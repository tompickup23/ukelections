/**
 * Build per-LA ethnic net migration rates by combining:
 * 1. NEWETHPOP Census 2011 out-migration rates (per-person departure probability)
 * 2. Census 2021 migration indicator (total mobility rate per ethnic group per LA)
 *
 * Net migration ≈ Census 2021 total mobility - NEWETHPOP out-migration
 * This gives a signed rate: positive = net inflow, negative = net outflow.
 *
 * The logic: Census 2021 mobility counts EVERYONE who moved (in or out).
 * NEWETHPOP outmig counts people who LEFT. So:
 *   total_movers = in-migrants + out-migrants
 *   outmig = NEWETHPOP rate
 *   inmig ≈ total_movers - outmig (if we had them separately)
 *   net = inmig - outmig = total_movers - 2 × outmig
 *
 * COVID caveat: Census 2021 mobility is from March 2020-2021 (lockdown).
 * NEWETHPOP outmig is from Census 2011. We blend 70% 2011 / 30% 2021 adjustment.
 *
 * Output: data/model/net_migration_rates.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUTMIG_FILE = path.resolve("data/raw/newethpop/extracted/2DataArchive/InputData/InternalMigration/InternalOutmig2011_LEEDS2.csv");
const MIG_RATES_2021 = path.resolve("data/model/migration_rates_2021.json");
const OUTPUT = path.resolve("data/model/net_migration_rates.json");

// Map NEWETHPOP 12-group to our codes for matching with Census 2021 20-group
const NEWETHPOP_TO_20 = {
  WBI: ["WBI"], WIR: ["WIR"], WHO: ["WGT", "WRO", "WHO"],
  MIX: ["MWA", "MWF", "MWC", "MOM"],
  IND: ["IND"], PAK: ["PAK"], BAN: ["BAN"], CHI: ["CHI"], OAS: ["OAS"],
  BLA: ["BAF"], BLC: ["BCA"], OBL: ["OBL"], OTH: ["ARB", "OOT"]
};

function parseCsvLine(line) {
  const f = []; let c = ""; let q = false;
  for (const ch of line) { if (ch === '"') q = !q; else if (ch === "," && !q) { f.push(c.trim()); c = ""; } else c += ch; }
  f.push(c.trim()); return f;
}

// 1. Parse NEWETHPOP out-migration rates
console.log("Reading NEWETHPOP out-migration rates...");
const outmigRaw = readFileSync(OUTMIG_FILE, "utf8").split("\n").filter(l => l.trim());
const outmigByLA = {}; // laCode → eth12 → avg outmig rate (working ages 18-64)

for (let i = 1; i < outmigRaw.length; i++) {
  const cols = parseCsvLine(outmigRaw[i]);
  const rawCode = cols[2], eth = cols[3];
  if (!rawCode || !eth) continue;
  const codes = rawCode.split("+");

  for (const code of codes) {
    if (!code.startsWith("E")) continue;
    // Working age out-migration rates (ages 18-64, columns 22-68 in NEWETHPOP format)
    const rates = [];
    for (let age = 18; age <= 64; age++) {
      const val = parseFloat(cols[4 + age]);
      if (!isNaN(val)) rates.push(val);
    }
    if (rates.length === 0) continue;
    const avgRate = rates.reduce((s, v) => s + v, 0) / rates.length;

    if (!outmigByLA[code]) outmigByLA[code] = {};
    outmigByLA[code][eth] = avgRate;
  }
}
console.log(`  ${Object.keys(outmigByLA).length} LAs`);

// 2. Load Census 2021 mobility rates
console.log("Loading Census 2021 mobility rates...");
const mig2021 = JSON.parse(readFileSync(MIG_RATES_2021, "utf8"));
const natAvg2021 = mig2021.nationalSummary || {};
console.log(`  ${Object.keys(mig2021.areas || {}).length} LAs`);

// 3. Compute RELATIVE migration indices per LA per ethnic group
// The approach: for each ethnic group, compute the national average out-migration rate.
// Then for each LA, the ratio of local/national outmig gives a "migration pressure" index.
// Ratio > 1 = higher-than-average outflow (losing this group)
// Ratio < 1 = lower-than-average outflow (retaining/gaining this group)
// Convert to net rate: base_net × (1 - relative_outmig_index)

console.log("Computing relative migration indices...");

// National average outmig per ethnic group
const natOutmig = {};
const natOutmigCounts = {};
for (const [, eths] of Object.entries(outmigByLA)) {
  for (const [eth, rate] of Object.entries(eths)) {
    natOutmig[eth] = (natOutmig[eth] || 0) + rate;
    natOutmigCounts[eth] = (natOutmigCounts[eth] || 0) + 1;
  }
}
for (const eth of Object.keys(natOutmig)) {
  natOutmig[eth] /= natOutmigCounts[eth] || 1;
}

console.log("National avg outmig rates (working ages):");
for (const [eth, rate] of Object.entries(natOutmig).sort(([, a], [, b]) => a - b)) {
  console.log(`  ${eth}: ${(rate * 100).toFixed(2)}%`);
}

// For each LA, compute relative outmig and convert to net migration rate
// Base assumption: in a closed system, national average net = 0
// Local net = national_avg_outmig × (1 - local_outmig/national_outmig)
// If local outmig < national → positive net (gaining people)
// If local outmig > national → negative net (losing people)
const netRates = {};

for (const [laCode, eths2011] of Object.entries(outmigByLA)) {
  netRates[laCode] = {};
  const mig21 = mig2021.areas?.[laCode];

  for (const [eth12, localOutRate] of Object.entries(eths2011)) {
    const children = NEWETHPOP_TO_20[eth12];
    if (!children) continue;
    const natRate = natOutmig[eth12] || localOutRate;

    for (const eth20 of children) {
      // Relative outmig index: > 1 means this LA loses more of this group than average
      const relativeIndex = natRate > 0 ? localOutRate / natRate : 1.0;

      // Convert to net rate: if relativeIndex = 1.2, this LA loses 20% more than average
      // Net rate = natRate × (1 - relativeIndex) = natRate × -0.2
      let netRate = natRate * (1 - relativeIndex);

      // Also incorporate Census 2021 mobility signal
      // If Census 2021 shows higher mobility for this group in this LA than national avg,
      // it suggests more churn (amplify the net rate direction)
      if (mig21?.[eth20]?.internalRate !== undefined) {
        const natMobility = (natAvg2021[eth20]?.internalPct || 9) / 100;
        const localMobility = mig21[eth20].internalRate;
        const mobilityRatio = natMobility > 0 ? localMobility / natMobility : 1;
        // Blend 70% 2011 pattern, 30% 2021 mobility signal
        netRate = 0.7 * netRate + 0.3 * netRate * mobilityRatio;
      }

      // Clamp to [-0.02, +0.02] per year (2% max net flow)
      netRates[laCode][eth20] = Math.max(-0.02, Math.min(0.02, Math.round(netRate * 100000) / 100000));
    }
  }
}

console.log(`  ${Object.keys(netRates).length} LAs with net migration rates`);

// Compute national averages
const natAvgNet = {};
const counts = {};
for (const [, eths] of Object.entries(netRates)) {
  for (const [eth, rate] of Object.entries(eths)) {
    natAvgNet[eth] = (natAvgNet[eth] || 0) + rate;
    counts[eth] = (counts[eth] || 0) + 1;
  }
}
for (const eth of Object.keys(natAvgNet)) {
  natAvgNet[eth] = Math.round(natAvgNet[eth] / (counts[eth] || 1) * 100000) / 100000;
}

console.log("\nNational average NET migration rates (per person/year):");
for (const [eth, rate] of Object.entries(natAvgNet).sort(([, a], [, b]) => b - a)) {
  console.log(`  ${eth}: ${(rate * 1000).toFixed(2)} per 1000 (${rate > 0 ? "net inflow" : "net outflow"})`);
}

// Build output
const output = {
  generatedAt: new Date().toISOString(),
  source: "NEWETHPOP Census 2011 out-migration rates (InternalOutmig2011_LEEDS2.csv) + Census 2021 migration indicator (data/model/migration_rates_2021.json)",
  methodology: "Net migration = 0.7 × (-outmig_2011) + 0.3 × (mobility_2021 - 2×outmig_2011). NEWETHPOP provides per-LA ethnic out-migration rates from Census 2011. Census 2021 provides total internal mobility rates. Net rate estimated as mobility minus twice outmig (since mobility = inmig + outmig, and inmig ≈ mobility - outmig). Blended 70/30 favoring 2011 patterns to mitigate COVID distortion in 2021. Clamped to [-5%, +5%].",
  areaCount: Object.keys(netRates).length,
  nationalAverage: natAvgNet,
  areas: netRates
};

writeFileSync(OUTPUT, JSON.stringify(output, null, 2), "utf8");
const fileSizeKB = Math.round(Buffer.byteLength(JSON.stringify(output)) / 1024);
console.log(`\nWritten ${OUTPUT} (${fileSizeKB} KB)`);
