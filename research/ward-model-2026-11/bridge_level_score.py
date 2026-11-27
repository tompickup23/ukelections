"""Score the by-election level and standing rate arms (BRIDGE_LEVEL_SPEC.md):
C0, C1, C2 and C3, with the conventions of score.py and backtest_b_score.py.

Input: cache/bridge_level_predictions.pkl, cache/bridge_level_levels.pkl (this
folder's own cache, written by bridge_level_fit.py), cache/fit_meta.pkl
Output: results/bridge_level_summary.json
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd

from bridge_level_fit import PREVIOUS_MAY, SCHEDULED
from common import CACHE, LANES, LANE_KEY, OUT, logit
from rolling_score import arm_from
from score import Mapper, score_arm, top

ARMS = ["c0", "c1", "c2", "c3"]
KEYS = [LANE_KEY[p] for p in LANES]
YEAR = {d: d[:4] for d in SCHEDULED}


def main():
    # This folder's own cache (our research output, not untrusted data).
    df = pd.read_pickle(CACHE / "bridge_level_predictions.pkl").set_index("ballot_paper_id")
    lv = pd.read_pickle(CACHE / "bridge_level_levels.pkl")
    fit_meta = pd.read_pickle(CACHE / "fit_meta.pkl")
    assert df.index.is_unique
    mapper = Mapper({p: fit_meta["lanes"][p]["oof_logit_resid_sd"] for p in LANES})
    act = {i: {p: float(r[f"s_{LANE_KEY[p]}"]) for p in LANES} for i, r in df.iterrows()}
    lead = {i: top(act[i]) for i in df.index}
    arms = {a: arm_from(df, a) for a in ARMS}

    sched, by = df[~df.is_by], df[df.is_by]
    sets = {f"scheduled_{YEAR[d]}": sched[sched.date == d].index for d in SCHEDULED}
    sets["scheduled_pooled_six"] = sched[sched.date.isin(SCHEDULED)].index
    in_window = pd.Series(False, index=by.index)
    for T in SCHEDULED:
        m = (by.date > PREVIOUS_MAY[T]) & (by.date < T)
        sets[f"byelections_window_before_{YEAR[T]}"] = by[m].index
        in_window |= m
    sets["byelections_outside_windows"] = by[~in_window].index
    sets["byelections_all"] = by.index

    res = {"sets": {}}
    for s, ids in sets.items():
        ids = list(ids)
        res["sets"][s] = {
            "rows": len(ids),
            "unforecastable": {str(k): int(v) for k, v in df.loc[ids, "unforecastable"].value_counts().items()},
            "arms": {a: score_arm(ids, arms[a], act, lead, mapper) for a in ARMS},
        }

    def lc(s, a):
        return res["sets"][s]["arms"][a]["leader_correct"]

    def mae(s, a):
        return res["sets"][s]["arms"][a]["share_mae_pp_all_lanes"]

    # ---- (a)
    years = [YEAR[d] for d in SCHEDULED]
    qa = {}
    for a in ["c1", "c2", "c3"]:
        per_year = {y: {"wards": res["sets"][f"scheduled_{y}"]["rows"], "c0": lc(f"scheduled_{y}", "c0"), a: lc(f"scheduled_{y}", a),
                        "difference": lc(f"scheduled_{y}", a) - lc(f"scheduled_{y}", "c0"),
                        "c0_mae": mae(f"scheduled_{y}", "c0"), f"{a}_mae": mae(f"scheduled_{y}", a)} for y in years}
        at_least = [y for y in years if per_year[y]["difference"] >= 0]
        worse_1pct = [y for y in years if -per_year[y]["difference"] > 0.01 * per_year[y]["wards"]]
        p = "scheduled_pooled_six"
        r = {
            "per_year": per_year,
            "pooled_leaders": {"c0": lc(p, "c0"), a: lc(p, a)},
            "pooled_share_mae_pp": {"c0": mae(p, "c0"), a: mae(p, a)},
            "years_at_least_as_many": at_least,
            "years_worse_by_more_than_1pct": worse_1pct,
            "rule_1_pooled_more": lc(p, a) > lc(p, "c0"),
            "rule_2_pooled_mae_no_higher": mae(p, a) <= mae(p, "c0"),
            "rule_3_four_of_six_years": len(at_least) >= 4,
            "rule_4_no_year_worse_than_1pct": len(worse_1pct) == 0,
        }
        r["supported"] = all(r[k] for k in ["rule_1_pooled_more", "rule_2_pooled_mae_no_higher", "rule_3_four_of_six_years", "rule_4_no_year_worse_than_1pct"])
        qa[a] = r
    res["question_a"] = qa

    # ---- (b)
    s25 = "scheduled_2025"
    res["question_b"] = {a: {"leaders": lc(s25, a), "wards": res["sets"][s25]["rows"],
                             "reform_signed_bias_pp": res["sets"][s25]["arms"][a]["by_party"]["Reform UK"]["signed_bias_pp"],
                             "reform_called_first": res["sets"][s25]["arms"][a]["by_party"]["Reform UK"]["called_leads"],
                             "reform_led": res["sets"][s25]["arms"][a]["by_party"]["Reform UK"]["actual_leads"]} for a in ARMS}

    # ---- (c)
    cells, tally = {}, {"same_sign": 0, "opposite_sign": 0, "no_byelection_evidence": 0, "no_wards": 0}
    for T in SCHEDULED:
        y = YEAR[T]
        rows = sched[(sched.date == T) & sched[[f"c0_{k}" for k in KEYS]].notna().any(axis=1)]
        cells[y] = {}
        for p in LANES:
            k = LANE_KEY[p]
            st = rows[rows[f"stood_{k}"].astype(bool)]
            e = np.asarray(logit(st[f"s_{k}"])) - np.asarray(logit(st[f"a_{k}"])) - st[f"off_c0_{k}"].to_numpy()
            may_mean = float(np.mean(e)) if len(e) else None
            L = lv["levels"][T][f"c1_{k}"]
            by_mean = L["weighted_mean_residual"]
            if L["contests"] == 0:
                verdict = "no_byelection_evidence"
            elif may_mean is None:
                verdict = "no_wards"
            else:
                verdict = "same_sign" if by_mean * may_mean > 0 else "opposite_sign"
            tally[verdict] += 1
            cells[y][p] = {"byelections": L["contests"], "weight_sum": round(L["weight_sum"], 2),
                           "byelection_mean_residual": None if by_mean is None else round(by_mean, 3),
                           "level_after_shrinkage": round(L["level"], 3),
                           "may_wards": int(len(e)), "may_mean_residual": None if may_mean is None else round(may_mean, 3),
                           "verdict": verdict}
    res["question_c"] = {"cells": cells, "tally": tally,
                         "by_lane": {p: {v: sum(1 for y in cells if cells[y][p]["verdict"] == v) for v in tally} for p in LANES}}
    res["levels"] = lv["levels"]

    # ---- (d)
    qd = {}
    for s in [k for k in sets if k.startswith("byelections")]:
        ids = list(sets[s])
        changed = sum(1 for i in ids if i in arms["c0"] and arms["c1"].get(i, {}).get("shares") != arms["c0"][i]["shares"])
        qd[s] = {"contests": len(ids), "forecast": res["sets"][s]["arms"]["c0"]["wards_forecast"],
                 "c0_leaders": lc(s, "c0"), "c2_leaders": lc(s, "c2"), "c0_mae": mae(s, "c0"), "c2_mae": mae(s, "c2"),
                 "c1_forecasts_differing_from_c0": changed}
    res["question_d"] = qd
    res["run"] = {"fit_seconds": round(lv["fit_seconds"]), "lane_jobs": lv["lane_jobs"], "cuts": lv["cuts"]}

    OUT.mkdir(exist_ok=True)
    with open(OUT / "bridge_level_summary.json", "w") as f:
        json.dump(res, f, indent=1, default=float)
        f.write("\n")

    for s, r in res["sets"].items():
        print(s, r["rows"], "unforecastable", r["unforecastable"])
        for a, m in r["arms"].items():
            print(f"  {a} {m['leader_correct']:5d}/{m['wards']} ({m['wards_forecast']} forecast) MAE {m['share_mae_pp_all_lanes']}  bias "
                  + ", ".join(f"{p[:3]} {m['by_party'][p]['signed_bias_pp']}" for p in LANES)
                  + "  leads " + ", ".join(f"{p[:3]} {m['by_party'][p]['called_leads']}/{m['by_party'][p]['actual_leads']}" for p in LANES))
    for a, r in qa.items():
        print("question_a", a, json.dumps({k: v for k, v in r.items() if k != "per_year"}))
    print("question_b", json.dumps(res["question_b"]))
    print("question_c tally", json.dumps(res["question_c"]["tally"]), json.dumps(res["question_c"]["by_lane"]))
    for y, c in cells.items():
        print("  ", y, {p[:3]: (v["byelections"], v["byelection_mean_residual"], v["level_after_shrinkage"], v["may_wards"], v["may_mean_residual"], v["verdict"][:4]) for p, v in c.items()})
    print("question_d", json.dumps(qd))
    print("run", res["run"])


if __name__ == "__main__":
    main()
