/**
 * Cohort-Component Ethnic Population Projection Model
 *
 * Runs 9 scenario combinations (3 fertility × 3 migration) for all 318 LAs.
 * Projects from Census 2021 base to 2071 in 5-year steps.
 *
 * For each 5-year step:
 *   1. Age the population (shift cohorts up one 5-year band)
 *   2. Apply ethnic-specific survival rates (deaths)
 *   3. Add births (ethnic TFR × female population in fertile ages × age profile)
 *   4. Apply internal migration (net rates by ethnic group)
 *   5. Add international migration (scenario volume × ethnic composition × age profile)
 *
 * Output: data/model/projections.json + src/data/live/ethnic-projections.json (updated)
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const BASE_PATH = path.resolve("data/model/base_population_2021.json");
const COMPONENTS_PATH = path.resolve("data/model/components.json");
const PROJECTIONS_PATH = path.resolve("data/model/projections.json");
const SITE_OUTPUT_PATH = path.resolve("src/data/live/ethnic-projections.json");

const basePop = JSON.parse(readFileSync(BASE_PATH, "utf8"));
const components = JSON.parse(readFileSync(COMPONENTS_PATH, "utf8"));

const ETHNIC_GROUPS = basePop.ethnicGroups;
const AGE_BANDS = basePop.ageBands;
const SEXES = ["M", "F"];

const FERTILITY_SCENARIOS = ["constant", "half_convergence", "full_convergence"];
const MIGRATION_SCENARIOS = ["principal", "high_migration", "low_migration"];
const PROJECTION_YEARS = [2026, 2031, 2036, 2041, 2046, 2051, 2056, 2061, 2066, 2071];
const STEP = 5;

/**
 * Run one 5-year projection step for one area.
 */
