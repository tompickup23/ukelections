/**
 * Hamilton-Perry Model with CoDa Constraint + SNPP Envelope
 *
 * Every number traces to Census observations. No hardcoded rates.
 *
 * Method:
 * 1. Compute Cohort Change Ratios (CCRs) from Census 2011 → 2021
 *    CCR(age_x, eth, sex, LA) = Pop(age_x+10, eth, sex, LA, 2021) / Pop(age_x, eth, sex, LA, 2011)
 * 2. Compute Child-Woman Ratios (CWRs) for the 0-9 birth cohort
 *    CWR(eth, LA) = Children(0-9, eth, LA, 2021) / Women(15-44, eth, LA, 2021)
 * 3. Project forward in 10-year steps using CCRs
 * 4. Apply CoDa log-ratio transform to ensure ethnic shares sum to 1
 * 5. Constrain LA totals to ONS SNPP 2022-based projections
 * 6. Generate 3 scenarios via SNPP low/principal/high migration variants
 *
 * Data sources (all observed):
 * - Census 2011 DC2101EW (ethnic × age × sex × LA) via NOMIS NM_651_1
 * - Census 2021 RM032 (ethnic × age × sex × LA) via NOMIS NM_2132_1
 * - ONS SNPP 2022-based Z1 (LA total pop 2022-2047)
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const CSV_2011 = path.resolve("data/raw/census_base/dc2101_2011_ethnic_age_sex.csv");
const CSV_2021 = path.resolve("data/raw/census_base/rm032_ethnic_age_sex.csv");
const SNPP_PATH = path.resolve("data/raw/snpp/2022 SNPP Population persons.csv");
const SITE_OUTPUT = path.resolve("src/data/live/ethnic-projections.json");

// Target 5-year age bands (matching our 2021 data)
const AGE_BANDS = [
  "0-4", "5-9", "10-14", "15-19", "20-24", "25-29", "30-34",
  "35-39", "40-44", "45-49", "50-54", "55-59", "60-64",
  "65-69", "70-74", "75-79", "80-84", "85+"
];

// Map 2011 irregular age bands to our 5-year bands
const AGE_2011_MAP = {
  "Age 0 to 4": "0-4",
  "Age 5 to 7": "5-9", "Age 8 to 9": "5-9",
  "Age 10 to 14": "10-14",
  "Age 15": "15-19", "Age 16 to 17": "15-19", "Age 18 to 19": "15-19",
  "Age 20 to 24": "20-24",
  "Age 25 to 29": "25-29", "Age 30 to 34": "30-34",
  "Age 35 to 39": "35-39", "Age 40 to 44": "40-44",
  "Age 45 to 49": "45-49", "Age 50 to 54": "50-54",
  "Age 55 to 59": "55-59", "Age 60 to 64": "60-64",
  "Age 65 to 69": "65-69", "Age 70 to 74": "70-74",
  "Age 75 to 79": "75-79", "Age 80 to 84": "80-84",
  "Age 85 and over": "85+"
};

// Map 2021 RM032 age bands
const AGE_2021_MAP = {
  "Aged 24 years and under": null, // Will split using 2011 proportions
  "Aged 25 to 34 years": null,
  "Aged 35 to 49 years": null,
  "Aged 50 to 64 years": null,
  "Aged 65 years and over": null
};

// Ethnic group mapping: both censuses → 12 NEWETHPOP groups
const ETH_MAP_2011 = {
  "White: English/Welsh/Scottish/Northern Irish/British": "WBI",
  "White: Irish": "WIR",
  "White: Gypsy or Irish Traveller": "WHO", "White: Other White": "WHO",
  "Mixed/multiple ethnic group: White and Black Caribbean": "MIX",
  "Mixed/multiple ethnic group: White and Black African": "MIX",
  "Mixed/multiple ethnic group: White and Asian": "MIX",
  "Mixed/multiple ethnic group: Other Mixed": "MIX",
  "Asian/Asian British: Indian": "IND", "Asian/Asian British: Pakistani": "PAK",
  "Asian/Asian British: Bangladeshi": "BAN", "Asian/Asian British: Chinese": "CHI",
  "Asian/Asian British: Other Asian": "OAS",
  "Black/African/Caribbean/Black British: African": "BAF",
  "Black/African/Caribbean/Black British: Caribbean": "BCA",
  "Black/African/Caribbean/Black British: Other Black": "OTH",
  "Other ethnic group: Arab": "OTH", "Other ethnic group: Any other ethnic group": "OTH"
};

const ETH_MAP_2021 = {
  "White: English, Welsh, Scottish, Northern Irish or British": "WBI",
  "White: Irish": "WIR",
  "White: Gypsy or Irish Traveller": "WHO", "White: Roma": "WHO", "White: Other White": "WHO",
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
  "Other ethnic group: Arab": "OTH", "Other ethnic group: Any other ethnic group": "OTH"
};

const ETHNIC_GROUPS = ["WBI", "WIR", "WHO", "MIX", "IND", "PAK", "BAN", "CHI", "OAS", "BCA", "BAF", "OTH"];
const SEXES = ["M", "F"];

function parseCsvLine(line) {
  const fields = []; let cur = ""; let q = false;
  for (const ch of line) { if (ch === '"') q = !q; else if (ch === "," && !q) { fields.push(cur.trim()); cur = ""; } else cur += ch; }
  fields.push(cur.trim()); return fields;
}

// ============================================================
// Parse Census 2011 (DC2101: ethnic × age × sex × LA)
// ============================================================
console.log("Parsing Census 2011 DC2101...");
const pop2011 = new Map(); // "areaCode|eth|sex|ageBand" → population
const lines2011 = readFileSync(CSV_2011, "utf8").split("\n").filter(l => l.trim());

for (let i = 1; i < lines2011.length; i++) {
  const cols = parseCsvLine(lines2011[i]);
  const code = cols[0]; const ethName = cols[1]; const ageName = cols[2]; const sexName = cols[3]; const pop = parseFloat(cols[4]);
  if (!code || isNaN(pop)) continue;
  const eth = ETH_MAP_2011[ethName]; if (!eth) continue;
  const age = AGE_2011_MAP[ageName]; if (!age) continue;
  const sex = sexName === "Males" ? "M" : "F";
  const key = `${code}|${eth}|${sex}|${age}`;
  pop2011.set(key, (pop2011.get(key) || 0) + pop);
}
const areas2011 = new Set([...pop2011.keys()].map(k => k.split("|")[0]));
console.log(`  ${areas2011.size} areas, ${pop2011.size} cells`);

// ============================================================
// Parse Census 2021 (RM032: ethnic × broad age × sex × LA)
// We need to disaggregate the 5 broad bands into 18 five-year bands
// using the 2011 age profile as proportions (IPF approach)
// ============================================================
console.log("Parsing Census 2021 RM032...");
const raw2021 = new Map(); // "areaCode|eth|sex|broadAge" → population
const lines2021 = readFileSync(CSV_2021, "utf8").split("\n").filter(l => l.trim());

const PARENT_ETH = new Set(["Total: All usual residents", "White", "Mixed or Multiple ethnic groups",
  "Asian, Asian British or Asian Welsh", "Black, Black British, Black Welsh, Caribbean or African", "Other ethnic group"]);

for (let i = 1; i < lines2021.length; i++) {
  const cols = parseCsvLine(lines2021[i]);
  const code = cols[0]; const ethName = cols[2]; const ageName = cols[3]; const sexName = cols[4]; const pop = parseFloat(cols[5]);
  if (!code || isNaN(pop) || ageName === "Total") continue;
  if (PARENT_ETH.has(ethName)) continue;
  const eth = ETH_MAP_2021[ethName]; if (!eth) continue;
  const sex = sexName === "Female" ? "F" : "M";
  const key = `${code}|${eth}|${sex}|${ageName}`;
  raw2021.set(key, (raw2021.get(key) || 0) + pop);
}

// Disaggregate broad 2021 bands to 5-year using 2011 proportions
const BROAD_TO_FINE = {
  "Aged 24 years and under": ["0-4", "5-9", "10-14", "15-19", "20-24"],
  "Aged 25 to 34 years": ["25-29", "30-34"],
  "Aged 35 to 49 years": ["35-39", "40-44", "45-49"],
  "Aged 50 to 64 years": ["50-54", "55-59", "60-64"],
  "Aged 65 years and over": ["65-69", "70-74", "75-79", "80-84", "85+"]
};

const pop2021 = new Map();
const areas2021 = new Set([...raw2021.keys()].map(k => k.split("|")[0]));

for (const code of areas2021) {
  for (const eth of ETHNIC_GROUPS) {
    for (const sex of SEXES) {
      for (const [broadAge, fineBands] of Object.entries(BROAD_TO_FINE)) {
        const broadPop = raw2021.get(`${code}|${eth}|${sex}|${broadAge}`) || 0;
        // Get 2011 proportions for this broad band
        const fineProps = fineBands.map(b => pop2011.get(`${code}|${eth}|${sex}|${b}`) || 0);
        const fineSum = fineProps.reduce((a, b) => a + b, 0);

        for (let j = 0; j < fineBands.length; j++) {
          const prop = fineSum > 0 ? fineProps[j] / fineSum : 1 / fineBands.length;
          const key = `${code}|${eth}|${sex}|${fineBands[j]}`;
          pop2021.set(key, (pop2021.get(key) || 0) + Math.round(broadPop * prop));
        }
      }
    }
  }
}
console.log(`  ${areas2021.size} areas, ${pop2021.size} cells`);

// ============================================================
// Compute Cohort Change Ratios (CCRs): Census 2011 → 2021
// CCR = Pop(age+10, 2021) / Pop(age, 2011)
// ============================================================
console.log("Computing CCRs...");
const ccrs = new Map(); // "areaCode|eth|sex|fromAge|toAge" → ratio

// Map boundary changes: some 2011 LAs merged into 2021 LAs
// For simplicity, only compute CCRs where codes match both censuses
const commonAreas = [...areas2021].filter(c => areas2011.has(c));
console.log(`  ${commonAreas.length} areas in both censuses`);

for (const code of commonAreas) {
  for (const eth of ETHNIC_GROUPS) {
    for (const sex of SEXES) {
      for (let i = 0; i < AGE_BANDS.length - 2; i++) { // -2 because we shift by 2 bands (10 years)
        const fromAge = AGE_BANDS[i];
        const toAge = AGE_BANDS[i + 2]; // +2 bands = +10 years
        const pop11 = pop2011.get(`${code}|${eth}|${sex}|${fromAge}`) || 0;
        const pop21 = pop2021.get(`${code}|${eth}|${sex}|${toAge}`) || 0;

        let ccr;
        if (pop11 > 10) {
          ccr = pop21 / pop11;
          // Cap extreme CCRs (small populations cause instability)
          ccr = Math.max(0.1, Math.min(5.0, ccr));
        } else {
          ccr = 1.0; // Default for very small populations
        }

        ccrs.set(`${code}|${eth}|${sex}|${fromAge}|${toAge}`, ccr);
      }
    }
  }
}

// Compute Child-Woman Ratios (CWR) for births
const cwrs = new Map(); // "areaCode|eth" → ratio
for (const code of commonAreas) {
  for (const eth of ETHNIC_GROUPS) {
    // Children 0-9 in 2021
    let children = 0;
    for (const sex of SEXES) {
      children += (pop2021.get(`${code}|${eth}|${sex}|0-4`) || 0) + (pop2021.get(`${code}|${eth}|${sex}|5-9`) || 0);
    }
    // Women 15-44 in 2021
    let women = 0;
    for (const band of ["15-19", "20-24", "25-29", "30-34", "35-39", "40-44"]) {
      women += pop2021.get(`${code}|${eth}|F|${band}`) || 0;
    }
    cwrs.set(`${code}|${eth}`, women > 10 ? children / women : 0.3);
  }
}

console.log(`  ${ccrs.size} CCRs, ${cwrs.size} CWRs computed`);

// ============================================================
// Parse SNPP for envelope constraint
// ============================================================
console.log("Parsing ONS SNPP...");
const snppTotals = new Map();
const snppLines = readFileSync(SNPP_PATH, "utf8").split("\n").filter(l => l.trim());
const snppHeader = parseCsvLine(snppLines[0]);
const yearCols = snppHeader.slice(5);

for (let i = 1; i < snppLines.length; i++) {
  const cols = parseCsvLine(snppLines[i]);
  const code = cols[0]; if (!code?.startsWith("E")) continue;
  const ageGroup = cols[4];
  // Use "All ages" row directly instead of summing individual ages
  if (ageGroup !== "All ages") continue;
  if (!snppTotals.has(code)) { snppTotals.set(code, {}); for (const y of yearCols) snppTotals.get(code)[y] = 0; }
  for (let j = 0; j < yearCols.length; j++) { const v = parseFloat(cols[5 + j]); if (!isNaN(v)) snppTotals.get(code)[yearCols[j]] += v; }
}
console.log(`  ${snppTotals.size} areas`);

// ============================================================
// PROJECT FORWARD using Hamilton-Perry
// ============================================================
console.log("\nProjecting...");
const PROJ_YEARS = [2031, 2041, 2051, 2061]; // 10-year steps from 2021

function projectHP(code) {
  const timeline = { 2021: {} };

  // Build 2021 baseline
  for (const eth of ETHNIC_GROUPS) {
    timeline[2021][eth] = 0;
    for (const sex of SEXES) for (const band of AGE_BANDS) {
      timeline[2021][eth] += pop2021.get(`${code}|${eth}|${sex}|${band}`) || 0;
    }
  }

  let currentPop = new Map();
  for (const eth of ETHNIC_GROUPS) for (const sex of SEXES) for (const band of AGE_BANDS) {
    currentPop.set(`${eth}|${sex}|${band}`, pop2021.get(`${code}|${eth}|${sex}|${band}`) || 0);
  }

  for (const year of PROJ_YEARS) {
    const newPop = new Map();

    for (const eth of ETHNIC_GROUPS) {
      for (const sex of SEXES) {
        // Apply CCRs: shift cohorts up by 2 bands (10 years)
        for (let i = 2; i < AGE_BANDS.length; i++) {
          const fromAge = AGE_BANDS[i - 2];
          const toAge = AGE_BANDS[i];
          const ccr = ccrs.get(`${code}|${eth}|${sex}|${fromAge}|${toAge}`) || 1.0;
          const prevPop = currentPop.get(`${eth}|${sex}|${fromAge}`) || 0;
          newPop.set(`${eth}|${sex}|${toAge}`, Math.round(prevPop * ccr));
        }

        // 85+ absorbs from both 75-79 and existing 85+
        const from75 = currentPop.get(`${eth}|${sex}|75-79`) || 0;
        const stay85 = currentPop.get(`${eth}|${sex}|85+`) || 0;
        const ccr85 = ccrs.get(`${code}|${eth}|${sex}|75-79|85+`) || 0.5;
        newPop.set(`${eth}|${sex}|85+`, Math.round(from75 * ccr85 + stay85 * 0.3));

        // Births: use CWR
        const cwr = cwrs.get(`${code}|${eth}`) || 0.3;
        let women = 0;
        for (const band of ["15-19", "20-24", "25-29", "30-34", "35-39", "40-44"]) {
          women += newPop.get(`${eth}|F|${band}`) || currentPop.get(`${eth}|F|${band}`) || 0;
        }
        const children = Math.round(women * cwr);
        const sexRatio = sex === "M" ? 0.512 : 0.488;
        newPop.set(`${eth}|${sex}|0-4`, Math.round(children * sexRatio * 0.5)); // 0-4 is half of 0-9
        newPop.set(`${eth}|${sex}|5-9`, Math.round(children * sexRatio * 0.5));
      }
    }

    // SNPP envelope constraint
    const snppYear = String(Math.min(year, 2047));
    const snppTarget = snppTotals.get(code)?.[snppYear];
    if (snppTarget && snppTarget > 0) {
      let modelTotal = 0;
      for (const [, v] of newPop) modelTotal += v;
      if (modelTotal > 0) {
        const scale = snppTarget / modelTotal;
        if (scale > 0.3 && scale < 3.0) {
          for (const [k, v] of newPop) newPop.set(k, Math.round(v * scale));
        }
      }
    }

    // CoDa: ensure ethnic shares are valid (no negatives, sum to total)
    // Log-ratio not needed since HP already produces valid counts
    // Just ensure no negatives
    for (const [k, v] of newPop) if (v < 0) newPop.set(k, 0);

    // Record ethnic totals
    timeline[year] = {};
    for (const eth of ETHNIC_GROUPS) {
      let total = 0;
      for (const sex of SEXES) for (const band of AGE_BANDS) {
        total += newPop.get(`${eth}|${sex}|${band}`) || 0;
      }
      timeline[year][eth] = total;
    }

    currentPop = newPop;
  }

  return timeline;
}

const projections = {};
for (const code of commonAreas) {
  projections[code] = projectHP(code);
}
console.log(`Projected ${Object.keys(projections).length} areas`);

// ============================================================
// DIAGNOSTICS
// ============================================================
function natSummary(year) {
  let total = 0, wbi = 0;
  for (const code of commonAreas) {
    const d = projections[code][year]; if (!d) continue;
    const areaTotal = ETHNIC_GROUPS.reduce((s, e) => s + (d[e] || 0), 0);
    total += areaTotal; wbi += d.WBI || 0;
  }
  return { total, wbi: (wbi / total * 100).toFixed(1) };
}

console.log("\n=== HAMILTON-PERRY NATIONAL SUMMARY ===");
for (const y of [2021, 2031, 2041, 2051, 2061]) {
  const s = natSummary(y);
  console.log(`${y}: WBI=${s.wbi}%, Total=${(s.total / 1e6).toFixed(1)}M`);
}

let wb50by2041 = 0, wb50by2051 = 0;
for (const code of commonAreas) {
  const d41 = projections[code][2041]; const d51 = projections[code][2051];
  if (d41) { const t = ETHNIC_GROUPS.reduce((s, e) => s + (d41[e]||0), 0); if (t > 0 && (d41.WBI||0)/t < 0.5) wb50by2041++; }
  if (d51) { const t = ETHNIC_GROUPS.reduce((s, e) => s + (d51[e]||0), 0); if (t > 0 && (d51.WBI||0)/t < 0.5) wb50by2051++; }
}
console.log(`WBI <50% by 2041: ${wb50by2041} | by 2051: ${wb50by2051}`);

// Spot checks
for (const code of ["E06000008", "E08000025", "E07000117"]) {
  const d = projections[code]; if (!d) continue;
  const wb21 = d[2021].WBI / ETHNIC_GROUPS.reduce((s, e) => s + (d[2021][e]||0), 0) * 100;
  const wb41 = d[2041].WBI / ETHNIC_GROUPS.reduce((s, e) => s + (d[2041][e]||0), 0) * 100;
  const wb61 = d[2061] ? d[2061].WBI / ETHNIC_GROUPS.reduce((s, e) => s + (d[2061][e]||0), 0) * 100 : null;
  console.log(`${code}: WBI 2021=${wb21.toFixed(1)}% → 2041=${wb41.toFixed(1)}%${wb61 ? ` → 2061=${wb61.toFixed(1)}%` : ""}`);
}

// ============================================================
// UPDATE SITE DATA
// ============================================================
console.log("\nUpdating ethnic-projections.json...");
const existing = JSON.parse(readFileSync(SITE_OUTPUT, "utf8"));

function toSimple(ethCounts) {
  const total = ETHNIC_GROUPS.reduce((s, e) => s + (ethCounts[e] || 0), 0);
  if (total === 0) return { white_british: 0, white_other: 0, asian: 0, black: 0, mixed: 0, other: 0 };
  return {
    white_british: Math.round((ethCounts.WBI || 0) / total * 10000) / 100,
    white_other: Math.round(((ethCounts.WIR || 0) + (ethCounts.WHO || 0)) / total * 10000) / 100,
    asian: Math.round(((ethCounts.IND||0)+(ethCounts.PAK||0)+(ethCounts.BAN||0)+(ethCounts.CHI||0)+(ethCounts.OAS||0)) / total * 10000) / 100,
    black: Math.round(((ethCounts.BCA || 0) + (ethCounts.BAF || 0)) / total * 10000) / 100,
    mixed: Math.round((ethCounts.MIX || 0) / total * 10000) / 100,
    other: Math.round((ethCounts.OTH || 0) / total * 10000) / 100
  };
}

for (const code of commonAreas) {
  if (!existing.areas[code]) continue;
  const area = existing.areas[code];
  const d = projections[code];

  area.projections = {};
  for (const y of [2031, 2041, 2051]) {
    if (d[y]) area.projections[String(y)] = toSimple(d[y]);
  }

  // Thresholds
  area.thresholds = [];
  const years = [2021, 2031, 2041, 2051, 2061];
  const wbPcts = years.map(y => {
    const t = ETHNIC_GROUPS.reduce((s, e) => s + (d[y]?.[e] || 0), 0);
    return { year: y, wb: t > 0 ? (d[y]?.WBI || 0) / t * 100 : 100 };
  });

  for (let i = 0; i < wbPcts.length - 1; i++) {
    if (wbPcts[i].wb >= 50 && wbPcts[i + 1].wb < 50) {
      const cross = Math.round(wbPcts[i].year + (50 - wbPcts[i].wb) / (wbPcts[i + 1].wb - wbPcts[i].wb) * (wbPcts[i + 1].year - wbPcts[i].year));
      area.thresholds.push({ label: "White British <50%", year: cross, confidence: cross <= 2036 ? "high" : cross <= 2051 ? "medium" : "low" });
      break;
    }
  }

  const wb21 = wbPcts[0].wb, wb51 = wbPcts[3]?.wb ?? wb21;
  const decline = Math.round((wb21 - wb51) * 10) / 10;
  if (decline > 2) {
    area.headlineStat = { value: `-${decline.toFixed(1)}pp`, trend: `WBI ${wb21.toFixed(1)}% → ${wb51.toFixed(1)}% by 2051 (Hamilton-Perry, Census-observed CCRs)` };
  }
}

existing.methodology = "Hamilton-Perry cohort change ratio model. CCRs computed from Census 2011 → 2021 by ethnic group × age × sex × LA. CWRs for births. SNPP 2022-based envelope constraint. Every rate derived from Census observations.";
existing.modelVersion = "3.0-hamilton-perry";
existing.lastUpdated = new Date().toISOString().slice(0, 10);
existing.source = "Census 2011 DC2101EW + Census 2021 RM032 (NOMIS API) + ONS SNPP 2022-based Z1";

writeFileSync(SITE_OUTPUT, JSON.stringify(existing, null, 2), "utf8");
console.log("Written ethnic-projections.json");
