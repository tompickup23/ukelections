"""Seat totals, council control and the plausibility comparison for the 2027
dry run (V2027_SPEC.md). No fit; reads the dry run file only.

    uv run python v2027_aggregate.py

Input:  data/forecasts/research/wards-2027-dryrun.json (v2027_forecast.py)
Output: results/v2027_results.json
Research only; nothing on the site reads it.
"""
from __future__ import annotations

import csv
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

import pandas as pd

from common import LANES, LANE_KEY, MAY26, MAY26_ACTUALS, OUT, REPO, dc_lane, pool_party, read_json, sha256
from v2027_forecast import BASE, COUNCILS, OUTFILE, WARDS, council_types, load_baselines, may26_ballot, may26_slate

DRIVE01 = Path.home() / "ukelections-research-cache/drive01/ward_results_2016-2026_candidates.csv"
DRIVE01_SHA = "ddeb3ebb6e258324a31fe4276d973e3ea2c82e24524931c32bc69764c92cf4e3"
ARMS = ("c2", "m50")
RESULTS = OUT / "v2027_results.json"


def lane_of_label(label: str) -> str:
    """V2027_SPEC.md: composition labels pooled to lanes by name."""
    if "Reform" in label:
        return "Reform UK"
    if "Labour" in label:
        return "Labour"
    if "Conservative" in label:
        return "Conservative"
    if "Liberal Democrat" in label:
        return "Liberal Democrats"
    if "Green" in label:
        return "Green Party"
    return "Others"


def winners_2023(ids: set[str]) -> dict:
    assert sha256(DRIVE01) == DRIVE01_SHA, "Democracy Club ward results file differs from V2027_SPEC.md"
    out = defaultdict(list)
    with open(DRIVE01, newline="") as f:
        for r in csv.DictReader(f):
            if r["ballot_paper_id"] in ids and r["elected"] == "True":
                out[r["ballot_paper_id"]].append(dc_lane({"party_ec_id": r["party_ec_id"], "party_name": r["party_name"]}))
    return out


def defended(w: dict, w23: dict, may: dict, baselines: dict):
    """Lanes of the seats up in ward w at the time they were last filled, or (None, reason)."""
    basis, k = w["seats_up_basis"], w["seats_up"]
    if basis == "elected_2023_same_ward":
        m = re.search(r"\((local\.[^)]+)\)", w.get("seats_up_note") or "")
        if not m or m.group(1) not in w23:
            return None, "2023 ballot not found in the Democracy Club file"
        lanes = w23[m.group(1)]
        if len(lanes) != k:
            return None, f"2023 ballot elected {len(lanes)}, seats up {k}"
        return lanes, None
    if basis == "order_retirement_2027":
        b = may.get(may26_ballot(w, may, baselines))
        if not b:
            return None, "May 2026 ballot not found"
        won = sorted([c for c in b["candidates"] if c.get("elected")], key=lambda c: c.get("votes") or 0)
        if len(won) < k:
            return None, "fewer May 2026 winners than seats up"
        return [pool_party(c.get("party_canonical") or "") for c in won[:k]], None
    return None, f"seats up basis {basis} has no defended seat rule"


def control_of(seats: dict, total: int):
    top = max(seats, key=seats.get)
    tied = sum(1 for v in seats.values() if v == seats[top]) > 1
    return (top if seats[top] > total / 2 else "No overall control"), (None if tied else top)