function projectStep(areaPop, year, fertilityScenario, migrationScenario) {
  const newPop = {};

  for (const eth of ETHNIC_GROUPS) {
    newPop[eth] = {};
    for (const sex of SEXES) {
      newPop[eth][sex] = {};
      let total = 0;

      // 1. Age the population (shift up one band)
      for (let i = 0; i < AGE_BANDS.length; i++) {
        const band = AGE_BANDS[i];
        if (i === 0) {
          // First band (0-4): filled by births, calculated below
          newPop[eth][sex][band] = 0;
        } else if (i === AGE_BANDS.length - 1) {
          // Last band (85+): receives from previous band + survivors in same band
          const fromPrev = areaPop[eth][sex][AGE_BANDS[i - 1]] || 0;
          const stayInBand = areaPop[eth][sex][band] || 0;
          const survivalPrev = components.mortality[eth]?.[AGE_BANDS[i - 1]] ?? 0.99;
          const survivalStay = components.mortality[eth]?.[band] ?? 0.35;
          newPop[eth][sex][band] = Math.round(
            fromPrev * survivalPrev + stayInBand * survivalStay
          );
        } else {
          // Middle bands: survivors from previous band
          const prevBand = AGE_BANDS[i - 1];
          const prevPop = areaPop[eth][sex][prevBand] || 0;
          const survival = components.mortality[eth]?.[prevBand] ?? 0.99;
          newPop[eth][sex][band] = Math.round(prevPop * survival);
        }
      }

      // 2. Add births (only for females aged 15-49 → new 0-4 cohort)
      if (sex === "M" || sex === "F") {
        const tfr = components.fertility[fertilityScenario]?.[year]?.[eth] ??
                     components.fertility[fertilityScenario]?.[String(year)]?.[eth] ??
                     ETHNIC_TFR_FALLBACK[eth] ?? 1.6;

        // Sum females in fertile age bands
        let fertileFemalePop = 0;
        for (const [ageBand, proportion] of Object.entries(components.fertility.constant[2025] ? {} : {})) {
          // Skip — we calculate differently
        }
        // Use female pop directly from previous step
        const fertileBands = ["Aged 15 to 19 years", "Aged 20 to 24 years", "Aged 25 to 29 years",
          "Aged 30 to 34 years", "Aged 35 to 39 years", "Aged 40 to 44 years", "Aged 45 to 49 years"];

        for (const band of fertileBands) {
          fertileFemalePop += (areaPop[eth]?.F?.[band] || 0);
        }

        // Births over 5-year period: TFR × fertile females × 5 years / (sum of age-specific proportions × total fertile years)
        // Simplified: births ≈ TFR * fertile_women / 7 (7 fertile 5-year bands × proportion in each)
        // Standard formula: births_per_year = sum(ASFR(a) × female_pop(a))
        // With TFR = sum(5 × ASFR(a)), so ASFR(a) ≈ TFR × age_profile(a) / 5
        let birthsPerYear = 0;
        for (const band of fertileBands) {
          const femalePop = areaPop[eth]?.F?.[band] || 0;
          const ageProfileProp = {
            "Aged 15 to 19 years": 0.03,
            "Aged 20 to 24 years": 0.12,
            "Aged 25 to 29 years": 0.25,
            "Aged 30 to 34 years": 0.32,
            "Aged 35 to 39 years": 0.21,
            "Aged 40 to 44 years": 0.06,
            "Aged 45 to 49 years": 0.01
          }[band] || 0;
          // ASFR for this band = TFR × proportion / 5 (5-year band width)
          const asfr = (tfr * ageProfileProp) / 5;
          birthsPerYear += asfr * femalePop;
        }

        const totalBirths = Math.round(birthsPerYear * STEP);
        // Split births 50/50 male/female (slight male bias in reality ~1.05)
        const sexRatio = sex === "M" ? 0.512 : 0.488;
        newPop[eth][sex][AGE_BANDS[0]] = Math.round(totalBirths * sexRatio);
      }

      // 3. Internal migration
      const intMigRate = components.migration.internalMigrationRates[eth] ?? 0;
      for (const band of AGE_BANDS) {
        const migEffect = Math.round((newPop[eth][sex][band] || 0) * intMigRate * STEP);
        newPop[eth][sex][band] = Math.max(0, (newPop[eth][sex][band] || 0) + migEffect);
      }

      // 4. International migration
      const totalNetMigration = components.migration.internationalScenarios[migrationScenario] ?? 315000;
      const ethShare = components.migration.internationalEthnicComposition[eth] ?? 0;
      const areaShareOfNational = 1 / Object.keys(basePop.areas).length; // Simplified equal distribution
      const ethMigPerYear = totalNetMigration * ethShare * areaShareOfNational;

      for (const band of AGE_BANDS) {
        const ageShare = components.migration.internationalAgeProfile[band] ?? 0;
        const sexShare = 0.5;
        const migrants = Math.round(ethMigPerYear * ageShare * sexShare * STEP);
        newPop[eth][sex][band] = Math.max(0, (newPop[eth][sex][band] || 0) + migrants);
      }

      // Calculate total
      for (const band of AGE_BANDS) {
        total += newPop[eth][sex][band] || 0;
      }
      newPop[eth][sex].total = total;
    }
  }

  return newPop;
}

const ETHNIC_TFR_FALLBACK = { WBI: 1.55, WIR: 1.50, WHO: 1.70, MIX: 1.65, IND: 1.80, PAK: 2.45, BAN: 2.20, CHI: 1.25, OAS: 1.75, BCA: 1.60, BAF: 2.10, OTH: 1.80 };

// Run projections for all 9 scenario combinations
console.log("Running cohort-component projections...");
console.log(`  ${Object.keys(basePop.areas).length} areas × 9 scenarios × ${PROJECTION_YEARS.length} time steps`);

const allProjections = {};
const areaCodes = Object.keys(basePop.areas);

