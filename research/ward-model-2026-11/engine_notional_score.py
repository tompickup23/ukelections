"""Score the candidate engine with a notional previous result on the bridged
wards (ENGINE_NOTIONAL_SPEC.md), with the November scorer.

Output: results/engine_notional_summary.json
"""
from __future__ import annotations

import json

import pandas as pd

from common import ARMS, BLEND_WEIGHT_MODEL, CACHE, LANES, LANE_KEY, MAY26_ACTUALS, OUT, POSTAUDIT, read_json
from rolling_score import arm_from
from score import CANDIDATE_FILE, Mapper, blend, pooled, score_arm, top


def engine_arm(path, ids):
    out = {}
    cand = read_json(path)["predictions"]
    for i in ids:
        e = cand.get(i)
        if e and e.get("prediction"):
            sh = pooled({p: v.get("pct", 0) for p, v in e["prediction"].items()})
            out[i] = {"leader": top(sh), "shares": sh}
    return out


def main():
    # Local caches written by this folder's own scripts.
    new = pd.read_pickle(CACHE / "bridge_predictions.pkl").set_index("ballot_paper_id")
    stored = pd.read_pickle(CACHE / "predictions.pkl")
    fit_meta = pd.read_pickle(CACHE / "fit_meta.pkl")
    mapper = Mapper({p: fit_meta["lanes"][p]["oof_logit_resid_sd"] for p in LANES})
    ids = [r["ballot_paper_id"] for r in read_json(POSTAUDIT)["prereg"]["rows"] if r["ballot_paper_id"].startswith("local.")]
    actuals = read_json(MAY26_ACTUALS)["by_ballot"]
    act = {i: pooled(actuals[i]["vote_shares"]) for i in ids}
    lead = {i: top(act[i]) for i in ids}

    model = arm_from(stored[stored.set == "may26"].set_index("ballot_paper_id"), "m")
    model.update(arm_from(new, "m"))
    arms = {"engine_before": engine_arm(CANDIDATE_FILE, ids), "engine_after": engine_arm(ARMS / "candidate-notional.json", ids), "model": model}
    for tag in ["before", "after"]:
        arms[f"blend_{tag}"] = {}
        for i, c in arms[f"engine_{tag}"].items():
            m = model.get(i)
            if m:
                sh = blend(c["shares"], m["shares"], BLEND_WEIGHT_MODEL)
                arms[f"blend_{tag}"][i] = {"leader": top(sh), "shares": sh}

    bridged = set(new.index)
    sets = {
        "bridged_220": list(new.index),
        "wards": list(new[new.layer == "ward"].index),
        "county_divisions": list(new[new.layer == "county_division"].index),
        "one_old_area": list(new[new.n_parents == 1].index),
        "several_old_areas": list(new[new.n_parents > 1].index),
        "other_2677": [i for i in ids if i not in bridged],
        "all_2897": ids,
    }
    results = {s: {a: score_arm(v, arms[a], act, lead, mapper) for a in arms} for s, v in sets.items()}
    other = sets["other_2677"]
    results["other_wards_leader_changes"] = {
        a: sum(1 for i in other if i in arms[f"{a}_before"] and arms[f"{a}_before"][i]["leader"] != arms[f"{a}_after"][i]["leader"])
        for a in ["engine", "blend"]
    }
    with open(OUT / "engine_notional_summary.json", "w") as f:
        json.dump(results, f, indent=1, default=float)
        f.write("\n")
    for s, res in results.items():
        if s == "other_wards_leader_changes":
            print(s, json.dumps(res))
            continue
        print(s)
        for a, r in res.items():
            print(f"  {a:14s} {r['leader_correct']:4d}/{r['wards']} ({r['wards_forecast']} forecast) MAE {r['share_mae_pp_all_lanes']} Brier {r['brier_common']}  bias "
                  + ", ".join(f"{p[:3]} {r['by_party'][p]['signed_bias_pp']}" for p in LANES)
                  + "  leads " + ", ".join(f"{p[:3]} {r['by_party'][p]['called_leads']}/{r['by_party'][p]['actual_leads']}" for p in LANES))


if __name__ == "__main__":
    main()
