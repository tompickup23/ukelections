#!/usr/bin/env node
// P3 prep: bulk fetch ONS LSOA21 → WD22 lookup table from ArcGIS,
// caching one chunk per page. Resumable.

import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const YEAR = process.env.WD_YEAR || "22";
const CACHE = path.join(ROOT, `.cache/lsoa-ward-lookup-wd${YEAR}`);
const OUT = path.join(ROOT, `data/features/lsoa21-to-ward${YEAR === "22" ? "" : `-wd${YEAR}`}.json`);
const SVC_BY_YEAR = {
  "22": "https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/LSOA_2021_to_Ward_to_Lower_Tier_Local_Authority_May_2022_Lookup_for_England_2022/FeatureServer/0/query",
  "23": "https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/LSOA21_WD23_LAD23_EW_LU/FeatureServer/0/query",
  "24": "https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/LSOA21_WD24_LAD24_EW_LU/FeatureServer/0/query",
  "25": "https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/LSOA21_WD25_LAD25_EW_LU_v2/FeatureServer/0/query",
};
const SVC = SVC_BY_YEAR[YEAR];
if (!SVC) { console.error(`No service for WD year ${YEAR}`); process.exit(1); }
const PAGE_SIZE = 2000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(offset) {
  // Field names depend on year; build outFields dynamically.
  const wdCd = `WD${YEAR}CD`, wdNm = `WD${YEAR}NM`;
  const ladCd = (YEAR === "22" ? "LTLA22CD" : `LAD${YEAR}CD`);
  const ladNm = (YEAR === "22" ? "LTLA22NM" : `LAD${YEAR}NM`);
  const url = `${SVC}?where=1%3D1&outFields=LSOA21CD,${wdCd},${wdNm},${ladCd},${ladNm}&returnGeometry=false&f=json&resultRecordCount=${PAGE_SIZE}&resultOffset=${offset}`;
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
    if (body.features.length === 0) break;
    if (!body.exceededTransferLimit) break; // service returned a full page
    offset += body.features.length;
  }

  // Compose
  const lookup = {};
  for (const f of readdirSync(CACHE)) {
    if (!f.endsWith(".json")) continue;
    const body = JSON.parse(readFileSync(path.join(CACHE, f), "utf8"));
    for (const feat of body.features) {
      const a = feat.attributes;
      const wdCd = a[`WD${YEAR}CD`];
      const wdNm = a[`WD${YEAR}NM`];
      const ladCd = a[YEAR === "22" ? "LTLA22CD" : `LAD${YEAR}CD`];
      const ladNm = a[YEAR === "22" ? "LTLA22NM" : `LAD${YEAR}NM`];
      lookup[a.LSOA21CD] = { wdcd: wdCd, wdnm: wdNm, ladcd: ladCd, ladnm: ladNm, wd_year: YEAR };
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
