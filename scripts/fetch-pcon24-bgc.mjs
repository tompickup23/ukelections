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
import { simplifyCoverage } from "./lib/simplify-shared-borders.mjs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data/geography/pcon24-bgc.geojson");
const LAYER =
  "https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/" +
  "Westminster_Parliamentary_Constituencies_July_2024_Boundaries_UK_BGC/FeatureServer/0/query";
const PAGE = 50;
const TOLERANCE = { fraction: 1 / 400, min: 5, max: 1500 };
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const EXPECTED = 650;

const round = (n) => Math.round(n * 1e5) / 1e5;

function roundRing(ring) {
  const out = [];
  for (const [x, y] of ring) {
    const p = [round(x), round(y)];
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  return out;
}

function roundGeometry(g) {
  if (g.type === "Polygon") return { type: g.type, coordinates: g.coordinates.map(roundRing) };
  if (g.type === "MultiPolygon") {
    return { type: g.type, coordinates: g.coordinates.map((poly) => poly.map(roundRing)) };
  }
  throw new Error(`unexpected geometry type ${g.type}`);
}

async function page(offset) {
  const params = new URLSearchParams({
    where: "1=1",
    outFields: "PCON24CD,PCON24NM",
    outSR: "4326",
    orderByFields: "PCON24CD",
    resultOffset: String(offset),
    resultRecordCount: String(PAGE),
    f: "geojson",
  });
  const res = await fetch(`${LAYER}?${params}`);
  if (!res.ok) throw new Error(`ONS layer answered ${res.status} at offset ${offset}`);
  const body = await res.json();
  if (!Array.isArray(body.features)) throw new Error(`no features at offset ${offset}`);
  return body.features;
}

async function fetchAll() {
  const features = [];
  for (let offset = 0; ; offset += PAGE) {
    const batch = await page(offset);
    for (const f of batch) {
      features.push({
        type: "Feature",
        geometry: roundGeometry(f.geometry),
        properties: { PCON24CD: f.properties.PCON24CD, PCON24NM: f.properties.PCON24NM },
      });
    }
    if (batch.length < PAGE) break;
  }
  return features;
}

const from = arg("from");
const features = from ? JSON.parse(readFileSync(from, "utf8")).features : await fetchAll();

const codes = new Set(features.map((f) => f.properties.PCON24CD));
if (features.length !== EXPECTED || codes.size !== EXPECTED) {
  throw new Error(`expected ${EXPECTED} constituencies, got ${features.length} (${codes.size} distinct)`);
}

const rawOut = arg("raw-out");
if (rawOut) writeFileSync(rawOut, JSON.stringify({ type: "FeatureCollection", features }));

const simplified = simplifyCoverage(features, TOLERANCE);
writeFileSync(OUT, JSON.stringify({ type: "FeatureCollection", features: simplified }));
console.log(`wrote ${simplified.length} constituencies to ${OUT}`);
