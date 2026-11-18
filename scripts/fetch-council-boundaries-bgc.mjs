#!/usr/bin/env node
// Fetch the ONS BGC (generalised, clipped to the coastline, 20m) boundaries
// the council pages draw, and write them thinned to data/geography/:
//
//   wd26   Wards (May 2026) Boundaries UK BGC             -> wd26-bgc.geojson
//   lad24  Local Authority Districts (December 2024) BGC  -> lad24-bgc.geojson
//   ced26  County Electoral Divisions (May 2026) EN BGC   -> ced26-bgc.geojson
//
// County councils elect by division, not ward, so their results map needs the
// division layer. That layer names no county, and division names repeat
// between counties (Constable and Hadleigh are in both Essex and Suffolk), so
// each division is given the county that contains its ONS label point, from
// Counties and Unitary Authorities (December 2025) BUC. A division that lands
// in no county, or in a unitary, stops the run.
//
// Why: the ward results map on a council page was drawn from the BSC (super
// generalised, 200m) ward file, which keeps the median ward to 14 vertices
// and the median Camden ward to 8, and the council outline on an uncovered
// council's page from a file whose median council has 12. Neither is the
// shape of the place. BGC keeps the real outline. The May 2026 ward layer is
// the one in force at the 7 May 2026 elections those maps report.
//
// The raw layers are large, most of it coastline, so each is thinned with the
// same topology-preserving Douglas-Peucker as the constituency file
// (scripts/lib/simplify-shared-borders.mjs): the tolerance on each border is a
// fixed fraction of the bounding-box diagonal of the smallest area that uses
// it, so both sides of a shared border still agree and a small urban ward
// keeps detail that an island coastline does not need. A council's wards are
// drawn 640px wide and a council outline 320px, so both fractions are about a
// pixel or less on the page. Output feeds only build-time SVG; nothing reaches the
// browser.
//
// Source: Office for National Statistics, Open Geography Portal.
// Contains OS data © Crown copyright and database right.
//
// Usage: node scripts/fetch-council-boundaries-bgc.mjs [wd26] [lad24] [ced26]
//          [--raw-dir=<dir>] [--from-dir=<dir>]
//   --raw-dir   also write each unsimplified layer there as <key>-raw.geojson
//   --from-dir  simplify previously saved raw layers instead of fetching

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fetchLayer } from "./lib/fetch-ons-layer.mjs";
import { simplifyCoverage } from "./lib/simplify-shared-borders.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const LAYERS = {
  wd26: {
    service: "WD_MAY_2026_UK_BGC",
    fields: ["WD26CD", "WD26NM", "LAD26CD", "LAD26NM"],
    out: "data/geography/wd26-bgc.geojson",
    pageSize: 200,
    // 1/100 of a ward is about a pixel when a council of 20 wards is drawn
    // 640px wide, and keeps the file near 9 MB against 15 MB at 1/300.
    tolerance: { fraction: 1 / 100, min: 5, max: 1500 },
    minimum: 8000,
  },
  lad24: {
    service: "Local_Authority_Districts_December_2024_Boundaries_UK_BGC",
    fields: ["LAD24CD", "LAD24NM"],
    out: "data/geography/lad24-bgc.geojson",
    pageSize: 25,
    tolerance: { fraction: 1 / 300, min: 5, max: 1500 },
    minimum: 361,
  },
  ced26: {
    service: "CED_MAY_2026_EN_BGC",
    fields: ["CED26CD", "CED26NM", "LONG", "LAT"],
    out: "data/geography/ced26-bgc.geojson",
    pageSize: 200,
    // Divisions are a few times the size of a ward and a county of 80 is drawn
    // 640px wide, so the same fraction as wards is under a pixel.
    tolerance: { fraction: 1 / 100, min: 5, max: 1500 },
    minimum: 1300,
    enrich: addCounty,
  },
};

const COUNTIES = {
  service: "Counties_and_Unitary_Authorities_December_2025_Boundaries_UK_BUC",
  fields: ["CTYUA25CD", "CTYUA25NM"],
  pageSize: 50,
};

function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function contains(geometry, point) {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some(([outer, ...holes]) => inRing(point, outer) && !holes.some((h) => inRing(point, h)));
}

// Replace each division's label point with the county that contains it.
async function addCounty(features) {
  const counties = (await fetchLayer(COUNTIES)).filter((c) => c.properties.CTYUA25CD.startsWith("E10"));
  if (counties.length < 20) throw new Error(`expected the English counties, got ${counties.length}`);
  return features.map((f) => {
    const { CED26CD, CED26NM, LONG, LAT } = f.properties;
    const county = counties.find((c) => contains(c.geometry, [LONG, LAT]));
    if (!county) throw new Error(`${CED26CD} ${CED26NM} has its label point in no county`);
    const { CTYUA25CD: CTY25CD, CTYUA25NM: CTY25NM } = county.properties;
    return { ...f, properties: { CED26CD, CED26NM, CTY25CD, CTY25NM } };
  });
}

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

async function run(key) {
  const layer = LAYERS[key];
  const fromDir = arg("from-dir");
  // A saved raw layer has already been through `enrich`.
  const features = fromDir
    ? JSON.parse(readFileSync(join(fromDir, `${key}-raw.geojson`), "utf8")).features
    : await (layer.enrich ?? ((x) => x))(await fetchLayer(layer));

  const codes = new Set(features.map((f) => f.properties[layer.fields[0]]));
  if (features.length < layer.minimum || codes.size !== features.length) {
    throw new Error(`${key}: expected at least ${layer.minimum} distinct areas, got ${features.length} (${codes.size} distinct)`);
  }

  const rawDir = arg("raw-dir");
  if (rawDir) writeFileSync(join(rawDir, `${key}-raw.geojson`), JSON.stringify({ type: "FeatureCollection", features }));

  const simplified = simplifyCoverage(features, layer.tolerance);
  const out = join(ROOT, layer.out);
  writeFileSync(out, JSON.stringify({ type: "FeatureCollection", features: simplified }));
  console.log(`wrote ${simplified.length} areas to ${out}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const wanted = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  for (const key of wanted.length ? wanted : Object.keys(LAYERS)) {
    if (!LAYERS[key]) throw new Error(`unknown layer ${key}; choose from ${Object.keys(LAYERS).join(", ")}`);
    await run(key);
  }
}
