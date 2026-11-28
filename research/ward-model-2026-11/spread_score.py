"""Score S1 and S2 against C2 (SPREAD_SPEC.md). One run.

  uv run python spread_score.py

Input: cache/spread/spread_predictions.pkl, cache/spread/spread_run.json (written by
spread_fit.py; this folder's own research cache, not untrusted data),
cache/rebuild/corrected/fit_meta.pkl
Output: results/spread_summary.json
Research only; nothing on the site reads it.
"""
from __future__ import annotations

import json
import sys

import pandas as pd

from common import CACHE, LANES, LANE_KEY, OUT
from rolling_score import arm_from
from score import Mapper, score_arm, top
from spread_diagnose import GROUPS, META, SCHED, reform_block

SRC = CACHE / "spread"
YEARS = list(SCHED)
CANDIDATES = ["s1", "s2"]
ARMS = ["c2"] + CANDIDATES
BASELINE = {"may_2019": (1375, 6.18), "may_2021": (1713, 6.04), "may_2022": (2138, 5.70), "may_2023": (1442, 5.43),
            "may_2025": (703, 8.30), "may_2026": (1764, 5.48), "may_pooled_six": (9135, 6.08),
            "may_pooled_five_without_2026": (7371, 6.29), "by_all": (786, 7.26)}


