#!/usr/bin/env node
// P3: Aggregate Census 2021 TS021 (ethnic group) + ONS IMD 2019 from LSOA
// to ward level using the ONS LSOA21→WD22 lookup.
//
// Inputs:
//   .cache/census/census2021-ts021-lsoa.csv (NOMIS bulk download)
//   data/features/lsoa21-to-ward.json (ONS lookup)
//   /Users/tompickup/clawd/burnley-council/data/imd2019_cache.json (LSOA IMD)
//
// Output: data/features/ward-demographics-2021.json (overwrites partial AI
// DOGE harvest with the full national set).
//
// TS021 column mapping (from metadata/ts021-2021-1.txt):
//   F0001-F0019 are 19 ethnic groups + 1 total. The relevant columns are
//   "Ethnic group: White: English, Welsh, Scottish, Northern Irish or British"
//   and similar for Asian, Black, Mixed, Other.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const TS021_LSOA = path.join(ROOT, ".cache/census/census2021-ts021-lsoa.csv");
const LSOA_TO_WARD = path.join(ROOT, "data/features/lsoa21-to-ward.json");
const IMD_LSOA = "/Users/tompickup/clawd/burnley-council/data/imd2019_cache.json";
const OUT = path.join(ROOT, "data/features/ward-demographics-2021.json");

