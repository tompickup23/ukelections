"""Bridge the May 2026 wards that carry a Democracy Club slug in place of an ONS
code to boundaries, small areas and the old areas they were cut from.

Prints counts only. Output: cache/bridge.pkl
"""
from __future__ import annotations

import csv
import json
import re
from collections import Counter, defaultdict

import pandas as pd
from pyproj import Transformer
from shapely.geometry import Point, shape
from shapely.strtree import STRtree

from common import CACHE, POSTAUDIT, REPO, UNIVERSE, read_json

D03 = CACHE / "drive03"
ALIASES = {"Essex": {"harlow parndon and toddbrook": "harlow parndon and todbrook"}}  # as src/lib/wardBoundaryJoin.ts


def norm(name: str) -> str:
    s = name.lower()
    s = re.sub(r" ed$", "", s).replace("&", "and")
    s = re.sub(r"['’]", "", s)
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def main():
    # dataset.pkl is this folder's own local cache.
    df = pd.read_pickle(CACHE / "dataset.pkl")
    have = set(df[df.set == "may26"].ballot_paper_id)
    ids = [r["ballot_paper_id"] for r in read_json(POSTAUDIT)["prereg"]["rows"] if r["ballot_paper_id"].startswith("local.")]
    miss = [i for i in ids if i not in have]
    wards = read_json(REPO / "data/identity/wards-may-2026.json")["by_ballot"]
    universe = {u["gss"]: u for u in csv.DictReader(open(UNIVERSE, newline=""))}

    layers = {
        "ward": (json.load(open(REPO / "data/geography/wd26-bgc.geojson")), "WD26CD", "WD26NM", "LAD26NM"),
        "county_division": (json.load(open(REPO / "data/geography/ced26-bgc.geojson")), "CED26CD", "CED26NM", "CTY25NM"),
    }
    index = {}
    for layer, (gj, cd, nm, parent) in layers.items():
        for f in gj["features"]:
            p = f["properties"]
            index.setdefault((layer, norm(p[parent])), defaultdict(list))[norm(p[nm])].append(f)

    matched, why = {}, Counter()
    for i in miss:
        w = wards[i]
        council = w["council_name"]
        name = norm(w["ward_name"])
        name = ALIASES.get(council, {}).get(name, name)
        hit = None
        for layer in layers:
            cands = index.get((layer, norm(council)), {}).get(name, [])
            if len(cands) == 1:
                hit = (layer, cands[0])
                break
        if hit is None:
            why[(w["council_slug"], "no unique name match")] += 1
            continue
        layer, f = hit
        matched[i] = {"layer": layer, "code": f["properties"][layers[layer][1]], "geom": shape(f["geometry"]), "council": w["council_slug"]}
    print("unscored wards", len(miss), "matched to a boundary", len(matched))
    print("unmatched by council", dict(Counter(c for (c, _), n in why.items() for _ in range(n))))
    print("matched code already in the feature file", sum(m["code"] in universe for m in matched.values()))

    # small areas: population-weighted centroid inside the boundary
    tr = Transformer.from_crs(27700, 4326, always_xy=True)
    pop = {}
    with open(D03 / "population_lsoa21_total_latest.csv", newline="") as f:
        rows = list(csv.DictReader(f))
    for r in rows:
        pop[r["GEOGRAPHY_CODE"]] = float(r["OBS_VALUE"])
    lsoa_ward = {r["lsoa21cd"]: r["wardcd"] for r in csv.DictReader(open(D03 / "lsoa21_to_ward_wd25.csv", newline=""))}
    ward_ced = {r["WD25CD"]: r["CED25CD"] for r in csv.DictReader(open(D03 / "ward25_to_ced25_lookup.csv", newline=""))}
    keys = list(matched)
    tree = STRtree([matched[k]["geom"] for k in keys])
    inside = defaultdict(list)
    points = {}
    with open(D03 / "lsoa21_population_weighted_centroids.csv", newline="") as f:
        for r in csv.DictReader(f):
            lon, lat = tr.transform(float(r["x_bng"]), float(r["y_bng"]))
            pt = Point(lon, lat)
            points[r["LSOA21CD"]] = pt
            for j in tree.query(pt):
                if matched[keys[j]]["geom"].contains(pt):
                    inside[keys[j]].append(r["LSOA21CD"])
                    break
    nearest = 0
    for k in keys:  # a new area containing no centroid takes the single nearest one
        if not inside.get(k):
            g = matched[k]["geom"]
            inside[k] = [min(points, key=lambda c: g.distance(points[c]))]
            nearest += 1
    print("areas given their nearest small area", nearest)
    gss_with_result = set(df.loc[df["gss"].notna() & (df.d < "2026-05-07"), "gss"])
    out = {}
    stats = Counter()
    for k, m in matched.items():
        ls = inside.get(k, [])
        if not ls:
            stats["no small area centroid inside"] += 1
            continue
        parents = defaultdict(float)
        for l in ls:
            wd = lsoa_ward.get(l)
            parent = ward_ced.get(wd) if m["layer"] == "county_division" else wd
            if parent:
                parents[parent] += pop.get(l, 0.0)
        tot = sum(parents.values())
        if tot <= 0:
            stats["no population"] += 1
            continue
        feat = {p: w for p, w in parents.items() if p in universe}
        res = {p: w for p, w in parents.items() if p in gss_with_result}
        out[k] = {
            "layer": m["layer"], "code": m["code"], "council": m["council"], "lsoas": len(ls), "population": tot,
            "parents": {p: w / tot for p, w in parents.items()},
            "feature_cover": sum(feat.values()) / tot, "result_cover": sum(res.values()) / tot,
        }
        stats["bridged"] += 1
        stats["feature cover at least 90%"] += sum(feat.values()) / tot >= 0.9
        stats["previous result cover at least 90%"] += sum(res.values()) / tot >= 0.9
        stats["one parent only"] += len(parents) == 1
    print(dict(stats))
    by_council = Counter(v["council"] for v in out.values())
    print("bridged by council", dict(by_council))
    low = Counter(v["council"] for v in out.values() if v["feature_cover"] < 0.9)
    print("feature cover under 90% by council", dict(low))
    lowr = Counter(v["council"] for v in out.values() if v["result_cover"] < 0.9)
    print("previous result cover under 90% by council", dict(lowr))
    pd.to_pickle(out, CACHE / "bridge.pkl")


if __name__ == "__main__":
    main()
