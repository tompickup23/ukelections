"""Score the local strength arms (STRENGTH_SPEC.md): L0, L1 and L2, with the
conventions of score.py and bridge_level_score.py (leader by full slate share
over six pooled lanes; a ward an arm cannot forecast counts as a miss; share
error over lanes with a forecast or an actual share).

Input: cache/strength_predictions.pkl, cache/strength_run.pkl (this folder's own
cache, written by strength_fit.py), cache/fit_meta.pkl
Output: results/strength_summary.json
"""
from __future__ import annotations

import json
import math

import numpy as np
import pandas as pd

from bridge_level_fit import SCHEDULED
from common import CACHE, LANES, LANE_KEY, MAJOR, OUT
from rolling_score import arm_from
from score import Mapper, score_arm, top

ARMS = ["l0", "l1", "l2"]
KEYS = [LANE_KEY[p] for p in LANES]
YEAR = {d: d[:4] for d in SCHEDULED}
YEARS = [YEAR[d] for d in SCHEDULED]
CONCENTRATED = ["Liberal Democrats", "Green Party", "Others"]


def prev_leader(r):
    """The lane that topped the ward's previous contest, from the prev_top_* input; None if no previous contest."""
    if pd.isna(r["prev_top_ref"]):
        return None
    for p in LANES:
        if r[f"prev_top_{LANE_KEY[p]}"] == 1.0:
            return p
    return None


