"""Score council control at the 7 May 2026 English local elections, as fixed in
CONTROL_SPEC.md (committed before this script was run).

  uv run python control_score.py --prep   data preparation and exclusions only, no score
  uv run python control_score.py          the one scoring run

Output: results/control_summary.json and CONTROL_RESULTS.md (tables; the prose
answer and limits are written by hand from the summary).
"""
from __future__ import annotations

import hashlib
import itertools
import json
import math
import sys
from collections import Counter, defaultdict

import numpy as np
import pandas as pd

from common import (
    ARMS, BLEND_WEIGHT_MODEL, CACHE, DC_HISTORY, LANES, LANE_KEY, MAY26_ACTUALS, OUT, POSTAUDIT,
    REPO, dc_lane, pool_party, read_json,
)
from score import PUBLISHED_COMMIT, PUBLISHED_SHA, blend, git_show, pooled, top

COMPOSITION = REPO / "data/features/council-composition-history.json"
CONTROL_FILE = REPO / "data/results/may-2026/council-control.json"
COMP_LANE = {"con": "Conservative", "lab": "Labour", "ld": "Liberal Democrats", "green": "Green Party",
             "ref": "Reform UK", "ukip": "Others", "snp": "Others", "pc": "Others", "nat": "Others",
             "other": "Others"}
CTL_LANE = {"con": "Conservative", "lab": "Labour", "ld": "Liberal Democrats", "green": "Green Party",
            "ref": "Reform UK"}
ALL_OUT_SHARE = 0.9
SPLIT_PP = 0.05
POLLING_DAY = "2026-05-07"
NOC, OTH_MAJ = "NOC", "Others majority"
ARM_NAMES = ["published", "candidate", "blend"]


def comp_lanes(row: dict) -> dict:
    out = {p: 0 for p in LANES}
    for k, lane in COMP_LANE.items():
        out[lane] += int(row.get(k) or 0)
    return out


def control(seats: dict, size: int) -> str:
    for p in LANES:
        if seats.get(p, 0) * 2 > size:
            return OTH_MAJ if p == "Others" else p
    return NOC


def largest(seats: dict) -> tuple:
    m = max(seats.values())
    return tuple(sorted(p for p in LANES if seats.get(p, 0) == m))


def dc_winners(r: dict) -> list[dict]:
    """Elected candidates, highest vote first."""
    el = [c for c in r["candidates"] if c.get("elected")]
    return sorted(el, key=lambda c: -(c.get("votes") or 0))


# ---------------------------------------------------------------- defenders

