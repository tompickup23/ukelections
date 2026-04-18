/**
 * Integrate Census 2021 migration indicator × ethnicity data.
 *
 * Computes per-LA ethnic-specific migration rates from Census 2021:
 * - Internal migration rate: proportion who moved within UK in year before Census
 * - International migration rate: proportion who arrived from outside UK
 * - Stayer rate: proportion who didn't move
 *
 * These rates replace the flat national migration assumptions in the CC model.
 *
 * Migration indicators:
 *   -8: Does not apply (children born after Census reference date)
 *    0: Same address (stayer)
 *    1: Student address (term-time/boarding — usually returns)
 *    2: Migrant from within UK (internal migration)
 *    3: Migrant from outside UK (international migration)
 *
 * Input:  data/raw/census_migration/census2021_migration_indicator_ethnicity.csv
 * Output: data/model/migration_rates_2021.json
 *         src/data/live/migration-ethnicity.json (site-facing summary)
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
const INPUT = path.resolve("data/raw/census_migration/census2021_migration_indicator_ethnicity.csv");
const MODEL_OUTPUT = path.resolve("data/model/migration_rates_2021.json");
const SITE_OUTPUT = path.resolve("src/data/live/migration-ethnicity.json");

// Map Census ethnic codes to our 20-group model codes
const ETH_CODE_MAP = {
  "1": "BAN", "2": "CHI", "3": "IND", "4": "PAK", "5": "OAS",
  "6": "BAF", "7": "BCA", "8": "OBL",
  "9": "MWA", "10": "MWF", "11": "MWC", "12": "MOM",
  "13": "WBI", "14": "WIR", "15": "WGT", "16": "WRO", "17": "WHO",
  "18": "ARB", "19": "OOT"
};

// 6-group mapping
const SIX_MAP = {
  WBI: "white_british", WIR: "white_other", WGT: "white_other", WRO: "white_other", WHO: "white_other",
  MWA: "mixed", MWF: "mixed", MWC: "mixed", MOM: "mixed",
  IND: "asian", PAK: "asian", BAN: "asian", CHI: "asian", OAS: "asian",
  BAF: "black", BCA: "black", OBL: "black",
  ARB: "other", OOT: "other"
};

console.log("Reading Census 2021 migration indicator × ethnicity...");
const raw = readFileSync(INPUT, "utf8");

// Manual CSV parsing (handles quoted fields)
const lines = raw.split("\n");
const headerLine = lines[0];
const headerParts = [];
let hCurr = "", hQuotes = false;
for (const ch of headerLine) {
  if (ch === '"') { hQuotes = !hQuotes; continue; }
  if (ch === ',' && !hQuotes) { headerParts.push(hCurr.trim()); hCurr = ""; continue; }
  hCurr += ch;
}
headerParts.push(hCurr.trim());

const rows = [];
for (let i = 1; i < lines.length; i++) {
  if (!lines[i].trim()) continue;
  const parts = [];
  let current = "", inQuotes = false;
  for (const ch of lines[i]) {
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === ',' && !inQuotes) { parts.push(current.trim()); current = ""; continue; }
    current += ch;
  }
  parts.push(current.trim());
  if (parts.length >= headerParts.length) {
    const obj = {};
    headerParts.forEach((h, idx) => obj[h] = parts[idx]);
    rows.push(obj);
  }
}

console.log(`  ${rows.length} rows`);

// Aggregate: LA → ethnic group → { stayer, student, internal, international, total }
const data = {};

for (const row of rows) {
  const laCode = row["Lower tier local authorities Code"];
  const laName = row["Lower tier local authorities"];
  const migCode = row["Migrant indicator (5 categories) Code"];
  const ethCode = row["Ethnic group (20 categories) Code"];
  const count = parseInt(row["Observation"]) || 0;

  if (!laCode?.startsWith("E")) continue;
  const eth = ETH_CODE_MAP[ethCode];
  if (!eth) continue; // Skip -8 "Does not apply"

  if (!data[laCode]) data[laCode] = { name: laName, groups: {} };
  if (!data[laCode].groups[eth]) {
    data[laCode].groups[eth] = { stayer: 0, student: 0, internal: 0, international: 0, total: 0 };
  }

  const g = data[laCode].groups[eth];
  g.total += count;

  switch (migCode) {
    case "0": g.stayer += count; break;
    case "1": g.student += count; break;
    case "2": g.internal += count; break;
    case "3": g.international += count; break;
    // -8 "Does not apply" — skip (children born after reference date)
  }
}

const laCodes = Object.keys(data).sort();
console.log(`  ${laCodes.length} LAs`);

// Compute rates per LA per ethnic group
const modelRates = {}; // laCode → eth → { internalRate, internationalRate, mobilityRate }
const siteData = {};   // laCode → { name, summary, groups }

for (const [laCode, la] of Object.entries(data)) {
  modelRates[laCode] = {};
  const sixGroupAgg = {};

  for (const [eth, g] of Object.entries(la.groups)) {
    const pop = g.total;
    if (pop < 10) continue; // Skip tiny populations

    const internalRate = Math.round(g.internal / pop * 10000) / 10000;
    const internationalRate = Math.round(g.international / pop * 10000) / 10000;
    const mobilityRate = Math.round((g.internal + g.international) / pop * 10000) / 10000;

    modelRates[laCode][eth] = {
      internalRate,
      internationalRate,
      mobilityRate,
      population: pop
    };

    // Aggregate to 6-group
    const sg = SIX_MAP[eth];
    if (!sixGroupAgg[sg]) sixGroupAgg[sg] = { internal: 0, international: 0, total: 0 };
    sixGroupAgg[sg].internal += g.internal;
    sixGroupAgg[sg].international += g.international;
    sixGroupAgg[sg].total += pop;
  }

  // Site-facing 6-group summary
  const groups = {};
  for (const [sg, agg] of Object.entries(sixGroupAgg)) {
    if (agg.total < 10) continue;
    groups[sg] = {
      internalPct: Math.round(agg.internal / agg.total * 1000) / 10,
      internationalPct: Math.round(agg.international / agg.total * 1000) / 10,
      population: agg.total
    };
  }

  // Total mobility for this LA
  const totalPop = Object.values(la.groups).reduce((s, g) => s + g.total, 0);
  const totalInternal = Object.values(la.groups).reduce((s, g) => s + g.internal, 0);
  const totalInternational = Object.values(la.groups).reduce((s, g) => s + g.international, 0);

  siteData[laCode] = {
    name: la.name,
    totalPop: totalPop,
    internalMigrantsPct: Math.round(totalInternal / totalPop * 1000) / 10,
    internationalMigrantsPct: Math.round(totalInternational / totalPop * 1000) / 10,
    groups
  };
}

// National summary
const natSummary = {};
for (const eth of Object.keys(ETH_CODE_MAP).map(k => ETH_CODE_MAP[k])) {
  let totalPop = 0, totalInternal = 0, totalInternational = 0;
  for (const [, la] of Object.entries(data)) {
    const g = la.groups[eth];
    if (g) {
      totalPop += g.total;
      totalInternal += g.internal;
      totalInternational += g.international;
    }
  }
  if (totalPop > 100) {
    natSummary[eth] = {
      population: totalPop,
      internalPct: Math.round(totalInternal / totalPop * 1000) / 10,
      internationalPct: Math.round(totalInternational / totalPop * 1000) / 10,
      totalMobilityPct: Math.round((totalInternal + totalInternational) / totalPop * 1000) / 10
    };
  }
}

// Model output
const modelOutput = {
  generatedAt: new Date().toISOString(),
  source: "Census 2021: Migrant indicator × Ethnic group × Lower tier local authority",
  methodology: "Migration rates computed as migrants / total usual residents per ethnic group per LA. Internal = moved within UK in year before Census Day (March 2021). International = arrived from outside UK. COVID caveat: Census Day was 21 March 2021 — migration patterns in the preceding 12 months were heavily affected by COVID travel restrictions, border closures, and lockdowns. International migration rates in particular are likely depressed.",
  areaCount: laCodes.length,
  nationalSummary: natSummary,
  areas: modelRates
};

writeFileSync(MODEL_OUTPUT, JSON.stringify(modelOutput, null, 2), "utf8");

// Site output (lighter)
const siteOutput = {
  generatedAt: new Date().toISOString(),
  source: "Census 2021 migration indicator × ethnic group",
  methodology: "Proportion of each ethnic group that moved in the year before Census Day 2021.",
  nationalSummary: natSummary,
  areas: siteData
};

writeFileSync(SITE_OUTPUT, JSON.stringify(siteOutput, null, 2), "utf8");

const modelKB = Math.round(Buffer.byteLength(JSON.stringify(modelOutput)) / 1024);
const siteKB = Math.round(Buffer.byteLength(JSON.stringify(siteOutput)) / 1024);
console.log(`\nWritten ${MODEL_OUTPUT} (${modelKB} KB)`);
console.log(`Written ${SITE_OUTPUT} (${siteKB} KB)`);

// Print national migration rates by ethnic group
console.log("\n=== National Migration Rates by Ethnic Group ===");
const sorted = Object.entries(natSummary).sort(([, a], [, b]) => b.totalMobilityPct - a.totalMobilityPct);
console.log("\nMost mobile (% who moved in year before Census):");
for (const [eth, d] of sorted.slice(0, 10)) {
  console.log(`  ${eth}: ${d.totalMobilityPct}% total (${d.internalPct}% internal, ${d.internationalPct}% international) — pop ${d.population.toLocaleString()}`);
}
console.log("\nLeast mobile:");
for (const [eth, d] of sorted.slice(-5).reverse()) {
  console.log(`  ${eth}: ${d.totalMobilityPct}% total (${d.internalPct}% internal, ${d.internationalPct}% international) — pop ${d.population.toLocaleString()}`);
}

// Areas with highest international migration
const highIntl = Object.entries(siteData)
  .filter(([, a]) => a.totalPop >= 50000)
  .sort(([, a], [, b]) => b.internationalMigrantsPct - a.internationalMigrantsPct)
  .slice(0, 10);
console.log("\nHighest international migration (% of pop, LAs 50K+):");
for (const [code, a] of highIntl) {
  console.log(`  ${a.name}: ${a.internationalMigrantsPct}% (${a.internalMigrantsPct}% internal)`);
}
