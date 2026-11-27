"""Score W365 and W180 (RECENCY_SPEC.md) beside S1, with the November scorer.

Output: results/recency_summary.json
"""
from __future__ import annotations

import json

import pandas as pd

from common import BLEND_WEIGHT_MODEL, CACHE, LANES, LANE_KEY, OUT, read_json
from rolling_score import arm_from
from score import CANDIDATE_FILE, Mapper, blend, pooled, score_arm, top

NAMES = [("s1_pooled", "s1"), ("w365", "w365"), ("w180", "w180")]


def main():
    # Local caches written by this folder's own scripts.
    df = pd.read_pickle(CACHE / "recency_predictions.pkl").set_index("ballot_paper_id")
    fit_meta = pd.read_pickle(CACHE / "fit_meta.pkl")
    mapper = Mapper({p: fit_meta["lanes"][p]["oof_logit_resid_sd"] for p in LANES})
    act = {i: {p: float(r[f"s_{LANE_KEY[p]}"]) for p in LANES} for i, r in df.iterrows()}
    lead = {i: top(act[i]) for i in df.index}
    arms = {name: arm_from(df, pre) for name, pre in NAMES}
    by = df[df.is_by]
    s26 = df[(~df.is_by) & (df.date == "2026-05-07")]
    sets = {
        "byelections_all_652": by.index,
        "byelections_before_may_2026": by[by.set != "byelection"].index,
        "byelections_after_may_2026_107": by[by.set == "byelection"].index,
        "scheduled_2025": df[(~df.is_by) & (df.date == "2025-05-01")].index,
        "scheduled_2026": s26.index,
        "scheduled_2026_london": s26[s26.region == "London"].index,
        "scheduled_2026_outside_london": s26[s26.region != "London"].index,
    }
    results = {s: {a: score_arm(list(ids), arms[a], act, lead, mapper) for a in arms} for s, ids in sets.items()}

    cand = {}
    for i, e in read_json(CANDIDATE_FILE)["predictions"].items():
        if e and e.get("prediction"):
            sh = pooled({p: v.get("pct", 0) for p, v in e["prediction"].items()})
            cand[i] = {"leader": top(sh), "shares": sh}
    may = df[df.set == "may26"]
    common = [i for i in may.index if i in cand]
    barms = {"candidate_engine": cand}
    for name, _ in NAMES:
        b = {}
        for i in common:
            m = arms[name].get(i)
            if m:
                sh = blend(cand[i]["shares"], m["shares"], BLEND_WEIGHT_MODEL)
                b[i] = {"leader": top(sh), "shares": sh}
        barms[f"blend_{name}"] = b
    results["may_2026_blend_2596"] = {a: score_arm(common, barms[a], act, lead, mapper) for a in barms}

    with open(OUT / "recency_summary.json", "w") as f:
        json.dump(results, f, indent=1, default=float)
        f.write("\n")
    for sname, res in results.items():
        print(sname)
        for a, r in res.items():
            print(f"  {a:16s} {r['leader_correct']:5d}/{r['wards']} ({r['wards_forecast']} forecast) MAE {r['share_mae_pp_all_lanes']} Brier {r['brier_common']}  bias "
                  + ", ".join(f"{p[:3]} {r['by_party'][p]['signed_bias_pp']}" for p in LANES)
                  + "  leads " + ", ".join(f"{p[:3]} {r['by_party'][p]['called_leads']}/{r['by_party'][p]['actual_leads']}" for p in LANES))


if __name__ == "__main__":
    main()
