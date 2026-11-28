#!/usr/bin/env bash
# Full rerun from a clean clone. Needs the two gitignored repo files symlinked
# (data/history/dc-historic-results.json, and node_modules for the replay) and
# rclone access to the Drive remote, or a cache/drive07 already in place.
set -euo pipefail
cd "$(dirname "$0")"
REPO="$(cd ../.. && pwd)"
[ -f cache/drive07/ward_contests_v2.csv ] || ./fetch_inputs.sh
mkdir -p cache/arms
(cd "$REPO" && node scripts/replay-may-2026-candidate.mjs --write-predictions=research/ward-model-2026-11/cache/arms/candidate-2026-10-24.json)
(cd "$REPO" && git status --porcelain -- data scripts src | grep . && { echo "replay changed tracked files"; exit 1; } || true)
uv run python prepare.py
uv run python fit_predict.py
uv run python score.py
uv run python write_transparency.py
