"""Score R1, R2 and R3 (OTHERS_SPLIT_SPEC.md) beside S1, with the November scorer.

Output: results/split_summary.json
"""
from __future__ import annotations

import json

import pandas as pd

from common import CACHE, LANES, LANE_KEY, OUT
from rolling_score import arm_from
from score import Mapper, score_arm, top


def main():
    # Local caches written by this folder's own scripts.
    df = pd.read_pickle(CACHE / "split_predictions.pkl").set_index("ballot_paper_id")
    fit_meta = pd.read_pickle(CACHE / "fit_meta.pkl")
    mapper = Mapper({p: fit_meta["lanes"][p]["oof_logit_resid_sd"] for p in LANES})
    act = {i: {p: float(r[f"s_{LANE_KEY[p]}"]) for p in LANES} for i, r in df.iterrows()}
    lead = {i: top(act[i]) for i in df.index}
    arms = {name: arm_from(df, pre) for name, pre in [("s1_pooled", "s1"), ("r1_others_split", "r1"), ("r2_short_memory", "r2"), ("r3_both", "r3")]}

    by = df[df.is_by]
    sets = {
        "byelections_all_652": by.index,
        "byelections_before_may_2026": by[by.set != "byelection"].index,
        "byelections_after_may_2026_107": by[by.set == "byelection"].index,
        "scheduled_2025": df[(~df.is_by) & (df.date == "2025-05-01")].index,
        "scheduled_2026": df[(~df.is_by) & (df.date == "2026-05-07")].index,
    }
    results = {s: {a: score_arm(list(ids), arms[a], act, lead, mapper) for a in arms} for s, ids in sets.items()}
    # Wards where an independent or a minor party stood, by-elections and May 2026
    for label, frame in [("byelections_independent_stood", by[by.stood_ind.astype(bool)]),
                         ("scheduled_2026_independent_stood", df[(~df.is_by) & (df.date == "2026-05-07") & df.stood_ind.astype(bool)])]:
        results[label] = {a: score_arm(list(frame.index), arms[a], act, lead, mapper) for a in ["s1_pooled", "r1_others_split"]}

    OUT.mkdir(exist_ok=True)
    with open(OUT / "split_summary.json", "w") as f:
        json.dump(results, f, indent=1, default=float)
        f.write("\n")
    for sname, res in results.items():
        print(sname)
        for a, r in res.items():
            print(f"  {a:18s} {r['leader_correct']:5d}/{r['wards']} ({r['wards_forecast']} forecast) MAE {r['share_mae_pp_all_lanes']} Brier {r['brier_common']}  bias "
                  + ", ".join(f"{p[:3]} {r['by_party'][p]['signed_bias_pp']}" for p in LANES)
                  + "  leads " + ", ".join(f"{p[:3]} {r['by_party'][p]['called_leads']}/{r['by_party'][p]['actual_leads']}" for p in LANES)
                  + f"  Others MAE {r['by_party']['Others']['mae_pp']}")


if __name__ == "__main__":
    main()
