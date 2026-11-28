"""Bridge the verified 2027 wards whose May 2026 ONS code is not in the feature
file to the 2025 wards they were cut from (V2027_SPEC.md, "bridge"; method of
BRIDGE_SPEC.md steps 2 to 4, matched on the code).

    uv run python v2027_bridge.py

Prints counts only. Output: cache/v2027/bridge.pkl (gitignored).
Research only; nothing on the site reads it.
"""
from __future__ import annotations

import csv
import json
from collections import Counter, defaultdict
from pathlib import Path

import pandas as pd
from pyproj import Transformer
from shapely.geometry import Point, shape
from shapely.strtree import STRtree

from common import CACHE, REPO, UNIVERSE

D03 = Path.home() / "ukelections-research-cache/from-worktree-all-party-2026-11-28/drive03"
OUTDIR = CACHE / "v2027"
WARDS = REPO / "data/identity/wards-2027.json"


def main():
    universe = {u["gss"] for u in csv.DictReader(open(UNIVERSE, newline=""))}
    wards = [w for w in json.load(open(WARDS))["wards"] if w["block"] == "verified"]
    todo = {w["gss_code"]: w for w in wards if w["gss_code"] and w["gss_code"] not in universe}
    gj = json.load(open(REPO / "data/geography/wd26-bgc.geojson"))
    geoms = {f["properties"]["WD26CD"]: shape(f["geometry"]) for f in gj["features"] if f["properties"]["WD26CD"] in todo}
    print("coded wards not in the feature file", len(todo), "found in wd26-bgc", len(geoms))

    tr = Transformer.from_crs(27700, 4326, always_xy=True)
    pop = {r["GEOGRAPHY_CODE"]: float(r["OBS_VALUE"]) for r in csv.DictReader(open(D03 / "population_lsoa21_total_latest.csv", newline=""))}
    lsoa_ward = {r["lsoa21cd"]: r["wardcd"] for r in csv.DictReader(open(D03 / "lsoa21_to_ward_wd25.csv", newline=""))}
    keys = list(geoms)
    tree = STRtree([geoms[k] for k in keys])
    inside, points = defaultdict(list), {}
    with open(D03 / "lsoa21_population_weighted_centroids.csv", newline="") as f:
        for r in csv.DictReader(f):
            lon, lat = tr.transform(float(r["x_bng"]), float(r["y_bng"]))
            pt = Point(lon, lat)
            points[r["LSOA21CD"]] = pt
            for j in tree.query(pt):
                if geoms[keys[j]].contains(pt):
                    inside[keys[j]].append(r["LSOA21CD"])
                    break
    nearest = 0
    for k in keys:
        if not inside.get(k):
            g = geoms[k]
            inside[k] = [min(points, key=lambda c: g.distance(points[c]))]
            nearest += 1

    out, stats = {}, Counter()
    for k in keys:
        parents = defaultdict(float)
        for l in inside[k]:
            wd = lsoa_ward.get(l)
            if wd:
                parents[wd] += pop.get(l, 0.0)
        tot = sum(parents.values())
        if tot <= 0:
            stats["no population"] += 1
            continue
        feat = sum(w for p, w in parents.items() if p in universe)
        out[k] = {"code": k, "council": todo[k]["council_slug"], "lsoas": len(inside[k]), "population": tot,
                  "parents": {p: w / tot for p, w in parents.items()}, "feature_cover": feat / tot}
        stats["bridged"] += 1
        stats["feature cover at least 90%"] += feat / tot >= 0.9
        stats["feature cover nil"] += feat == 0
        stats["one parent only"] += len(parents) == 1
    print("given their nearest small area", nearest)
    print(dict(stats))
    print("bridged by council", dict(Counter(v["council"] for v in out.values())))
    OUTDIR.mkdir(exist_ok=True)
    pd.to_pickle(out, OUTDIR / "bridge.pkl")


if __name__ == "__main__":
    main()
