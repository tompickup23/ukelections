#!/usr/bin/env node
// Best-fit lookup from 2021 LSOAs to the May 2026 wards, built the way ONS
// builds its best-fit lookups: each LSOA goes to the ward containing its
// population-weighted centroid.
//
// Why: the repo and the Drive library hold ONS LSOA-to-ward lookups for the
// 2022 to 2025 ward sets only. Wards redrawn for May 2026 (and so everything
// that votes on them in 2027) need a 2026 lookup, and ONS has not published
// one on hand.
//
// Inputs:
//   data/geography/wd26-bgc.geojson                       ONS wards, May 2026 (committed)
//   .cache/wards-2027/lsoa21_population_weighted_centroids.csv
//       ONS LSOA 2021 population-weighted centroids, British National Grid,
//       from the Drive library (03 Geography and lookups)
//   .cache/wards-2027/lsoa21_to_ward_wd25.csv             ONS best-fit, 2025 wards (for the agreement check)
// Output:
//   .cache/wards-2027/lsoa21-to-wd26.json   { lookup: {LSOA: WD26CD}, check: {...} }
//
// The output is a derived cache file and is not committed; build-wards-2027
// regenerates it when missing.

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv, bngToWgs84, geometryContains, geometryBbox, sha256File } from "./lib/wards-2027-lib.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, ".cache/wards-2027");

export function buildLsoaToWd26() {
  const geoPath = join(ROOT, "data/geography/wd26-bgc.geojson");
  const centroidPath = join(CACHE, "lsoa21_population_weighted_centroids.csv");
  const geo = JSON.parse(readFileSync(geoPath, "utf8"));
  const feats = geo.features
    .filter((f) => f.properties.WD26CD.startsWith("E"))
    .map((f) => ({ code: f.properties.WD26CD, lad: f.properties.LAD26CD, geom: f.geometry, bbox: geometryBbox(f.geometry) }));
  // Coarse grid index over bounding boxes.
  const CELL = 0.05;
  const grid = new Map();
  feats.forEach((f, i) => {
    for (let gx = Math.floor(f.bbox[0] / CELL); gx <= Math.floor(f.bbox[2] / CELL); gx++)
      for (let gy = Math.floor(f.bbox[1] / CELL); gy <= Math.floor(f.bbox[3] / CELL); gy++) {
        const k = `${gx},${gy}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(i);
      }
  });
  const rows = parseCsv(readFileSync(centroidPath, "utf8")).filter((r) => r.LSOA21CD.startsWith("E"));
  const lookup = {};
  const unplaced = [];
  for (const r of rows) {
    const pt = bngToWgs84(Number(r.x_bng), Number(r.y_bng));
    const cand = grid.get(`${Math.floor(pt[0] / CELL)},${Math.floor(pt[1] / CELL)}`) || [];
    let hit = null;
    for (const i of cand) {
      const f = feats[i];
      if (pt[0] < f.bbox[0] || pt[0] > f.bbox[2] || pt[1] < f.bbox[1] || pt[1] > f.bbox[3]) continue;
      if (geometryContains(f.geom, pt)) { hit = f.code; break; }
    }
    if (hit) lookup[r.LSOA21CD] = hit;
    else unplaced.push(r.LSOA21CD);
  }
  // Agreement with ONS's own 2025 best-fit, over wards whose code is the same
  // in both sets (an unchanged ward keeps its code).
  const wd25 = parseCsv(readFileSync(join(CACHE, "lsoa21_to_ward_wd25.csv"), "utf8"));
  const wd26Codes = new Set(feats.map((f) => f.code));
  let same = 0, differ = 0;
  for (const r of wd25) {
    if (!wd26Codes.has(r.wardcd) || !lookup[r.lsoa21cd]) continue;
    // Count only LSOAs whose 2026 ward is also an unchanged code.
    const w26 = lookup[r.lsoa21cd];
    if (!wd25Codes(wd25).has(w26)) continue;
    if (w26 === r.wardcd) same++; else differ++;
  }
  return {
    snapshot: {
      method: "Each 2021 LSOA assigned to the May 2026 ward containing its population-weighted centroid (ONS best-fit method).",
      inputs: {
        "data/geography/wd26-bgc.geojson": sha256File(geoPath),
        "lsoa21_population_weighted_centroids.csv": sha256File(centroidPath),
      },
    },
    check: {
      english_lsoas: rows.length,
      placed: Object.keys(lookup).length,
      unplaced: unplaced.length,
      unplaced_codes: unplaced,
      agreement_with_ons_wd25_on_unchanged_wards: { same, differ, rate: same + differ ? Math.round((same / (same + differ)) * 10000) / 10000 : null },
    },
    lookup,
  };
}

let _wd25Codes = null;
function wd25Codes(wd25) {
  if (!_wd25Codes) _wd25Codes = new Set(wd25.map((r) => r.wardcd));
  return _wd25Codes;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = buildLsoaToWd26();
  writeFileSync(join(CACHE, "lsoa21-to-wd26.json"), JSON.stringify(out));
  console.log(JSON.stringify(out.check.agreement_with_ons_wd25_on_unchanged_wards), "placed", out.check.placed, "unplaced", out.check.unplaced);
}
