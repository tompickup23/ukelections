/**
 * Build single-year-of-age ethnic population base from Census 2021 custom dataset.
 *
 * REPLACES IPF. The ONS "Create a custom dataset" provides Census 2021
 * single-year × 20 ethnic groups × sex × 311 LAs as direct observations.
 * No estimation required — every cell is an observed Census count.
 *
 * 20 ethnic groups (ONS codes 1-19):
 *   BAN, CHI, IND, PAK, OAS (Asian subcategories)
 *   BAF, BCA, OBL (Black subcategories)
 *   MWA, MWF, MWC, MOM (Mixed subcategories)
 *   WBI, WIR, WGT, WRO, WHO (White subcategories)
 *   ARB, OOT (Other subcategories)
 *
 * 20 areas are suppressed for disclosure control — identified and listed.
 *
 * Output: data/model/base_single_year_2021.json
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const CENSUS_CSV = path.resolve("data/raw/census_single_year/census2021_ethnic_age_sex_la_singleyear.csv");
const OUTPUT_DIR = path.resolve("data/model");
const OUTPUT_PATH = path.join(OUTPUT_DIR, "base_single_year_2021.json");
mkdirSync(OUTPUT_DIR, { recursive: true });

// 20-group ethnic codes (our internal codes)
const ETHNIC_GROUPS_20 = [
  "WBI", "WIR", "WGT", "WRO", "WHO",  // White: British, Irish, Gypsy/Traveller, Roma, Other
  "MWA", "MWF", "MWC", "MOM",          // Mixed: White+Asian, White+Black African, White+Black Caribbean, Other Mixed
  "IND", "PAK", "BAN", "CHI", "OAS",   // Asian: Indian, Pakistani, Bangladeshi, Chinese, Other Asian
  "BAF", "BCA", "OBL",                  // Black: African, Caribbean, Other Black
  "ARB", "OOT"                          // Other: Arab, Any Other
];

// Also define the 12-group backwards-compatible mapping
const MAP_20_TO_12 = {
  WBI: "WBI", WIR: "WIR", WGT: "WHO", WRO: "WHO", WHO: "WHO",
  MWA: "MIX", MWF: "MIX", MWC: "MIX", MOM: "MIX",
  IND: "IND", PAK: "PAK", BAN: "BAN", CHI: "CHI", OAS: "OAS",
  BAF: "BAF", BCA: "BCA", OBL: "OTH",
  ARB: "OTH", OOT: "OTH"
};
const ETHNIC_GROUPS_12 = ["WBI", "WIR", "WHO", "MIX", "IND", "PAK", "BAN", "CHI", "OAS", "BCA", "BAF", "OTH"];

// Map ONS Census CSV ethnic codes (integers) to our 20-group codes
const ONS_CODE_MAP = {
  1: "BAN",   // Bangladeshi
  2: "CHI",   // Chinese
  3: "IND",   // Indian
  4: "PAK",   // Pakistani
  5: "OAS",   // Other Asian
  6: "BAF",   // African
  7: "BCA",   // Caribbean
  8: "OBL",   // Other Black
  9: "MWA",   // White and Asian
  10: "MWF",  // White and Black African
  11: "MWC",  // White and Black Caribbean
  12: "MOM",  // Other Mixed
  13: "WBI",  // English, Welsh, Scottish, Northern Irish or British
  14: "WIR",  // Irish
  15: "WGT",  // Gypsy or Irish Traveller
  16: "WRO",  // Roma
  17: "WHO",  // Other White
  18: "ARB",  // Arab
  19: "OOT"   // Any other ethnic group
};

const SEXES = ["M", "F"];
const AGES = []; for (let a = 0; a <= 90; a++) AGES.push(a);

console.log("Parsing Census 2021 custom dataset (single-year × 20 ethnic × sex × LA)...");
console.log(`  Source: ${CENSUS_CSV}`);

// Use Python-style CSV parsing for robustness with quoted fields
function parseCsvLine(line) {
  const f = []; let c = ""; let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === "," && !q) { f.push(c.trim()); c = ""; }
    else c += ch;
  }
  f.push(c.trim()); return f;
}

const fileContent = readFileSync(CENSUS_CSV, "utf8");
const lines = fileContent.split("\n").filter(l => l.trim());
console.log(`  ${lines.length - 1} data rows`);

// Columns: LA Code, LA Name, Age Code, Age Name, Eth Code, Eth Name, Sex Code, Sex Name, Observation
const result = {};     // code → { eth → { sex → { age → pop, total → sum } } }
const suppressedAreas = new Set();
let rowCount = 0;

for (let i = 1; i < lines.length; i++) {
  const cols = parseCsvLine(lines[i]);
  const laCode = cols[0];
  const ageCode = parseInt(cols[2]);
  const ethCode = parseInt(cols[4]);
  const sexCode = parseInt(cols[6]);
  const observation = parseInt(cols[8]) || 0;

  if (!laCode?.startsWith("E")) continue;

  // Map ethnic code
  const eth = ONS_CODE_MAP[ethCode];
  if (!eth) continue; // Skip "Does not apply" (code -8)

  // Map sex
  const sex = sexCode === 1 ? "F" : sexCode === 2 ? "M" : null;
  if (!sex) continue;

  // Map age: 0-89 = individual years, 90-100 = sum into 90+
  let age;
  if (ageCode >= 0 && ageCode <= 89) {
    age = ageCode;
  } else if (ageCode >= 90 && ageCode <= 100) {
    age = 90; // Sum into 90+ bucket
  } else {
    continue;
  }

  // Initialize area/eth/sex structures
  if (!result[laCode]) result[laCode] = {};
  if (!result[laCode][eth]) result[laCode][eth] = {};
  if (!result[laCode][eth][sex]) {
    result[laCode][eth][sex] = {};
    for (const a of AGES) result[laCode][eth][sex][a] = 0;
    result[laCode][eth][sex].total = 0;
  }

  result[laCode][eth][sex][age] += observation;
  result[laCode][eth][sex].total += observation;
  rowCount++;
}

// Compute totals and verify
const areaCodes = Object.keys(result).sort();
let totalPop = 0, totalWBI = 0;
const areaPopulations = {};

for (const code of areaCodes) {
  let areaPop = 0;
  for (const eth of ETHNIC_GROUPS_20) {
    for (const sex of SEXES) {
      const pop = result[code]?.[eth]?.[sex]?.total || 0;
      areaPop += pop;
      totalPop += pop;
      if (eth === "WBI") totalWBI += pop;
    }
  }
  areaPopulations[code] = areaPop;

  // Check for suppressed areas (very low populations across all groups)
  // ONS suppresses 20 areas for disclosure control
  if (areaPop < 1000) {
    suppressedAreas.add(code);
  }
}

console.log(`\nParsed ${areaCodes.length} areas from Census custom dataset`);
console.log(`Total population: ${totalPop.toLocaleString()}`);
console.log(`WBI: ${totalWBI.toLocaleString()} (${(totalWBI / totalPop * 100).toFixed(1)}%)`);
console.log(`Suppressed areas (pop < 1000): ${suppressedAreas.size}`);

// Also generate a 12-group version for backwards compatibility
const result12 = {};
for (const code of areaCodes) {
  if (suppressedAreas.has(code)) continue;
  result12[code] = {};
  for (const eth20 of ETHNIC_GROUPS_20) {
    const eth12 = MAP_20_TO_12[eth20];
    if (!result12[code][eth12]) {
      result12[code][eth12] = {};
      for (const sex of SEXES) {
        result12[code][eth12][sex] = {};
        for (const a of AGES) result12[code][eth12][sex][a] = 0;
        result12[code][eth12][sex].total = 0;
      }
    }
    for (const sex of SEXES) {
      for (const a of AGES) {
        result12[code][eth12][sex][a] += result[code]?.[eth20]?.[sex]?.[a] || 0;
      }
      result12[code][eth12][sex].total += result[code]?.[eth20]?.[sex]?.total || 0;
    }
  }
}

// Write 20-group output
const output20 = {
  baseYear: 2021,
  source: "Census 2021 custom dataset: single-year-of-age × 20 ethnic groups × sex × 311 LAs. Direct observations — no IPF or estimation.",
  methodology: "ONS 'Create a custom dataset' tool. Every cell is a directly observed Census 2021 count. Ages 90-100 summed into 90+ bucket. No iterative fitting, no seed profiles, no estimation. 20 ethnic groups as defined by ONS Census 2021 classification.",
  ethnicGroups: ETHNIC_GROUPS_20,
  ethnicGroups12: ETHNIC_GROUPS_12,
  map20to12: MAP_20_TO_12,
  ages: AGES,
  areaCount: areaCodes.length - suppressedAreas.size,
  suppressedAreas: [...suppressedAreas],
  areas: {}
};

// Only include non-suppressed areas
for (const code of areaCodes) {
  if (suppressedAreas.has(code)) continue;
  output20.areas[code] = result[code];
}

writeFileSync(OUTPUT_PATH, JSON.stringify(output20), "utf8");
console.log(`\nWritten 20-group base: ${OUTPUT_PATH} (${(JSON.stringify(output20).length / 1e6).toFixed(1)} MB)`);

// Write 12-group backwards-compatible version
const output12Path = path.join(OUTPUT_DIR, "base_single_year_2021_12group.json");
const output12 = {
  baseYear: 2021,
  source: "Census 2021 custom dataset, aggregated from 20 to 12 groups for backwards compatibility.",
  methodology: "Direct Census observations aggregated: WGT+WRO→WHO, MWA+MWF+MWC+MOM→MIX, OBL+ARB+OOT→OTH.",
  ethnicGroups: ETHNIC_GROUPS_12,
  ages: AGES,
  areaCount: Object.keys(result12).length,
  areas: result12
};

writeFileSync(output12Path, JSON.stringify(output12), "utf8");
console.log(`Written 12-group base: ${output12Path} (${(JSON.stringify(output12).length / 1e6).toFixed(1)} MB)`);

// Spot checks
const bb = output20.areas["E06000008"];
if (bb) {
  console.log("\nBlackburn age pyramid (selected groups, males, selected ages):");
  for (const age of [0, 5, 15, 25, 35, 50, 65, 80]) {
    const wbi = bb.WBI?.M?.[age] || 0;
    const pak = bb.PAK?.M?.[age] || 0;
    const arb = bb.ARB?.M?.[age] || 0;
    const wro = bb.WRO?.M?.[age] || 0;
    console.log(`  Age ${age}: WBI=${wbi} PAK=${pak} ARB=${arb} Roma=${wro}`);
  }
}

// New group totals
console.log("\nNew group national totals:");
const natTotals = {};
for (const code of areaCodes) {
  if (suppressedAreas.has(code)) continue;
  for (const eth of ETHNIC_GROUPS_20) {
    natTotals[eth] = (natTotals[eth] || 0) + (result[code]?.[eth]?.M?.total || 0) + (result[code]?.[eth]?.F?.total || 0);
  }
}
for (const eth of ETHNIC_GROUPS_20) {
  console.log(`  ${eth}: ${(natTotals[eth] || 0).toLocaleString()} (${((natTotals[eth] || 0) / totalPop * 100).toFixed(2)}%)`);
}
