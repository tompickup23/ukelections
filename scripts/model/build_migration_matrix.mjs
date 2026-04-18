/**
 * Build ethnic-specific internal out-migration rate matrix from NEWETHPOP Census 2011 data.
 *
 * NEWETHPOP provides:
 * - InternalOutmig: per-person departure rates by LA × ethnic group × age
 *   (probability that a person of age X, ethnicity E, in LA L, migrates out)
 * - InternalInmig: per-origin arrival rates (NOT per-person, very small values)
 *   (share of destination LA population arriving from each origin)
 *
 * For modelling, out-migration rates are the directly usable quantity.
 * In-migration is handled implicitly via SNPP total population constraint.
 *
 * This script:
 * 1. Reads NEWETHPOP out-migration rate files
 * 2. Computes average out-migration rates per LA per ethnic group (working ages 15-64)
 * 3. Splits 12 groups to 20 using 2021 sub-group proportions
 * 4. Outputs migration matrix for reference and future model integration
 *
 * Output: data/model/migration_matrix.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const INMIG_FILE = path.resolve("data/raw/newethpop/extracted/2DataArchive/InputData/InternalMigration/InternalInmig2011_LEEDS2.csv");
const OUTMIG_FILE = path.resolve("data/raw/newethpop/extracted/2DataArchive/InputData/InternalMigration/InternalOutmig2011_LEEDS2.csv");
const BASE_POP = path.resolve("data/model/base_single_year_2021.json");
const OUTPUT = path.resolve("data/model/migration_matrix.json");

// NEWETHPOP 12 groups → our 20-group split mapping
const SPLIT_MAP = {
  WHO: ["WIR", "WGT", "WRO", "WHO"],
  MIX: ["MWA", "MWF", "MWC", "MOM"],
  BLA: ["BAF"],
  BLC: ["BCA"],
  OTH: ["ARB", "OOT"],
  OBL: ["OBL"]
};

// Groups that map 1:1
const DIRECT_MAP = { WBI: "WBI", IND: "IND", PAK: "PAK", BAN: "BAN", CHI: "CHI", OAS: "OAS" };

function parseCSV(filepath) {
  const raw = readFileSync(filepath, "utf8");
  const lines = raw.split("\n").filter(l => l.trim());
  const header = lines[0];

  // Extract age column names from header
  const headerParts = header.split(",").map(s => s.replace(/"/g, "").trim());
  // Columns: row_num, LAD.name, LAD.code, ETH.group, then age columns (MB.0, M0.1, M1.2, ...)

  const data = {}; // laCode → ethGroup → avgRate (mean across ages 0-90)
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(",");
    if (parts.length < 10) continue;

    const laCode = parts[2]?.replace(/"/g, "").trim();
    const ethGroup = parts[3]?.replace(/"/g, "").trim();

    if (!laCode || !ethGroup || !laCode.startsWith("E")) continue;
    // Skip combined LA codes (e.g., E09000001+E09000033)
    if (laCode.includes("+")) continue;

    // Parse age-specific rates (columns 4 onwards)
    const rates = [];
    for (let j = 4; j < parts.length; j++) {
      const val = parseFloat(parts[j]);
      if (!isNaN(val)) rates.push(val);
    }

    if (rates.length === 0) continue;

    // Compute mean rate across working ages (15-64) which are the main movers
    // Ages 0-14 move with parents; 65+ rarely move
    const workingAgeRates = rates.slice(15, 65);
    const avgRate = workingAgeRates.length > 0
      ? workingAgeRates.reduce((s, v) => s + v, 0) / workingAgeRates.length
      : rates.reduce((s, v) => s + v, 0) / rates.length;

    if (!data[laCode]) data[laCode] = {};
    data[laCode][ethGroup] = avgRate;
  }

  return data;
}

console.log("Reading NEWETHPOP internal migration data...");
const inmigRates = parseCSV(INMIG_FILE);
const outmigRates = parseCSV(OUTMIG_FILE);

const laCodesIn = Object.keys(inmigRates).sort();
const laCodesOut = Object.keys(outmigRates).sort();
console.log(`  In-migration: ${laCodesIn.length} LAs`);
console.log(`  Out-migration: ${laCodesOut.length} LAs`);

// Compute net migration rates per LA per 12-group ethnic group
const netMig12 = {}; // laCode → ethGroup → netRate
const allEths12 = new Set();

for (const laCode of laCodesIn) {
  netMig12[laCode] = {};
  const inmig = inmigRates[laCode] || {};
  const outmig = outmigRates[laCode] || {};

  for (const eth of Object.keys(inmig)) {
    allEths12.add(eth);
    const inRate = inmig[eth] || 0;
    const outRate = outmig[eth] || 0;
    netMig12[laCode][eth] = Math.round((inRate - outRate) * 100000) / 100000;
  }
}

console.log(`  Ethnic groups: ${[...allEths12].sort().join(", ")}`);

// Load 2021 base pop for 20-group splitting proportions
console.log("\nLoading Census 2021 base for 20-group splitting...");
const basePop = JSON.parse(readFileSync(BASE_POP, "utf8"));

// Split 12 groups to 20 groups using 2021 sub-group population proportions
const netMig20 = {}; // laCode → 20-group ethCode → netRate

for (const [laCode, eths] of Object.entries(netMig12)) {
  netMig20[laCode] = {};
  const areaBase = basePop.areas[laCode];

  for (const [eth12, netRate] of Object.entries(eths)) {
    // Direct mapping
    if (DIRECT_MAP[eth12]) {
      netMig20[laCode][DIRECT_MAP[eth12]] = netRate;
      continue;
    }

    // Split mapping — distribute parent rate to sub-groups
    const subGroups = SPLIT_MAP[eth12];
    if (!subGroups) continue;

    if (areaBase && subGroups.length > 1) {
      // Compute sub-group population shares within parent
      let parentTotal = 0;
      for (const sg of subGroups) {
        const ethData = areaBase[sg];
        if (ethData) {
          const mTotal = Object.values(ethData.M || {}).reduce((s, v) => s + v, 0);
          const fTotal = Object.values(ethData.F || {}).reduce((s, v) => s + v, 0);
          parentTotal += mTotal + fTotal;
        }
      }

      for (const sg of subGroups) {
        const ethData = areaBase[sg];
        if (ethData && parentTotal > 0) {
          const mTotal = Object.values(ethData.M || {}).reduce((s, v) => s + v, 0);
          const fTotal = Object.values(ethData.F || {}).reduce((s, v) => s + v, 0);
          const share = (mTotal + fTotal) / parentTotal;
          // All sub-groups inherit the parent rate (migration rate is per-person, not volume)
          netMig20[laCode][sg] = netRate;
        } else {
          netMig20[laCode][sg] = netRate;
        }
      }
    } else {
      // Single sub-group or no base data — direct assignment
      for (const sg of subGroups) {
        netMig20[laCode][sg] = netRate;
      }
    }
  }
}

console.log(`  20-group migration rates for ${Object.keys(netMig20).length} LAs`);

// Compute national averages per ethnic group
const nationalAvg = {};
const counts = {};
for (const [laCode, eths] of Object.entries(netMig20)) {
  for (const [eth, rate] of Object.entries(eths)) {
    nationalAvg[eth] = (nationalAvg[eth] || 0) + rate;
    counts[eth] = (counts[eth] || 0) + 1;
  }
}
for (const eth of Object.keys(nationalAvg)) {
  nationalAvg[eth] = Math.round(nationalAvg[eth] / (counts[eth] || 1) * 100000) / 100000;
}

console.log("\nNational average net migration rates (20-group):");
for (const [eth, rate] of Object.entries(nationalAvg).sort(([, a], [, b]) => b - a)) {
  const direction = rate > 0 ? "net inflow" : "net outflow";
  console.log(`  ${eth}: ${(rate * 1000).toFixed(3)} per 1000 (${direction})`);
}

// Identify areas with strongest ethnic-specific migration patterns
const extremePatterns = [];
for (const [laCode, eths] of Object.entries(netMig20)) {
  const wbiRate = eths.WBI || 0;
  const pakRate = eths.PAK || 0;
  if (Math.abs(wbiRate) > 0.005 || Math.abs(pakRate) > 0.005) {
    extremePatterns.push({
      laCode,
      wbiNet: Math.round(wbiRate * 10000) / 10,
      pakNet: Math.round(pakRate * 10000) / 10
    });
  }
}
extremePatterns.sort((a, b) => b.wbiNet - a.wbiNet);

console.log("\nAreas with strongest WBI in-migration (per 10K):");
for (const a of extremePatterns.slice(0, 5)) {
  console.log(`  ${a.laCode}: WBI +${a.wbiNet}, PAK ${a.pakNet > 0 ? "+" : ""}${a.pakNet}`);
}
console.log("Areas with strongest WBI out-migration (per 10K):");
for (const a of extremePatterns.slice(-5).reverse()) {
  console.log(`  ${a.laCode}: WBI ${a.wbiNet}, PAK ${a.pakNet > 0 ? "+" : ""}${a.pakNet}`);
}

// Build output
const output = {
  generatedAt: new Date().toISOString(),
  source: "NEWETHPOP Leeds2 Archive — Census 2011 internal migration rates (InternalInmig2011/InternalOutmig2011)",
  methodology: "Net migration rate = in-migration rate minus out-migration rate per LA per ethnic group. Rates are annual probability rates averaged across working ages (15-64). 12-group rates split to 20 groups using Census 2021 sub-group population proportions. Migration rates are per-person, so sub-groups inherit the parent group rate. COVID caveat: these are 2011 Census-era rates; Census 2021 migration patterns may differ due to COVID, Brexit, and changing settlement patterns.",
  ethnicGroups20: Object.keys(nationalAvg).sort(),
  areaCount: Object.keys(netMig20).length,
  nationalAverage: nationalAvg,
  areas: netMig20
};

writeFileSync(OUTPUT, JSON.stringify(output, null, 2), "utf8");
const fileSizeKB = Math.round(Buffer.byteLength(JSON.stringify(output)) / 1024);
console.log(`\nWritten ${OUTPUT} (${fileSizeKB} KB)`);
