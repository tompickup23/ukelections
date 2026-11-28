#!/usr/bin/env bash
# Copy the two Drive inputs (and the method notes) into the gitignored cache and
# check them against the hashes recorded in README.md. Read only on Drive.
set -euo pipefail
cd "$(dirname "$0")"
SRC="doge:DOGE/Elections & Demographics/07 Models (Reform propensity)"
mkdir -p cache/drive07
for f in ward_contests_v2.csv universe_features_v2.csv README.txt REPORT.md; do
  rclone copyto "$SRC/$f" "cache/drive07/$f"
done
shasum -a 256 -c <<'SUMS'
23baa08041a06683d2a54638afb07fd38586e1e5b61f041d253fbaeb8bc99f6d  cache/drive07/ward_contests_v2.csv
592a5e96f447a719c61db231c93e14babacbc9d0a344c83041cf1a03b3f97404  cache/drive07/universe_features_v2.csv
c20ae9c4fa52def0e13afc3980bae28ce12087ed34dc9f53490a1715647f051f  cache/drive07/README.txt
5bc013c37844c7740c8e7c6b566dba03db384fbbc1e2c8fc915e1235be89df80  cache/drive07/REPORT.md
SUMS
