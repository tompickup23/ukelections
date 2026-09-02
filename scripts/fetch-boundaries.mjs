#!/usr/bin/env node
// fetch-boundaries.mjs
//
// Download boundary GeoJSON from the ONS Open Geography Portal's ArcGIS REST
// API. Writes the raw download to data/geography/; scripts/simplify-boundaries.mjs
// then turns each raw file into the pair of files the site actually reads.
//
// Why this exists (2 Sep 2026): the committed pcon24/lad24 raw files were the
// BUC product. "BUC" is Boundaries Ultra Generalised Clipped, ONS's coarsest
// generalisation at 500m, and at that resolution a small urban seat is a
// handful of points before anyone simplifies anything: Holborn and St Pancras
// is an 8-vertex octagon in the raw BUC file. No amount of re-simplification
// recovers a shape that was never in the source, so the fix was to pull the
// BGC product (Generalised Clipped, 20m) and simplify from that instead.
//
// Product ladder, coarse to fine: BUC (500m) < BSC (200m) < BGC (20m) < BFC/BFE
// (full resolution). BGC is the sweet spot: recognisable at street level while
// staying a few MB for the whole UK.
//
// Wards are the exception. The May 2025 ward BGC service is published as a
// TilesOnly MapServer (capabilities "Map,ChangeTracking,TilesOnly,Tilemap"),
// so it serves map tiles and refuses feature queries. There is no ward BGC to
// download through this pattern, which is why data/geography/wd25-bsc-raw.geojson
// stays on BSC and the ward pass simplifies from that.
//
// Usage:
//   node scripts/fetch-boundaries.mjs            # fetch every layer below
//   node scripts/fetch-boundaries.mjs pcon24     # fetch one

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const HOST = "https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services";

// LAD24: the May and December 2024 BGC services carry identical LAD24CD sets
// (both 361, verified 2 Sep 2026). May matches the vintage of the BUC file it
// replaces, so that is the one we track.
const LAYERS = {
  pcon24: {
    service: "Westminster_Parliamentary_Constituencies_July_2024_Boundaries_UK_BGC",
    out: "data/geography/pcon24-bgc-raw.geojson",
    fields: ["PCON24CD", "PCON24NM"],
    expect: 650,
  },
  lad24: {
    service: "Local_Authority_Districts_May_2024_Boundaries_UK_BGC",
    out: "data/geography/lad24-bgc-raw.geojson",
    fields: ["LAD24CD", "LAD24NM"],
    expect: 361,
  },
};

const PAGE = 250;

async function getJson(url) {
  const res = await fetch(url, { headers: { "user-agent": "ukelections.co.uk boundary fetch" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const json = await res.json();
  if (json.error) throw new Error(`ArcGIS error ${json.error.code}: ${json.error.message}`);
  return json;
}

async function fetchLayer(key) {
  const cfg = LAYERS[key];
  const base = `${HOST}/${cfg.service}/FeatureServer/0/query`;
  const features = [];

  for (let offset = 0; ; offset += PAGE) {
    const qs = new URLSearchParams({
      where: "1=1",
      outFields: cfg.fields.join(","),
      returnGeometry: "true",
      outSR: "4326",
      // Ask for pages in a stable order. Without an orderByFields the server
      // is free to return rows in any order per request, and paging over an
      // unstable order silently drops and duplicates features.
      orderByFields: cfg.fields[0],
      resultOffset: String(offset),
      resultRecordCount: String(PAGE),
      f: "geojson",
    });
    const page = await getJson(`${base}?${qs}`);
    const got = page.features ?? [];
    features.push(...got);
    process.stdout.write(`  ${key}: ${features.length} features\r`);
    if (got.length < PAGE) break;
  }

  if (features.length !== cfg.expect) {
    throw new Error(`${key}: expected ${cfg.expect} features, got ${features.length}`);
  }

  // Keep only the fields the site indexes on. The service also returns
  // BNG_E/BNG_N/LAT/LONG/Shape__Area and a Welsh name column, none of which
  // anything here reads, and all of which cost bytes in a committed file.
  for (const f of features) {
    const keep = {};
    for (const k of cfg.fields) keep[k] = f.properties?.[k];
    f.properties = keep;
    delete f.id;
  }

  const path = resolve(process.cwd(), cfg.out);
  writeFileSync(path, JSON.stringify({ type: "FeatureCollection", features }));
  console.log(`  ${key}: ${features.length} features -> ${cfg.out}`);
}

const wanted = process.argv.slice(2);
const keys = wanted.length ? wanted : Object.keys(LAYERS);
for (const k of keys) {
  if (!LAYERS[k]) throw new Error(`unknown layer "${k}" (have: ${Object.keys(LAYERS).join(", ")})`);
  console.log(`fetching ${k} from ${LAYERS[k].service}`);
  await fetchLayer(k);
}