for (const fertScenario of FERTILITY_SCENARIOS) {
  for (const migScenario of MIGRATION_SCENARIOS) {
    const scenarioKey = `${fertScenario}__${migScenario}`;
    allProjections[scenarioKey] = {};

    for (const areaCode of areaCodes) {
      let currentPop = basePop.areas[areaCode];
      const areaTimeline = { 2021: summarizeArea(currentPop) };

      for (const year of PROJECTION_YEARS) {
        currentPop = projectStep(currentPop, year, fertScenario, migScenario);
        areaTimeline[year] = summarizeArea(currentPop);
      }

      allProjections[scenarioKey][areaCode] = areaTimeline;
    }
  }
}

function summarizeArea(areaPop) {
  const groups = {};
  let total = 0;

  for (const eth of ETHNIC_GROUPS) {
    let ethTotal = 0;
    for (const sex of SEXES) {
      ethTotal += areaPop[eth]?.[sex]?.total ?? 0;
    }
    groups[eth] = ethTotal;
    total += ethTotal;
  }

  // Convert to percentages
  const pct = {};
  for (const eth of ETHNIC_GROUPS) {
    pct[eth] = total > 0 ? Math.round((groups[eth] / total) * 10000) / 100 : 0;
  }

  return { total: Math.round(total), groups, pct };
}

console.log("Projections complete.");

// Generate summary stats
const centralScenario = "half_convergence__principal";
const centralData = allProjections[centralScenario];

console.log("\n=== CENTRAL SCENARIO (half convergence + principal migration) ===");
const sampleAreas = ["E06000008", "E08000025", "E07000117", "E09000002"];
for (const code of sampleAreas) {
  if (!centralData[code]) continue;
  const d = centralData[code];
  const name = code; // We don't have names in projections, use code
  console.log(`\n${code}:`);
  console.log(`  2021: WBI=${d[2021].pct.WBI}%, total=${d[2021].total.toLocaleString()}`);
  console.log(`  2041: WBI=${d[2041].pct.WBI}%, total=${d[2041].total.toLocaleString()}`);
  console.log(`  2061: WBI=${d[2061].pct.WBI}%, total=${d[2061].total.toLocaleString()}`);
}

// Count areas where WBI drops below 50% by 2051 in central scenario
let wbBelow50by2051 = 0;
let wbBelow50by2041 = 0;
for (const code of areaCodes) {
  if (centralData[code]?.[2051]?.pct?.WBI < 50) wbBelow50by2051++;
  if (centralData[code]?.[2041]?.pct?.WBI < 50) wbBelow50by2041++;
}
console.log(`\nAreas with WBI <50% by 2041: ${wbBelow50by2041}`);
console.log(`Areas with WBI <50% by 2051: ${wbBelow50by2051}`);

// Save full projections
writeFileSync(PROJECTIONS_PATH, JSON.stringify({
  generatedAt: new Date().toISOString(),
  baseYear: 2021,
  projectionYears: PROJECTION_YEARS,
  scenarios: Object.keys(allProjections),
  centralScenario,
  areaCount: areaCodes.length,
  projections: allProjections
}, null, 2), "utf8");
console.log(`\nWritten ${PROJECTIONS_PATH}`);

// ============================================================
// Generate updated ethnic-projections.json for the site
// ============================================================
console.log("\nGenerating site data...");

const existingProjections = JSON.parse(readFileSync(SITE_OUTPUT_PATH, "utf8"));

// Map NEWETHPOP groups back to our 6 simplified groups
function mapToSimplified(pct) {
  return {
    white_british: pct.WBI ?? 0,
    white_other: (pct.WIR ?? 0) + (pct.WHO ?? 0),
    asian: (pct.IND ?? 0) + (pct.PAK ?? 0) + (pct.BAN ?? 0) + (pct.CHI ?? 0) + (pct.OAS ?? 0),
    black: (pct.BCA ?? 0) + (pct.BAF ?? 0),
    mixed: pct.MIX ?? 0,
    other: pct.OTH ?? 0
  };
}

