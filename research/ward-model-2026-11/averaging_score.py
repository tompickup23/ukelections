"""Score the averaged C2 arms (AVERAGING_SPEC.md), with score.score_arm as bridge_level_score.py does.

  uv run python averaging_score.py --reproduce   # c2 only, from averaging_reproduce.pkl, printed, nothing written
  uv run python averaging_score.py               # c2, a1, a2 on both input sets; writes results/averaging_summary.json

Input: cache/averaging/<pr199|corrected>/averaging_predictions.pkl (written by averaging_fit.py) and the
frozen fit_meta.pkl from the rebuild cache (for the leader probability mapper, as bridge_level_score.py).
"""
from __future__ import annotations

import argparse
import json

import pandas as pd

from averaging_fit import DEFAULT_REBUILD, MEMBERS
from bridge_level_fit import SCHEDULED
from common import HERE, LANES, LANE_KEY
from rolling_score import arm_from
from score import Mapper, score_arm, top

YEAR = {d: d[:4] for d in SCHEDULED}
YEARS = [YEAR[d] for d in SCHEDULED]
SETS_POLLS = ["pr199", "corrected"]


def score_set(df, arms, mapper):
    act = {i: {p: float(r[f"s_{LANE_KEY[p]}"]) for p in LANES} for i, r in df.iterrows()}
    lead = {i: top(act[i]) for i in df.index}
    called = {a: arm_from(df, a) for a in arms}
    sched, by = df[~df.is_by], df[df.is_by]
    sets = {f"scheduled_{YEAR[d]}": list(sched[sched.date == d].index) for d in SCHEDULED}
    sets["scheduled_pooled_six"] = list(sched[sched.date.isin(SCHEDULED)].index)
    sets["scheduled_pooled_five_without_2026"] = list(sched[sched.date.isin(SCHEDULED[:-1])].index)
    sets["byelections_all"] = list(by.index)
    res = {s: {"rows": len(ids), "arms": {a: score_arm(ids, called[a], act, lead, mapper) for a in arms}} for s, ids in sets.items()}
    return res, called, sets


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--reproduce", action="store_true")
    args = ap.parse_args()
    # Frozen settings file from the rebuild cache (our own research output).
    fit_meta = pd.read_pickle(DEFAULT_REBUILD / "corrected" / "fit_meta.pkl")
    mapper = Mapper({p: fit_meta["lanes"][p]["oof_logit_resid_sd"] for p in LANES})
    name = "averaging_reproduce" if args.reproduce else "averaging_predictions"
    arms = ["c2"] if args.reproduce else ["c2", "a1", "a2"]

    scored, called, sets, runs = {}, {}, {}, {}
    for polls in SETS_POLLS:
        d = HERE / "cache" / "averaging" / polls
        # Our own cache, written by averaging_fit.py.
        df = pd.read_pickle(d / f"{name}.pkl").set_index("ballot_paper_id")
        assert df.index.is_unique
        runs[polls] = json.loads((d / f"{name}_run.json").read_text())
        scored[polls], called[polls], sets[polls] = score_set(df, arms, mapper)

    def lc(polls, s, a):
        return scored[polls][s]["arms"][a]["leader_correct"]

    def mae(polls, s, a):
        return scored[polls][s]["arms"][a]["share_mae_pp_all_lanes"]

    for polls in SETS_POLLS:
        for s in scored[polls]:
            print(polls, s, scored[polls][s]["rows"], {a: (lc(polls, s, a), mae(polls, s, a)) for a in arms})
    if args.reproduce:
        return

    # ---- Stability: leaders called that differ between the two input sets, ward by ward.
    stability = {}
    for a in arms:
        per = {}
        for s in [f"scheduled_{y}" for y in YEARS] + ["byelections_all"]:
            ids = sets["corrected"][s]
            assert sorted(ids) == sorted(sets["pr199"][s])
            l1 = {i: called["pr199"][a].get(i, {}).get("leader") for i in ids}
            l2 = {i: called["corrected"][a].get(i, {}).get("leader") for i in ids}
            per[s] = {"rows": len(ids), "leader_changed": sum(1 for i in ids if l1[i] != l2[i]),
                      "net_change_in_leaders_correct": lc("corrected", s, a) - lc("pr199", s, a)}
        per["pooled_six_mays_leader_changed"] = sum(per[f"scheduled_{y}"]["leader_changed"] for y in YEARS)
        stability[a] = per

    # ---- Rules (AVERAGING_SPEC.md), each variant against c2 on the corrected ("Both") inputs.
    rules = {}
    P, P5, B = "scheduled_pooled_six", "scheduled_pooled_five_without_2026", "byelections_all"
    for a in ["a1", "a2"]:
        per_year = {y: {"wards": scored["corrected"][f"scheduled_{y}"]["rows"], "c2": lc("corrected", f"scheduled_{y}", "c2"),
                        a: lc("corrected", f"scheduled_{y}", a),
                        "difference": lc("corrected", f"scheduled_{y}", a) - lc("corrected", f"scheduled_{y}", "c2"),
                        "c2_mae": mae("corrected", f"scheduled_{y}", "c2"), f"{a}_mae": mae("corrected", f"scheduled_{y}", a)} for y in YEARS}
        at_least = [y for y in YEARS if per_year[y]["difference"] >= 0]
        worse = [y for y in YEARS if -per_year[y]["difference"] > 0.01 * per_year[y]["wards"]]
        st, st2 = stability[a], stability["c2"]
        r = {
            "per_year": per_year,
            "rule_s1_pooled_changes_at_most_three_quarters_of_c2": st["pooled_six_mays_leader_changed"] <= 0.75 * st2["pooled_six_mays_leader_changed"],
            "rule_s2_no_may_with_more_changes_than_c2": all(st[f"scheduled_{y}"]["leader_changed"] <= st2[f"scheduled_{y}"]["leader_changed"] for y in YEARS),
            "rule_1_pooled_at_least_as_many_leaders": lc("corrected", P, a) >= lc("corrected", P, "c2"),
            "rule_1b_same_without_2026": lc("corrected", P5, a) >= lc("corrected", P5, "c2"),
            "rule_2_pooled_mae_no_higher": mae("corrected", P, a) <= mae("corrected", P, "c2"),
            "rule_3_four_of_six_years": len(at_least) >= 4,
            "rule_4_no_year_worse_than_1pct": len(worse) == 0,
            "rule_b1_byelection_leaders_not_more_than_1pct_fewer": lc("corrected", B, a) >= lc("corrected", B, "c2") - 0.01 * scored["corrected"][B]["rows"],
            "rule_b2_byelection_mae_no_higher": mae("corrected", B, a) <= mae("corrected", B, "c2"),
            "years_at_least_as_many": at_least,
            "years_worse_by_more_than_1pct": worse,
            "pooled_leaders": {"c2": lc("corrected", P, "c2"), a: lc("corrected", P, a)},
            "pooled_leaders_without_2026": {"c2": lc("corrected", P5, "c2"), a: lc("corrected", P5, a)},
            "pooled_share_mae_pp": {"c2": mae("corrected", P, "c2"), a: mae("corrected", P, a)},
            "byelection_leaders": {"c2": lc("corrected", B, "c2"), a: lc("corrected", B, a)},
            "byelection_share_mae_pp": {"c2": mae("corrected", B, "c2"), a: mae("corrected", B, a)},
        }
        r["stable"] = r["rule_s1_pooled_changes_at_most_three_quarters_of_c2"] and r["rule_s2_no_may_with_more_changes_than_c2"]
        r["no_less_accurate"] = all(r[k] for k in r if k.startswith("rule_") and not k.startswith("rule_s"))
        r["supported"] = r["stable"] and r["no_less_accurate"]
        rules[a] = r

    out = {"spec": "AVERAGING_SPEC.md", "members": MEMBERS, "runs": runs,
           "scores": {polls: {s: {"rows": v["rows"], "arms": {a: {k: m[k] for k in ("leader_correct", "wards", "wards_forecast", "share_mae_pp_all_lanes")}
                                                              for a, m in v["arms"].items()}} for s, v in scored[polls].items()} for polls in SETS_POLLS},
           "scores_full_corrected": scored["corrected"], "stability": stability, "rules": rules}
    path = HERE / "results" / "averaging_summary.json"
    path.write_text(json.dumps(out, indent=1, default=float) + "\n")
    print(json.dumps(stability, indent=1))
    for a, r in rules.items():
        print(a, json.dumps({k: v for k, v in r.items() if k != "per_year"}))
    print(f"wrote {path}")


if __name__ == "__main__":
    main()