def main():
    doc = read_json(OUTFILE)
    recs = [r for r in doc["wards"] if r["block"] == "verified"]
    wj = read_json(WARDS)
    wards = {w["id"]: w for w in wj["wards"]}
    councils = {c["slug"]: c for c in read_json(COUNCILS)["councils"]}
    ctype = council_types([c for c in wj["councils"] if c["block"] == "verified"])
    may = read_json(MAY26_ACTUALS)["by_ballot"]
    baselines = load_baselines()
    res = {"source": {"dry_run": "data/forecasts/research/wards-2027-dryrun.json", "sha256": sha256(OUTFILE),
                      "inputs": doc["inputs"]}, "status": doc["status"]}

    # ---------------------------------------------------------------- seats
    fc = [r for r in recs if r["forecast"]]
    with_seats = [r for r in fc if r["seats_up"] is not None]
    seats_total = sum(r["seats_up"] for r in recs if r["seats_up"] is not None)
    uncovered = sum(r["seats_up"] for r in recs if r["seats_up"] is not None and not r["forecast"])
    seats = {"verified_wards": len(recs), "verified_seats_up_known": seats_total,
             "wards_with_blank_seats_up": sum(1 for r in recs if r["seats_up"] is None),
             "wards_with_forecast_and_blank_seats_up": sum(1 for r in fc if r["seats_up"] is None),
             "wards_counted": len(with_seats), "seats_counted": sum(r["seats_up"] for r in with_seats),
             "seats_up_not_covered": uncovered, "arms": {}}
    for a in ARMS:
        m0, ex = Counter(), defaultdict(float)
        for r in with_seats:
            f = r["forecast"][a]
            m0[f["leader"]] += r["seats_up"]
            for p, wc in f["win_chance"].items():
                ex[p] += r["seats_up"] * (wc or 0)
        seats["arms"][a] = {"m0": {p: m0.get(p, 0) for p in LANES}, "expected": {p: round(ex.get(p, 0.0), 1) for p in LANES},
                            "wards_led": dict(Counter(r["forecast"][a]["leader"] for r in fc))}
    by_type = defaultdict(lambda: {a: Counter() for a in ARMS})
    for r in with_seats:
        for a in ARMS:
            by_type[ctype.get(r["council_slug"], "unknown")][a][r["forecast"][a]["leader"]] += r["seats_up"]
    seats["m0_by_council_type"] = {t: {a: dict(v[a]) for a in ARMS} for t, v in sorted(by_type.items())}
    res["seats"] = seats

    # -------------------------------------------------------------- control
    need23 = set()
    for r in recs:
        m = re.search(r"\((local\.[^)]+)\)", wards[r["id"]].get("seats_up_note") or "")
        if m:
            need23.add(m.group(1))
    w23 = winners_2023(need23)
    by_council = defaultdict(list)
    for r in recs:
        by_council[r["council_slug"]].append(r)
    called, uncalled = {}, {}
    for slug, rs in sorted(by_council.items()):
        c = councils.get(slug) or {}
        T = (c.get("total_seats") or {}).get("value")
        nofc = [r["id"] for r in rs if not r["forecast"]]
        blank = [r["id"] for r in rs if r["seats_up"] is None]
        if nofc:
            uncalled[slug] = f"{len(nofc)} of {len(rs)} wards have no forecast"
            continue
        if blank:
            uncalled[slug] = f"{len(blank)} of {len(rs)} wards have blank seats up"
            continue
        if not T:
            uncalled[slug] = "chamber size blank in councils-2027.json"
            continue
        up = sum(r["seats_up"] for r in rs)
        if up == T:
            N, kind = {p: 0 for p in LANES}, "all_out"
        else:
            sc = (c.get("control") or {}).get("seat_counts")
            if not sc:
                uncalled[slug] = "current composition blank in councils-2027.json"
                continue
            C = Counter()
            for lab, n in sc.items():
                C[lane_of_label(lab)] += n
            if sum(C.values()) != T:
                uncalled[slug] = f"composition totals {sum(C.values())}, chamber {T}"
                continue
            D, bad = Counter(), None
            for r in rs:
                lanes, why = defended(wards[r["id"]], w23, may, baselines)
                if lanes is None:
                    bad = f"seats defended unresolved in {r['id']}: {why}"
                    break
                D.update(lanes)
            if bad:
                uncalled[slug] = bad
                continue
            N = {p: C.get(p, 0) - D.get(p, 0) for p in LANES}
            if min(N.values()) < 0:
                uncalled[slug] = "composition minus seats defended is negative in a lane"
                continue
            kind = "partial"
        entry = {"type": ctype.get(slug, "unknown"), "kind": kind, "chamber": T, "seats_up": up, "seats_not_up": N}
        for a in ARMS:
            s = Counter(N)
            for r in rs:
                s[r["forecast"][a]["leader"]] += r["seats_up"]
            ctl, largest = control_of({p: s.get(p, 0) for p in LANES}, T)
            entry[a] = {"seats": {p: s.get(p, 0) for p in LANES}, "control": ctl, "largest": largest}
        called[slug] = entry
    reasons = Counter(re.sub(r"\d+", "n", v).split(":")[0] for v in uncalled.values())
    res["control"] = {"councils_verified": len(by_council), "callable": len(called), "not_callable": len(uncalled),
                      "not_callable_reasons": dict(reasons), "not_callable_by_council": uncalled,
                      "control_counts": {a: dict(Counter(v[a]["control"] for v in called.values())) for a in ARMS},
                      "arms_disagree_on_control": sorted(s for s, v in called.items() if v["c2"]["control"] != v["m50"]["control"]),
                      "councils": called}

    # --------------------------------------------------------- plausibility
    # This folder's own cache (research output of rebuild.py); not untrusted data.
    ds = pd.read_pickle(BASE)
    m26 = ds[(ds.date == MAY26) & ~ds.is_by.astype(bool)].set_index("gss")
    pairs = []
    for r in fc:
        act = None
        if r["route"] == "direct" and r["gss_code"] in m26.index:
            row = m26.loc[r["gss_code"]]
            if isinstance(row, pd.DataFrame):
                row = row.iloc[0]
            act = {p: float(row[f"s_{LANE_KEY[p]}"]) for p in LANES}
        elif r["route"] == "bridge":
            w = wards[r["id"]]
            s = may26_slate(may26_ballot(w, may, baselines), may)
            act = s[0] if s else None
        if act:
            pairs.append((r, act))
    pl = {"wards_with_may_2026_result": len(pairs), "mean_share": {}, "first_places": {}, "same_leader_as_may_2026": {}}
    pl["mean_share"]["may_2026_actual"] = {p: round(sum(a[p] for _, a in pairs) / len(pairs), 4) for p in LANES}
    pl["first_places"]["may_2026_actual"] = dict(Counter(max(a, key=a.get) for _, a in pairs))
    for a in ARMS:
        pl["mean_share"][a] = {p: round(sum(r["forecast"][a]["shares"][p] for r, _ in pairs) / len(pairs), 4) for p in LANES}
        pl["first_places"][a] = dict(Counter(r["forecast"][a]["leader"] for r, _ in pairs))
        pl["same_leader_as_may_2026"][a] = sum(r["forecast"][a]["leader"] == max(x, key=x.get) for r, x in pairs)
    dis = []
    for slug, rs in by_council.items():
        f = [r for r in rs if r["forecast"]]
        if not f:
            continue
        n = sum(r["forecast"]["c2"]["leader"] != r["forecast"]["m50"]["leader"] for r in f)
        dis.append((n, n / len(f), slug, len(f)))
    dis.sort(key=lambda x: (-x[0], -x[1], x[2]))
    pl["wards_where_arms_disagree_on_leader"] = sum(r["forecast"]["c2"]["leader"] != r["forecast"]["m50"]["leader"] for r in fc)
    pl["top_ten_councils_arms_disagree"] = [
        {"council": s, "wards_forecast": m, "wards_leader_differs": n,
         "c2_first_places": dict(Counter(r["forecast"]["c2"]["leader"] for r in by_council[s] if r["forecast"])),
         "m50_first_places": dict(Counter(r["forecast"]["m50"]["leader"] for r in by_council[s] if r["forecast"]))}
        for n, _, s, m in dis[:10]]
    res["plausibility"] = pl

    # ---------------------------------------------------- standing coverage
    res["m50_benchmark"] = dict(Counter(r.get("m50_benchmark") for r in fc))
    res["others_assumed_to_stand"] = sum("Others" in r["standing_assumed"] for r in fc)
    RESULTS.write_text(json.dumps(res, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"seats": {k: v for k, v in seats.items() if k != "m0_by_council_type"},
                      "control": {k: v for k, v in res["control"].items() if k not in ("councils", "not_callable_by_council")},
                      "plausibility": pl, "m50_benchmark": res["m50_benchmark"]}, indent=1))


if __name__ == "__main__":
    main()