function parseCsv(text) {
  const rows = [];
  const lines = text.split(/\r?\n/);
  const header = lines[0].split(",").map((c) => c.replace(/^"|"$/g, ""));
  for (let i = 1; i < lines.length; i += 1) {
    if (!lines[i]) continue;
    const cells = parseCsvLine(lines[i]);
    const row = {};
    for (let j = 0; j < header.length; j += 1) row[header[j]] = cells[j];
    rows.push(row);
  }
  return { header, rows };
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function pickEthnicityFields(header) {
  // Normalise multi-line headers: collapse newlines, strip extra spaces.
  // Then exact-match the top-level group totals (no sub-category after the
  // second colon) and the specific White-British row.
  const norm = header.map((h) => h.toLowerCase().replace(/\s+/g, " ").trim());
  const idx = {};
  for (let i = 0; i < norm.length; i += 1) {
    const h = norm[i];
    if (h === "ethnic group: total: all usual residents") idx.total = i;
    else if (h === "ethnic group: asian, asian british or asian welsh") idx.asian = i;
    else if (h === "ethnic group: black, black british, black welsh, caribbean or african") idx.black = i;
    else if (h === "ethnic group: mixed or multiple ethnic groups") idx.mixed = i;
    else if (h === "ethnic group: other ethnic group") idx.other = i;
    else if (h === "ethnic group: white") idx.white_total = i;
    else if (h === "ethnic group: white: english, welsh, scottish, northern irish or british") idx.white_british = i;
  }
  return idx;
}

function aggregateLsoaToWard() {
  if (!existsSync(TS021_LSOA)) throw new Error(`Missing ${TS021_LSOA}`);
  if (!existsSync(LSOA_TO_WARD)) throw new Error(`Missing ${LSOA_TO_WARD}`);
  const text = readFileSync(TS021_LSOA, "utf8");
  const { header, rows } = parseCsv(text);
  const idx = pickEthnicityFields(header);
  console.log("Ethnicity column indices found:", idx);
  const lsoaCol = header.findIndex((h) => h.toLowerCase().includes("lsoa") || h.toLowerCase() === "geography code");
  if (lsoaCol < 0) throw new Error("LSOA code column not found");

  const lookup = JSON.parse(readFileSync(LSOA_TO_WARD, "utf8")).lookup;
  let imd = {};
  if (existsSync(IMD_LSOA)) imd = JSON.parse(readFileSync(IMD_LSOA, "utf8"));

  const wardAgg = {}; // wd22cd → { total, white_british, asian, black, mixed, other, imd_sum, imd_count }
  let lsoasMatched = 0;
  let lsoasTotal = 0;
  for (const row of rows) {
    const lsoa = row[header[lsoaCol]];
    if (!lsoa || !lsoa.startsWith("E0")) continue;
    lsoasTotal += 1;
    const ward = lookup[lsoa];
    if (!ward) continue;
    lsoasMatched += 1;
    const wd = ward.wd22cd;
    if (!wardAgg[wd]) wardAgg[wd] = { total: 0, white_british: 0, asian: 0, black: 0, mixed: 0, other: 0, imd_sum: 0, imd_count: 0, ward_name: ward.wd22nm, lad22cd: ward.lad22cd };
    const t = Number(row[header[idx.total]]) || 0;
    wardAgg[wd].total += t;
    wardAgg[wd].white_british += Number(row[header[idx.white_british]]) || 0;
    wardAgg[wd].asian += Number(row[header[idx.asian]]) || 0;
    wardAgg[wd].black += Number(row[header[idx.black]]) || 0;
    wardAgg[wd].mixed += Number(row[header[idx.mixed]]) || 0;
    wardAgg[wd].other += Number(row[header[idx.other]]) || 0;
    const imdRow = imd[lsoa];
    if (imdRow) { wardAgg[wd].imd_sum += imdRow.decile || 0; wardAgg[wd].imd_count += 1; }
  }
  console.log(`LSOAs matched: ${lsoasMatched.toLocaleString()}/${lsoasTotal.toLocaleString()}`);

  const out = {};
  for (const [wd, v] of Object.entries(wardAgg)) {
    if (v.total === 0) continue;
    out[wd] = {
      white_british_pct: +(v.white_british / v.total).toFixed(4),
      asian_pct: +(v.asian / v.total).toFixed(4),
      black_pct: +(v.black / v.total).toFixed(4),
      mixed_pct: +(v.mixed / v.total).toFixed(4),
      other_pct: +(v.other / v.total).toFixed(4),
      avg_imd_decile: v.imd_count > 0 ? +(v.imd_sum / v.imd_count).toFixed(2) : null,
      total_residents: v.total,
      ward_name: v.ward_name,
      lad22cd: v.lad22cd,
      _source: "Census 2021 TS021 LSOA-to-ward aggregation + IMD2019 LSOA decile",
    };
  }
  return out;
}

function main() {
  console.log("Aggregating LSOA Census + IMD to ward level...");
  const wardMap = aggregateLsoaToWard();
  console.log(`Aggregated ${Object.keys(wardMap).length} wards`);

  // Cross-reference with identity
  let coveredCount = 0;
  let identityWards = 0;
  try {
    const identity = JSON.parse(readFileSync(path.join(ROOT, "data/identity/wards-may-2026.json"), "utf8"));
    const targets = identity.wards.filter((w) => (w.tier === "local" || w.tier === "mayor") && w.gss_code);
    identityWards = targets.length;
    coveredCount = targets.filter((w) => wardMap[w.gss_code]).length;
  } catch {}

  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({
    snapshot: {
      generated_at: new Date().toISOString(),
      method: "Census 2021 TS021 (ethnic group) LSOA download from NOMIS, aggregated to WD22 via ONS LSOA21→WD22 lookup. IMD 2019 LSOA decile averaged per ward. Coverage limited to England (TS021 publishes Wales separately; Scotland uses Scottish Census 2022).",
      sources: ["NOMIS Census 2021 TS021 LSOA bulk", "ONS LSOA21→WD22 lookup", "MHCLG IMD 2019 LSOA"],
    },
    summary: {
      ward_count_total: Object.keys(wardMap).length,
      identity_target_wards: identityWards,
      identity_target_wards_covered: coveredCount,
      coverage_pct_of_identity: identityWards > 0 ? +(100 * coveredCount / identityWards).toFixed(1) : 0,
    },
    wards: wardMap,
  }, null, 2));
  console.log(`Coverage of May 2026 identity: ${coveredCount}/${identityWards}`);
  console.log(`Wrote ${OUT}`);
}

main();
