#!/usr/bin/env node
// P3 prep: bulk fetch ONS LSOA21 → WD22 lookup table from ArcGIS,
// caching one chunk per page. Resumable.

import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const CACHE = path.join(ROOT, ".cache/lsoa-ward-lookup");
const OUT = path.join(ROOT, "data/features/lsoa21-to-ward.json");
const SVC = "https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/LSOA_2021_to_Ward_to_Lower_Tier_Local_Authority_May_2022_Lookup_for_England_2022/FeatureServer/0/query";
const PAGE_SIZE = 2000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(offset) {
  const url = `${SVC}?where=1%3D1&outFields=LSOA21CD,WD22CD,WD22NM,LTLA22CD,LTLA22NM&returnGeometry=false&f=json&resultRecordCount=${PAGE_SIZE}&resultOffset=${offset}`;
  const r = await fetch(url, { headers: { "user-agent": "ukelections.co.uk lookup fetch" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} on offset ${offset}`);
  return r.json();
}

async function main() {
  mkdirSync(CACHE, { recursive: true });
  let offset = 0;
  let totalRows = 0;
  while (true) {
    const cachePath = path.join(CACHE, `page-${String(offset).padStart(7, "0")}.json`);
    let body;
    if (existsSync(cachePath)) {
      body = JSON.parse(readFileSync(cachePath, "utf8"));
      process.stderr.write(`offset ${offset}: cached (${body.features.length})\n`);
    } else {
      body = await fetchPage(offset);
      writeFileSync(cachePath, JSON.stringify(body));
      process.stderr.write(`offset ${offset}: +${body.features.length}\n`);
      await sleep(250);
    }
    totalRows += body.features.length;
    if (!body.exceededTransferLimit && body.features.length === 0) break;
    if (body.features.length < PAGE_SIZE) break;
    offset += body.features.length;
  }

  // Compose
  const lookup = {};
  for (const f of readdirSync(CACHE)) {
    if (!f.endsWith(".json")) continue;
    const body = JSON.parse(readFileSync(path.join(CACHE, f), "utf8"));
    for (const feat of body.features) {
      const a = feat.attributes;
      lookup[a.LSOA21CD] = { wd22cd: a.WD22CD, wd22nm: a.WD22NM, lad22cd: a.LTLA22CD, lad22nm: a.LTLA22NM };
    }
  }
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({
    snapshot: { generated_at: new Date().toISOString(), source: "ONS Open Geography Portal — LSOA21_WD22_LAD22 lookup England", rows: Object.keys(lookup).length },
    lookup,
  }, null, 2));
  process.stdout.write(`\nWrote ${OUT} (${Object.keys(lookup).length} LSOA→ward rows)\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
