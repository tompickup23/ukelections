"""Council control at the 7 May 2026 English local elections (CONTROL_SPEC.md).

Arms: published, candidate, blend (candidate and ward model S1, 0.5 and 0.5),
and the no change benchmark. Research only.

  uv run python control_score.py --inputs-only   build and check inputs, no score
  uv run python control_score.py                 the one scoring run

Output: results/control_summary.json
"""
from __future__ import annotations

import hashlib
import json
import sys
from collections import Counter, defaultdict

import pandas as pd

from common import (
    BLEND_WEIGHT_MODEL, CACHE, LANES, MAY26_ACTUALS, OUT, POSTAUDIT, REPO,
    dc_lane, pool_party, read_json,
)
from rolling_score import shares
from score import CANDIDATE_FILE, PUBLISHED_COMMIT, PUBLISHED_SHA, blend, git_show, pooled, top

CONTROL = REPO / "data/results/may-2026/council-control.json"
COMPOSITION = REPO / "data/features/council-composition-history.json"
DC_HISTORY = REPO / "data/history/dc-historic-results.json"
ALL_OUT_FRACTION = 0.6
ARMS = ["published", "candidate", "blend"]
LABOUR_COOP = {"Labour Co-operative", "Labour and Co-operative Party"}
OCD_LANE = {"con": "Conservative", "lab": "Labour", "ld": "Liberal Democrats",
            "green": "Green Party", "ref": "Reform UK"}
CC_LANE = dict(OCD_LANE, other="Others")


def seat_lane(label: str) -> str:
    return "Labour" if label in LABOUR_COOP else pool_party(label)


def pooled_seats(d: dict) -> dict:
    """Forecast shares pooled for seats: as score.pooled, with Labour Co-operative as Labour."""
    out = defaultdict(float)
    for k, v in d.items():
        out[seat_lane(k)] += float(v or 0)
    return {p: out.get(p, 0.0) for p in LANES}


def ocd_pool(row: dict) -> dict:
    out = {p: 0 for p in LANES}
    for k, v in row.items():
        if k in ("total", "majority") or not isinstance(v, (int, float)):
            continue
        out[OCD_LANE.get(k, "Others")] += int(v)
    return out


# --------------------------------------------------------------- inputs

def load_actuals():
    by = read_json(MAY26_ACTUALS)["by_ballot"]
    rows = [r for r in by.values() if r["tier"] == "local" and not r["is_by_election"]]
    by_council = defaultdict(list)
    for r in rows:
        by_council[r["council_slug"]].append(r)
    return by_council


def ward_slates(r) -> Counter:
    """Candidates fielded per lane on the actual ballot (known at close of nominations)."""
    return Counter(dc_lane(c) for c in r["candidates"])


def actual_wins(r) -> Counter:
    return Counter(seat_lane(w["party_canonical"]) for w in r["winners"])


def history_index():
    h = read_json(DC_HISTORY)
    hb = h["by_ballot"]
    per = defaultdict(lambda: defaultdict(dict))  # council -> year -> ward_slug -> ballot
    for b in hb.values():
        if b["tier"] != "local" or b["is_by_election"] or not b.get("council_slug"):
            continue
        per[b["council_slug"]][int(b["year"])][b["ward_slug"]] = b
    return per, h["snapshot"]


def defended(slug, rows, T, hist):
    """D for a thirds or halves council: (Counter of lanes, None) or (None, reason)."""
    years = hist.get(slug, {})
    seats_by_year = {y: sum(sum(1 for c in b["candidates"] if c.get("elected")) for b in w.values())
                     for y, w in years.items()}
    allout = [y for y in range(2022, 2026) if seats_by_year.get(y, 0) >= ALL_OUT_FRACTION * T]
    Y = max(allout) if allout else 2022
    is_allout = bool(allout)
    later = sorted({y for y in years if Y < y < 2026} | {2026})
    j = len(later)
    D = Counter()
    unresolved = []
    for r in rows:
        k = r["winner_count"]
        b = years.get(Y, {}).get(r["ward_slug"])
        if not b:
            unresolved.append(f"{r['ward_slug']} (no {Y} contest for this ward)")
            continue
        won = sorted([c for c in b["candidates"] if c.get("elected")], key=lambda c: -(c.get("votes") or 0))
        n = len(won)
        if not is_allout:
            if n != k:
                unresolved.append(f"{r['ward_slug']} ({Y} filled {n}, 2026 has {k})")
                continue
            for c in won:
                D[dc_lane(c)] += 1
        else:
            rank = n - j + 1
            if k != 1 or not (1 <= rank <= n) or any(c.get("votes") is None for c in won):
                unresolved.append(f"{r['ward_slug']} (all out {Y}: n {n}, j {j}, 2026 seats {k})")
                continue
            D[dc_lane(won[rank - 1])] += 1
    if unresolved:
        return None, {"Y": Y, "all_out_year": is_allout, "unresolved_wards": unresolved}
    return D, {"Y": Y, "all_out_year": is_allout, "j": j}


