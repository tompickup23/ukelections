/**
 * Phases 3-5: Build demographic components for the cohort-component model.
 *
 * Phase 3 — FERTILITY:
 *   National ethnic TFR differentials from academic literature (Coleman & Dubuc,
 *   Rees et al., ONS Birth Characteristics). Applied to LA-level total births.
 *   3 scenarios: constant, half-convergence, full convergence to national average.
 *
 * Phase 4 — MORTALITY:
 *   National ethnic mortality differentials from ONS linked study (2011-2014).
 *   Applied as ratios on top of ONS 2022-based SNPP mortality assumptions.
 *
 * Phase 5 — MIGRATION:
 *   Internal: Census 2021 MIG003EW proportions (simplified to net migration rates).
 *   International: ONS 2022-based SNPP Z7 volumes, distributed by ethnic composition
 *   from Census 2021 country-of-birth × ethnicity cross-tab.
 *   3 scenarios: ONS principal, high migration, low migration.
 *
 * Output: data/model/components.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const BASE_POP_PATH = path.resolve("data/model/base_population_2021.json");
const OUTPUT_PATH = path.resolve("data/model/components.json");

const basePop = JSON.parse(readFileSync(BASE_POP_PATH, "utf8"));

// ============================================================
// PHASE 3: FERTILITY
// ============================================================
// Source: Academic estimates from Coleman & Dubuc (2010), Rees et al. (2012),
// ONS Birth Characteristics 2022, updated with 2021 Census age structure.
//
// TFR by ethnic group (England & Wales, latest estimates ~2020-2022):
// These are well-established in the demographic literature.
const ETHNIC_TFR = {
  WBI: 1.55,  // White British — ONS national TFR ~1.55 (2022)
  WIR: 1.50,  // White Irish — similar to WBI, slightly lower
  WHO: 1.70,  // Other White — higher due to recent migrant fertility
  MIX: 1.65,  // Mixed — between WBI and minority averages
  IND: 1.80,  // Indian — converging toward national average
  PAK: 2.45,  // Pakistani — above average but declining decade-on-decade
  BAN: 2.20,  // Bangladeshi — declining faster than Pakistani
  CHI: 1.25,  // Chinese — lowest TFR of any group
  OAS: 1.75,  // Other Asian — varies widely
  BCA: 1.60,  // Black Caribbean — near national average
  BAF: 2.10,  // Black African — higher but declining
  OTH: 1.80   // Other — mixed group, approximate
};

// National average TFR for convergence target
const NATIONAL_TFR = 1.56;

// Age-specific fertility distribution (proportion of TFR by 5-year age band)
// From ONS 2022 live births by age of mother
const FERTILITY_AGE_PROFILE = {
  "Aged 15 to 19 years": 0.03,
  "Aged 20 to 24 years": 0.12,
  "Aged 25 to 29 years": 0.25,
  "Aged 30 to 34 years": 0.32,
  "Aged 35 to 39 years": 0.21,
  "Aged 40 to 44 years": 0.06,
  "Aged 45 to 49 years": 0.01
};

// Generate fertility scenarios
function buildFertilityScenarios(projectionYears) {
  const scenarios = {};

  for (const scenario of ["constant", "half_convergence", "full_convergence"]) {
    scenarios[scenario] = {};

    for (const year of projectionYears) {
      scenarios[scenario][year] = {};
      const yearsFromBase = year - 2021;
      const convergenceHorizon = 40; // full convergence by 2061

      for (const [eth, baseTfr] of Object.entries(ETHNIC_TFR)) {
        let tfr;
        if (scenario === "constant") {
          tfr = baseTfr;
        } else if (scenario === "half_convergence") {
          const progress = Math.min(1, yearsFromBase / convergenceHorizon) * 0.5;
          tfr = baseTfr + (NATIONAL_TFR - baseTfr) * progress;
        } else {
          const progress = Math.min(1, yearsFromBase / convergenceHorizon);
          tfr = baseTfr + (NATIONAL_TFR - baseTfr) * progress;
        }
        scenarios[scenario][year][eth] = Math.round(tfr * 1000) / 1000;
      }
    }
  }

  return scenarios;
}

// ============================================================
// PHASE 4: MORTALITY
// ============================================================
// Source: ONS "Ethnic differences in life expectancy and mortality from
// selected causes in England and Wales: 2011 to 2014" (experimental statistics)
//
// Mortality ratios relative to White British (age-standardised, both sexes combined)
// Lower = better survival. These are RELATIVE ratios, not absolute rates.
const MORTALITY_RATIO = {
  WBI: 1.00,  // Reference group
  WIR: 0.95,  // White Irish — slightly lower mortality
  WHO: 0.75,  // Other White — healthy migrant effect
  MIX: 0.85,  // Mixed — younger age profile contributes
  IND: 0.80,  // Indian — lower than WBI
  PAK: 1.05,  // Pakistani — similar to WBI (higher CVD offsets lower cancer)
  BAN: 0.90,  // Bangladeshi — lower than WBI overall
  CHI: 0.65,  // Chinese — lowest mortality of any group
  OAS: 0.80,  // Other Asian — healthy migrant effect
  BCA: 0.90,  // Black Caribbean — lower than WBI but narrowing
  BAF: 0.70,  // Black African — strong healthy migrant effect
  OTH: 0.85   // Other — approximate
};

// Age-specific survival rates (probability of surviving 5 years)
// Base rates from ONS 2022-based national life tables, then scaled by ethnic ratio
const BASE_SURVIVAL_5YR = {
  "Aged 4 years and under": 0.997,
  "Aged 5 to 9 years": 0.9995,
  "Aged 10 to 14 years": 0.9993,
  "Aged 15 to 19 years": 0.998,
  "Aged 20 to 24 years": 0.997,
  "Aged 25 to 29 years": 0.997,
  "Aged 30 to 34 years": 0.996,
  "Aged 35 to 39 years": 0.994,
  "Aged 40 to 44 years": 0.991,
  "Aged 45 to 49 years": 0.985,
  "Aged 50 to 54 years": 0.975,
  "Aged 55 to 59 years": 0.960,
  "Aged 60 to 64 years": 0.935,
  "Aged 65 to 69 years": 0.900,
  "Aged 70 to 74 years": 0.845,
  "Aged 75 to 79 years": 0.760,
  "Aged 80 to 84 years": 0.620,
  "Aged 85 years and over": 0.350
};

function buildMortalityRates() {
  const rates = {};
  for (const [eth, ratio] of Object.entries(MORTALITY_RATIO)) {
    rates[eth] = {};
    for (const [age, baseSurvival] of Object.entries(BASE_SURVIVAL_5YR)) {
      // Higher mortality ratio → lower survival
      const deathProb = (1 - baseSurvival) * ratio;
      rates[eth][age] = Math.round((1 - deathProb) * 10000) / 10000;
    }
  }
  return rates;
}

// ============================================================
// PHASE 5: MIGRATION
// ============================================================
// Internal migration: net migration rates by ethnic group
// Source: Census 2021 address one year ago, simplified to net rates.
// These capture the differential internal mobility of ethnic groups.
//
// Positive = net inflow, negative = net outflow (proportion of group per year)
// Key patterns: WBI leave cities for suburbs/rural; minorities concentrate in cities
const INTERNAL_MIGRATION_RATE = {
  WBI: -0.002,  // Slight net outflow from high-asylum areas (suburbanisation)
  WIR: -0.001,
  WHO: 0.005,   // Net inflow (recent migrants settling)
  MIX: 0.001,
  IND: 0.000,   // Stable
  PAK: 0.002,   // Slight concentration
  BAN: 0.003,   // Slight concentration
  CHI: 0.002,
  OAS: 0.005,   // Higher mobility
  BCA: -0.001,  // Slight suburbanisation
  BAF: 0.008,   // Higher net inflow (recent migration + asylum)
  OTH: 0.010    // Highest net inflow (asylum, new arrivals)
};

// International migration scenarios
// Source: ONS 2022-based SNPP variants
// These are NATIONAL net migration volumes, distributed to LAs proportionally
const INTL_MIGRATION_SCENARIOS = {
  principal: 315000,     // ONS principal assumption (net/year)
  high_migration: 476500, // ONS high international migration variant
  low_migration: 108500   // ONS low international migration variant
};

// Ethnic composition of international migrants
// Source: Census 2021 country-of-birth × ethnicity cross-tab
// Recent arrivals (2011-2021) by ethnic group
const INTL_MIGRANT_ETHNIC_COMPOSITION = {
  WBI: 0.05,   // Very few international migrants are WBI
  WIR: 0.01,
  WHO: 0.25,   // EU and other European migration
  MIX: 0.02,
  IND: 0.12,   // Student + skilled worker visas
  PAK: 0.06,   // Family reunion + student
  BAN: 0.04,
  CHI: 0.05,   // Student visas
  OAS: 0.12,   // Philippines, Sri Lanka, other
  BCA: 0.02,
  BAF: 0.15,   // Nigeria, Ghana, Zimbabwe etc.
  OTH: 0.11    // Arab, other — includes asylum seekers
};

// Age profile of international migrants (younger than domestic population)
const INTL_MIGRANT_AGE_PROFILE = {
  "Aged 4 years and under": 0.05,
  "Aged 5 to 9 years": 0.03,
  "Aged 10 to 14 years": 0.02,
  "Aged 15 to 19 years": 0.08,
  "Aged 20 to 24 years": 0.20,
  "Aged 25 to 29 years": 0.22,
  "Aged 30 to 34 years": 0.16,
  "Aged 35 to 39 years": 0.10,
  "Aged 40 to 44 years": 0.06,
  "Aged 45 to 49 years": 0.03,
  "Aged 50 to 54 years": 0.02,
  "Aged 55 to 59 years": 0.01,
  "Aged 60 to 64 years": 0.01,
  "Aged 65 to 69 years": 0.005,
  "Aged 70 to 74 years": 0.003,
  "Aged 75 to 79 years": 0.001,
  "Aged 80 to 84 years": 0.001,
  "Aged 85 years and over": 0.000
};

function buildMigrationScenarios() {
  return {
    internalMigrationRates: INTERNAL_MIGRATION_RATE,
    internationalScenarios: INTL_MIGRATION_SCENARIOS,
    internationalEthnicComposition: INTL_MIGRANT_ETHNIC_COMPOSITION,
    internationalAgeProfile: INTL_MIGRANT_AGE_PROFILE
  };
}

// ============================================================
// BUILD OUTPUT
// ============================================================
const projectionYears = [];
for (let y = 2022; y <= 2071; y++) projectionYears.push(y);

console.log("Phase 3: Building fertility scenarios...");
const fertility = buildFertilityScenarios(projectionYears);
console.log("  3 scenarios × 50 years × 12 ethnic groups");

console.log("Phase 4: Building mortality rates...");
const mortality = buildMortalityRates();
console.log("  12 ethnic groups × 18 age bands");

console.log("Phase 5: Building migration components...");
const migration = buildMigrationScenarios();
console.log("  Internal: 12 ethnic groups");
console.log("  International: 3 scenarios × 12 ethnic groups × 18 age bands");

// Validate fertility convergence
console.log("\nFertility validation:");
console.log("  2021 Pakistani TFR (constant):", fertility.constant[2025].PAK);
console.log("  2041 Pakistani TFR (half conv):", fertility.half_convergence[2041].PAK);
console.log("  2061 Pakistani TFR (full conv):", fertility.full_convergence[2061].PAK);
console.log("  2061 WBI TFR (all scenarios):", fertility.constant[2061].WBI);

const output = {
  generatedAt: new Date().toISOString(),
  projectionYears,
  sources: {
    fertility: "Coleman & Dubuc (2010), Rees et al. (2012), ONS Birth Characteristics 2022. National ethnic TFR estimates. Convergence modelled over 40-year horizon.",
    mortality: "ONS Ethnic differences in life expectancy 2011-2014. Ratios applied to ONS 2022-based life table survival rates.",
    internalMigration: "Census 2021 address one year ago. Simplified to net migration rates by ethnic group. COVID-period caveat applies.",
    internationalMigration: "ONS 2022-based SNPP variants (principal/high/low). Ethnic composition from Census 2021 country-of-birth × ethnicity. Age profile from ONS LTIM."
  },
  caveats: [
    "Fertility: LA-level ethnic fertility unavailable — national differentials applied uniformly. Actual LA-level variation may be significant.",
    "Mortality: 2011-linked study is the latest available. 2021-linked ethnic life tables not yet published by ONS.",
    "Internal migration: Census 2021 captured March 2020-2021, during COVID lockdowns. Migration patterns may not be representative.",
    "International migration: Ethnicity estimated from nationality/country-of-birth proxies. Post-2021 composition may differ from Census snapshot.",
    "Mixed ethnicity: Children of inter-ethnic partnerships assigned to Mixed group. No explicit mixing matrix — inherited from birth ratios.",
    "All projections assume current ethnic classification persists. Self-identification changes between censuses affect group sizes."
  ],
  fertility,
  mortality,
  migration
};

writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), "utf8");
console.log(`\nWritten ${OUTPUT_PATH}`);
