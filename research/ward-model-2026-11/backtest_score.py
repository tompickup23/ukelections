"""Score back-test stage A (BACKTEST_SPEC.md): S1 and W365 beside two benchmarks,
B1 (same party as last time) and B2 (last time moved by the national change),
with the conventions of score.py and recency_score.py.

Output: results/backtest_summary.json
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd

from common import CACHE, LANES, LANE_KEY, OUT, expit, logit
from rolling_score import arm_from
from score import Mapper, score_arm, top

KEYS = [LANE_KEY[p] for p in LANES]
ARMS = ["s1", "w365"]
BENCH = ["b1", "b2"]
YEARS = ["2021", "2022", "2023"]
SCHED = {"2021": "2021-05-06", "2022": "2022-05-05", "2023": "2023-05-04"}
BANDS = [("under_5", 0, 5), ("5_or_more", 5, None), ("10_or_more", 10, None), ("15_or_more", 15, None)]


def benchmarks(df):
    b1, b2 = {}, {}
    cover = {}
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
            z = logit(prev[p]) + logit(r[f"a_{k}"]) - logit(r[f"prev_a_{k}"])
            raw[p] = float(expit(z))
        tot = sum(raw.values())
        if tot > 0:
            sh = {p: raw.get(p, 0.0) / tot for p in LANES}
            b2[i] = {"leader": top(sh), "shares": sh}
    return b1, b2, cover


def lead_pp(sh):
    v = sorted(sh.values(), reverse=True)
    return 100 * (v[0] - (v[1] if len(v) > 1 else 0.0))


def bands(ids, arm, lead):
    out = {}
    for name, lo, hi in BANDS:
        sel = [i for i in ids if i in arm and lead_pp(arm[i]["shares"]) >= lo and (hi is None or lead_pp(arm[i]["shares"]) < hi)]
        ok = sum(arm[i]["leader"] == lead[i] for i in sel)
        out[name] = {"rows": len(sel), "leader_right": int(ok), "rate": round(ok / len(sel), 4) if sel else None}
    return out


def head_to_head(ids, a, b, lead):
    common = [i for i in ids if i in a and i in b]
    return {
        "rows_both_forecast": len(common),
        "arm_correct": int(sum(a[i]["leader"] == lead[i] for i in common)),
        "benchmark_correct": int(sum(b[i]["leader"] == lead[i] for i in common)),
    }


def main():
    # This folder's own cache, written by backtest_fit.py.
    df = pd.read_pickle(CACHE / "backtest_predictions.pkl").set_index("ballot_paper_id")
    fit_meta = pd.read_pickle(CACHE / "fit_meta.pkl")
    mapper = Mapper({p: fit_meta["lanes"][p]["oof_logit_resid_sd"] for p in LANES})
    act = {i: {p: float(r[f"s_{LANE_KEY[p]}"]) for p in LANES} for i, r in df.iterrows()}
    lead = {i: top(act[i]) for i in df.index}
    arms = {a: arm_from(df, a) for a in ARMS}
    b1, b2, cover = benchmarks(df)
    arms["b1"], arms["b2"] = b1, b2

    sched = df[~df.is_by]
    by = df[df.is_by]
    sets = {f"scheduled_{y}": sched[sched.date == SCHED[y]].index for y in YEARS}
    sets["scheduled_2022_2023"] = sched[sched.date.isin([SCHED["2022"], SCHED["2023"]])].index
    sets["scheduled_2021_2023"] = sched.index
    for y in ["2020", "2021", "2022", "2023", "2024"]:
        sets[f"byelections_{y}"] = by[by.date.str[:4] == y].index
    sets["byelections_all"] = by.index

    res = {"sets": {}, "question_a": {}, "question_b": {}, "question_c": {}}
    for s, ids in sets.items():
        ids = list(ids)
        cov = pd.Series([cover.get(i, "no_previous_contest") for i in ids]).value_counts().to_dict()
        res["sets"][s] = {
            "rows": len(ids),
            "benchmark_cover": {k: int(v) for k, v in cov.items()},
            "arms": {a: score_arm(ids, arms[a], act, lead, mapper) for a in ARMS + BENCH},
        }
        res["question_b"][s] = {a: {b: head_to_head(ids, arms[a], arms[b], lead) for b in BENCH} for a in ARMS}
        res["question_c"][s] = {a: bands(ids, arms[a], lead) for a in ARMS + BENCH}

    # ---- (a)
    def lc(s, a):
        return res["sets"][s]["arms"][a]["leader_correct"]

    def mae(s, a):
        return res["sets"][s]["arms"][a]["share_mae_pp_all_lanes"]

    years_more = [y for y in ["2022", "2023"] if lc(f"scheduled_{y}", "w365") > lc(f"scheduled_{y}", "s1")]
    pooled = "scheduled_2021_2023"
    res["question_a"] = {
        "pooled_leaders": {"s1": lc(pooled, "s1"), "w365": lc(pooled, "w365")},
        "pooled_share_mae_pp": {"s1": mae(pooled, "s1"), "w365": mae(pooled, "w365")},
        "years_w365_more": years_more,
        "rule_pooled_more": lc(pooled, "w365") > lc(pooled, "s1"),
        "rule_mae_no_higher": mae(pooled, "w365") <= mae(pooled, "s1"),
        "rule_both_forecastable_years": len(years_more) == 2,
    }
    res["question_a"]["supported"] = all(res["question_a"][k] for k in ["rule_pooled_more", "rule_mae_no_higher", "rule_both_forecastable_years"])
    res["question_b_rule"] = {
        a: {y: {b: (lambda h: h["rows_both_forecast"] > 0 and h["arm_correct"] > h["benchmark_correct"])(res["question_b"][f"scheduled_{y}"][a][b]) for b in BENCH}
            for y in ["2022", "2023"]}
        for a in ARMS
    }

    OUT.mkdir(exist_ok=True)
    with open(OUT / "backtest_summary.json", "w") as f:
        json.dump(res, f, indent=1, default=float)
        f.write("\n")

    for s, r in res["sets"].items():
        print(s, r["rows"], r["benchmark_cover"])
        for a, m in r["arms"].items():
            print(f"  {a:5s} {m['leader_correct']:5d}/{m['wards']} ({m['wards_forecast']} forecast) MAE {m['share_mae_pp_all_lanes']} Brier {m['brier_common']}  bias "
                  + ", ".join(f"{p[:3]} {m['by_party'][p]['signed_bias_pp']}" for p in LANES)
                  + "  leads " + ", ".join(f"{p[:3]} {m['by_party'][p]['called_leads']}/{m['by_party'][p]['actual_leads']}" for p in LANES))
        for a in ARMS:
            print("   h2h", a, {b: res["question_b"][s][a][b] for b in BENCH})
        for a in ARMS + BENCH:
            print("   bands", a, {k: (v["rows"], v["leader_right"]) for k, v in res["question_c"][s][a].items()})
    print("question_a", json.dumps(res["question_a"]))
    print("question_b_rule", json.dumps(res["question_b_rule"]))


if __name__ == "__main__":
    main()