def previous_holders_all_out(slug, rows, hist):
    """Secondary fill for an all out council: winners of the same ward slug in the last all out year."""
    years = hist.get(slug, {})
    out = {}
    for y in sorted(years, reverse=True):
        if y >= 2026:
            continue
        w = years[y]
        if not w:
            continue
        T_y = sum(sum(1 for c in b["candidates"] if c.get("elected")) for b in w.values())
        if T_y < ALL_OUT_FRACTION * sum(r["winner_count"] for r in rows):
            continue
        for r in rows:
            b = w.get(r["ward_slug"])
            if b:
                won = [c for c in b["candidates"] if c.get("elected")]
                if len(won) == r["winner_count"]:
                    out[r["ballot_paper_id"]] = Counter(dc_lane(c) for c in won)
        break
    return out


def defended_by_ward(slug, rows, hist, info):
    """Per-ward D for the secondary fill on a thirds or halves council."""
    years = hist.get(slug, {})
    out = {}
    for r in rows:
        b = years.get(info["Y"], {}).get(r["ward_slug"])
        won = sorted([c for c in b["candidates"] if c.get("elected")], key=lambda c: -(c.get("votes") or 0))
        if info["all_out_year"]:
            out[r["ballot_paper_id"]] = Counter([dc_lane(won[len(won) - info["j"]])])
        else:
            out[r["ballot_paper_id"]] = Counter(dc_lane(c) for c in won)
    return out


def load_forecasts():
    buf = git_show(PUBLISHED_COMMIT, "data/predictions/may-2026/local-and-mayor.json")
    assert hashlib.sha256(buf).hexdigest() == PUBLISHED_SHA, "published forecast hash"
    pub = json.loads(buf)["predictions"]
    live = {r["ballot_paper_id"]: seat_lane(r["predicted_winner"])
            for r in read_json(POSTAUDIT)["live"]["rows"] if r["ballot_paper_id"].startswith("local.")}
    arms = {a: {} for a in ARMS}
    labels = Counter()
    for i, e in pub.items():
        if not i.startswith("local.") or not e.get("prediction"):
            continue
        labels.update(e["prediction"].keys())
        sh = pooled_seats({p: v.get("pct", 0) for p, v in e["prediction"].items()})
        if sum(sh.values()) > 0 and i in live:
            arms["published"][i] = {"leader": live[i], "shares": sh}
    cand = read_json(CANDIDATE_FILE)["predictions"]
    for i, e in cand.items():
        if i.startswith("local.") and e and e.get("prediction"):
            labels.update(e["prediction"].keys())
            sh = pooled_seats({p: v.get("pct", 0) for p, v in e["prediction"].items()})
            if top(sh):
                arms["candidate"][i] = {"leader": top(sh), "shares": sh}
    df = pd.read_pickle(CACHE / "recency_predictions.pkl")
    may = df[df.set == "may26"].set_index("ballot_paper_id")
    for i, r in may.iterrows():
        s1 = shares(r, "s1")
        c = arms["candidate"].get(i)
        if s1 and c:
            b = blend(c["shares"], s1, BLEND_WEIGHT_MODEL)
            arms["blend"][i] = {"leader": top(b), "shares": b}
    coop = {k: v for k, v in labels.items() if k in LABOUR_COOP}
    return arms, coop


# --------------------------------------------------------------- scoring helpers

def allocate(f, k, slate, rule):
    if rule == "A":
        return Counter({f["leader"]: k})
    order = [f["leader"]] + [p for p in sorted(LANES, key=lambda p: -f["shares"].get(p, 0))
                             if p != f["leader"] and f["shares"].get(p, 0) > 0]
    out, left = Counter(), k
    for p in order:
        t = min(left, slate.get(p, 0))
        out[p] += t
        left -= t
        if not left:
            break
    if left:  # slates too short for the seats (not expected): rest to the leader
        out[f["leader"]] += left
    return out