def defenders_for_ward(events, all_out_year, s26):
    """Enumerate every seat assignment the data allows (CONTROL_SPEC.md, steps 1 to 4).

    events: Democracy Club results for the ward before polling day, any year.
    Returns (sorted tuple of defending lanes, None) or (None, reason).
    """
    ords = sorted([r for r in events if not r["is_by_election"]], key=lambda r: r["election_date"])
    byes = [r for r in events if r["is_by_election"]]
    if all_out_year is not None:
        start = [r for r in ords if r["year"] == all_out_year]
        if not start:
            return None, f"no ward record at the council's {all_out_year} all-out election"
        start = start[0]
        q0 = tuple(dc_lane(c) for c in reversed(dc_winners(start)))  # lowest vote first
        if not q0:
            return None, "no winners recorded at the all-out election"
        later = [r for r in ords + byes if r["election_date"] > start["election_date"]]
        building = False
        states = {q0}
    else:
        later = [r for r in ords + byes if r["election_date"] >= "2022-05-01"]
        first_ord = next((r for r in sorted(later, key=lambda r: r["election_date"]) if not r["is_by_election"]), None)
        if first_ord is None or first_ord["year"] != 2022:
            return None, "no ordinary election in this ward in 2022 (the seat up in 2026 has no record)"
        building = True
        states = {()}
    later.sort(key=lambda r: (r["election_date"], r["is_by_election"]))
    for r in later:
        ws = dc_winners(r)
        if not ws:
            return None, f"no winners recorded for {r['ballot_paper_id']}"
        lanes = [dc_lane(c) for c in ws]
        new = set()
        for q in states:
            if r["is_by_election"]:
                qs = {q}
                for ln in lanes:  # each by-election winner replaces an unknown seat
                    nxt = set()
                    for qq in qs:
                        for i in range(len(qq)):
                            nxt.add(qq[:i] + (ln,) + qq[i + 1:])
                        if building:
                            nxt.add(qq)  # the seat may predate the window and be re-elected later
                    qs = nxt
                if not qs:
                    return None, f"by-election {r['ballot_paper_id']} with no seat it could fill"
                new |= qs
            else:
                base = (q if building else q[1:]) + (lanes[0],)
                qs = {base}
                for ln in lanes[1:]:  # casual vacancies filled at an ordinary election
                    nxt = set()
                    for qq in qs:
                        for i in range(len(qq) - 1):
                            nxt.add(qq[:i] + (ln,) + qq[i + 1:])
                        if building:
                            nxt.add(qq)
                    qs = nxt
                if not qs:
                    return None, f"casual vacancy at {r['ballot_paper_id']} with no seat it could fill"
                new |= qs
        states = new
        if len(states) > 20000:
            return None, "too many possible seat histories"
    outcomes = set()
    for q in states:
        if s26 > len(q):
            return None, f"2026 elects {s26} but only {len(q)} seats are on record"
        if s26 == len(q):
            outcomes.add(tuple(sorted(q)))
            continue
        for extra in itertools.combinations(range(1, len(q)), s26 - 1):
            outcomes.add(tuple(sorted((q[0],) + tuple(q[i] for i in extra))))
    if len(outcomes) != 1:
        return None, f"defending parties not determined ({len(outcomes)} possibilities)"
    return next(iter(outcomes)), None


def holders_all_up(events, s26):
    """Secondary coverage, all-up council: the winners of the ward's latest ordinary election,
    if it elected the same number of seats, kept only if later by-elections leave the lanes unique."""
    ords = sorted([r for r in events if not r["is_by_election"]], key=lambda r: r["election_date"])
    if not ords:
        return None
    last = ords[-1]
    ws = dc_winners(last)
    if len(ws) != s26:
        return None
    states = {tuple(sorted(dc_lane(c) for c in ws))}
    for r in sorted([r for r in events if r["is_by_election"] and r["election_date"] > last["election_date"]],
                    key=lambda r: r["election_date"]):
        for c in dc_winners(r):
            ln = dc_lane(c)
            states = {tuple(sorted(q[:i] + (ln,) + q[i + 1:])) for q in states for i in range(len(q))}
    return next(iter(states)) if len(states) == 1 else None


# ---------------------------------------------------------------- forecasts