def main():
    df = pd.read_pickle(SRC / "spread_predictions.pkl").set_index("ballot_paper_id")
    run = json.loads((SRC / "spread_run.json").read_text())
    fm = pd.read_pickle(META)
    df["is_by"] = df.is_by.astype(bool)
    assert df.index.is_unique
    mapper = Mapper({p: fm["lanes"][p]["oof_logit_resid_sd"] for p in LANES})
    act = {i: {p: float(r[f"s_{LANE_KEY[p]}"]) for p in LANES} for i, r in df.iterrows()}
    lead = {i: top(act[i]) for i in df.index}
    arms = {a: arm_from(df, a) for a in ARMS}

    st = df.stood_ref.astype(bool)
    prev = df.prev_rel_ref.notna()
    hp = df.has_prev.fillna(0).astype(bool)
    grp = {i: (GROUPS[0] if st[i] and prev[i] else GROUPS[1] if st[i] and hp[i] else GROUPS[2] if st[i] else GROUPS[3]) for i in df.index}

    sched, by = df[~df.is_by], df[df.is_by]
    sets = {f"may_{y}": list(sched[sched.date == d].index) for y, d in SCHED.items()}
    sets["may_pooled_six"] = list(sched[sched.date.isin(SCHED.values())].index)
    sets["may_pooled_five_without_2026"] = list(sched[sched.date.isin([SCHED[y] for y in YEARS if y != "2026"])].index)
    sets["may_2025_2026"] = sets["may_2025"] + sets["may_2026"]
    sets["by_all"] = list(by.index)
    sets["by_before_2025-05-01"] = list(by[by.date < "2025-05-01"].index)
    sets["by_from_2025-05-01"] = list(by[by.date >= "2025-05-01"].index)
    sets["by_after_2026-05-07"] = list(by[by.date > "2026-05-07"].index)
    sets["pooled_from_2025-05-01"] = sets["may_2025_2026"] + sets["by_from_2025-05-01"]

    res = {"run": run, "sets": {}}
    for s, (lc, mae) in BASELINE.items():
        m = score_arm(sets[s], arms["c2"], act, lead, mapper)
        if m["leader_correct"] != lc or abs(m["share_mae_pp_all_lanes"] - mae) > 1e-9:
            sys.exit(f"STOP: refitted C2 {s} is {m['leader_correct']} / {m['share_mae_pp_all_lanes']}, expected {lc} / {mae}")
    res["baseline_check"] = "refitted C2 reproduces REBUILD_RESULTS.md 'Both' on every May and on the by-elections"

    for s, ids in sets.items():
        o = {"rows": len(ids), "arms": {}, "groups": {}}
        for a in ARMS:
            sc = score_arm(ids, arms[a], act, lead, mapper)
            o["arms"][a] = {"leaders_called": sc["leader_correct"], "wards_forecast": sc["wards_forecast"],
                            "share_mae_pp_all_lanes": sc["share_mae_pp_all_lanes"], "brier_common": sc["brier_common"],
                            "by_party": {p: {k: sc["by_party"][p][k] for k in ("called_leads", "actual_leads", "signed_bias_pp", "mae_pp")} for p in LANES},
                            "reform": reform_block(ids, arms[a], act, lead)}
        if s in ("pooled_from_2025-05-01", "may_2025_2026", "by_from_2025-05-01", "by_after_2026-05-07", "may_2026", "may_2025"):
            for g in GROUPS[:3]:
                gi = [i for i in ids if grp[i] == g]
                o["groups"][g] = {"rows": len(gi), "arms": {}}
                for a in ARMS:
                    sc = score_arm(gi, arms[a], act, lead, mapper) if gi else None
                    o["groups"][g]["arms"][a] = {"leaders_called": sc["leader_correct"] if sc else 0,
                                                 "share_mae_pp_all_lanes": sc["share_mae_pp_all_lanes"] if sc else None,
                                                 "reform": reform_block(gi, arms[a], act, lead)}
        res["sets"][s] = o

    def lc(s, a):
        return res["sets"][s]["arms"][a]["leaders_called"]

    def mae(s, a):
        return res["sets"][s]["arms"][a]["share_mae_pp_all_lanes"]

    p6, p5, b, r7 = "may_pooled_six", "may_pooled_five_without_2026", "by_all", "pooled_from_2025-05-01"
    rules = {}
    for a in CANDIDATES:
        per_year = {y: {"wards": len(sets[f"may_{y}"]), "c2": lc(f"may_{y}", "c2"), a: lc(f"may_{y}", a),
                        "difference": lc(f"may_{y}", a) - lc(f"may_{y}", "c2"),
                        "c2_mae": mae(f"may_{y}", "c2"), f"{a}_mae": mae(f"may_{y}", a)} for y in YEARS}
        at_least = [y for y in YEARS if per_year[y]["difference"] >= 0]
        worse = [y for y in YEARS if -per_year[y]["difference"] > 0.01 * per_year[y]["wards"]]
        rc, ra = res["sets"][r7]["arms"]["c2"]["reform"], res["sets"][r7]["arms"][a]["reform"]
        gap_c = abs(rc["wards_called_first"] - rc["wards_won"])
        gap_a = abs(ra["wards_called_first"] - ra["wards_won"])
        r = {
            "per_year": per_year,
            "pooled_six": {"c2": lc(p6, "c2"), a: lc(p6, a), "c2_mae": mae(p6, "c2"), f"{a}_mae": mae(p6, a)},
            "pooled_five_without_2026": {"c2": lc(p5, "c2"), a: lc(p5, a), "c2_mae": mae(p5, "c2"), f"{a}_mae": mae(p5, a)},
            "byelections": {"c2": lc(b, "c2"), a: lc(b, a), "c2_mae": mae(b, "c2"), f"{a}_mae": mae(b, a)},
            "reform_from_2025": {"c2_slope": rc.get("calibration_slope"), f"{a}_slope": ra.get("calibration_slope"),
                                 "c2_called_won": [rc["wards_called_first"], rc["wards_won"]],
                                 f"{a}_called_won": [ra["wards_called_first"], ra["wards_won"]]},
            "years_at_least_as_many": at_least,
            "years_worse_by_more_than_1pct": worse,
            "rule_1_pooled_more": lc(p6, a) > lc(p6, "c2"),
            "rule_2_pooled_mae_no_higher": mae(p6, a) <= mae(p6, "c2"),
            "rule_3_four_of_six_years": len(at_least) >= 4,
            "rule_4_no_year_worse_than_1pct": not worse,
            "rule_5_without_2026": lc(p5, a) > lc(p5, "c2") and mae(p5, a) <= mae(p5, "c2"),
            "rule_6_byelections": lc(b, a) >= lc(b, "c2") and mae(b, a) <= mae(b, "c2"),
            "rule_7_reform_spread": abs(ra["calibration_slope"] - 1) < abs(rc["calibration_slope"] - 1) and gap_a < gap_c,
        }
        r["supported"] = all(v for k, v in r.items() if k.startswith("rule_"))
        rules[a] = r
    res["rules"] = rules
    sup = [a for a in CANDIDATES if rules[a]["supported"]]
    res["named"] = max(sup, key=lambda a: lc(p6, a)) if sup else None

    OUT.mkdir(exist_ok=True)
    with open(OUT / "spread_summary.json", "w") as f:
        json.dump(res, f, indent=1, default=float)
        f.write("\n")

    print(res["baseline_check"])
    for s, o in res["sets"].items():
        print(s, o["rows"])
        for a, m in o["arms"].items():
            rf = m["reform"]
            print(f"  {a} {m['leaders_called']:5d} mae {m['share_mae_pp_all_lanes']} | ref slope {rf.get('calibration_slope')} err {rf.get('signed_error_pp')} "
                  f"called/won {rf['wards_called_first']}/{rf['wards_won']} lead {rf.get('won_mean_forecast_lead_pp')}/{rf.get('won_mean_actual_lead_pp')}")
        for g, v in o["groups"].items():
            for a, m in v["arms"].items():
                rf = m["reform"]
                print(f"    {g[:22]:22s} {a} n{v['rows']} L{m['leaders_called']} | slope {rf.get('calibration_slope')} c/w {rf['wards_called_first']}/{rf['wards_won']} "
                      f"lead {rf.get('won_mean_forecast_lead_pp')}/{rf.get('won_mean_actual_lead_pp')}")
    for a, r in rules.items():
        print("rules", a, json.dumps({k: v for k, v in r.items() if k != "per_year"}))
        print("   per year", json.dumps({y: v["difference"] for y, v in r["per_year"].items()}))
    print("named", res["named"])


if __name__ == "__main__":
    main()
