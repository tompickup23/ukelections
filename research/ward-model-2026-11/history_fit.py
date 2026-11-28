"""Fit and score C0 to C3 once on the extended dataset (HISTORY_SPEC.md), with
bridge_level_fit.py and bridge_level_score.py unchanged, pointed at cache/history/
as rebuild_fit_score.py points them at a rebuild folder.

    uv run python history_fit.py

Stops unless results/history_manifest.json records every check passed and the
extended dataset still has the hash it records. Writes cache/history/
bridge_level_predictions.pkl, bridge_level_levels.pkl and bridge_level_summary.json
(the scorer's own summary over every test row; the judged scoring is history_score.py).
"""
from __future__ import annotations

import json
import sys

import common

cache = common.CACHE / "history"
m = json.loads((common.HERE / "results/history_manifest.json").read_text())
if m["failed"]:
    sys.exit(f"STOP: the extended build failed checks {m['failed']}")
if common.sha256(cache / "bridge_level_dataset.pkl") != m["outputs"]["bridge_level_dataset.pkl"]:
    sys.exit("STOP: cache/history/bridge_level_dataset.pkl changed since the manifest was written")

common.CACHE = cache
common.OUT = cache
import bridge_level_fit  # noqa: E402
import bridge_level_score  # noqa: E402

bridge_level_fit.main()
bridge_level_score.main()
print("wrote cache/history/bridge_level_summary.json")
