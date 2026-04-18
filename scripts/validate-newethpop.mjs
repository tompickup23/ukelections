/**
 * NEWETHPOP Validation: Compare 2021 predictions against Census 2021 actuals.
 *
 * NEWETHPOP CSV format: row_id, LAD.name, LAD.code, ETH.group, M0..M100p, F0..F100p
 * Each row = one LA × ethnic group, with population by single year of age and sex.
 * ETH.group codes: WBI, WIR, WHO, MIX, IND, PAK, BAN, CHI, OAS, BCA, BAF, OTH
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const NEWETHPOP_CSV = path.resolve("data/raw/newethpop/extracted/2DataArchive/OutputData/Population/Population2021_LEEDS2.csv");
const CENSUS_PATH = path.resolve("src/data/live/ethnic-projections.json");
const OUTPUT_PATH = path.resolve("src/data/live/newethpop-validation.json");

// Map NEWETHPOP 12 groups to our 6 simplified groups
const GROUP_MAP = {
  WBI: "white_british",
  WIR: "white_other",
  WHO: "white_other",
  MIX: "mixed",
  IND: "asian",
  PAK: "asian",
  BAN: "asian",
  CHI: "asian",
  OAS: "asian",
  BCA: "black",
  BAF: "black",
  OTH: "other"
};

if (!existsSync(NEWETHPOP_CSV)) {
  console.error(`Not found: ${NEWETHPOP_CSV}`);
  process.exit(1);
}

// Parse NEWETHPOP CSV
console.log("Parsing NEWETHPOP Population2021_LEEDS2.csv...");
const text = readFileSync(NEWETHPOP_CSV, "utf8");
const lines = text.split("\n").filter((l) => l.trim());
const header = lines[0].split(",").map((h) => h.replace(/"/g, "").trim());

// Find column indices
const codeIdx = header.indexOf("LAD.code");
const nameIdx = header.indexOf("LAD.name");
const ethIdx = header.indexOf("ETH.group");

// Aggregate total population by area code and simplified ethnic group
const areas = new Map();

for (let i = 1; i < lines.length; i++) {
  const cols = lines[i].split(",").map((c) => c.replace(/"/g, "").trim());
  const rawCode = cols[codeIdx];
  const ethGroup = cols[ethIdx];
  const simplified = GROUP_MAP[ethGroup];

  if (!rawCode || !simplified) continue;

  // Handle merged area codes like "E09000001+E09000033"
  const areaCodes = rawCode.split("+");

  // Sum all age columns (M0..M100p and F0..F100p)
  let totalPop = 0;
  for (let j = ethIdx + 1; j < cols.length; j++) {
    const val = parseFloat(cols[j]);
    if (!isNaN(val)) totalPop += val;
  }

  // Distribute equally among merged codes (rough but reasonable)
  const popPerCode = totalPop / areaCodes.length;

  for (const areaCode of areaCodes) {
    if (!areas.has(areaCode)) {
      areas.set(areaCode, {
        name: cols[nameIdx],
        total: 0,
        white_british: 0,
        white_other: 0,
        asian: 0,
        black: 0,
        mixed: 0,
        other: 0
      });
    }
    const area = areas.get(areaCode);
    area.total += popPerCode;
    area[simplified] += popPerCode;
  }
}

console.log(`  ${areas.size} areas parsed from NEWETHPOP`);

// Load Census 2021 actuals
const census = JSON.parse(readFileSync(CENSUS_PATH, "utf8"));
console.log(`  ${Object.keys(census.areas).length} areas in Census 2021 data`);

// Compare
const validation = {
  source: "NEWETHPOP Leeds2 (ONS-aligned, 2011-based) vs Census 2021 actuals (ONS TS021)",
  generatedAt: new Date().toISOString(),
  methodology: "NEWETHPOP projected ethnic populations from 2011 Census base using cohort-component model. Census 2021 provides actual ethnic composition 10 years later. Error = predicted% - actual%.",
  summary: {},
  areas: {}
};

let totalAbsErrorWB = 0;
let totalAbsErrorAsian = 0;
let totalSquaredErrorWB = 0;
let overPredictWBCount = 0;
let comparedCount = 0;
let worstOver = { code: "", error: -Infinity };
let worstUnder = { code: "", error: Infinity };

for (const [areaCode, censusArea] of Object.entries(census.areas)) {
  const pred = areas.get(areaCode);
  if (!pred || pred.total < 100) continue;

  const actualPct = censusArea.current.groups;
  const predPct = {
    white_british: (pred.white_british / pred.total) * 100,
    white_other: (pred.white_other / pred.total) * 100,
    asian: (pred.asian / pred.total) * 100,
    black: (pred.black / pred.total) * 100,
    mixed: (pred.mixed / pred.total) * 100,
    other: (pred.other / pred.total) * 100
  };

  const errorWB = predPct.white_british - actualPct.white_british;
  const errorAsian = predPct.asian - actualPct.asian;
  const absErrorWB = Math.abs(errorWB);

  totalAbsErrorWB += absErrorWB;
  totalAbsErrorAsian += Math.abs(errorAsian);
  totalSquaredErrorWB += errorWB * errorWB;
  comparedCount++;

  if (errorWB > 0) overPredictWBCount++;
  if (errorWB > worstOver.error) worstOver = { code: areaCode, name: censusArea.areaName, error: errorWB, predicted: predPct.white_british, actual: actualPct.white_british };
  if (errorWB < worstUnder.error) worstUnder = { code: areaCode, name: censusArea.areaName, error: errorWB, predicted: predPct.white_british, actual: actualPct.white_british };

  validation.areas[areaCode] = {
    areaName: censusArea.areaName,
    predictedWB: r(predPct.white_british),
    actualWB: r(actualPct.white_british),
    errorWB: r(errorWB),
    absErrorWB: r(absErrorWB),
    predictedAsian: r(predPct.asian),
    actualAsian: r(actualPct.asian),
    errorAsian: r(errorAsian),
    predictedBlack: r(predPct.black),
    actualBlack: r(actualPct.black),
    predictedTotal: Math.round(pred.total),
    actualTotal: censusArea.current.total_population
  };
}

function r(n) { return Math.round(n * 100) / 100; }

validation.summary = {
  areasCompared: comparedCount,
  meanAbsoluteErrorWB: r(totalAbsErrorWB / comparedCount),
  meanAbsoluteErrorAsian: r(totalAbsErrorAsian / comparedCount),
  rmseWB: r(Math.sqrt(totalSquaredErrorWB / comparedCount)),
  biasDirection: overPredictWBCount > comparedCount / 2
    ? `Over-predicted WB in ${overPredictWBCount}/${comparedCount} areas (model underestimated diversity growth)`
    : `Under-predicted WB in ${comparedCount - overPredictWBCount}/${comparedCount} areas (model overestimated diversity growth)`,
  overPredictWBCount,
  underPredictWBCount: comparedCount - overPredictWBCount,
  worstOverPrediction: worstOver.code ? { ...worstOver, error: r(worstOver.error), predicted: r(worstOver.predicted), actual: r(worstOver.actual) } : null,
  worstUnderPrediction: worstUnder.code ? { ...worstUnder, error: r(worstUnder.error), predicted: r(worstUnder.predicted), actual: r(worstUnder.actual) } : null
};

console.log("\n=== NEWETHPOP VALIDATION RESULTS ===");
console.log(`Areas compared: ${comparedCount}`);
console.log(`Mean Absolute Error (WB%): ${validation.summary.meanAbsoluteErrorWB}pp`);
console.log(`Mean Absolute Error (Asian%): ${validation.summary.meanAbsoluteErrorAsian}pp`);
console.log(`RMSE (WB%): ${validation.summary.rmseWB}pp`);
console.log(`Bias: ${validation.summary.biasDirection}`);
if (worstOver.code) console.log(`Worst WB over-prediction: ${worstOver.name} (pred ${r(worstOver.predicted)}%, actual ${r(worstOver.actual)}%, error +${r(worstOver.error)}pp)`);
if (worstUnder.code) console.log(`Worst WB under-prediction: ${worstUnder.name} (pred ${r(worstUnder.predicted)}%, actual ${r(worstUnder.actual)}%, error ${r(worstUnder.error)}pp)`);

// Top 10 worst predictions
const ranked = Object.entries(validation.areas)
  .sort((a, b) => b[1].absErrorWB - a[1].absErrorWB)
  .slice(0, 15);

console.log("\nTop 15 worst WB% predictions:");
for (const [code, area] of ranked) {
  console.log(`  ${area.areaName}: predicted ${area.predictedWB}%, actual ${area.actualWB}%, error ${area.errorWB > 0 ? "+" : ""}${area.errorWB}pp`);
}

// Accuracy distribution
const errors = Object.values(validation.areas).map((a) => a.absErrorWB);
const within1pp = errors.filter((e) => e <= 1).length;
const within2pp = errors.filter((e) => e <= 2).length;
const within5pp = errors.filter((e) => e <= 5).length;
console.log(`\nAccuracy distribution:`);
console.log(`  Within 1pp: ${within1pp}/${comparedCount} (${r(within1pp/comparedCount*100)}%)`);
console.log(`  Within 2pp: ${within2pp}/${comparedCount} (${r(within2pp/comparedCount*100)}%)`);
console.log(`  Within 5pp: ${within5pp}/${comparedCount} (${r(within5pp/comparedCount*100)}%)`);

writeFileSync(OUTPUT_PATH, JSON.stringify(validation, null, 2), "utf8");
console.log(`\nWritten ${OUTPUT_PATH}`);