def load_arms(ballots):
    buf = git_show(PUBLISHED_COMMIT, "data/predictions/may-2026/local-and-mayor.json")
    sha = hashlib.sha256(buf).hexdigest()
    assert sha == PUBLISHED_SHA, f"published forecast hash {sha}"
    pub = json.loads(buf)["predictions"]
    cand = read_json(ARMS / "candidate-2026-10-24.json")["predictions"]
    rp = pd.read_pickle(CACHE / "recency_predictions.pkl")  # local cache written by recency_fit.py in this folder
    rp = rp[rp.set == "may26"].set_index("ballot_paper_id")
    arms = {a: {} for a in ARM_NAMES}
    for i in ballots:
        e = pub.get(i) or {}
        if e.get("prediction"):
            sh = pooled({p: v.get("pct", 0) for p, v in e["prediction"].items()})
            if top(sh):
                arms["published"][i] = sh
        e = cand.get(i) or {}
        if e.get("prediction"):
            sh = pooled({p: v.get("pct", 0) for p, v in e["prediction"].items()})
            if top(sh):
                arms["candidate"][i] = sh
        if i in rp.index and i in arms["candidate"]:
            r = rp.loc[i]
            s1 = {p: float(r[f"s1_{LANE_KEY[p]}"]) for p in LANES}
            s1 = {p: (0.0 if np.isnan(v) else v) for p, v in s1.items()}
            if sum(s1.values()) > 0:
                b = blend(arms["candidate"][i], s1, BLEND_WEIGHT_MODEL)
                if b and top(b):
                    arms["blend"][i] = b
    # descriptive: published leader by pooled top against the post-audit predicted_winner
    pa = read_json(POSTAUDIT)
    live = {r["ballot_paper_id"]: pool_party(r["predicted_winner"]) for r in pa["live"]["rows"]
            if r["ballot_paper_id"].startswith("local.")}
    both = [i for i in ballots if i in live and i in arms["published"]]
    differ = [i for i in both if top(arms["published"][i]) != live[i]]
    return arms, {"wards_compared": len(both), "wards_differing": len(differ), "examples": differ[:10]}


def ward_seats(sh: dict, s: int, rule: str) -> dict:
    order = sorted(LANES, key=lambda p: -sh.get(p, 0))
    lead, second = order[0], order[1]
    out = Counter()
    if rule == "secondary" and s >= 2 and sh.get(second, 0) > 0 and sh[lead] - sh[second] <= SPLIT_PP:
        out[lead] += math.ceil(s / 2)
        out[second] += s - math.ceil(s / 2)
    else:
        out[lead] += s
    return out


# ---------------------------------------------------------------- main

