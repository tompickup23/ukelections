#!/usr/bin/env node
// Fetch the ONS Westminster Parliamentary Constituencies (July 2024)
// Boundaries UK BGC (generalised, clipped to the coastline, 20m) layer and
// write data/geography/pcon24-bgc.geojson.
//
// Why: the seat-page MiniMap used the BUC (ultra generalised, 500m) file as
// its "full" fidelity. BUC takes Holborn and St Pancras down to 8 vertices and
// the median seat to 31, which is still not the shape of a small urban seat.
// BGC keeps the real outline. Coordinates are rounded to 5 decimal places
// (about 1m), well inside the 20m generalisation.
//
// The raw BGC layer is 11 MB, almost all of it Scottish coastline (Na
// h-Eileanan an Iar alone has 38,748 vertices). It is thinned with a
// topology-preserving Douglas-Peucker (scripts/lib/simplify-shared-borders.mjs)
// whose tolerance is 1/400 of the bounding-box diagonal of the smallest seat
// on each border, between 5m and 1,500m. The seat map draws a seat across
// about 300px, so that is under a pixel; small urban seats keep every BGC
// vertex (Holborn and St Pancras 78, against 8 in BUC) while island
// coastlines lose detail nobody can see. Output is about 3 MB and feeds only
// build-time SVG; nothing reaches the browser.
//
// Source: Office for National Statistics, Open Geography Portal,
// "Westminster Parliamentary Constituencies (July 2024) Boundaries UK BGC".
// Contains OS data © Crown copyright and database right.
//
// Usage: node scripts/fetch-pcon24-bgc.mjs [--raw-out=<path>] [--from=<path>]
//   --raw-out  also write the unsimplified layer (for inspection)
//   --from     simplify a previously saved raw layer instead of fetching

import { readFileSync, writeFileSync } from "node:fs";
import { fetchLayer } from "./lib/fetch-ons-layer.mjs";
import { simplifyCoverage } from "./lib/simplify-shared-borders.mjs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data/geography/pcon24-bgc.geojson");
const LAYER = {
  service: "Westminster_Parliamentary_Constituencies_July_2024_Boundaries_UK_BGC",
  fields: ["PCON24CD", "PCON24NM"],
  pageSize: 50,
};
const TOLERANCE = { fraction: 1 / 400, min: 5, max: 1500 };
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const EXPECTED = 650;

const from = arg("from");
const features = from ? JSON.parse(readFileSync(from, "utf8")).features : await fetchLayer(LAYER);

const codes = new Set(features.map((f) => f.properties.PCON24CD));
if (features.length !== EXPECTED || codes.size !== EXPECTED) {
  throw new Error(`expected ${EXPECTED} constituencies, got ${features.length} (${codes.size} distinct)`);
}

const rawOut = arg("raw-out");
if (rawOut) writeFileSync(rawOut, JSON.stringify({ type: "FeatureCollection", features }));

const simplified = simplifyCoverage(features, TOLERANCE);
writeFileSync(OUT, JSON.stringify({ type: "FeatureCollection", features: simplified }));
console.log(`wrote ${simplified.length} constituencies to ${OUT}`);