def control_of(seats, T):
    for p in LANES:
        if seats.get(p, 0) > T / 2:
            return p
    return "NOC"


def largest_of(seats):
    m = max(seats.get(p, 0) for p in LANES)
    tied = [p for p in LANES if seats.get(p, 0) == m]
    return tied


def main():
    inputs_only = "--inputs-only" in sys.argv
    by_council = load_actuals()
    missing = Counter(b["council_slug"] for b in read_json(MAY26_ACTUALS)["missing_ballots"] if b["tier"] == "local")
    cc = {c["council_slug"]: c for c in read_json(CONTROL)["councils"]}
    comp = read_json(COMPOSITION)["per_council"]
    hist, hist_snap = history_index()
    arms, coop_labels = load_forecasts()

    councils = {}
    excluded = []
    for slug in sorted(by_council):
        rows = by_council[slug]
        c = cc[slug]
        T = c["cycle"]["total_seats"]
        U = sum(r["winner_count"] for r in rows)
        ocd = comp.get(c.get("ocd_slug") or slug, {}).get("history", {}).get("2025")
        pre = ocd_pool(ocd) if ocd else None
        rec = {"T": T, "U": U, "wards": len(rows), "pre": pre, "pre_total": ocd and ocd.get("total")}
        # Fault fixed before scoring: undeclared ballots are absent from by_ballot, so U alone
        # made all out councils with gaps (Birmingham, Newham, Tower Hamlets) look like thirds.
        undeclared = missing.get(slug, 0)
        undeclared_seats = c["may7_wins"].get("undeclared_seats", 0)
        if undeclared or undeclared_seats:
            excluded.append({"council": slug, "reason": f"results incomplete ({undeclared} ballots with no result in the merged file, "
                                                        f"{undeclared_seats} undeclared seats in council-control.json)"})
            continue
        if U >= ALL_OUT_FRACTION * T:
            rec["cycle"] = "all out"
            if U < T:
                excluded.append({"council": slug, "reason": f"results cover fewer seats than the chamber ({U} of {T})"})
                continue
            if U > T:
                excluded.append({"council": slug, "reason": f"more seats in results than the chamber ({U} of {T})"})
                continue
            rec["N"] = {p: 0 for p in LANES}
            rec["fill"] = previous_holders_all_out(slug, rows, hist)
        else:
            rec["cycle"] = "thirds or halves"
            if pre is None:
                excluded.append({"council": slug, "reason": "no 2025 composition"})
                continue
            if ocd["total"] != T:
                excluded.append({"council": slug, "reason": f"2025 composition total {ocd['total']} differs from chamber {T}"})
                continue
            D, info = defended(slug, rows, T, hist)
            rec["defended_rule"] = info
            if D is None:
                excluded.append({"council": slug, "reason": f"seats defended unresolved in {len(info['unresolved_wards'])} of {len(rows)} wards (year {info['Y']})",
                                 "detail": info["unresolved_wards"]})
                continue
            N = {p: pre[p] - D.get(p, 0) for p in LANES}
            if sum(D.values()) != U or any(v < 0 for v in N.values()):
                excluded.append({"council": slug, "reason": "composition does not reconcile with seats up plus seats not up",
                                 "detail": {"pre": pre, "defended": dict(D), "seats_not_up": N}})
                continue
            rec["N"] = N
            rec["D"] = dict(D)
            rec["fill"] = defended_by_ward(slug, rows, hist, info)
        rec["rows"] = rows
        councils[slug] = rec

    # actual result and cross-check
    cross = []
    for slug, rec in councils.items():
        seats = Counter(rec["N"])
        for r in rec["rows"]:
            seats.update(actual_wins(r))
        rec["actual"] = {p: seats.get(p, 0) for p in LANES}
        rec["actual_control"] = control_of(rec["actual"], rec["T"])
        rec["actual_largest"] = largest_of(rec["actual"])
        ctl = cc[slug]["control"]
        theirs = CC_LANE.get(ctl.get("controlling_party"), ctl.get("controlling_party")) if ctl["status"] == "majority" else (
            "NOC" if ctl["status"] == "no_overall_control" else ctl["status"])
        if theirs != rec["actual_control"]:
            cross.append({"council": slug, "derived_here": rec["actual_control"], "council_control_json": theirs,
                          "cycle": rec["cycle"], "derived_seats": rec["actual"],
                          "council_control_post": {CC_LANE.get(k, "Others"): v for k, v in cc[slug]["post_may7"]["by_party"].items() if v}})

    # coverage per arm
    coverage = {}
    for a in ARMS:
        coverage[a] = {}
        for slug, rec in councils.items():
            miss = [r["ballot_paper_id"] for r in rec["rows"] if r["ballot_paper_id"] not in arms[a]]
            unfillable = [i for i in miss if i not in rec["fill"]]
            coverage[a][slug] = {"wards_missing": len(miss), "wards_missing_unfillable": len(unfillable)}

    voted = sorted(by_council)
    print(f"councils voting {len(voted)}; inputs built for {len(councils)}; excluded {len(excluded)}")
    for e in excluded:
        print("  excluded", e["council"], e["reason"])
    print(f"actual control derived here disagrees with council-control.json in {len(cross)} councils")
    for x in cross:
        print("  ", x["council"], x["cycle"], "here", x["derived_here"], "json", x["council_control_json"])
    print("Labour Co-operative labels in forecasts:", coop_labels)
    for a in ARMS:
        full = sum(1 for v in coverage[a].values() if v["wards_missing"] == 0)
        fill = sum(1 for v in coverage[a].values() if v["wards_missing_unfillable"] == 0)
        print(f"  {a}: wards forecast {len(arms[a])}; councils fully covered {full}; after fill {fill}")
    if inputs_only:
        return

    # ------------------------------------------------------------ the one scoring run
    def forecast_seats(a, rec, rule, fill):
        seats = Counter(rec["N"])
        for r in rec["rows"]:
            f = arms[a].get(r["ballot_paper_id"])
            if f:
                seats.update(allocate(f, r["winner_count"], ward_slates(r), rule))
            elif fill and r["ballot_paper_id"] in rec["fill"]:
                seats.update(rec["fill"][r["ballot_paper_id"]])
            else:
                return None
        return {p: seats.get(p, 0) for p in LANES}

    def judge(seats, rec):
        ctl = control_of(seats, rec["T"])
        lg = largest_of(seats)
        return {
            "control": ctl,
            "largest": lg[0] if len(lg) == 1 else "tie: " + ", ".join(lg),
            "control_right": ctl == rec["actual_control"],
            "largest_right": len(lg) == 1 and lg[0] in rec["actual_largest"],
            "abs_seat_error": {p: abs(seats[p] - rec["actual"][p]) for p in LANES},
        }

    calls = {}
    for slug, rec in councils.items():
        calls[slug] = {}
        for a in ARMS:
            for rule in ("A", "B"):
                for fill in (False, True):
                    s = forecast_seats(a, rec, rule, fill)
                    if s is not None:
                        calls[slug][(a, rule, fill)] = {"seats": s, **judge(s, rec)}
        pre = rec["pre"]
        if pre:
            calls[slug][("no_change", "-", False)] = {"seats": pre, **judge(pre, rec)}
        else:
            calls[slug][("no_change", "-", False)] = {"seats": None, "control": "no call", "largest": "no call",
                                                       "control_right": False, "largest_right": False, "abs_seat_error": None}

    def summarise(keys, slugs):
        out = {}
        for key in keys:
            got = [calls[s][key] for s in slugs if key in calls[s]]
            errs = [v for g in got if g["abs_seat_error"] for v in g["abs_seat_error"].values()]
            out[key] = {
                "councils_scored": len(got),
                "control_right": sum(g["control_right"] for g in got),
                "largest_right": sum(g["largest_right"] for g in got),
                "mean_abs_seat_error_per_lane_per_council": round(sum(errs) / len(errs), 3) if errs else None,
                "seat_error_councils": len(errs) // len(LANES),
            }
        return out

    primary = [(a, "A", False) for a in ARMS] + [("no_change", "-", False)]
    common = [s for s in councils if all(k in calls[s] for k in primary)]
    keyname = lambda k: k[0] if k[0] == "no_change" else f"{k[0]} rule {k[1]}{' with fill' if k[2] else ''}"
    allkeys = [(a, r, f) for a in ARMS for r in ("A", "B") for f in (False, True)] + [("no_change", "-", False)]
    common_b = [s for s in councils if all((a, "B", False) in calls[s] for a in ARMS)]
    common_fill = [s for s in councils if all((a, "A", True) in calls[s] for a in ARMS)]

    results = {
        "common_set_primary": {keyname(k): v for k, v in summarise(primary, common).items()},
        "common_set_rule_B": {keyname(k): v for k, v in summarise([(a, "B", False) for a in ARMS] + [("no_change", "-", False)], common_b).items()},
        "common_set_with_fill": {keyname(k): v for k, v in summarise([(a, "A", True) for a in ARMS] + [("no_change", "-", False)], common_fill).items()},
        "own_coverage": {keyname(k): v for k, v in summarise(allkeys, list(councils)).items()},
        "common_set_councils": sorted(common),
        "common_set_rule_B_councils": len(common_b),
        "common_set_with_fill_councils": len(common_fill),
    }
    wrong = {}
    for k in primary:
        wrong[keyname(k)] = [{"council": s, "forecast_control": calls[s][k]["control"], "actual_control": councils[s]["actual_control"],
                              "forecast_largest": calls[s][k]["largest"], "actual_largest": councils[s]["actual_largest"],
                              "in_common_set": s in common}
                             for s in councils if k in calls[s] and not calls[s][k]["control_right"]]
    others = [{"council": s, "actual_control": rec["actual_control"], "actual_largest": rec["actual_largest"], "actual_seats": rec["actual"]}
              for s, rec in councils.items() if rec["actual_control"] == "Others" or "Others" in rec["actual_largest"]]
    per_council = {s: {"cycle": rec["cycle"], "T": rec["T"], "U": rec["U"], "seats_not_up": rec["N"], "defended": rec.get("D"),
                       "defended_rule": rec.get("defended_rule"), "actual_seats": rec["actual"], "actual_control": rec["actual_control"],
                       "actual_largest": rec["actual_largest"],
                       "calls": {keyname(k): {kk: vv for kk, vv in v.items() if kk != "abs_seat_error"} for k, v in calls[s].items()}}
                   for s, rec in councils.items()}
    actual_counts = Counter(rec["actual_control"] for rec in councils.values())
    summary = {
        "spec": "CONTROL_SPEC.md",
        "sources": {
            "actual_results": str(MAY26_ACTUALS.relative_to(REPO)),
            "council_control": str(CONTROL.relative_to(REPO)),
            "composition": str(COMPOSITION.relative_to(REPO)) + " (2025 row, OpenCouncilData)",
            "defended_seats": str(DC_HISTORY.relative_to(REPO)) + f" (snapshot {hist_snap.get('snapshot_id')})",
            "published": f"data/predictions/may-2026/local-and-mayor.json at {PUBLISHED_COMMIT}, sha256 {PUBLISHED_SHA}",
            "candidate": str(CANDIDATE_FILE.relative_to(REPO)),
            "ward_model_s1": "research/ward-model-2026-11/cache/recency_predictions.pkl, s1_* columns, set may26",
            "blend_weight_model": BLEND_WEIGHT_MODEL,
        },
        "councils_voting": len(voted),
        "councils_with_inputs": len(councils),
        "excluded": excluded,
        "actual_control_counts": dict(actual_counts),
        "actual_control_disagreements_with_council_control_json": cross,
        "councils_with_others_in_control_or_largest": others,
        "coverage_wards_missing": coverage,
        "labour_cooperative_labels_in_forecasts": coop_labels,
        "results": results,
        "control_wrong_primary": wrong,
        "per_council": per_council,
    }
    OUT.mkdir(exist_ok=True)
    with open(OUT / "control_summary.json", "w") as f:
        json.dump(summary, f, indent=1, default=lambda o: list(o) if isinstance(o, (set, tuple)) else str(o))
        f.write("\n")
    print(f"common set {len(common)} councils")
    for name, block in results.items():
        if isinstance(block, dict):
            print(name)
            for k, v in block.items():
                print(f"  {k:28s} control {v['control_right']}/{v['councils_scored']}  largest {v['largest_right']}/{v['councils_scored']}  seat MAE {v['mean_abs_seat_error_per_lane_per_council']}")


if __name__ == "__main__":
    main()
