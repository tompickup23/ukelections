"""Write the summary tables to data/transparency/ward-model-research-2026-11.json.

Research only: no page, engine or forecast reads this file.
"""
from __future__ import annotations

import json

from common import BLEND_WEIGHT_MODEL, LANES, OUT, REPO

TARGET = REPO / "data/transparency/ward-model-research-2026-11.json"


def slim(arm: dict) -> dict:
    return {
        "wards": arm["wards"],
        "wards_forecast": arm["wards_forecast"],
        "leader_correct": arm["leader_correct"],
        "leader_accuracy": arm["leader_accuracy"],
        "share_mae_pp_all_lanes": arm["share_mae_pp_all_lanes"],
        "brier_common": arm["brier_common"],
        "brier_native": arm["brier_native"],
        "by_party": {
            p: {k: arm["by_party"][p][k] for k in ("n", "mae_pp", "signed_bias_pp", "actual_leads", "called_leads", "expected_leads_common")}
            for p in LANES
        },
    }


def main():
    s = json.load(open(OUT / "summary.json"))
    out = {
        "title": "All-party ward share model for English local elections: research test, November 2026",
        "status": "research only; not used by any page, engine or published forecast",
        "generated_by": "research/ward-model-2026-11 (prepare.py, fit_predict.py, score.py, write_transparency.py)",
        "method_note": "research/ward-model-2026-11/README.md",
        "yardstick": "scripts/score-may-2026-like-for-like.mjs conventions: 2,897 local wards in data/transparency/may-2026-postaudit-2026-05-10.json; results data/results/may-2026/local-and-mayor.merged.json; five parties plus Others pooled; leader by full-slate vote share; unforecast wards count as misses",
        "training": {
            "window": "contests before 7 May 2026 with an environment anchor: 2024 (anchor GE2024 GB result) and 24 April 2025 to 23 April 2026 (anchor 14-day mean of GB polls)",
            "rows_by_year": s["data"]["train_by_year"],
            "lanes": {p: {k: s["fit"]["lanes"][p][k] for k in ("train_rows", "councils", "oof_share_mae_pp", "oof_share_bias_pp", "best_params")} for p in LANES},
        },
        "blend_weight_model": BLEND_WEIGHT_MODEL,
        "may_2026": {stratum: {arm: slim(v) for arm, v in arms.items()} for stratum, arms in s["may_2026"].items()},
        "byelections_after_7_may_2026": {
            "window": s["byelection_window"],
            "skipped": {k: len(v) for k, v in s["byelection_skipped"].items()},
            "results": {stratum: {arm: slim(v) for arm, v in arms.items()} for stratum, arms in s["byelections"].items()},
        },
    }
    with open(TARGET, "w") as f:
        json.dump(out, f, indent=2)
        f.write("\n")
    print(f"wrote {TARGET.relative_to(REPO)}")


if __name__ == "__main__":
    main()