def main():
    # This folder's own cache (our research output, not untrusted data).
    df = pd.read_pickle(CACHE / "strength_predictions.pkl").set_index("ballot_paper_id")
    run = pd.read_pickle(CACHE / "strength_run.pkl")
    fit_meta = pd.read_pickle(CACHE / "fit_meta.pkl")
    assert df.index.is_unique
    mapper = Mapper({p: fit_meta["lanes"][p]["oof_logit_resid_sd"] for p in LANES})
    act = {i: {p: float(r[f"s_{LANE_KEY[p]}"]) for p in LANES} for i, r in df.iterrows()}
    lead = {i: top(act[i]) for i in df.index}
    prev = {i: prev_leader(r) for i, r in df.iterrows()}
    arms = {a: arm_from(df, a) for a in ARMS}
    assert set(arms["l0"]) == set(arms["l1"]) == set(arms["l2"]), "forecastable wards differ between arms"

    sched, by = df[~df.is_by], df[df.is_by]
    sets = {f"scheduled_{YEAR[d]}": sched[sched.date == d].index for d in SCHEDULED}
    sets["scheduled_pooled_six"] = sched[sched.date.isin(SCHEDULED)].index
    sets["byelections_all"] = by.index
    for y in sorted(set(by.date.str[:4])):
        sets[f"byelections_{y}"] = by[by.date.str[:4] == y].index

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

    # ---- (a) rule
    qa = {}
    for a in ["l1", "l2"]:
        per_year = {y: {"wards": res["sets"][f"scheduled_{y}"]["rows"], "l0": lc(f"scheduled_{y}", "l0"), a: lc(f"scheduled_{y}", a),
                        "difference": lc(f"scheduled_{y}", a) - lc(f"scheduled_{y}", "l0"),
                        "l0_mae": mae(f"scheduled_{y}", "l0"), f"{a}_mae": mae(f"scheduled_{y}", a)} for y in YEARS}
        at_least = [y for y in YEARS if per_year[y]["difference"] >= 0]
        worse_1pct = [y for y in YEARS if -per_year[y]["difference"] > 0.01 * per_year[y]["wards"]]
        p = "scheduled_pooled_six"
        r = {
            "per_year": per_year,
            "pooled_leaders": {"l0": lc(p, "l0"), a: lc(p, a)},
            "pooled_share_mae_pp": {"l0": mae(p, "l0"), a: mae(p, a)},
            "years_at_least_as_many": at_least,
            "years_worse_by_more_than_1pct": worse_1pct,
            "rule_1_pooled_more": lc(p, a) > lc(p, "l0"),
            "rule_2_pooled_mae_no_higher": mae(p, a) <= mae(p, "l0"),
            "rule_3_four_of_six_years": len(at_least) >= 4,
            "rule_4_no_year_worse_than_1pct": len(worse_1pct) == 0,
        }
        r["supported"] = all(r[k] for k in ["rule_1_pooled_more", "rule_2_pooled_mae_no_higher", "rule_3_four_of_six_years", "rule_4_no_year_worse_than_1pct"])
        qa[a] = r
    res["question_a"] = qa

    # ---- (b) party totals over wards every arm forecast
    qb = {"years": {}, "lowest_rms_years": {a: 0 for a in ARMS}, "tied_lowest_years": []}
    for T in SCHEDULED:
        y = YEAR[T]
        ids = [i for i in sets[f"scheduled_{y}"] if i in arms["l0"]]
        led = {p: sum(1 for i in ids if lead[i] == p) for p in LANES}
        yr = {"wards_forecast_by_every_arm": len(ids), "led": led, "arms": {}}
        for a in ARMS:
            called = {p: sum(1 for i in ids if arms[a][i]["leader"] == p) for p in LANES}
            diff = {p: called[p] - led[p] for p in LANES}
            rms = math.sqrt(sum(diff[p] ** 2 for p in MAJOR) / len(MAJOR))
            yr["arms"][a] = {"called_first": called, "called_minus_led": diff, "rms_five_main_parties": round(rms, 1)}
        best = min(yr["arms"][a]["rms_five_main_parties"] for a in ARMS)
        winners = [a for a in ARMS if yr["arms"][a]["rms_five_main_parties"] == best]
        if len(winners) == 1:
            qb["lowest_rms_years"][winners[0]] += 1
        else:
            qb["tied_lowest_years"].append({"year": y, "arms": winners})
        qb["years"][y] = yr
    res["question_b"] = qb

    # ---- (c) where it helps
    pooled = [i for i in sets["scheduled_pooled_six"]]
    groups = {"same_leader_as_last_time": [i for i in pooled if prev[i] is not None and prev[i] == lead[i]],
              "leader_changed": [i for i in pooled if prev[i] is not None and prev[i] != lead[i]],
              "no_previous_contest": [i for i in pooled if prev[i] is None]}
    qc = {"by_ward_history": {}, "by_lane_led_last_time": {}, "concentrated_lanes": {}}
    for g, ids in groups.items():
        qc["by_ward_history"][g] = {"wards": len(ids), **{a: sum(1 for i in ids if i in arms[a] and arms[a][i]["leader"] == lead[i]) for a in ARMS}}
        qc["by_ward_history"][g]["per_year"] = {
            y: {"wards": sum(1 for i in ids if df.at[i, "date"] == T),
                **{a: sum(1 for i in ids if df.at[i, "date"] == T and i in arms[a] and arms[a][i]["leader"] == lead[i]) for a in ARMS}}
            for T, y in YEAR.items()}
    for p in LANES:
        k = LANE_KEY[p]
        out = {}
        for led_last, ids in (("led_last_time", [i for i in pooled if prev[i] == p]),
                              ("did_not_lead_last_time", [i for i in pooled if prev[i] is not None and prev[i] != p])):
            led = sum(1 for i in ids if lead[i] == p)
            o = {"wards": len(ids), "lane_led": led}
            for a in ARMS:
                called = [i for i in ids if i in arms[a] and arms[a][i]["leader"] == p]
                hit = sum(1 for i in called if lead[i] == p)
                err = [arms[a][i]["shares"][p] - act[i][p] for i in ids if i in arms[a] and (arms[a][i]["shares"][p] > 0 or act[i][p] > 0)]
                o[a] = {"called_first": len(called), "called_first_and_led": hit,
                        "share_mae_pp": round(100 * float(np.mean(np.abs(err))), 2) if err else None,
                        "signed_bias_pp": round(100 * float(np.mean(err)), 2) if err else None}
            out[led_last] = o
        qc["by_lane_led_last_time"][p] = out
    for p in CONCENTRATED:
        o = {}
        for T, y in YEAR.items():
            ids = [i for i in sets[f"scheduled_{y}"]]
            led = sum(1 for i in ids if lead[i] == p)
            o[y] = {"lane_led": led, **{a: {"called_first": sum(1 for i in ids if i in arms[a] and arms[a][i]["leader"] == p),
                                            "called_first_and_led": sum(1 for i in ids if i in arms[a] and arms[a][i]["leader"] == p and lead[i] == p),
                                            "signed_bias_pp": res["sets"][f"scheduled_{y}"]["arms"][a]["by_party"][p]["signed_bias_pp"]}
                                        for a in ARMS}}
        qc["concentrated_lanes"][p] = o
    res["question_c"] = qc

    # ---- (d) by-elections
    qd = {}
    for s in [k for k in sets if k.startswith("byelections")]:
        qd[s] = {"contests": res["sets"][s]["rows"], "forecast": res["sets"][s]["arms"]["l0"]["wards_forecast"],
                 **{f"{a}_leaders": lc(s, a) for a in ARMS}, **{f"{a}_mae": mae(s, a) for a in ARMS}}
    n_by = res["sets"]["byelections_all"]["rows"]
    for a in ["l1", "l2"]:
        qd[f"check_{a}"] = {
            "leaders_not_below_l0_by_more_than_1pct": lc("byelections_all", a) >= lc("byelections_all", "l0") - 0.01 * n_by,
            "mae_not_above_l0_by_more_than_0.10pp": mae("byelections_all", a) <= mae("byelections_all", "l0") + 0.10,
        }
    res["question_d"] = qd
    res["run"] = {k: (round(v) if isinstance(v, float) else v) for k, v in run.items()}

    OUT.mkdir(exist_ok=True)
    with open(OUT / "strength_summary.json", "w") as f:
        json.dump(res, f, indent=1, default=float)
        f.write("\n")

    for s, r in res["sets"].items():
        print(s, r["rows"], "unforecastable", r["unforecastable"])
        for a, m in r["arms"].items():
            print(f"  {a} {m['leader_correct']:5d}/{m['wards']} ({m['wards_forecast']} forecast) MAE {m['share_mae_pp_all_lanes']}  bias "
                  + ", ".join(f"{p[:3]} {m['by_party'][p]['signed_bias_pp']}" for p in LANES))
    for a, r in qa.items():
        print("question_a", a, json.dumps({k: v for k, v in r.items() if k != "per_year"}))
        print("   per year", json.dumps({y: v["difference"] for y, v in r["per_year"].items()}))
    for y, yr in qb["years"].items():
        print("question_b", y, "led", yr["led"])
        for a in ARMS:
            print("   ", a, yr["arms"][a]["called_minus_led"], "rms", yr["arms"][a]["rms_five_main_parties"])
    print("question_b lowest", qb["lowest_rms_years"], qb["tied_lowest_years"])
    print("question_c history", json.dumps({g: {k: v for k, v in x.items() if k != "per_year"} for g, x in qc["by_ward_history"].items()}))
    for p, o in qc["by_lane_led_last_time"].items():
        print("question_c lane", p, json.dumps(o))
    print("question_d", json.dumps(qd))
    print("run", res["run"])


if __name__ == "__main__":
    main()
