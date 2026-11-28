"""Score the bridged May 2026 wards (BRIDGE_SPEC.md) with the November scorer.

Output: results/bridge_summary.json
"""
from __future__ import annotations

import json

import pandas as pd

from common import BLEND_WEIGHT_MODEL, CACHE, LANES, LANE_KEY, OUT, read_json
from rolling_score import arm_from
from score import CANDIDATE_FILE, Mapper, blend, pooled, score_arm, top


def main():
    # Local caches written by this folder's own scripts.
    new = pd.read_pickle(CACHE / "bridge_predictions.pkl").set_index("ballot_paper_id")
    fit_meta = pd.read_pickle(CACHE / "fit_meta.pkl")
    prior = read_json(OUT / "summary.json")["may_2026"]["all_2897"]
    mapper = Mapper({p: fit_meta["lanes"][p]["oof_logit_resid_sd"] for p in LANES})
    act = {i: {p: float(r[f"s_{LANE_KEY[p]}"]) for p in LANES} for i, r in new.iterrows()}
    lead = {i: top(act[i]) for i in new.index}
    arms = {"model": arm_from(new, "m"), "candidate_engine": {}, "blend": {}}
    for i, e in read_json(CANDIDATE_FILE)["predictions"].items():
        if i in new.index and e and e.get("prediction"):
            sh = pooled({p: v.get("pct", 0) for p, v in e["prediction"].items()})
            arms["candidate_engine"][i] = {"leader": top(sh), "shares": sh}
            m = arms["model"].get(i)
            if m:
                b = blend(sh, m["shares"], BLEND_WEIGHT_MODEL)
                arms["blend"][i] = {"leader": top(b), "shares": b}
    sets = {
        "bridged_220": new.index,
        "wards": new[new.layer == "ward"].index,
        "county_divisions": new[new.layer == "county_division"].index,
        "one_old_area": new[new.n_parents == 1].index,
        "several_old_areas": new[new.n_parents > 1].index,
    }
    results = {s: {a: score_arm(list(ids), arms[a], act, lead, mapper) for a in arms} for s, ids in sets.items()}
    b220 = results["bridged_220"]
    results["all_2897_after_bridge"] = {
        "model": {"before": prior["model"]["leader_correct"], "after": prior["model"]["leader_correct"] + b220["model"]["leader_correct"]},
        "blend": {"before": prior["blend"]["leader_correct"], "after": prior["blend"]["leader_correct"] + b220["blend"]["leader_correct"]},
        "candidate_engine": {"all": prior["candidate"]["leader_correct"]},
        "wards": 2897, "still_unscored": 2897 - 2596 - len(new),
    }
    with open(OUT / "bridge_summary.json", "w") as f:
        json.dump(results, f, indent=1, default=float)
        f.write("\n")
    for s, res in results.items():
        if s == "all_2897_after_bridge":
            print(s, json.dumps(res))
            continue
        print(s)
        for a, r in res.items():
            print(f"  {a:17s} {r['leader_correct']:4d}/{r['wards']} ({r['wards_forecast']} forecast) MAE {r['share_mae_pp_all_lanes']} Brier {r['brier_common']}  bias "
                  + ", ".join(f"{p[:3]} {r['by_party'][p]['signed_bias_pp']}" for p in LANES)
                  + "  leads " + ", ".join(f"{p[:3]} {r['by_party'][p]['called_leads']}/{r['by_party'][p]['actual_leads']}" for p in LANES))


if __name__ == "__main__":
    main()
