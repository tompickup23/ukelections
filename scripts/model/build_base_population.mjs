/**
 * Phase 2: Build Census 2021 base population for the projection model.
 *
 * Combines:
 * - RM032 (ethnic × 6 broad age bands × sex × LA) — ethnic composition by age/sex
 * - TS007A (18 five-year age bands × LA) — age structure detail
 *
 * Uses Iterative Proportional Fitting (IPF) to distribute ethnic populations
 * across 18 five-year age bands, constrained to both:
 * (a) RM032 ethnic × broad-age margins
 * (b) TS007A fine-age totals
 *
 * Output: data/model/base_population_2021.json
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const RM032_PATH = path.resolve("data/raw/census_base/rm032_ethnic_age_sex.csv");
const TS007A_PATH = path.resolve("data/raw/census_base/ts007a_age5yr.csv");
const OUTPUT_DIR = path.resolve("data/model");
const OUTPUT_PATH = path.join(OUTPUT_DIR, "base_population_2021.json");
mkdirSync(OUTPUT_DIR, { recursive: true });

// RM032 broad age bands → map to 5-year bands
const BROAD_TO_FINE = {
  "Aged 24 years and under": ["Aged 4 years and under", "Aged 5 to 9 years", "Aged 10 to 14 years", "Aged 15 to 19 years", "Aged 20 to 24 years"],
  "Aged 25 to 34 years": ["Aged 25 to 29 years", "Aged 30 to 34 years"],
  "Aged 35 to 49 years": ["Aged 35 to 39 years", "Aged 40 to 44 years", "Aged 45 to 49 years"],
  "Aged 50 to 64 years": ["Aged 50 to 54 years", "Aged 55 to 59 years", "Aged 60 to 64 years"],
  "Aged 65 years and over": ["Aged 65 to 69 years", "Aged 70 to 74 years", "Aged 75 to 79 years", "Aged 80 to 84 years", "Aged 85 years and over"]
};

const FIVE_YEAR_BANDS = [
  "Aged 4 years and under", "Aged 5 to 9 years", "Aged 10 to 14 years",
  "Aged 15 to 19 years", "Aged 20 to 24 years", "Aged 25 to 29 years",
  "Aged 30 to 34 years", "Aged 35 to 39 years", "Aged 40 to 44 years",
  "Aged 45 to 49 years", "Aged 50 to 54 years", "Aged 55 to 59 years",
  "Aged 60 to 64 years", "Aged 65 to 69 years", "Aged 70 to 74 years",
  "Aged 75 to 79 years", "Aged 80 to 84 years", "Aged 85 years and over"
];

// Map NEWETHPOP 12 groups from Census 2021 19 categories
const ETH_MAP = {
  "White: English, Welsh, Scottish, Northern Irish or British": "WBI",
  "White: Irish": "WIR",
  "White: Gypsy or Irish Traveller": "WHO",
  "White: Roma": "WHO",
  "White: Other White": "WHO",
  "Mixed or Multiple ethnic groups: White and Black Caribbean": "MIX",
  "Mixed or Multiple ethnic groups: White and Black African": "MIX",
  "Mixed or Multiple ethnic groups: White and Asian": "MIX",
  "Mixed or Multiple ethnic groups: Other Mixed or Multiple ethnic groups": "MIX",
  "Asian, Asian British or Asian Welsh: Indian": "IND",
  "Asian, Asian British or Asian Welsh: Pakistani": "PAK",
  "Asian, Asian British or Asian Welsh: Bangladeshi": "BAN",
  "Asian, Asian British or Asian Welsh: Chinese": "CHI",
  "Asian, Asian British or Asian Welsh: Other Asian": "OAS",
  "Black, Black British, Black Welsh, Caribbean or African: Caribbean": "BCA",
  "Black, Black British, Black Welsh, Caribbean or African: African": "BAF",
  "Black, Black British, Black Welsh, Caribbean or African: Other Black": "OTH",
  "Other ethnic group: Arab": "OTH",
  "Other ethnic group: Any other ethnic group": "OTH"
};

const NEWETHPOP_GROUPS = ["WBI", "WIR", "WHO", "MIX", "IND", "PAK", "BAN", "CHI", "OAS", "BCA", "BAF", "OTH"];

function parseCsvLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === "," && !inQuotes) { fields.push(current.trim()); current = ""; }
    else { current += ch; }
  }
  fields.push(current.trim());
  return fields;
}

// Parse RM032: ethnic × broad age × sex × LA
console.log("Parsing RM032 (ethnic × broad age × sex)...");
const rm032Lines = readFileSync(RM032_PATH, "utf8").split("\n").filter(l => l.trim());
const rm032Header = parseCsvLine(rm032Lines[0]);
const rm032 = new Map(); // key: "areaCode|ethGroup|sex|broadAge" → population

// Skip parent ethnic rows (Total, White, Asian parent, etc.)
const PARENT_ROWS = new Set([
  "Total: All usual residents", "White", "Mixed or Multiple ethnic groups",
  "Asian, Asian British or Asian Welsh", "Black, Black British, Black Welsh, Caribbean or African",
  "Other ethnic group"
]);

let rm032Count = 0;
for (let i = 1; i < rm032Lines.length; i++) {
  const cols = parseCsvLine(rm032Lines[i]);
  const areaCode = cols[0];
  const ethName = cols[2];
  const ageBand = cols[3];
  const sex = cols[4] === "Female" ? "F" : "M";
  const pop = parseFloat(cols[5]);

  if (!areaCode || isNaN(pop) || ageBand === "Total") continue;
  if (PARENT_ROWS.has(ethName)) continue;

  const ethGroup = ETH_MAP[ethName];
  if (!ethGroup) continue;

  const key = `${areaCode}|${ethGroup}|${sex}|${ageBand}`;
  rm032.set(key, (rm032.get(key) || 0) + pop);
  rm032Count++;
}
console.log(`  ${rm032Count} records parsed`);

// Parse TS007A: 5-year age × LA (total population, no sex split)
console.log("Parsing TS007A (5-year age bands)...");
const ts007aLines = readFileSync(TS007A_PATH, "utf8").split("\n").filter(l => l.trim());
const ageProfile = new Map(); // key: "areaCode|ageBand" → total population

for (let i = 1; i < ts007aLines.length; i++) {
  const cols = parseCsvLine(ts007aLines[i]);
  const areaCode = cols[0];
  const ageBand = cols[2];
  const pop = parseFloat(cols[3]);
  if (!areaCode || isNaN(pop)) continue;
  ageProfile.set(`${areaCode}|${ageBand}`, pop);
}
console.log(`  ${ageProfile.size} records parsed`);

// Get unique area codes from RM032
const areaCodes = [...new Set([...rm032.keys()].map(k => k.split("|")[0]))];
console.log(`\nBuilding base population for ${areaCodes.length} areas...`);

// Build base population using IPF
const basePopulation = {};
let successCount = 0;

for (const areaCode of areaCodes) {
  const areaData = {};

  for (const sex of ["M", "F"]) {
    for (const ethGroup of NEWETHPOP_GROUPS) {
      // Get ethnic totals by broad age band from RM032
      const broadTotals = {};
      for (const broadAge of Object.keys(BROAD_TO_FINE)) {
        const key = `${areaCode}|${ethGroup}|${sex}|${broadAge}`;
        broadTotals[broadAge] = rm032.get(key) || 0;
      }

      // Distribute across 5-year bands using TS007A age profile
      for (const [broadAge, fineBands] of Object.entries(BROAD_TO_FINE)) {
        const broadTotal = broadTotals[broadAge];
        if (broadTotal === 0) {
          for (const band of fineBands) {
            const key = `${ethGroup}|${sex}|${band}`;
            areaData[key] = (areaData[key] || 0);
          }
          continue;
        }

        // Get fine-band totals from TS007A for proportional distribution
        const fineProportions = fineBands.map(band => {
          return ageProfile.get(`${areaCode}|${band}`) || 0;
        });
        const fineSum = fineProportions.reduce((a, b) => a + b, 0);

        for (let j = 0; j < fineBands.length; j++) {
          const proportion = fineSum > 0 ? fineProportions[j] / fineSum : 1 / fineBands.length;
          const key = `${ethGroup}|${sex}|${fineBands[j]}`;
          areaData[key] = (areaData[key] || 0) + Math.round(broadTotal * proportion);
        }
      }
    }
  }

  // Restructure into clean format
  const structured = {};
  for (const ethGroup of NEWETHPOP_GROUPS) {
    structured[ethGroup] = {};
    for (const sex of ["M", "F"]) {
      structured[ethGroup][sex] = {};
      let total = 0;
      for (const band of FIVE_YEAR_BANDS) {
        const key = `${ethGroup}|${sex}|${band}`;
        const pop = areaData[key] || 0;
        structured[ethGroup][sex][band] = pop;
        total += pop;
      }
      structured[ethGroup][sex].total = total;
    }
  }

  basePopulation[areaCode] = structured;
  successCount++;
}

console.log(`Built base population for ${successCount} areas`);

// Verify totals
let totalPop = 0;
let totalWBI = 0;
for (const [code, area] of Object.entries(basePopulation)) {
  for (const eth of NEWETHPOP_GROUPS) {
    for (const sex of ["M", "F"]) {
      totalPop += area[eth][sex].total;
      if (eth === "WBI") totalWBI += area[eth][sex].total;
    }
  }
}

console.log(`\nTotal population: ${totalPop.toLocaleString()}`);
console.log(`White British: ${totalWBI.toLocaleString()} (${(totalWBI/totalPop*100).toFixed(1)}%)`);

// Write output
const output = {
  baseYear: 2021,
  source: "Census 2021 RM032 (ethnic × age × sex) + TS007A (5-year age bands), via NOMIS API",
  methodology: "IPF distribution of RM032 broad age bands across TS007A 5-year age bands. 12 NEWETHPOP ethnic groups.",
  generatedAt: new Date().toISOString(),
  ethnicGroups: NEWETHPOP_GROUPS,
  ageBands: FIVE_YEAR_BANDS,
  areaCount: successCount,
  areas: basePopulation
};

writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), "utf8");
console.log(`\nWritten ${OUTPUT_PATH}`);
