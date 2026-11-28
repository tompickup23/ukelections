"""Run bridge_level_fit.py and bridge_level_score.py unchanged on a rebuilt
dataset (REBUILD_SPEC.md, run 3).

  uv run python rebuild_fit_score.py --polls corrected

The two scripts read and write common.CACHE and common.OUT; this points them at
cache/rebuild/<polls>/ (both) before importing them, so
nothing else in them changes and the committed results/bridge_level_summary.json
(PR 197) is not overwritten. The summary is then copied to
results/rebuild_bridge_level_summary_<polls>.json.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys

import common

ap = argparse.ArgumentParser()
ap.add_argument("--polls", choices=["old", "pr199", "corrected"], default="corrected")
args = ap.parse_args()

cache = common.CACHE / "rebuild" / args.polls
out = cache
man = cache / "rebuild_manifest.json"
if not man.exists():
    sys.exit(f"STOP: {man} not found; run rebuild.py --polls {args.polls} first")
m = json.loads(man.read_text())
if m["failed"]:
    sys.exit(f"STOP: the rebuild of {args.polls} failed checks {m['failed']}; not fitting on it")
if common.sha256(cache / "bridge_level_dataset.pkl") != m["outputs"]["bridge_level_dataset.pkl"]["sha256"]:
    sys.exit("STOP: bridge_level_dataset.pkl changed since the manifest was written")

common.CACHE = cache
common.OUT = out
import bridge_level_fit  # noqa: E402
import bridge_level_score  # noqa: E402

bridge_level_fit.main()
bridge_level_score.main()
shutil.copy2(out / "bridge_level_summary.json", common.HERE / "results" / f"rebuild_bridge_level_summary_{args.polls}.json")
print(f"wrote results/rebuild_bridge_level_summary_{args.polls}.json")
