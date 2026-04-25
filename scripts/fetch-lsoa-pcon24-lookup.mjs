#!/usr/bin/env node
// Fetch ONS LSOA21 → PCON24 lookup (the parl constituencies as of 2024 GE).
// Persists data/features/lsoa21-to-pcon24.json keyed by LSOA21CD.
// Used for Senedd super-constituency demographic enrichment.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const CACHE = path.join(ROOT, ".cache/lsoa-pcon24-lookup");
const OUT = path.join(ROOT, "data/features/lsoa21-to-pcon24.json");
const SVC = "https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/LSOA21_PCON24_LAD21_EW_LU/FeatureServer/0/query";
const PAGE_SIZE = 2000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(offset) {
  const url = `${SVC}?where=1%3D1&outFields=LSOA21CD,PCON24CD,PCON24NM,LAD21CD,LAD21NM&returnGeometry=false&f=json&resultRecordCount=${PAGE_SIZE}&resultOffset=${offset}`;
  const r = await fetch(url, { headers: { "user-agent": "ukelections.co.uk lookup" } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function main() {
  mkdirSync(CACHE, { recursive: true });
  let offset = 0;
  while (true) {
    const cachePath = path.join(CACHE, `page-${String(offset).padStart(7, "0")}.json`);
    let body;
    if (existsSync(cachePath)) {
      body = JSON.parse(readFileSync(cachePath, "utf8"));
    } else {
      body = await fetchPage(offset);
      writeFileSync(cachePath, JSON.stringify(body));
      process.stderr.write(`offset ${offset}: +${body.features.length}\n`);
      await sleep(250);
    }
    if (body.features.length === 0) break;
    if (!body.exceededTransferLimit) break;
    offset += body.features.length;
  }
  const lookup = {};
  for (const f of readdirSync(CACHE)) {
    const body = JSON.parse(readFileSync(path.join(CACHE, f), "utf8"));
    for (const feat of body.features) {
      const a = feat.attributes;
      lookup[a.LSOA21CD] = { pcon24cd: a.PCON24CD, pcon24nm: a.PCON24NM, lad21cd: a.LAD21CD };
    }
  }
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ snapshot: { generated_at: new Date().toISOString(), source: "ONS LSOA21→PCON24" }, lookup }, null, 2));
  console.log(`Wrote ${OUT} (${Object.keys(lookup).length} rows)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
