"""Reproduction check for the live runner (LIVE_SPEC.md, "Reproduction check").

Runs live_forecast.forecast as of 00:00 UTC on the first of October and of
November 2026 for the by-elections polling in that month, with two anchors:
  polling_day  each contest anchored on its own polling day, as the cached C2
               back-test was; should reproduce cache/bridge_level_predictions.pkl
  run_date     the live rule: every contest anchored on the run date
and compares both with the cached forward only C2 forecast for the same contests.

Past-dated runs are a check of the code path only. They are written to
results/live_check.json, never to live/, and are never offered as live entries.

    uv run python live_check.py [--polls=<timeseries file>]

The default polls file is this branch's data/polling/timeseries.json, the one
the cached dataset was anchored from.
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from common import CACHE, LANES, LANE_KEY, OUT, REPO
from live_forecast import forecast, load_contests, load_polls

MONTHS = ["2026-10-01", "2026-11-01"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ref", default="origin/main")
    ap.add_argument("--polls", default=str(REPO / "data/polling/timeseries.json"))
    args = ap.parse_args()
    contests, commit = load_contests(args.ref)
    polls = load_polls(__import__("pathlib").Path(args.polls))
    # This folder's own cache, written by bridge_level_fit.py (our research output, not untrusted data).
    cached = pd.read_pickle(CACHE / "bridge_level_predictions.pkl")
    cached = cached[cached["set"] == "byelection"].set_index("ballot_paper_id")
    keys = [LANE_KEY[p] for p in LANES]

    report = {"contest_files_commit": commit, "polls_file": args.polls, "months": {}}
    for m in MONTHS:
        as_of = datetime.fromisoformat(m).replace(tzinfo=timezone.utc)
        month = m[:7]
        want = [b for b in cached.index if cached.at[b, "date"].startswith(month)]
        rep = {"cached_contests": len(want)}
        for mode in ("polling_day_check", "run_date"):
            preds, skipped, facts = forecast(contests, polls, as_of, anchor_mode=mode)
            rows, diffs, same_leader, both = [], [], 0, 0
            for b in want:
                c = cached.loc[b]
                if b not in preds or np.isnan(c["c2_ref"] if c["stood_ref"] else 0.0):
                    rows.append({"ballot": b, "live": None, "reason": skipped.get(b, ("not built",))[0]})
                    continue
                cs = {p: float(c[f"c2_{LANE_KEY[p]}"]) if not np.isnan(c[f"c2_{LANE_KEY[p]}"]) else 0.0 for p in LANES}
                ls = preds[b]["shares"]
                d = max(abs(cs[p] - ls[p]) for p in LANES) * 100
                cl, ll = max(cs, key=cs.get), max(ls, key=ls.get)
                both += 1
                same_leader += cl == ll
                diffs.append(d)
                actual = {p: float(c[f"s_{LANE_KEY[p]}"]) for p in LANES}
                rows.append({"ballot": b, "max_lane_diff_pp": round(d, 3), "cached_leader": cl, "live_leader": ll,
                             "actual_leader": max(actual, key=actual.get),
                             "win_chance_live_leader": round(preds[b]["win_chance"].get(ll, 0.0), 3)})
            rep[mode] = {
                "compared": both, "same_leader": same_leader,
                "max_lane_diff_pp": round(max(diffs), 3) if diffs else None,
                "median_max_lane_diff_pp": round(float(np.median(diffs)), 3) if diffs else None,
                "identical_to_4dp": int(sum(d < 0.005 for d in diffs)),
                "live_called_right": int(sum(r.get("live_leader") == r.get("actual_leader") for r in rows if r.get("live_leader"))),
                "cached_called_right": int(sum(r.get("cached_leader") == r.get("actual_leader") for r in rows if r.get("live_leader"))),
                "training_rows_by_lane": facts["training_rows_by_lane"],
                "run_date_anchor": facts["anchor"],
                "rows": rows,
            }
            print(f"{m} {mode}: {both} compared, same leader {same_leader}, max lane diff {rep[mode]['max_lane_diff_pp']}pp, "
                  f"median {rep[mode]['median_max_lane_diff_pp']}pp, identical {rep[mode]['identical_to_4dp']}, "
                  f"right live {rep[mode]['live_called_right']} cached {rep[mode]['cached_called_right']}", flush=True)
        report["months"][m] = rep
    OUT.mkdir(exist_ok=True)
    (OUT / "live_check.json").write_text(json.dumps(report, indent=1, default=float) + "\n", encoding="utf-8")
    print("wrote results/live_check.json")


if __name__ == "__main__":
    main()
