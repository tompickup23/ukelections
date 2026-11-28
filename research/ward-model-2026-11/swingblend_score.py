"""Score a fixed blend of the ward model (C2) with the swing from last time
(SWINGBLEND_SPEC.md). No fit: C2's cached forecasts on the corrected inputs are
used exactly as written by rebuild_fit_score.py --polls corrected.

  uv run python swingblend_score.py

Input: cache/rebuild/corrected/bridge_level_predictions.pkl, cache/rebuild/corrected/fit_meta.pkl
Output: results/swingblend_summary.json
Research only; nothing on the site reads it.
"""
from __future__ import annotations

import json
import sys

import numpy as np
import pandas as pd

from backtest_b_score import benchmarks
from backtest_score import head_to_head
from common import CACHE, LANES, LANE_KEY, OUT, expit, logit, sha256
from rolling_score import arm_from
from score import Mapper, score_arm, top

SRC = CACHE / "rebuild" / "corrected"
PRED = SRC / "bridge_level_predictions.pkl"
META = SRC / "fit_meta.pkl"
PRED_SHA = "bb7586ce43bded0159aa7dca8af41fbf1532a26ac7ae3a5337c363d6d8e25d8a"
META_SHA = "936d07ee4d9004d1cdd811796f60dbfb1b22a723e7575789b56292c287ac67ad"
SCHED = {"2019": "2019-05-02", "2021": "2021-05-06", "2022": "2022-05-05", "2023": "2023-05-04",
         "2025": "2025-05-01", "2026": "2026-05-07"}
YEARS = list(SCHED)
BASELINE = {"scheduled_2019": (1375, 6.18), "scheduled_2021": (1713, 6.04), "scheduled_2022": (2138, 5.70),
            "scheduled_2023": (1442, 5.43), "scheduled_2025": (703, 8.30), "scheduled_2026": (1764, 5.48),
            "scheduled_pooled_six": (9135, 6.08), "byelections_all": (786, 7.26)}
WEIGHTS = {"m25": 0.25, "m50": 0.5, "m75": 0.75, "m00": 0.0}
RULE_ARMS = ["m50", "m25", "m75"]
ALL = ["c2", "m25", "m50", "m75", "m00", "b2"]
AGE_DAYS = 1461  # four years


def has_benchmark(r):
    return not (pd.isna(r["prev_date"]) or pd.isna(r["prev_anchor_kind"]) or pd.isna(r["anchor_kind"]))


def blend(df, c2, w):
    out = {}
    for i, e in c2.items():
        r = df.loc[i]
        m = e["shares"]
        if not has_benchmark(r):
            out[i] = e
            continue
        live = [p for p in LANES if m.get(p, 0) > 0]
        old = [p for p in live if float(r[f"prev_s_{LANE_KEY[p]}"]) > 0]
        if not old:
            out[i] = e
            continue
        raw = {}
        for p in old:
            k = LANE_KEY[p]
            a_now, a_prev = r[f"a_{k}"], r[f"prev_a_{k}"]
            change = 0.0 if (pd.isna(a_now) or pd.isna(a_prev)) else float(logit(a_now) - logit(a_prev))
            raw[p] = float(expit(logit(float(r[f"prev_s_{k}"])) + change))
        m_old = sum(m[p] for p in old)
        tot = sum(raw.values())
        z = {}
        for p in live:
            if p in raw:
                b = raw[p] / tot * m_old
                z[p] = w * float(logit(m[p])) + (1 - w) * float(logit(b))
            else:
                z[p] = float(logit(m[p]))
        sh = {p: float(expit(v)) for p, v in z.items()}
        s = sum(sh.values())
        sh = {p: sh.get(p, 0.0) / s for p in LANES}
        out[i] = {"leader": top(sh), "shares": sh}
    return out


