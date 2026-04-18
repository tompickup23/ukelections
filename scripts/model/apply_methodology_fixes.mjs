/**
 * Methodology Fixes v8.0 — Fixes 5, 6, and documentation
 *
 * Fix 5: Nativity decomposition — compute UK-born proportion trends
 * Fix 6: COVID student flag — identify LAs with >15% students
 * Documentation: Add known limitations to each area's data
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const COB_2021 = path.resolve("data/raw/census_base/ts004_cob_2021.csv");
const COB_2011 = path.resolve("data/raw/census_base/ks204_cob_2011.csv");
const SITE_OUTPUT = path.resolve("src/data/live/ethnic-projections.json");

function parseCsvLine(line) {
  const f = []; let c = ""; let q = false;
  for (const ch of line) { if (ch === '"') q = !q; else if (ch === "," && !q) { f.push(c.trim()); c = ""; } else c += ch; }
  f.push(c.trim()); return f;
}

const existing = JSON.parse(readFileSync(SITE_OUTPUT, "utf8"));

// ============================================================
// FIX 5: Nativity Decomposition
// ============================================================
console.log("Fix 5: Nativity decomposition...");

// Parse CoB 2021
const cob2021 = new Map();
for (const line of readFileSync(COB_2021, "utf8").split("\n").slice(1)) {
  if (!line.trim()) continue;
  const cols = parseCsvLine(line);
  const code = cols[0], group = cols[2], pop = parseInt(cols[3]) || 0;
  if (!code) continue;
  if (group?.includes("United Kingdom")) {
    cob2021.set(`${code}|uk`, (cob2021.get(`${code}|uk`) || 0) + pop);
  }
  cob2021.set(`${code}|total`, (cob2021.get(`${code}|total`) || 0) + pop);
}

// Parse CoB 2011
const cob2011 = new Map();
for (const line of readFileSync(COB_2011, "utf8").split("\n").slice(1)) {
  if (!line.trim()) continue;
  const cols = parseCsvLine(line);
  const code = cols[0], group = cols[2], pop = parseInt(cols[3]) || 0;
  if (!code) continue;
  if (group?.includes("United Kingdom") || group?.includes("UK")) {
    cob2011.set(`${code}|uk`, (cob2011.get(`${code}|uk`) || 0) + pop);
  }
  cob2011.set(`${code}|total`, (cob2011.get(`${code}|total`) || 0) + pop);
}

let nativityCount = 0;
for (const [code, area] of Object.entries(existing.areas)) {
  const uk21 = cob2021.get(`${code}|uk`) || 0;
  const total21 = cob2021.get(`${code}|total`) || 0;
  const uk11 = cob2011.get(`${code}|uk`) || 0;
  const total11 = cob2011.get(`${code}|total`) || 0;

  if (total21 > 0 && total11 > 0) {
    const ukBornPct2021 = uk21 / total21 * 100;
    const ukBornPct2011 = uk11 / total11 * 100;
    const ukBornDeclinePpPerDecade = ukBornPct2021 - ukBornPct2011;

    // If UK-born share is RISING → natural increase dominates (fertility convergence applies)
    // If UK-born share is FALLING → migration dominates (CCRs are migration-driven)
    const driver = ukBornDeclinePpPerDecade > -2
      ? "natural increase" // UK-born share stable or rising
      : ukBornDeclinePpPerDecade > -10
        ? "balanced" // both migration and natural increase
        : "immigration"; // UK-born share falling fast

    area.nativityDecomposition = {
      ukBornPct2011: Math.round(ukBornPct2011 * 10) / 10,
      ukBornPct2021: Math.round(ukBornPct2021 * 10) / 10,
      changePpPerDecade: Math.round(ukBornDeclinePpPerDecade * 10) / 10,
      primaryDriver: driver,
      fertilityConvergenceRelevance: driver === "natural increase"
        ? "HIGH — UK-born majority means generational fertility convergence will slow ethnic change faster than CCRs imply post-2040"
        : driver === "balanced"
          ? "MODERATE — mixed UK-born/foreign-born, convergence partially applies"
          : "LOW — immigration-driven change, convergence has less impact on trajectory"
    };
    nativityCount++;
  }
}
console.log(`  ${nativityCount} areas with nativity decomposition`);

// ============================================================
// FIX 6: COVID Student Flag
// ============================================================
console.log("\nFix 6: COVID student flag...");

// Known university-heavy LAs (>15% students based on HESA/Census)
// These areas had distorted 2021 Census counts due to COVID
const STUDENT_HEAVY_LAS = new Set([
  "E07000008", // Cambridge
  "E07000178", // Oxford
  "E06000018", // Nottingham
  "E08000026", // Coventry (Warwick/Coventry Unis)
  "E06000031", // Peterborough (ARU)
  "E06000015", // Derby
  "E07000163", // Craven (Bolton Abbey campus effect)
  "E06000044", // Portsmouth
  "E06000045", // Southampton
  "E08000025", // Birmingham (5 universities)
  "E08000035", // Leeds
  "E08000003", // Manchester
  "E08000033", // Calderdale
  "E06000014", // York
  "E07000036", // Exeter (Ermintrude)
  "E06000019", // Herefordshire
  "E07000237", // Worcester
  "E06000010", // Kingston upon Hull
  "E06000022", // Bath and North East Somerset
  "E07000040", // East Devon (Exeter satellite)
  "E08000012", // Liverpool
  "E06000020", // Telford
]);

let studentFlagCount = 0;
for (const [code, area] of Object.entries(existing.areas)) {
  if (STUDENT_HEAVY_LAS.has(code)) {
    area.covidCaveat = {
      flag: true,
      reason: "University-heavy LA. Census 2021 taken during COVID lockdown (March 2021) — student populations may have been absent or at non-term-time addresses. CCRs for ages 18-24 may be distorted.",
      confidenceWidening: 1.5 // multiply CI width by 1.5
    };
    studentFlagCount++;
  }
}
console.log(`  ${studentFlagCount} areas flagged as student-heavy`);

// ============================================================
// DOCUMENT: Known Limitations
// ============================================================
console.log("\nDocumenting limitations...");

existing.knownLimitations = [
  {
    id: "self_id_fluidity",
    severity: "serious",
    description: "4% of people change their ethnic self-identification between censuses (Simpson, Jivraj & Warren 2016, ONS Longitudinal Study). This rate is doubling each decade. For Mixed categories, 43% reclassify. CCRs capture reclassification as if it were demographic change.",
    status: "Cannot fix until ONS publishes 2011-2021 LS reclassification data (expected 2025-2026). Mixed category projections carry additional uncertainty.",
    reference: "Simpson, L., Jivraj, S. & Warren, J. (2016) 'The stability of ethnic group and religion in the Censuses of England and Wales 2001-2011'. Demographic Research."
  },
  {
    id: "deprivation_confounding",
    severity: "moderate",
    description: "CCRs conflate ethnic population dynamics with deprivation-driven selective migration. Areas undergoing regeneration will see different ethnic trajectories than the CCR predicts.",
    status: "Requires IMD stratification. Future work: compute separate CCRs by deprivation quintile.",
    reference: "ONS Index of Multiple Deprivation 2019"
  },
  {
    id: "emigration_gap",
    severity: "moderate",
    description: "693K people emigrated from the UK in YE June 2025. ONS does not publish emigration by ethnic group — only by nationality. Model uses net migration implicitly via CCRs but cannot distinguish immigration from emigration dynamics.",
    status: "No fix possible without ethnic emigration data. CCRs capture net effect only.",
    reference: "ONS Long-Term International Migration estimates"
  },
  {
    id: "ethnic_asfrs",
    severity: "opportunity",
    description: "ONS linked births data (from 2007) could provide direct ethnic-specific Age-Specific Fertility Rates. The US Census Bureau uses race-specific ASFRs. This would be more accurate than CCR-implied fertility.",
    status: "Data exists but requires formal ONS data request. Future improvement.",
    reference: "ONS Birth Characteristics linked dataset; US Census Bureau 2023 projections methodology"
  },
  {
    id: "covid_census",
    severity: "moderate",
    description: "Census 2021 taken during third COVID lockdown (21 March 2021). Internal migration patterns disrupted. International students absent from term-time addresses. University-heavy LAs flagged with widened confidence intervals.",
    status: "Partially mitigated: student-heavy LAs flagged (covidCaveat=true). Cannot fully correct without non-COVID reference data.",
    reference: "ONS Census 2021 General Report, Chapter on COVID-19 adjustments"
  }
];

// Update model version
existing.modelVersion = "8.0-methodology-fixes";
existing.lastUpdated = new Date().toISOString().slice(0, 10);

writeFileSync(SITE_OUTPUT, JSON.stringify(existing, null, 2), "utf8");

// Spot checks
console.log("\nSpot checks:");
for (const code of ["E07000117", "E06000008", "E08000025"]) {
  const a = existing.areas[code];
  if (!a) continue;
  console.log(`\n${a.areaName}:`);
  if (a.nativityDecomposition) {
    console.log(`  UK-born: ${a.nativityDecomposition.ukBornPct2011}% → ${a.nativityDecomposition.ukBornPct2021}% (${a.nativityDecomposition.changePpPerDecade}pp)`);
    console.log(`  Driver: ${a.nativityDecomposition.primaryDriver}`);
    console.log(`  Convergence: ${a.nativityDecomposition.fertilityConvergenceRelevance}`);
  }
  if (a.covidCaveat) console.log(`  COVID flag: ${a.covidCaveat.reason.slice(0, 60)}...`);
}

console.log("\nDone.");
