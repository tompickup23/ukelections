"""Score back-test stage B (BACKTEST_B_SPEC.md): S1, W365, S1c, W365c, B1, B2 and
M2, with the conventions of score.py and backtest_score.py.

Output: results/backtest_b_summary.json
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd

from common import CACHE, LANES, LANE_KEY, OUT, expit, logit, read_json
from rolling_score import arm_from
from score import Mapper, score_arm, top
from backtest_score import bands, head_to_head

MODEL = ["s1", "w365", "s1c", "w365c"]
ALL = MODEL + ["b1", "b2", "m2"]
SCHED = {"2018": "2018-05-03", "2019": "2019-05-02", "2021": "2021-05-06", "2022": "2022-05-05", "2023": "2023-05-04"}
RULE_YEARS = ["2019", "2021", "2022", "2023"]
BY_YEARS = ["2018", "2019", "2020", "2021", "2022", "2023", "2024"]


def benchmarks(df):
    b1, b2, cover = {}, {}, {}
    for i, r in df.iterrows():
        if pd.isna(r["prev_date"]):
            cover[i] = "no_previous_contest"
            continue
        prev = {p: float(r[f"prev_s_{LANE_KEY[p]}"]) for p in LANES}
        b1[i] = {"leader": top(prev), "shares": prev}
        if pd.isna(r["prev_anchor_kind"]) or pd.isna(r["anchor_kind"]):
            cover[i] = "no_anchor_at_previous_contest" if pd.isna(r["prev_anchor_kind"]) else "no_anchor_now"
            continue
        cover[i] = "both"
        raw = {}
        for p in LANES:
            k = LANE_KEY[p]
            if not bool(r[f"stood_{k}"]):
                continue
            a_now, a_prev = r[f"a_{k}"], r[f"prev_a_{k}"]
            # A lane with no anchor at either date (Reform UK before March 2019): national change zero.
            change = 0.0 if (pd.isna(a_now) or pd.isna(a_prev)) else float(logit(a_now) - logit(a_prev))
            raw[p] = float(expit(logit(prev[p]) + change))
        tot = sum(raw.values())
        if tot > 0:
            sh = {p: raw.get(p, 0.0) / tot for p in LANES}
            b2[i] = {"leader": top(sh), "shares": sh}
    return b1, b2, cover


def mix(s1c, b2):
    m2 = {}
    for i, e in s1c.items():
        if i not in b2:
            m2[i] = e
            continue
        raw = {}
        for p in LANES:
            if e["shares"].get(p, 0) > 0:
                raw[p] = float(expit(0.5 * (logit(e["shares"][p]) + logit(b2[i]["shares"].get(p, 0)))))
        tot = sum(raw.values())
        sh = {p: raw.get(p, 0.0) / tot for p in LANES}
        m2[i] = {"leader": top(sh), "shares": sh}
    return m2


def main():
    # This folder's own cache, written by backtest_b_fit.py.
    df = pd.read_pickle(CACHE / "backtest_b_predictions.pkl").set_index("ballot_paper_id")
    fit_meta = pd.read_pickle(CACHE / "fit_meta.pkl")
    mapper = Mapper({p: fit_meta["lanes"][p]["oof_logit_resid_sd"] for p in LANES})
    act = {i: {p: float(r[f"s_{LANE_KEY[p]}"]) for p in LANES} for i, r in df.iterrows()}
    lead = {i: top(act[i]) for i in df.index}
    arms = {a: arm_from(df, a) for a in MODEL}
    arms["b1"], arms["b2"], cover = benchmarks(df)
    arms["m2"] = mix(arms["s1c"], arms["b2"])

    sched, by = df[~df.is_by], df[df.is_by]
    sets = {f"scheduled_{y}": sched[sched.date == d].index for y, d in SCHED.items()}
    sets["scheduled_2019_2023"] = sched[sched.date.isin([SCHED[y] for y in RULE_YEARS])].index
    for y in BY_YEARS:
        sets[f"byelections_{y}"] = by[by.date.str[:4] == y].index
    sets["byelections_all"] = by.index

    res = {"sets": {}, "question_b": {}, "question_c": {}, "question_d": {}, "question_e": {}}
    for s, ids in sets.items():
        ids = list(ids)
        res["sets"][s] = {
            "rows": len(ids),
            "unforecastable": {str(k): int(v) for k, v in df.loc[ids, "unforecastable"].value_counts().items()},
            "benchmark_cover": {k: int(v) for k, v in pd.Series([cover.get(i, "no_previous_contest") for i in ids]).value_counts().items()},
            "arms": {a: score_arm(ids, arms[a], act, lead, mapper) for a in ALL},
        }
        res["question_b"][s] = {
            "s1c_vs_b2": head_to_head(ids, arms["s1c"], arms["b2"], lead),
            "m2_vs_s1c": head_to_head(ids, arms["m2"], arms["s1c"], lead),
            "m2_vs_b2": head_to_head(ids, arms["m2"], arms["b2"], lead),
        }
        res["question_c"][s] = {
            "s1_vs_s1c": head_to_head(ids, arms["s1"], arms["s1c"], lead),
            "share_mae_pp": {a: res["sets"][s]["arms"][a]["share_mae_pp_all_lanes"] for a in ["s1", "s1c"]},
        }
        res["question_d"][s] = {a: bands(ids, arms[a], lead) for a in ALL}
        no_b2 = [i for i in ids if i in arms["s1c"] and i in arms["b1"] and i not in arms["b2"]]
        res["question_e"][s] = head_to_head(no_b2, arms["s1c"], arms["b1"], lead)

    def lc(s, a):
        return res["sets"][s]["arms"][a]["leader_correct"]

    def mae(s, a):
        return res["sets"][s]["arms"][a]["share_mae_pp_all_lanes"]

    pooled = "scheduled_2019_2023"
    years_more = [y for y in RULE_YEARS if lc(f"scheduled_{y}", "w365c") > lc(f"scheduled_{y}", "s1c")]
    qa = {
        "pooled_leaders": {"s1c": lc(pooled, "s1c"), "w365c": lc(pooled, "w365c")},
        "pooled_share_mae_pp": {"s1c": mae(pooled, "s1c"), "w365c": mae(pooled, "w365c")},
        "years_w365c_more": years_more,
        "rule_pooled_more": lc(pooled, "w365c") > lc(pooled, "s1c"),
        "rule_mae_no_higher": mae(pooled, "w365c") is not None and mae(pooled, "w365c") <= mae(pooled, "s1c"),
        "rule_three_of_four_years": len(years_more) >= 3,
    }
    qa["supported"] = qa["rule_pooled_more"] and qa["rule_mae_no_higher"] and qa["rule_three_of_four_years"]
    res["question_a"] = qa

    def beats(h):
        return h["rows_both_forecast"] > 0 and h["arm_correct"] > h["benchmark_correct"]

    qb = {k: {y: beats(res["question_b"][f"scheduled_{y}"][k]) for y in RULE_YEARS} for k in ["s1c_vs_b2", "m2_vs_s1c", "m2_vs_b2"]}
    res["question_b_rule"] = {k: {"by_year": v, "supported": all(v.values())} for k, v in qb.items()}

    stage_a = read_json(OUT / "backtest_summary.json")["sets"]
    res["stage_a_comparison"] = {
        y: {a: {"stage_a": stage_a[f"scheduled_{y}"]["arms"][a]["leader_correct"], "stage_b": lc(f"scheduled_{y}", a),
                "stage_a_mae": stage_a[f"scheduled_{y}"]["arms"][a]["share_mae_pp_all_lanes"], "stage_b_mae": mae(f"scheduled_{y}", a)}
            for a in ["s1", "w365", "b1", "b2"]}
        for y in ["2022", "2023"]
    }

    OUT.mkdir(exist_ok=True)
    with open(OUT / "backtest_b_summary.json", "w") as f:
        json.dump(res, f, indent=1, default=float)
        f.write("\n")

    for s, r in res["sets"].items():
        print(s, r["rows"], "unforecastable", r["unforecastable"], "cover", r["benchmark_cover"])
        for a, m in r["arms"].items():
            print(f"  {a:6s} {m['leader_correct']:5d}/{m['wards']} ({m['wards_forecast']} forecast) MAE {m['share_mae_pp_all_lanes']} Brier {m['brier_common']}  bias "
                  + ", ".join(f"{p[:3]} {m['by_party'][p]['signed_bias_pp']}" for p in LANES)
                  + "  leads " + ", ".join(f"{p[:3]} {m['by_party'][p]['called_leads']}/{m['by_party'][p]['actual_leads']}" for p in LANES))
        print("   b", res["question_b"][s])
        print("   c", res["question_c"][s])
        print("   e", res["question_e"][s])
        for a in ["s1c", "m2"]:
            print("   d", a, {k: (v["rows"], v["leader_right"]) for k, v in res["question_d"][s][a].items()})
    print("question_a", json.dumps(qa))
    print("question_b_rule", json.dumps(res["question_b_rule"]))
    print("stage_a_comparison", json.dumps(res["stage_a_comparison"]))


if __name__ == "__main__":
    main()
