"""Choose and score the baseline age discount by whole-council folds
(BASELINE_AGE_SPEC.md), with the November scorer.

Output: results/baseline_age_summary.json
"""
from __future__ import annotations

import hashlib
import json

import pandas as pd

from common import ARMS, BLEND_WEIGHT_MODEL, CACHE, LANES, LANE_KEY, MAY26_ACTUALS, OUT, POSTAUDIT, read_json
from rolling_score import arm_from
from score import Mapper, blend, pooled, score_arm, top

FOLDS = 5


def fold_of(council: str) -> int:
    return int(hashlib.sha256(council.encode()).hexdigest()[:8], 16) % FOLDS


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
    doc = read_json(ARMS / "candidate-age.json")
    grid, age = doc["grid"], doc["age"]

    model = arm_from(stored[stored.set == "may26"].set_index("ballot_paper_id"), "m")
    model.update(arm_from(new, "m"))

    def engine(name):
        out = {}
        for i in ids:
            sh = doc["arms"][name].get(i)
            if sh:
                sh = pooled(sh)
                out[i] = {"leader": top(sh), "shares": sh}
        return out

    def blended(eng):
        out = {}
        for i, c in eng.items():
            m = model.get(i)
            if m:
                sh = blend(c["shares"], m["shares"], BLEND_WEIGHT_MODEL)
                out[i] = {"leader": top(sh), "shares": sh}
        return out

    real = {k: engine(f"real_k{k}") for k in grid}
    notional = {k: engine(f"notional_k{k}") for k in grid}
    bridged = list(new.index)
    based = [i for i in ids if i in age and i not in set(bridged)]
    fold = {i: fold_of(i.split(".")[1]) for i in based}

    def sc(v, arm):
        return score_arm(v, arm, act, lead, mapper)

    def pick(train):
        errs = {k: sc(train, real[k])["share_mae_pp_all_lanes"] for k in grid}
        best = min(grid, key=lambda k: (errs[k], k))
        return best, errs

    results = {"folds": {}, "wards_with_a_base": len(based)}
    oof = {}
    for f in range(FOLDS):
        train = [i for i in based if fold[i] != f]
        held = [i for i in based if fold[i] == f]
        k, errs = pick(train)
        for i in held:
            oof[i] = real[k][i]
        results["folds"][str(f)] = {"councils": len({i.split(".")[1] for i in held}), "wards": len(held), "k_chosen": k, "training_share_error_by_k": errs}
    results["out_of_fold"] = {
        "engine_before": sc(based, real[0]), "engine_rule": sc(based, oof),
        "blend_before": sc(based, blended(real[0])), "blend_rule": sc(based, blended(oof)),
    }
    k_all, errs_all = pick(based)
    results["k_on_all_wards_with_a_base"] = {"k": k_all, "share_error_by_k": errs_all}
    results["in_sample_grid_descriptive"] = {
        str(k): {"engine": sc(based, real[k]), "blend": sc(based, blended(real[k]))} for k in grid}
    year = {i: f"{2026 - round(age[i]):d}" if age[i] >= 0.5 else "2026" for i in based}
    results["out_of_fold_by_baseline_year"] = {}
    for y in sorted(set(year.values())):
        v = [i for i in based if year[i] == y]
        results["out_of_fold_by_baseline_year"][y] = {
            "engine_before": sc(v, real[0]), "engine_rule": sc(v, oof), "blend_before": sc(v, blended(real[0])), "blend_rule": sc(v, blended(oof))}
    results["bridged_220"] = {
        "engine_fallback": sc(bridged, real[0]), "blend_fallback": sc(bridged, blended(real[0])),
        "engine_notional": sc(bridged, notional[0]), "blend_notional": sc(bridged, blended(notional[0])),
        "engine_notional_rule": sc(bridged, notional[k_all]), "blend_notional_rule": sc(bridged, blended(notional[k_all])),
    }
    results["all_2897_at_k_all"] = {
        "engine_before": sc(ids, real[0]), "blend_before": sc(ids, blended(real[0])),
        "engine_rule_bridged_on_fallback": sc(ids, real[k_all]), "blend_rule_bridged_on_fallback": sc(ids, blended(real[k_all])),
        "engine_rule_bridged_notional": sc(ids, notional[k_all]), "blend_rule_bridged_notional": sc(ids, blended(notional[k_all])),
    }
    with open(OUT / "baseline_age_summary.json", "w") as f:
        json.dump(results, f, indent=1, default=float)
        f.write("\n")

    def line(a, r):
        print(f"  {a:32s} {r['leader_correct']:4d}/{r['wards']} MAE {r['share_mae_pp_all_lanes']} Brier {r['brier_common']}  bias "
              + ", ".join(f"{p[:3]} {r['by_party'][p]['signed_bias_pp']}" for p in LANES)
              + "  leads " + ", ".join(f"{p[:3]} {r['by_party'][p]['called_leads']}/{r['by_party'][p]['actual_leads']}" for p in LANES))
    for f, v in results["folds"].items():
        print("fold", f, v["councils"], "councils", v["wards"], "wards, k", v["k_chosen"], v["training_share_error_by_k"])
    print("k on all", results["k_on_all_wards_with_a_base"])
    for s in ["out_of_fold", "bridged_220", "all_2897_at_k_all"]:
        print(s)
        for a, r in results[s].items():
            line(a, r)
    for y, res in results["out_of_fold_by_baseline_year"].items():
        print("baseline year", y)
        for a, r in res.items():
            line(a, r)
    print("in sample grid (descriptive)")
    for k, res in results["in_sample_grid_descriptive"].items():
        for a, r in res.items():
            line(f"k {k} {a}", r)


if __name__ == "__main__":
    main()
