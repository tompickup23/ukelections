"""Score the extended C2 once, both ways fixed in HISTORY_SPEC.md.

    uv run python history_score.py

(a) original rows (the base predictions' 12,175 May wards and 1,190 by-elections):
    extended C2 against base C2, six rules; (b) added test rows, descriptive, with
    B1 (last time) and B2 (swing from last time) beside C2.

Inputs (this folder's own cache, research output; not untrusted data):
  cache/history/bridge_level_predictions.pkl         extended (history_fit.py)
  cache/rebuild/corrected/bridge_level_predictions.pkl  base, sha256 checked
  cache/fit_meta.pkl
Output: results/history_results.json
"""
from __future__ import annotations

import json
import sys

import pandas as pd

from backtest_b_score import benchmarks
from common import CACHE, HERE, LANES, LANE_KEY, sha256
from rolling_score import arm_from
from score import Mapper, score_arm, top

EXT = CACHE / "history" / "bridge_level_predictions.pkl"
BASE = CACHE / "rebuild" / "corrected" / "bridge_level_predictions.pkl"
BASE_SHA = "bb7586ce43bded0159aa7dca8af41fbf1532a26ac7ae3a5337c363d6d8e25d8a"
META_SHA = "936d07ee4d9004d1cdd811796f60dbfb1b22a723e7575789b56292c287ac67ad"
SCHED = {"2019": "2019-05-02", "2021": "2021-05-06", "2022": "2022-05-05", "2023": "2023-05-04",
         "2025": "2025-05-01", "2026": "2026-05-07"}
COMMITTED = {"scheduled_pooled_six": (9135, 6.08), "byelections_all": (786, 7.26)}
ADDED = ("history_baselines_dc2027", "history_bridge_may26")


def slim(m):
    return {k: m[k] for k in ("wards", "wards_forecast", "leader_correct", "leader_accuracy", "share_mae_pp_all_lanes")} | {
        "reform_uk": {k: m["by_party"]["Reform UK"][k] for k in ("signed_bias_pp", "called_leads", "actual_leads")}}