// Update each area's projections with model output
for (const areaCode of areaCodes) {
  const areaData = centralData[areaCode];
  if (!areaData || !existingProjections.areas[areaCode]) continue;

  const area = existingProjections.areas[areaCode];

  // Update projections with model output
  area.projections = {};
  for (const year of [2026, 2031, 2036, 2041, 2046, 2051]) {
    if (areaData[year]) {
      area.projections[String(year)] = mapToSimplified(areaData[year].pct);
    }
  }

  // Update thresholds based on model projections
  area.thresholds = [];
  const wbTimeline = PROJECTION_YEARS.map(y => ({
    year: y,
    wb: areaData[y]?.pct?.WBI ?? 100
  }));

  // Find WBI <50% crossing
  for (let i = 0; i < wbTimeline.length - 1; i++) {
    if (wbTimeline[i].wb >= 50 && wbTimeline[i + 1].wb < 50) {
      // Interpolate
      const y1 = wbTimeline[i].year;
      const y2 = wbTimeline[i + 1].year;
      const wb1 = wbTimeline[i].wb;
      const wb2 = wbTimeline[i + 1].wb;
      const crossYear = Math.round(y1 + (50 - wb1) / (wb2 - wb1) * (y2 - y1));
      area.thresholds.push({
        label: "White British <50%",
        year: crossYear,
        confidence: crossYear <= 2036 ? "high" : crossYear <= 2051 ? "medium" : "low"
      });
      break;
    }
  }

  // Find WBI <40% crossing
  for (let i = 0; i < wbTimeline.length - 1; i++) {
    if (wbTimeline[i].wb >= 40 && wbTimeline[i + 1].wb < 40) {
      const y1 = wbTimeline[i].year;
      const y2 = wbTimeline[i + 1].year;
      const wb1 = wbTimeline[i].wb;
      const wb2 = wbTimeline[i + 1].wb;
      const crossYear = Math.round(y1 + (40 - wb1) / (wb2 - wb1) * (y2 - y1));
      area.thresholds.push({
        label: "White British <40%",
        year: crossYear,
        confidence: crossYear <= 2036 ? "high" : crossYear <= 2051 ? "medium" : "low"
      });
      break;
    }
  }

  // Headline stat
  const wb2021 = areaData[2021]?.pct?.WBI ?? 0;
  const wb2051 = areaData[2051]?.pct?.WBI ?? wb2021;
  const decline = Math.round((wb2021 - wb2051) * 10) / 10;
  if (decline > 2) {
    area.headlineStat = {
      value: `-${decline.toFixed(1)}pp`,
      trend: `White British projected to fall from ${wb2021.toFixed(1)}% to ${wb2051.toFixed(1)}% by 2051 (cohort-component model, central scenario)`
    };
  }

  // Add scenario range
  const highDiv = allProjections["constant__high_migration"]?.[areaCode]?.[2051]?.pct?.WBI ?? wb2051;
  const lowDiv = allProjections["full_convergence__low_migration"]?.[areaCode]?.[2051]?.pct?.WBI ?? wb2051;
  area.scenarioRange2051 = {
    central: Math.round(wb2051 * 10) / 10,
    highDiversity: Math.round(highDiv * 10) / 10,
    lowDiversity: Math.round(lowDiv * 10) / 10
  };
}

// Update metadata
existingProjections.methodology = "Cohort-component model (5-year age bands, 12 ethnic groups, 2 sexes). Census 2021 base population. Ethnic-specific fertility, mortality, and migration rates. 9 scenarios (3 fertility × 3 migration). Central scenario: half fertility convergence + ONS principal migration.";
existingProjections.lastUpdated = new Date().toISOString().slice(0, 10);
existingProjections.source = "Census 2021 (ONS RM032 + TS007A via NOMIS) + NEWETHPOP methodology + ONS 2022-based SNPP assumptions";
existingProjections.modelVersion = "2.0-cohort-component";

writeFileSync(SITE_OUTPUT_PATH, JSON.stringify(existingProjections, null, 2), "utf8");
console.log(`Updated ${SITE_OUTPUT_PATH}`);
