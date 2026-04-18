/**
 * Validate ethnic projections against DfE School Census 2024/25.
 *
 * The school census is the ONLY annual inter-censal ethnic signal at LA level.
 * Children in primary school (ages 4-10) in 2024/25 were born 2014-2020.
 * Children in secondary school (ages 11-15) in 2024/25 were born 2009-2013.
 *
 * This script compares our Census 2021 ethnic composition of children
 * against the observed DfE 2024/25 school enrollment by ethnicity.
 *
 * If our projections claim 30% Asian children in Burnley but schools show 35%,
 * the CCRs for young cohorts need adjustment.
 *
 * Output: src/data/live/school-validation.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const DFE_CSV = path.resolve("data/raw/dfe_schools/spc_pupils_ethnicity_and_language.csv");
const PROJECTIONS = path.resolve("src/data/live/ethnic-projections.json");
const BASE_POP = path.resolve("data/model/base_single_year_2021.json");
const OUTPUT = path.resolve("src/data/live/school-validation.json");

// Map DfE ethnicity categories to our 6-group model
const ETH_MAP = {
  "White - White British": "white_british",
  "White - Irish": "white_other",
  "White - Gypsy/Roma": "white_other",
  "White - Traveller of Irish heritage": "white_other",
  "White - Any other White background": "white_other",
  "Asian - Bangladeshi": "asian",
  "Asian - Indian": "asian",
  "Asian - Pakistani": "asian",
  "Asian - Chinese": "asian",
  "Asian - Any other Asian background": "asian",
  "Black - Black African": "black",
  "Black - Black Caribbean": "black",
  "Black - Any other Black background": "black",
  "Mixed - White and Asian": "mixed",
  "Mixed - White and Black African": "mixed",
  "Mixed - White and Black Caribbean": "mixed",
  "Mixed - Any other Mixed background": "mixed",
  "Any other ethnic group": "other"
};

// Also build a 12-group breakdown for detailed comparison
const ETH_MAP_DETAIL = {
  "White - White British": "WBI",
  "White - Irish": "WIR",
  "White - Gypsy/Roma": "WHO",
  "White - Traveller of Irish heritage": "WHO",
  "White - Any other White background": "WHO",
  "Asian - Bangladeshi": "BAN",
  "Asian - Indian": "IND",
  "Asian - Pakistani": "PAK",
  "Asian - Chinese": "CHI",
  "Asian - Any other Asian background": "OAS",
  "Black - Black African": "BAF",
  "Black - Black Caribbean": "BCA",
  "Black - Any other Black background": "OTH",
  "Mixed - White and Asian": "MIX",
  "Mixed - White and Black African": "MIX",
  "Mixed - White and Black Caribbean": "MIX",
  "Mixed - Any other Mixed background": "MIX",
  "Any other ethnic group": "OTH"
};

console.log("Loading DfE school census data...");
const csv = readFileSync(DFE_CSV, "utf8");
const lines = csv.split("\n").filter(l => l.trim());

// Parse school data by LA, phase, and year
// phase_type_grouping column (index 10): Total, State-funded primary, State-funded secondary, etc.
// We want 'Total' for all schools and also primary/secondary separately
const schoolByLA = {};  // code → { total, groups, primary: {total, groups}, secondary: {total, groups} }

for (let i = 1; i < lines.length; i++) {
  const cols = lines[i].split(",");
  if (cols[0] !== "202425" || cols[2] !== "Local authority") continue;

  const laCode = cols[9]?.trim();
  const phase = cols[10]?.trim();
  const ethnicity = cols[11]?.trim();
  const language = cols[12]?.trim();
  const headcount = parseInt(cols[13]) || 0;

  // Only total language (not split by English/other)
  if (language !== "Total") continue;
  if (!laCode || !laCode.startsWith("E")) continue;

  const group = ETH_MAP[ethnicity];
  const detailGroup = ETH_MAP_DETAIL[ethnicity];
  if (!group) continue;

  if (!schoolByLA[laCode]) {
    schoolByLA[laCode] = {
      total: 0, groups: {}, detail: {},
      primary: { total: 0, groups: {}, detail: {} },
      secondary: { total: 0, groups: {}, detail: {} }
    };
  }

  const la = schoolByLA[laCode];

  // Aggregate by phase
  if (phase === "Total") {
    la.groups[group] = (la.groups[group] || 0) + headcount;
    la.total += headcount;
    if (detailGroup) la.detail[detailGroup] = (la.detail[detailGroup] || 0) + headcount;
  } else if (phase === "State-funded primary") {
    la.primary.groups[group] = (la.primary.groups[group] || 0) + headcount;
    la.primary.total += headcount;
    if (detailGroup) la.primary.detail[detailGroup] = (la.primary.detail[detailGroup] || 0) + headcount;
  } else if (phase === "State-funded secondary") {
    la.secondary.groups[group] = (la.secondary.groups[group] || 0) + headcount;
    la.secondary.total += headcount;
    if (detailGroup) la.secondary.detail[detailGroup] = (la.secondary.detail[detailGroup] || 0) + headcount;
  }
}

console.log(`Parsed ${Object.keys(schoolByLA).length} LAs from DfE data`);

// Load our ethnic projections (Census 2021 base)
console.log("Loading ethnic projections...");
const projections = JSON.parse(readFileSync(PROJECTIONS, "utf8"));

// Load Census 2021 age-specific ethnic base (from HP model)
// This gives us ethnic composition for ages 4-15 specifically
console.log("Loading Census 2021 single-year base...");
let basePop = null;
try {
  basePop = JSON.parse(readFileSync(BASE_POP, "utf8"));
  console.log(`  ${basePop.areaCount} areas in base population`);
} catch (e) {
  console.log("  WARNING: base_single_year_2021.json not found. Using total pop comparison only.");
}

// Map 20-group model codes to our 6-group output categories
const MODEL_TO_6 = {
  WBI: "white_british", WIR: "white_other", WGT: "white_other", WRO: "white_other", WHO: "white_other",
  MWA: "mixed", MWF: "mixed", MWC: "mixed", MOM: "mixed",
  MIX: "mixed",  // backwards compat with 12-group
  IND: "asian", PAK: "asian", BAN: "asian", CHI: "asian", OAS: "asian",
  BAF: "black", BCA: "black", OBL: "black",
  ARB: "other", OOT: "other", OTH: "other"
};

// Extract Census 2021 ethnic composition for school-age children (ages 4-15)
// This is the correct comparison population for DfE school data
function getCensusChildEthnicity(areaCode) {
  if (!basePop?.areas?.[areaCode]) return null;
  const areaData = basePop.areas[areaCode];
  const groups6 = {};
  let total = 0;
  for (const eth of basePop.ethnicGroups) {
    const g6 = MODEL_TO_6[eth];
    if (!g6) continue;
    for (const sex of ["M", "F"]) {
      const sexData = areaData[eth]?.[sex];
      if (!sexData) continue;
      // Ages 4-15 = school-age children in Census 2021
      // Primary: 4-10, Secondary: 11-15
      for (let age = 4; age <= 15; age++) {
        const pop = sexData[String(age)] || 0;
        groups6[g6] = (groups6[g6] || 0) + pop;
        total += pop;
      }
    }
  }
  if (total < 100) return null;
  // Convert to percentages
  const pcts = {};
  for (const [g, c] of Object.entries(groups6)) {
    pcts[g] = Math.round(c / total * 1000) / 10;
  }
  return { total, groups: pcts };
}

// Compare: for each LA, compare Census 2021 child ethnic shares with DfE 2024/25
const validationResults = [];
const groups = ["white_british", "white_other", "asian", "black", "mixed", "other"];
// Separate error tracking for age-specific (proper) and total-pop (naive) comparisons
const errors = { ageSpecific: [], totalPop: [], byGroup: {}, byGroupAge: {} };
for (const g of groups) { errors.byGroup[g] = []; errors.byGroupAge[g] = []; }

for (const [code, area] of Object.entries(projections.areas)) {
  const school = schoolByLA[code];
  if (!school || school.total < 500) continue;
  if (!area.current?.groups) continue;

  // Exclude "Unclassified" pupils from denominators
  const unclassifiedCount = school.total - Object.values(school.groups).reduce((s, v) => s + v, 0);
  const classifiedTotal = school.total - Math.max(0, unclassifiedCount);
  const unclassifiedPct = school.total > 0 ? Math.round(unclassifiedCount / school.total * 1000) / 10 : 0;

  const result = {
    areaCode: code,
    areaName: area.areaName,
    totalPupils: school.total,
    classifiedPupils: classifiedTotal,
    unclassifiedPct,
    primaryPupils: school.primary.total,
    secondaryPupils: school.secondary.total,
    comparison: {},     // vs Census 2021 ages 4-15 (proper comparison)
    comparisonTotalPop: {},  // vs Census 2021 total pop (naive, for context)
    primaryComparison: {},
    secondaryComparison: {}
  };

  // Get age-specific Census data
  const censusChildren = getCensusChildEthnicity(code);

  // Proper comparison: school 2024/25 vs Census 2021 ages 4-15
  for (const g of groups) {
    const schoolPct = classifiedTotal > 0 ? Math.round(((school.groups[g] || 0) / classifiedTotal) * 1000) / 10 : 0;
    const censusPopPct = area.current.groups[g] || 0;
    const censusChildPct = censusChildren?.groups?.[g] || null;

    // Age-specific comparison (the meaningful one)
    if (censusChildPct !== null) {
      const gap = Math.round((schoolPct - censusChildPct) * 10) / 10;
      result.comparison[g] = {
        schoolPct,
        censusChildPct,
        gapPp: gap,
        direction: gap > 2 ? "schools_higher" : gap < -2 ? "census_higher" : "aligned"
      };
      errors.byGroupAge[g].push(Math.abs(gap));
      errors.ageSpecific.push(Math.abs(gap));
    }

    // Total-pop comparison (naive, for context)
    const gapTotal = Math.round((schoolPct - censusPopPct) * 10) / 10;
    result.comparisonTotalPop[g] = {
      schoolPct,
      censusPopPct,
      gapPp: gapTotal
    };
    errors.byGroup[g].push(Math.abs(gapTotal));
    errors.totalPop.push(Math.abs(gapTotal));
  }

  // Primary schools (ages 4-10, born 2014-2020 — younger cohort)
  if (school.primary.total > 200) {
    for (const g of groups) {
      const schoolPct = school.primary.total > 0 ? Math.round(((school.primary.groups[g] || 0) / school.primary.total) * 1000) / 10 : 0;
      result.primaryComparison[g] = { schoolPct };
    }
  }

  // Secondary schools (ages 11-15, born 2009-2013 — older cohort)
  if (school.secondary.total > 200) {
    for (const g of groups) {
      const schoolPct = school.secondary.total > 0 ? Math.round(((school.secondary.groups[g] || 0) / school.secondary.total) * 1000) / 10 : 0;
      result.secondaryComparison[g] = { schoolPct };
    }
  }

  // Primary vs Secondary gap = demographic pipeline signal
  if (school.primary.total > 200 && school.secondary.total > 200) {
    const priWBI = (school.primary.groups["white_british"] || 0) / school.primary.total * 100;
    const secWBI = (school.secondary.groups["white_british"] || 0) / school.secondary.total * 100;
    result.pipelineGap = {
      primaryWBIPct: Math.round(priWBI * 10) / 10,
      secondaryWBIPct: Math.round(secWBI * 10) / 10,
      gapPp: Math.round((priWBI - secWBI) * 10) / 10,
      signal: priWBI < secWBI - 3
        ? "Accelerating diversification — primary schools are significantly more diverse than secondary."
        : priWBI > secWBI + 3
          ? "Slowing diversification — primary schools are less diverse than secondary."
          : "Stable demographic pipeline."
    };
  }

  validationResults.push(result);
}

// Compute aggregate validation statistics
const mae = (arr) => arr.length ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length * 100) / 100 : null;
const rmse = (arr) => arr.length ? Math.round(Math.sqrt(arr.reduce((s, v) => s + v * v, 0) / arr.length) * 100) / 100 : null;

const stats = {
  areaCount: validationResults.length,
  ageSpecificMAE: mae(errors.ageSpecific),
  ageSpecificRMSE: rmse(errors.ageSpecific),
  totalPopMAE: mae(errors.totalPop),
  totalPopRMSE: rmse(errors.totalPop),
  note: "Age-specific comparison (Census 2021 ages 4-15 vs DfE 2024/25) is the valid comparison. Total-pop comparison is provided for context only — it shows the expected structural gap between younger and older cohorts.",
  byGroupAgeSpecific: {},
  byGroupTotalPop: {}
};

for (const g of groups) {
  stats.byGroupAgeSpecific[g] = {
    mae: mae(errors.byGroupAge[g]),
    rmse: rmse(errors.byGroupAge[g])
  };
  stats.byGroupTotalPop[g] = {
    mae: mae(errors.byGroup[g]),
    rmse: rmse(errors.byGroup[g])
  };
}

// Find most and least accurate areas (using age-specific comparison)
const areaErrors = validationResults.map(r => {
  const errs = groups.map(g => Math.abs(r.comparison[g]?.gapPp || r.comparisonTotalPop[g]?.gapPp || 0));
  return { code: r.areaCode, name: r.areaName, meanError: mae(errs) };
}).sort((a, b) => a.meanError - b.meanError);

stats.bestAreas = areaErrors.slice(0, 10).map(a => ({ name: a.name, code: a.code, meanError: a.meanError }));
stats.worstAreas = areaErrors.slice(-10).reverse().map(a => ({ name: a.name, code: a.code, meanError: a.meanError }));

// Schools where WBI pupils are <50% (minority WBI in schools)
const minorityWBISchools = validationResults
  .filter(r => (r.comparison.white_british?.schoolPct || 100) < 50)
  .sort((a, b) => (a.comparison.white_british?.schoolPct || 100) - (b.comparison.white_british?.schoolPct || 100));

stats.minorityWBISchoolCount = minorityWBISchools.length;
stats.minorityWBISchools = minorityWBISchools.slice(0, 30).map(r => ({
  name: r.areaName,
  code: r.areaCode,
  schoolWBIPct: r.comparison.white_british?.schoolPct ?? r.comparisonTotalPop.white_british?.schoolPct,
  censusChildWBIPct: r.comparison.white_british?.censusChildPct ?? null,
  censusPopWBIPct: r.comparisonTotalPop.white_british?.censusPopPct,
  totalPupils: r.totalPupils
}));

// Biggest pipeline gaps (primary much more diverse than secondary = fast change)
const pipelineAlerts = validationResults
  .filter(r => r.pipelineGap && r.pipelineGap.gapPp < -5)
  .sort((a, b) => a.pipelineGap.gapPp - b.pipelineGap.gapPp);

stats.acceleratingDiversification = pipelineAlerts.slice(0, 20).map(r => ({
  name: r.areaName,
  code: r.areaCode,
  primaryWBIPct: r.pipelineGap.primaryWBIPct,
  secondaryWBIPct: r.pipelineGap.secondaryWBIPct,
  gapPp: r.pipelineGap.gapPp
}));

// National totals
let natPupils = 0, natWBI = 0, natAsian = 0, natBlack = 0;
for (const d of Object.values(schoolByLA)) {
  natPupils += d.total;
  natWBI += d.groups["white_british"] || 0;
  natAsian += d.groups["asian"] || 0;
  natBlack += d.groups["black"] || 0;
}
stats.national = {
  totalPupils: natPupils,
  wbiPct: Math.round(natWBI / natPupils * 1000) / 10,
  asianPct: Math.round(natAsian / natPupils * 1000) / 10,
  blackPct: Math.round(natBlack / natPupils * 1000) / 10
};

const output = {
  generatedAt: new Date().toISOString(),
  source: "DfE School Census 2024/25 (spc_pupils_ethnicity_and_language.csv)",
  methodology: "Primary comparison: Census 2021 ethnic composition of ages 4-15 vs DfE 2024/25 school enrollment by LA (like-for-like). Secondary comparison: Census 2021 total population vs schools (shows structural age gap). The age-specific comparison validates whether our Census-derived ethnic base for young cohorts aligns with independently observed school data 3 years later. A 3-year gap (Census 2021 → DfE 2024/25) means some divergence is expected from births, migration, and demographic change since the Census.",
  validationStats: stats,
  areas: validationResults
};

writeFileSync(OUTPUT, JSON.stringify(output, null, 2), "utf8");

// Print summary
console.log(`\nSchool Census Validation Summary`);
console.log(`================================`);
console.log(`Areas compared: ${stats.areaCount}`);
console.log(`\nAge-specific (Census 2021 ages 4-15 vs DfE 2024/25):`);
console.log(`  MAE: ${stats.ageSpecificMAE}pp | RMSE: ${stats.ageSpecificRMSE}pp`);
console.log(`  By group:`);
for (const g of groups) {
  console.log(`    ${g}: MAE ${stats.byGroupAgeSpecific[g].mae}pp`);
}
console.log(`\nTotal-pop (Census 2021 all ages vs DfE 2024/25) — structural gap expected:`);
console.log(`  MAE: ${stats.totalPopMAE}pp | RMSE: ${stats.totalPopRMSE}pp`);
console.log(`  By group:`);
for (const g of groups) {
  console.log(`    ${g}: MAE ${stats.byGroupTotalPop[g].mae}pp`);
}
console.log(`\nNational: ${natPupils.toLocaleString()} pupils, ${stats.national.wbiPct}% WBI`);
console.log(`\nMinority-WBI schools: ${stats.minorityWBISchoolCount} LAs`);
for (const s of stats.minorityWBISchools.slice(0, 10)) {
  console.log(`  ${s.name}: ${s.schoolWBIPct}% WBI in schools (Census child: ${s.censusChildWBIPct ?? 'N/A'}%, Census pop: ${s.censusPopWBIPct}%)`);
}
console.log(`\nAccelerating diversification (primary >> secondary):`);
for (const s of stats.acceleratingDiversification.slice(0, 5)) {
  console.log(`  ${s.name}: primary ${s.primaryWBIPct}% WBI, secondary ${s.secondaryWBIPct}% WBI (${s.gapPp}pp)`);
}
console.log(`\nBest-validated areas (lowest error):`);
for (const s of stats.bestAreas.slice(0, 5)) {
  console.log(`  ${s.name}: ${s.meanError}pp mean error`);
}
console.log(`\nWorst-validated areas (highest error):`);
for (const s of stats.worstAreas.slice(0, 5)) {
  console.log(`  ${s.name}: ${s.meanError}pp mean error`);
}
console.log(`\nOutput: ${OUTPUT}`);
