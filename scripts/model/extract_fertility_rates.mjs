/**
 * Extract empirical ethnic fertility rates from ONS Linked Births 2024.
 *
 * Extracts from two tables:
 * - Table 5: births by area of residence and ethnicity (regional level)
 * - Table 8: quarterly births by ethnicity × IMD decile × age of mother
 *
 * Produces:
 * 1. Census-derived CWRs (what the HP model uses)
 * 2. Empirical TFRs from ONS 2024 birth counts / Census 2021 female population
 * 3. Age-Specific Fertility Rates (ASFRs) from Table 8 age bands
 * 4. Fertility by IMD deprivation decile
 * 5. Regional birth distribution from Table 5
 *
 * NOTE: Table 8 provides ethnicity × all, IMD × all, and age × all as separate
 * marginal summaries (not a full cross-tab). So we get empirical TFR per ethnic
 * group, ASFR by age (all ethnicities), and births by IMD (all ethnicities).
 *
 * Output: src/data/live/fertility-rates.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import xlsx from "xlsx";

const BIRTHS_2024 = path.resolve("data/raw/ons_births/2024birthslinked.xlsx");
const BASE_POP = path.resolve("data/model/base_single_year_2021.json");
const OUTPUT = path.resolve("src/data/live/fertility-rates.json");

// Map ONS birth ethnicity labels to our 6-group model
const BIRTH_ETH_MAP = {
  "Bangladeshi": "asian",
  "Indian": "asian",
  "Pakistani": "asian",
  "Any other Asian background": "asian",
  "Black African": "black",
  "Black Caribbean": "black",
  "Any other Black background": "black",
  "Mixed/multiple ethnic groups": "mixed",
  "Any other ethnic group": "other",
  "White British": "white_british",
  "Any other White background": "white_other",
  "Not stated": null
};

// Map to 20-group where possible
const BIRTH_ETH_MAP_20 = {
  "Bangladeshi": "BAN",
  "Indian": "IND",
  "Pakistani": "PAK",
  "Any other Asian background": "OAS",
  "Black African": "BAF",
  "Black Caribbean": "BCA",
  "Any other Black background": "OBL",
  "White British": "WBI",
  "Any other White background": "WHO",
  "Mixed/multiple ethnic groups": "MIX",
  "Any other ethnic group": "OOT"
};

// Age band mapping for ASFR computation
const AGE_BAND_MAP = {
  "Under 20": { label: "15-19", midpoint: 17.5, width: 5 },
  "20 to 24": { label: "20-24", midpoint: 22.5, width: 5 },
  "25 to 29": { label: "25-29", midpoint: 27.5, width: 5 },
  "30 to 34": { label: "30-34", midpoint: 32.5, width: 5 },
  "35 to 39": { label: "35-39", midpoint: 37.5, width: 5 },
  "40 to 44": { label: "40-44", midpoint: 42.5, width: 5 },
  "45 and over": { label: "45-49", midpoint: 47.5, width: 5 }
};

function safeInt(v) {
  return parseInt(String(v).replace(/,/g, "").trim()) || 0;
}

console.log("Reading ONS Linked Births 2024...");
const wb2024 = xlsx.readFile(BIRTHS_2024);

// ── TABLE 5: births by region and ethnicity ──
const table5 = xlsx.utils.sheet_to_json(wb2024.Sheets["Table_5"], { header: 1, raw: false, defval: "" });
console.log(`  Table_5: ${table5.length} rows`);

const birthsByEthnicity = {};
for (let i = 0; i < table5.length; i++) {
  const row = table5[i];
  if (!row) continue;
  const code = String(row[0] || "").trim();
  if (code !== "E92000001") continue; // England only
  const ethnicity = String(row[3] || "").trim();
  if (ethnicity === "All ethnic groups" || !ethnicity) continue;
  const births = safeInt(row[4]);
  if (births > 0 && BIRTH_ETH_MAP.hasOwnProperty(ethnicity)) {
    birthsByEthnicity[ethnicity] = births;
  }
}

let totalBirths = 0;
console.log("\nEngland-level births by ethnicity (Table 5):");
for (const [eth, births] of Object.entries(birthsByEthnicity)) {
  console.log(`  ${eth}: ${births.toLocaleString()}`);
  totalBirths += births;
}
console.log(`  Total: ${totalBirths.toLocaleString()}`);

// Also extract regional births by ethnicity
const regionalBirths = {};
for (let i = 0; i < table5.length; i++) {
  const row = table5[i];
  if (!row) continue;
  const code = String(row[0] || "").trim();
  const region = String(row[1] || "").trim();
  if (!code.startsWith("E12")) continue; // Region codes
  const ethnicity = String(row[3] || "").trim();
  if (ethnicity === "All ethnic groups" || !ethnicity) continue;
  const births = safeInt(row[4]);
  if (births > 0 && BIRTH_ETH_MAP.hasOwnProperty(ethnicity)) {
    if (!regionalBirths[region]) regionalBirths[region] = {};
    regionalBirths[region][ethnicity] = births;
  }
}

// ── TABLE 8: quarterly births by ethnicity/IMD/age ──
const table8 = xlsx.utils.sheet_to_json(wb2024.Sheets["Table_8"], { header: 1, raw: false, defval: "" });
console.log(`\n  Table_8: ${table8.length} rows`);

// Table 8 has marginal summaries (not full cross-tab):
// - Ethnicity rows: specific ethnicity, "All groups" IMD, "All ages"
// - IMD rows: "All ethnic groups", specific decile, "All ages"
// - Age rows: "All ethnic groups", "All groups" IMD, specific age band

// Sum across all 4 quarters for annual totals
const annualBirthsByEthnicity = {};  // ethnicity → annual births
const annualBirthsByIMD = {};        // decile → annual births
const annualBirthsByAge = {};        // age band → annual births

for (let i = 6; i < table8.length; i++) {
  const row = table8[i];
  const [quarter, eth, imd, age, gest, mats, liveBirths] = row;
  if (!quarter || !eth) continue;
  const births = safeInt(liveBirths);
  if (births === 0) continue;

  // Only use "All gestational ages" rows to avoid double-counting
  if (gest && gest !== "All gestational ages") continue;

  // Ethnicity marginal: specific ethnicity, all IMD, all ages
  if (eth !== "All ethnic groups" && eth !== "Not stated" &&
      imd === "All groups" && age === "All ages") {
    annualBirthsByEthnicity[eth] = (annualBirthsByEthnicity[eth] || 0) + births;
  }

  // IMD marginal: all ethnicities, specific decile, all ages
  if (eth === "All ethnic groups" && imd !== "All groups" && age === "All ages") {
    annualBirthsByIMD[imd] = (annualBirthsByIMD[imd] || 0) + births;
  }

  // Age marginal: all ethnicities, all IMD, specific age band
  if (eth === "All ethnic groups" && imd === "All groups" &&
      age !== "All ages" && age !== "Not stated" && AGE_BAND_MAP[age]) {
    annualBirthsByAge[age] = (annualBirthsByAge[age] || 0) + births;
  }
}

console.log("\nTable 8 annual births by ethnicity (4 quarters summed):");
for (const [eth, births] of Object.entries(annualBirthsByEthnicity)) {
  console.log(`  ${eth}: ${births.toLocaleString()}`);
}

// ── Load Census 2021 base population ──
console.log("\nLoading Census 2021 female population for TFR computation...");
const basePop = JSON.parse(readFileSync(BASE_POP, "utf8"));

// Compute national female population by age band and ethnic group
const femalePop = {};       // eth → total women 15-44
const femalePopByAge = {};  // age band label → total women
const childPop = {};        // eth → children 0-4

for (const [code, area] of Object.entries(basePop.areas)) {
  for (const eth of basePop.ethnicGroups) {
    const femData = area[eth]?.F;
    if (!femData) continue;

    if (!femalePop[eth]) femalePop[eth] = 0;
    if (!childPop[eth]) childPop[eth] = 0;

    for (let age = 15; age <= 44; age++) {
      femalePop[eth] += femData[age] || 0;
    }
    for (let age = 0; age <= 4; age++) {
      childPop[eth] += (area[eth]?.M?.[age] || 0) + (femData[age] || 0);
    }
  }

  // Also compute national women by 5-year age band (all ethnicities)
  for (const [ageBand, info] of Object.entries(AGE_BAND_MAP)) {
    const startAge = info.midpoint - 2.5;
    const endAge = info.midpoint + 2.5;
    let women = 0;
    for (const eth of basePop.ethnicGroups) {
      const femData = area[eth]?.F;
      if (!femData) continue;
      for (let age = Math.round(startAge); age < Math.round(endAge); age++) {
        women += femData[age] || 0;
      }
    }
    femalePopByAge[info.label] = (femalePopByAge[info.label] || 0) + women;
  }
}

// ── Compute Census CWRs (what model uses) ──
console.log("\nCensus 2021 CWRs (model basis):");
const censusCWR = {};
for (const eth of basePop.ethnicGroups) {
  const women = femalePop[eth] || 0;
  const children = childPop[eth] || 0;
  censusCWR[eth] = women > 0 ? Math.round(children / women * 10000) / 10000 : 0;
  if (censusCWR[eth] > 0) {
    const approxTFR = Math.round(censusCWR[eth] * 30 / 5 * 100) / 100;
    console.log(`  ${eth}: CWR=${censusCWR[eth]} (approx TFR ≈ ${approxTFR})`);
  }
}

// ── Compute empirical TFRs by ethnic group ──
console.log("\nEmpirical TFRs from ONS 2024 births:");
const empiricalTFR = {};
const empiricalTFRDetail = {};
for (const [onsEth, births] of Object.entries(annualBirthsByEthnicity)) {
  const modelEth = BIRTH_ETH_MAP_20[onsEth];
  if (!modelEth || !femalePop[modelEth]) {
    // For groups that map to aggregate (MIX), skip detailed TFR
    if (modelEth === "MIX") {
      // Sum all mixed sub-group female pop
      const mixedWomen = ["MWA", "MWF", "MWC", "MOM"].reduce((s, e) => s + (femalePop[e] || 0), 0);
      if (mixedWomen > 0) {
        const tfr = Math.round(births / mixedWomen * 30 * 100) / 100;
        empiricalTFR["MIX"] = tfr;
        empiricalTFRDetail["MIX"] = { births, women: Math.round(mixedWomen), tfr, onsLabel: onsEth };
        console.log(`  ${onsEth} (MIX): ${births.toLocaleString()} / ${Math.round(mixedWomen).toLocaleString()} women = TFR ${tfr}`);
      }
    }
    continue;
  }

  const women = femalePop[modelEth];
  // TFR ≈ annual births / women(15-44) × 30 (years of childbearing window)
  const tfr = Math.round(births / women * 30 * 100) / 100;
  empiricalTFR[modelEth] = tfr;
  empiricalTFRDetail[modelEth] = { births, women: Math.round(women), tfr, onsLabel: onsEth };
  console.log(`  ${onsEth} (${modelEth}): ${births.toLocaleString()} / ${Math.round(women).toLocaleString()} women = TFR ${tfr}`);
}

// Also compute 6-group aggregate TFRs
const sixGroupTFR = {};
const sixGroupMap = {
  white_british: ["WBI"],
  white_other: ["WIR", "WGT", "WRO", "WHO"],
  asian: ["IND", "PAK", "BAN", "CHI", "OAS"],
  black: ["BAF", "BCA", "OBL"],
  mixed: ["MWA", "MWF", "MWC", "MOM"],
  other: ["ARB", "OOT"]
};
for (const [group, codes] of Object.entries(sixGroupMap)) {
  // For mixed, births are reported as aggregate "MIX" not per sub-group
  if (group === "mixed" && empiricalTFRDetail["MIX"]) {
    sixGroupTFR[group] = empiricalTFRDetail["MIX"].tfr;
    continue;
  }
  const groupBirths = codes.reduce((s, c) => s + (empiricalTFRDetail[c]?.births || 0), 0);
  const groupWomen = codes.reduce((s, c) => s + (femalePop[c] || 0), 0);
  if (groupWomen > 0) {
    sixGroupTFR[group] = Math.round(groupBirths / groupWomen * 30 * 100) / 100;
  }
}
console.log("\n6-group TFRs:", sixGroupTFR);

// ── Compute national ASFRs by age band ──
console.log("\nAge-Specific Fertility Rates (all ethnicities, England 2024):");
const totalWomen15_44 = Object.values(femalePopByAge).reduce((s, v) => s + v, 0);
const totalAnnualBirths = Object.values(annualBirthsByAge).reduce((s, v) => s + v, 0);
const nationalASFR = {};
let computedTFR = 0;
for (const [ageBand, info] of Object.entries(AGE_BAND_MAP)) {
  const births = annualBirthsByAge[ageBand] || 0;
  const women = femalePopByAge[info.label] || 1;
  // ASFR = births / women in that age band (annual rate)
  const asfr = Math.round(births / women * 10000) / 10000;
  nationalASFR[info.label] = asfr;
  computedTFR += asfr * info.width;
  console.log(`  ${info.label}: ${births.toLocaleString()} births / ${Math.round(women).toLocaleString()} women = ASFR ${asfr} (${(asfr * 1000).toFixed(1)} per 1000)`);
}
computedTFR = Math.round(computedTFR * 100) / 100;
console.log(`  Computed national TFR: ${computedTFR}`);

// ── Births by IMD deprivation decile ──
console.log("\nBirths by IMD deprivation decile (all ethnicities, 2024):");
const fertilityByIMD = {};
const totalIMDBirths = Object.values(annualBirthsByIMD).reduce((s, v) => s + v, 0);
for (const [decile, births] of Object.entries(annualBirthsByIMD)) {
  const decileNum = parseInt(decile.replace("Decile ", ""));
  const pctOfBirths = Math.round(births / totalIMDBirths * 1000) / 10;
  fertilityByIMD[decile] = { births, pctOfBirths, decile: decileNum };
  console.log(`  ${decile}: ${births.toLocaleString()} (${pctOfBirths}% of births)`);
}

// Compute deprivation gradient (most deprived quintile vs least)
const q1Births = (annualBirthsByIMD["Decile 1"] || 0) + (annualBirthsByIMD["Decile 2"] || 0);
const q5Births = (annualBirthsByIMD["Decile 9"] || 0) + (annualBirthsByIMD["Decile 10"] || 0);
const deprivationRatio = Math.round(q1Births / Math.max(q5Births, 1) * 100) / 100;
console.log(`\n  Most deprived quintile: ${q1Births.toLocaleString()} births`);
console.log(`  Least deprived quintile: ${q5Births.toLocaleString()} births`);
console.log(`  Ratio: ${deprivationRatio}x`);

// ── Regional birth shares ──
const regionalShares = {};
for (const [region, eths] of Object.entries(regionalBirths)) {
  const total = Object.values(eths).reduce((s, v) => s + v, 0);
  const wbi = eths["White British"] || 0;
  regionalShares[region] = {
    totalBirths: total,
    wbiPct: Math.round(wbi / total * 1000) / 10,
    nonWbiPct: Math.round((total - wbi) / total * 1000) / 10
  };
}

// ── Build output ──
const output = {
  generatedAt: new Date().toISOString(),
  source: "ONS Births Linked 2024 (Tables 5 & 8) + Census 2021 custom dataset",
  methodology: "Census-derived CWRs computed as Children(0-4) / Women(15-44) per ethnic group per LA. The HP model uses these directly. Empirical TFRs computed from ONS 2024 annual births / Census 2021 women(15-44) × 30. ASFRs from Table 8 age band marginals. IMD fertility gradient from Table 8 deprivation marginals.",
  censusCWR,
  empiricalTFR,
  empiricalTFRDetail,
  sixGroupTFR,
  nationalASFR,
  nationalTFR: computedTFR,
  totalBirths2024: totalAnnualBirths,
  fertilityByIMD,
  deprivationGradient: {
    mostDeprivedQuintileBirths: q1Births,
    leastDeprivedQuintileBirths: q5Births,
    ratio: deprivationRatio,
    insight: `Women in the most deprived quintile have ${deprivationRatio}x more births than the least deprived. This deprivation gradient is a major driver of apparent ethnic fertility differentials — Pakistani and Bangladeshi populations are concentrated in deprived areas.`
  },
  regionalBirthShares: regionalShares,
  onsBirths2024ByEthnicity: birthsByEthnicity,
  note: "The v6.0 HP model uses Census-derived CWRs per LA per ethnic group — NOT hardcoded TFRs. These empirical ONS 2024 rates serve as independent validation and calibration data. Table 8 provides ethnicity, IMD, and age as separate marginals (not a full ethnicity × IMD × age cross-tab). The full cross-tab would be needed to compute ethnic-specific ASFRs by deprivation — this requires an ONS ad-hoc request or indirect estimation."
};

writeFileSync(OUTPUT, JSON.stringify(output, null, 2), "utf8");
console.log(`\nWritten ${OUTPUT}`);