def main():
    if sha256(BASE) != BASE_SHA or sha256(CACHE / "fit_meta.pkl") != META_SHA:
        sys.exit("STOP: base predictions or fit_meta.pkl differ from HISTORY_SPEC.md")
    man = json.loads((HERE / "results/history_manifest.json").read_text())
    base = pd.read_pickle(BASE).set_index("ballot_paper_id")
    ext = pd.read_pickle(EXT).set_index("ballot_paper_id")
    assert base.index.is_unique and ext.index.is_unique
    fm = pd.read_pickle(CACHE / "fit_meta.pkl")
    mapper = Mapper({p: fm["lanes"][p]["oof_logit_resid_sd"] for p in LANES})

    def actuals(df):
        act = {i: {p: float(r[f"s_{LANE_KEY[p]}"]) for p in LANES} for i, r in df.iterrows()}
        return act, {i: top(a) for i, a in act.items()}

    act_b, lead_b = actuals(base)
    act_e, lead_e = actuals(ext)
    c2_b, c2_e = arm_from(base, "c2"), arm_from(ext, "c2")

    sb, bb = base[~base.is_by.astype(bool)], base[base.is_by.astype(bool)]
    sets = {f"scheduled_{y}": list(sb[sb.date == d].index) for y, d in SCHED.items()}
    sets["scheduled_pooled_six"] = list(sb[sb.date.isin(SCHED.values())].index)
    sets["scheduled_pooled_five_without_2026"] = list(sb[sb.date.isin([d for y, d in SCHED.items() if y != "2026"])].index)
    sets["byelections_all"] = list(bb.index)
    missing = [i for s in sets.values() for i in s if i not in ext.index]
    if missing:
        sys.exit(f"STOP: {len(missing)} original rows are missing from the extended predictions")
    if any(act_b[i] != act_e[i] for s in sets.values() for i in s):
        sys.exit("STOP: an original row's actual shares differ between base and extended")

    res = {"spec": "HISTORY_SPEC.md", "inputs": {"extended_predictions": {"path": "cache/history/bridge_level_predictions.pkl", "sha256": sha256(EXT)},
                                                 "base_predictions": {"path": "cache/rebuild/corrected/bridge_level_predictions.pkl", "sha256": BASE_SHA},
                                                 "extended_dataset_sha256": man["outputs"]["bridge_level_dataset.pkl"]},
           "a": {"sets": {}}}
    for s, ids in sets.items():
        res["a"]["sets"][s] = {"base_c2": slim(score_arm(ids, c2_b, act_b, lead_b, mapper)),
                               "extended_c2": slim(score_arm(ids, c2_e, act_e, lead_e, mapper))}
    for s, (lc, mae) in COMMITTED.items():
        got = res["a"]["sets"][s]["base_c2"]
        if (got["leader_correct"], got["share_mae_pp_all_lanes"]) != (lc, mae):
            sys.exit(f"STOP: base C2 rescored on {s} gives {got['leader_correct']}, {got['share_mae_pp_all_lanes']}, not the committed {lc}, {mae}")

    def lc(s, arm):
        return res["a"]["sets"][s][arm]["leader_correct"]

    def mae(s, arm):
        return res["a"]["sets"][s][arm]["share_mae_pp_all_lanes"]

    per_year = {y: {"wards": len(sets[f"scheduled_{y}"]), "base": lc(f"scheduled_{y}", "base_c2"), "extended": lc(f"scheduled_{y}", "extended_c2"),
                    "difference": lc(f"scheduled_{y}", "extended_c2") - lc(f"scheduled_{y}", "base_c2"),
                    "base_mae": mae(f"scheduled_{y}", "base_c2"), "extended_mae": mae(f"scheduled_{y}", "extended_c2")} for y in SCHED}
    at_least = [y for y, v in per_year.items() if v["difference"] >= 0]
    worse = [y for y, v in per_year.items() if -v["difference"] > 0.01 * v["wards"]]
    p6, p5, by = "scheduled_pooled_six", "scheduled_pooled_five_without_2026", "byelections_all"
    rules = {
        "rule_1_pooled_at_least_as_many_leaders": lc(p6, "extended_c2") >= lc(p6, "base_c2"),
        "rule_2_pooled_share_error_no_higher": mae(p6, "extended_c2") <= mae(p6, "base_c2"),
        "rule_3_at_least_as_many_in_four_of_six_years": len(at_least) >= 4,
        "rule_4_no_year_worse_by_more_than_1pct": not worse,
        "rule_5_rules_1_and_2_without_may_2026": lc(p5, "extended_c2") >= lc(p5, "base_c2") and mae(p5, "extended_c2") <= mae(p5, "base_c2"),
        "rule_6_byelections_leaders_within_1pct_and_error_no_higher": lc(by, "extended_c2") >= lc(by, "base_c2") - 0.01 * len(sets[by])
        and mae(by, "extended_c2") <= mae(by, "base_c2"),
    }
    res["a"].update({"per_year": per_year, "years_at_least_as_many": at_least, "years_worse_by_more_than_1pct": worse,
                     "rules": rules, "passes": all(rules.values())})

    # ---- (b) added test rows
    test_added = ext[ext.source.isin(ADDED) & ~ext.is_by.astype(bool)]
    b1, b2, cover = benchmarks(test_added)
    res["b"] = {}
    for name, d in (("added_2023_05_04", "2023-05-04"), ("added_2026_05_07", "2026-05-07")):
        ids = list(test_added[test_added.date == d].index)
        i1 = [i for i in ids if i in b1]
        i2 = [i for i in ids if i in b2]
        res["b"][name] = {
            "rows": len(ids),
            "benchmark_cover": {k: sum(1 for i in ids if cover.get(i, "no_previous_contest") == k) for k in ("both", "no_previous_contest", "no_anchor_at_previous_contest", "no_anchor_now")},
            "c2_all_rows": slim(score_arm(ids, c2_e, act_e, lead_e, mapper)),
            "on_b1_rows": {"rows": len(i1), "c2": slim(score_arm(i1, c2_e, act_e, lead_e, mapper)), "b1_last_time": slim(score_arm(i1, b1, act_e, lead_e, mapper))},
            "on_b2_rows": {"rows": len(i2), "c2": slim(score_arm(i2, c2_e, act_e, lead_e, mapper)), "b2_swing": slim(score_arm(i2, b2, act_e, lead_e, mapper))},
        }
    relab = [b for b in man["rows_added"]["C"]["rows"] if b in base.index and b in sets["scheduled_2023"]]
    res["b"]["code_reissue_rows_in_may_2023"] = {"rows": len(relab), "base_c2": slim(score_arm(relab, c2_b, act_b, lead_b, mapper)),
                                                 "extended_c2": slim(score_arm(relab, c2_e, act_e, lead_e, mapper))}
    # Rows of the original sets whose inputs gained a previous contest.
    lag_changed = [i for i in sets[p6] + sets[by] if bool(base.at[i, "has_prev"]) != bool(ext.at[i, "has_prev"])]
    res["b"]["original_rows_whose_previous_contest_appeared_or_went"] = {
        "rows": len(lag_changed), "base_c2": slim(score_arm(lag_changed, c2_b, act_b, lead_b, mapper)),
        "extended_c2": slim(score_arm(lag_changed, c2_e, act_e, lead_e, mapper))}

    (HERE / "results").mkdir(exist_ok=True)
    with open(HERE / "results/history_results.json", "w") as f:
        json.dump(res, f, indent=1, default=float)
        f.write("\n")
    print(json.dumps({"per_year": per_year, "pooled": {s: res["a"]["sets"][s] for s in (p6, p5, by)}, "rules": rules, "passes": res["a"]["passes"]}, indent=1, default=float))
    print(json.dumps(res["b"], indent=1, default=float))


if __name__ == "__main__":
    main()