def main(prep_only: bool):
    res = read_json(MAY26_ACTUALS)
    bb = res["by_ballot"]
    comp_all = read_json(COMPOSITION)["per_council"]
    ctl_file = {c["council_slug"]: c for c in read_json(CONTROL_FILE)["councils"]}
    hist = defaultdict(list)
    for r in read_json(DC_HISTORY)["results"]:
        if r.get("tier") == "local" and r.get("council_slug") and r["election_date"] < POLLING_DAY and r["year"] >= 2014:
            hist[r["council_slug"]].append(r)

    sched = defaultdict(list)
    bye_only = set()
    for k, v in bb.items():
        if v["tier"] != "local":
            continue
        if v["is_by_election"]:
            bye_only.add(v["council_slug"])
        else:
            sched[v["council_slug"]].append(v)
    bye_only -= set(sched)
    partial_res = {p["council_slug"]: p for p in res["partial_councils"]}
    missing = defaultdict(int)
    for m in res["missing_ballots"]:
        if m["tier"] == "local":
            missing[m["council_slug"]] += 1

    councils = {}
    excluded = {}  # council -> reason (all arms)
    faults = []
    for c in sorted(sched):
        bal = sched[c]
        up = sum(v["winner_count"] for v in bal)
        h = comp_all.get(c, {}).get("history", {})
        c25 = h.get("2025")
        info = {"wards": len(bal), "seats_up": up, "comp_2025_total": c25["total"] if c25 else None}
        if c in partial_res or missing.get(c):
            excluded[c] = (f"results incomplete: {partial_res.get(c, {}).get('declared', '?')} of "
                           f"{partial_res.get(c, {}).get('expected', '?')} declared per the results file")
            councils[c] = info | {"type": None}
            continue
        if c25 is None:
            in_ctl = ctl_file.get(c, {})
            if in_ctl.get("inaugural"):
                info |= {"type": "all_up", "size": up, "continuing": {p: 0 for p in LANES}}
            else:
                excluded[c] = "no 2025 composition and not a new council: seats not up cannot be known"
                info |= {"type": None}
            councils[c] = info
            continue
        comp25 = comp_lanes(c25)
        if sum(comp25.values()) != c25["total"]:
            faults.append(f"{c}: 2025 composition parties sum to {sum(comp25.values())}, total says {c25['total']}")
        if up >= ALL_OUT_SHARE * c25["total"]:
            if up < c25["total"]:
                excluded[c] = (f"all up but {up} seats elected against {c25['total']} in the 2025 composition: "
                               "unfilled seats or a smaller council cannot be told apart")
                councils[c] = info | {"type": "all_up"}
                continue
            info |= {"type": "all_up", "size": up, "continuing": {p: 0 for p in LANES}, "comp_2025": comp25}
            councils[c] = info
            continue
        # partial council
        info |= {"type": "partial", "size": c25["total"], "comp_2025": comp25}
        yw = Counter()
        for r in hist[c]:
            if not r["is_by_election"]:
                yw[r["year"]] += len(dc_winners(r))
        all_out = [y for y in yw if 2022 <= y < 2026 and str(y) in h and yw[y] >= ALL_OUT_SHARE * h[str(y)]["total"]]
        A = max(all_out) if all_out else None
        info["all_out_year_used"] = A
        byw = defaultdict(list)
        for r in hist[c]:
            byw[r["ward_slug"]].append(r)
        defend = {}
        unres = []
        for v in bal:
            d, why = defenders_for_ward(byw.get(v["ward_slug"], []), A, v["winner_count"])
            if d is None:
                unres.append(f"{v['ward_slug']}: {why}")
            else:
                defend[v["ballot_paper_id"]] = d
        info["defenders"] = {k: list(x) for k, x in defend.items()}
        if unres:
            excluded[c] = f"defenders not determined in {len(unres)} ward(s): " + "; ".join(unres)
            councils[c] = info
            continue
        dl = Counter(p for d in defend.values() for p in d)
        cont = {p: comp25[p] - dl.get(p, 0) for p in LANES}
        info["defenders_by_lane"] = {p: dl.get(p, 0) for p in LANES}
        if any(x < 0 for x in cont.values()):
            neg = ", ".join(f"{p} {x}" for p, x in cont.items() if x < 0)
            excluded[c] = f"does not reconcile: 2025 composition minus defenders is negative ({neg})"
            councils[c] = info
            continue
        info["continuing"] = cont
        councils[c] = info

    scorable = [c for c in councils if c not in excluded]
    ballots = [v["ballot_paper_id"] for c in scorable for v in sched[c]]
    arms, pub_leader_check = load_arms(ballots)

    # actual
    actual = {}
    for c in scorable:
        info = councils[c]
        wins = Counter()
        for v in sched[c]:
            for w in v["winners"]:
                wins[pool_party(w["party_canonical"])] += 1
        post = {p: info["continuing"][p] + wins.get(p, 0) for p in LANES}
        if sum(post.values()) != info["size"]:
            faults.append(f"{c}: actual seats sum to {sum(post.values())}, size {info['size']}")
        actual[c] = {"seats": post, "control": control(post, info["size"]), "largest": largest(post)}

    # comparison with council-control.json
    disagree = []
    for c in scorable:
        x = ctl_file.get(c)
        if not x:
            disagree.append({"council": c, "derived": actual[c]["control"], "council_control_json": "absent"})
            continue
        st = x["control"]["status"]
        theirs = NOC if st == "no_overall_control" else CTL_LANE.get(x["control"].get("controlling_party"), str(x["control"].get("controlling_party")))
        if theirs != actual[c]["control"]:
            disagree.append({"council": c, "type": councils[c]["type"], "derived": actual[c]["control"],
                             "council_control_json": theirs,
                             "derived_seats": actual[c]["seats"],
                             "council_control_json_post": {CTL_LANE.get(k, "Others"): v for k, v in x["post_may7"]["by_party"].items() if v}})

    # coverage per arm
    def pre_holder(c, v):
        info = councils[c]
        if info["type"] == "partial":
            d = info["defenders"].get(v["ballot_paper_id"])
            return Counter(d) if d else None
        d = holders_all_up([r for r in hist[c] if r["ward_slug"] == v["ward_slug"]], v["winner_count"])
        return Counter(d) if d else None

    coverage = {}
    for a in ARM_NAMES:
        prim = [c for c in scorable if all(v["ballot_paper_id"] in arms[a] for v in sched[c])]
        sec, filled = [], {}
        for c in scorable:
            ok, f = True, {}
            for v in sched[c]:
                if v["ballot_paper_id"] in arms[a]:
                    continue
                ph = pre_holder(c, v)
                if ph is None:
                    ok = False
                    break
                f[v["ballot_paper_id"]] = ph
            if ok:
                sec.append(c)
                if f:
                    filled[c] = f
        coverage[a] = {"primary": prim, "secondary": sec, "secondary_filled": filled,
                       "not_scored_primary": {c: sum(1 for v in sched[c] if v["ballot_paper_id"] not in arms[a])
                                              for c in scorable if c not in prim}}
    bench_set = [c for c in scorable if councils[c].get("comp_2025")]
    common = [c for c in scorable if all(c in coverage[a]["primary"] for a in ARM_NAMES) and c in bench_set]

    prep = {
        "councils_voting": len(sched),
        "by_election_only_councils": sorted(bye_only),
        "councils_scorable_on_actuals": len(scorable),
        "excluded_all_arms": excluded,
        "faults": faults,
        "published_leader_check": pub_leader_check,
        "coverage_counts": {a: {"primary": len(coverage[a]["primary"]), "secondary": len(coverage[a]["secondary"])} for a in ARM_NAMES},
        "benchmark_councils": len(bench_set),
        "common_councils": len(common),
        "types": Counter(councils[c]["type"] for c in scorable),
    }
    if prep_only:
        print(json.dumps(prep, indent=1, default=str))
        return

    # ------------------------------------------------------------ scoring
    def forecast_seats(a, c, rule, fill):
        info = councils[c]
        wins = Counter()
        for v in sched[c]:
            sh = arms[a].get(v["ballot_paper_id"])
            if sh is not None:
                wins += ward_seats(sh, v["winner_count"], rule)
            else:
                wins += fill[v["ballot_paper_id"]]
        return {p: info["continuing"][p] + wins.get(p, 0) for p in LANES}

    def score(cset, getter):
        n = len(cset)
        ctl_ok = lp_ok = 0
        err = {p: [] for p in LANES}
        wrong, rows = [], {}
        oth = []
        for c in cset:
            seats, size = getter(c)
            fc, fl = control(seats, size), largest(seats)
            ac = actual[c]
            rows[c] = {"control": fc, "largest": list(fl), "seats": seats}
            if fc == ac["control"]:
                ctl_ok += 1
            else:
                wrong.append({"council": c, "forecast_control": fc, "actual_control": ac["control"]})
            if fl == ac["largest"]:
                lp_ok += 1
            for p in LANES:
                err[p].append(abs(seats[p] - ac["seats"][p]))
            if OTH_MAJ in (fc, ac["control"]):
                oth.append(c)
        no_oth = [c for c in cset if c not in oth]
        ctl_ok_no_oth = sum(1 for c in no_oth if rows[c]["control"] == actual[c]["control"])
        return {
            "councils": n,
            "control_correct": ctl_ok,
            "control_accuracy": round(ctl_ok / n, 4) if n else None,
            "largest_party_correct": lp_ok,
            "largest_party_accuracy": round(lp_ok / n, 4) if n else None,
            "seat_mae_by_lane": {p: round(float(np.mean(err[p])), 2) if n else None for p in LANES},
            "seat_mae_all_lanes": round(float(np.mean([x for p in LANES for x in err[p]])), 2) if n else None,
            "councils_with_others_majority_forecast_or_actual": oth,
            "control_correct_excluding_those": ctl_ok_no_oth,
            "councils_excluding_those": len(no_oth),
            "wrong_control": wrong,
            "per_council": rows,
        }

    results = {}
    for rule in ["primary", "secondary"]:
        for cov in ["primary", "secondary"]:
            key = f"seats_{rule}__coverage_{cov}"
            results[key] = {}
            for a in ARM_NAMES:
                cset = coverage[a][cov]
                fill = {k: v for d in coverage[a]["secondary_filled"].values() for k, v in d.items()}
                results[key][a] = score(cset, lambda c, a=a, rule=rule, fill=fill: (forecast_seats(a, c, rule, fill), councils[c]["size"]))
            results[key]["common"] = {
                a: score(common, lambda c, a=a, rule=rule: (forecast_seats(a, c, rule, {}), councils[c]["size"]))
                for a in ARM_NAMES
            }
    bench = lambda c: (councils[c]["comp_2025"], sum(councils[c]["comp_2025"].values()))
    results["no_change"] = {"own_set": score(bench_set, bench), "common": score(common, bench)}

    others_actual = [c for c in scorable if actual[c]["control"] == OTH_MAJ]
    summary = {
        "spec": "CONTROL_SPEC.md",
        "inputs": {
            "results": str(MAY26_ACTUALS.relative_to(REPO)),
            "results_snapshot": res["snapshot"]["snapshot_id"],
            "composition": str(COMPOSITION.relative_to(REPO)),
            "council_control": str(CONTROL_FILE.relative_to(REPO)),
            "published": f"{PUBLISHED_COMMIT}:data/predictions/may-2026/local-and-mayor.json sha256 {PUBLISHED_SHA}",
            "candidate": "cache/arms/candidate-2026-10-24.json",
            "ward_model": "cache/recency_predictions.pkl s1_* rows set == may26",
            "blend_weight_model": BLEND_WEIGHT_MODEL,
            "split_rule_pp": SPLIT_PP * 100,
        },
        "prep": prep,
        "actual": {c: {"control": actual[c]["control"], "largest": list(actual[c]["largest"]), "seats": actual[c]["seats"],
                       "type": councils[c]["type"], "size": councils[c]["size"]} for c in scorable},
        "actual_control_counts": Counter(actual[c]["control"] for c in scorable),
        "others_majority_actual": others_actual,
        "council_control_json_disagreements": disagree,
        "coverage": {a: {"primary": coverage[a]["primary"], "secondary": coverage[a]["secondary"],
                         "not_scored_primary_missing_wards": coverage[a]["not_scored_primary"],
                         "secondary_filled_wards": {c: list(f) for c, f in coverage[a]["secondary_filled"].items()}}
                     for a in ARM_NAMES},
        "benchmark_set": bench_set,
        "common_set": common,
        "results": results,
    }
    OUT.mkdir(exist_ok=True)
    with open(OUT / "control_summary.json", "w") as f:
        json.dump(summary, f, indent=1, default=lambda o: dict(o) if isinstance(o, Counter) else str(o))
        f.write("\n")

    for key in ["seats_primary__coverage_primary", "seats_secondary__coverage_primary", "seats_primary__coverage_secondary"]:
        print(key)
        for a in ARM_NAMES:
            r = results[key][a]
            print(f"  {a:10s} control {r['control_correct']}/{r['councils']}  largest {r['largest_party_correct']}/{r['councils']}  seat MAE {r['seat_mae_all_lanes']}")
        for a in ARM_NAMES:
            r = results[key]["common"][a]
            print(f"  common {a:10s} control {r['control_correct']}/{r['councils']}  largest {r['largest_party_correct']}/{r['councils']}  seat MAE {r['seat_mae_all_lanes']}")
    for k, r in results["no_change"].items():
        print(f"  no_change {k:8s} control {r['control_correct']}/{r['councils']}  largest {r['largest_party_correct']}/{r['councils']}  seat MAE {r['seat_mae_all_lanes']}")


if __name__ == "__main__":
    main("--prep" in sys.argv)