def main():
    for path, want in [(PRED, PRED_SHA), (META, META_SHA)]:
        if sha256(path) != want:
            sys.exit(f"STOP: {path} does not match the hash in SWINGBLEND_SPEC.md")
    # This folder's own cache (research output written by rebuild_fit_score.py), hash checked above; not untrusted data.
    df = pd.read_pickle(PRED).set_index("ballot_paper_id")
    assert df.index.is_unique
    fm = pd.read_pickle(META)
    mapper = Mapper({p: fm["lanes"][p]["oof_logit_resid_sd"] for p in LANES})
    act = {i: {p: float(r[f"s_{LANE_KEY[p]}"]) for p in LANES} for i, r in df.iterrows()}
    lead = {i: top(act[i]) for i in df.index}

    arms = {"c2": arm_from(df, "c2")}
    _, arms["b2"], cover = benchmarks(df)
    for a, w in WEIGHTS.items():
        arms[a] = blend(df, arms["c2"], w)

    sched, by = df[~df.is_by], df[df.is_by]
    sets = {f"scheduled_{y}": list(sched[sched.date == d].index) for y, d in SCHED.items()}
    sets["scheduled_pooled_six"] = list(sched[sched.date.isin(SCHED.values())].index)
    sets["scheduled_pooled_five_without_2026"] = list(sched[sched.date.isin([SCHED[y] for y in YEARS if y != "2026"])].index)
    sets["byelections_all"] = list(by.index)

    res = {"inputs": {"predictions": {"path": "cache/rebuild/corrected/bridge_level_predictions.pkl", "sha256": PRED_SHA},
                      "fit_meta": {"path": "cache/rebuild/corrected/fit_meta.pkl", "sha256": META_SHA}},
           "weights_on_model": WEIGHTS, "sets": {}}

    # Baseline check before anything else is scored.
    for s, (lc_want, mae_want) in BASELINE.items():
        m = score_arm(sets[s], arms["c2"], act, lead, mapper)
        if m["leader_correct"] != lc_want or abs(m["share_mae_pp_all_lanes"] - mae_want) > 1e-9:
            sys.exit(f"STOP: C2 baseline {s} is {m['leader_correct']} / {m['share_mae_pp_all_lanes']}, spec says {lc_want} / {mae_want}")
    res["baseline_check"] = "C2 reproduces REBUILD_RESULTS.md 'Both' on every set"
    print(res["baseline_check"])

    for s, ids in sets.items():
        res["sets"][s] = {
            "rows": len(ids),
            "benchmark_cover": {k: int(v) for k, v in pd.Series([cover.get(i, "no_previous_contest") for i in ids]).value_counts().items()},
            "arms": {a: score_arm(ids, arms[a], act, lead, mapper) for a in ALL},
            "on_b2_rows": {a: head_to_head(ids, arms[a], arms["b2"], lead) for a in ["c2", "m50"]},
        }

    def lc(s, a):
        return res["sets"][s]["arms"][a]["leader_correct"]

    def mae(s, a):
        return res["sets"][s]["arms"][a]["share_mae_pp_all_lanes"]

    rules = {}
    p6, p5, b = "scheduled_pooled_six", "scheduled_pooled_five_without_2026", "byelections_all"
    for a in RULE_ARMS:
        per_year = {y: {"wards": len(sets[f"scheduled_{y}"]), "c2": lc(f"scheduled_{y}", "c2"), a: lc(f"scheduled_{y}", a),
                        "difference": lc(f"scheduled_{y}", a) - lc(f"scheduled_{y}", "c2"),
                        "c2_mae": mae(f"scheduled_{y}", "c2"), f"{a}_mae": mae(f"scheduled_{y}", a)} for y in YEARS}
        at_least = [y for y in YEARS if per_year[y]["difference"] >= 0]
        worse = [y for y in YEARS if -per_year[y]["difference"] > 0.01 * per_year[y]["wards"]]
        r = {
            "per_year": per_year,
            "pooled_six": {"c2": lc(p6, "c2"), a: lc(p6, a), "c2_mae": mae(p6, "c2"), f"{a}_mae": mae(p6, a)},
            "pooled_five_without_2026": {"c2": lc(p5, "c2"), a: lc(p5, a), "c2_mae": mae(p5, "c2"), f"{a}_mae": mae(p5, a)},
            "byelections": {"c2": lc(b, "c2"), a: lc(b, a), "c2_mae": mae(b, "c2"), f"{a}_mae": mae(b, a)},
            "years_at_least_as_many": at_least,
            "years_worse_by_more_than_1pct": worse,
            "rule_1_pooled_more": lc(p6, a) > lc(p6, "c2"),
            "rule_2_pooled_mae_no_higher": mae(p6, a) <= mae(p6, "c2"),
            "rule_3_four_of_six_years": len(at_least) >= 4,
            "rule_4_no_year_worse_than_1pct": not worse,
            "rule_5_byelections": lc(b, a) >= lc(b, "c2") and mae(b, a) <= mae(b, "c2"),
            "rule_6_without_2026": lc(p5, a) > lc(p5, "c2") and mae(p5, a) <= mae(p5, "c2"),
        }
        r["supported"] = all(v for k, v in r.items() if k.startswith("rule_"))
        rules[a] = r
    res["rules"] = rules

    # Age breakdown.
    age = {}
    for i, row in df.iterrows():
        if pd.isna(row["prev_date"]):
            age[i] = "no_previous_contest"
        else:
            d = (pd.Timestamp(row["date"]) - pd.Timestamp(row["prev_date"])).days
            age[i] = "previous_under_4_years" if d < AGE_DAYS else "previous_4_years_or_more"
    res["age_breakdown"] = {}
    for s, ids in sets.items():
        res["age_breakdown"][s] = {}
        for g in ["previous_under_4_years", "previous_4_years_or_more", "no_previous_contest"]:
            gi = [i for i in ids if age[i] == g]
            res["age_breakdown"][s][g] = {
                "rows": len(gi),
                "rows_without_benchmark": int(sum(1 for i in gi if not has_benchmark(df.loc[i]))),
                "arms": {a: {"leader_correct": (m := score_arm(gi, arms[a], act, lead, mapper))["leader_correct"],
                             "share_mae_pp_all_lanes": m["share_mae_pp_all_lanes"]} for a in ["c2", "m50", "m00"]},
            }

    OUT.mkdir(exist_ok=True)
    with open(OUT / "swingblend_summary.json", "w") as f:
        json.dump(res, f, indent=1, default=float)
        f.write("\n")

    for s, r in res["sets"].items():
        print(s, r["rows"], "cover", r["benchmark_cover"])
        for a, m in r["arms"].items():
            print(f"  {a:4s} {m['leader_correct']:5d}/{m['wards']} ({m['wards_forecast']} forecast) MAE {m['share_mae_pp_all_lanes']} Brier {m['brier_common']}  bias "
                  + ", ".join(f"{p[:3]} {m['by_party'][p]['signed_bias_pp']}" for p in LANES)
                  + "  leads " + ", ".join(f"{p[:3]} {m['by_party'][p]['called_leads']}/{m['by_party'][p]['actual_leads']}" for p in LANES))
        print("   on B2 rows", r["on_b2_rows"])
    for a, r in rules.items():
        print("rules", a, json.dumps({k: v for k, v in r.items() if k != "per_year"}))
        print("   per year", json.dumps({y: v["difference"] for y, v in r["per_year"].items()}))
    for s, g in res["age_breakdown"].items():
        print("age", s, json.dumps(g))


if __name__ == "__main__":
    main()
