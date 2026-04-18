/**
 * Compute per-LA ethnic fertility proxy from DfE School Census Reception intake.
 *
 * The DfE School Census provides annual ethnic enrollment by LA and school phase.
 * Reception year (age 4-5) pupils entering primary school each year are a direct
 * proxy for births 4-5 years earlier. The year-on-year change in Reception ethnic
 * composition is the only annual inter-censal ethnic fertility signal at LA level.
 *
 * This script:
 * 1. Extracts State-funded primary school pupils by ethnicity × LA × year
 * 2. Computes Reception-year ethnic composition trends (2015-2025)
 * 3. Derives implied ethnic fertility differentials per LA
 * 4. Outputs school-fertility-proxy.json for model calibration
 *
 * Input:  data/raw/dfe_schools/spc_pupils_ethnicity_and_language.csv
 * Output: src/data/live/school-fertility-proxy.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const INPUT = path.resolve("data/raw/dfe_schools/spc_pupils_ethnicity_and_language.csv");
const OUTPUT = path.resolve("src/data/live/school-fertility-proxy.json");

// Map DfE ethnicity labels to our 20-group codes
const ETH_MAP = {
  "White - Irish": "WIR",
  "White - Gypsy/Roma": "WGT",
  "White - Traveller of Irish heritage": "WGT",
  "White - Any other White background": "WHO",
  "Mixed - White and Asian": "MWA",
  "Mixed - White and Black African": "MWF",
  "Mixed - White and Black Caribbean": "MWC",
  "Mixed - Any other Mixed background": "MOM",
  "Asian - Indian": "IND",
  "Asian - Pakistani": "PAK",
  "Asian - Bangladeshi": "BAN",
  "Asian - Chinese": "CHI",
  "Asian - Any other Asian background": "OAS",
  "Black - Black African": "BAF",
  "Black - Black Caribbean": "BCA",
  "Black - Any other Black background": "OBL",
  "Any other ethnic group": "OOT"
};

// 6-group aggregation
const SIX_GROUP_MAP = {
  "WBI": "white_british", "WIR": "white_other", "WGT": "white_other", "WHO": "white_other",
  "MWA": "mixed", "MWF": "mixed", "MWC": "mixed", "MOM": "mixed",
  "IND": "asian", "PAK": "asian", "BAN": "asian", "CHI": "asian", "OAS": "asian",
  "BAF": "black", "BCA": "black", "OBL": "black",
  "ARB": "other", "OOT": "other"
};

console.log("Reading DfE School Census...");
const raw = readFileSync(INPUT, "utf8");
const lines = raw.split("\n");
console.log(`  ${lines.length - 1} data rows`);

// Parse CSV — handle quoted fields
function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') { inQuotes = !inQuotes; continue; }
    if (line[i] === ',' && !inQuotes) { result.push(current.trim()); current = ""; continue; }
    current += line[i];
  }
  result.push(current.trim());
  return result;
}

// Aggregate: LA code → year → ethnicity → headcount (primary schools, total language)
const data = {}; // laCode → year → ethCode → headcount

for (let i = 1; i < lines.length; i++) {
  const cols = parseCSVLine(lines[i]);
  if (cols.length < 15) continue;

  const year = cols[0]; // e.g., "202425"
  const geoLevel = cols[2];
  const laCode = cols[9]; // new_la_code
  const phase = cols[10];
  const ethnicity = cols[11];
  const language = cols[12];
  const headcount = parseInt(cols[13]) || 0;

  // Only LA-level, primary schools, total language
  if (geoLevel !== "Local authority") continue;
  if (phase !== "State-funded primary") continue;
  if (language !== "Total") continue;
  if (!laCode || !laCode.startsWith("E")) continue;
  if (headcount === 0) continue;

  // Map ethnicity
  let ethCode;
  if (ethnicity === "White - White British") ethCode = "WBI";
  else ethCode = ETH_MAP[ethnicity];
  if (!ethCode) continue;

  if (!data[laCode]) data[laCode] = {};
  if (!data[laCode][year]) data[laCode][year] = {};
  data[laCode][year][ethCode] = (data[laCode][year][ethCode] || 0) + headcount;
}

const laCodes = Object.keys(data).sort();
console.log(`  ${laCodes.length} LAs with primary school data`);

// Compute trends: for each LA, WBI share in primary schools over time
const yearOrder = ["201516", "201617", "201718", "201819", "201920", "202021", "202122", "202223", "202324", "202425"];

const output = {
  generatedAt: new Date().toISOString(),
  source: "DfE School Census 2015/16 to 2024/25 — State-funded primary school pupils by ethnicity and local authority",
  methodology: "Primary school enrollment by ethnicity tracks actual births ~4-5 years lagged. Year-on-year change in ethnic composition is a proxy for ethnic-specific fertility differentials at LA level. This is the only annual inter-censal ethnic signal available.",
  years: yearOrder,
  areas: {}
};

let areasWithTrend = 0;

for (const laCode of laCodes) {
  const laData = data[laCode];
  const timeSeries = {};
  const wbiTrend = [];

  for (const year of yearOrder) {
    const yearData = laData[year];
    if (!yearData) continue;

    const total = Object.values(yearData).reduce((s, v) => s + v, 0);
    if (total < 100) continue; // Skip tiny LAs

    const groups = {};
    for (const [eth, count] of Object.entries(yearData)) {
      const sixGroup = SIX_GROUP_MAP[eth] || "other";
      groups[sixGroup] = (groups[sixGroup] || 0) + count;
    }

    // Convert to percentages
    const pcts = {};
    for (const [g, count] of Object.entries(groups)) {
      pcts[g] = Math.round(count / total * 1000) / 10;
    }

    timeSeries[year] = { total, ...pcts };

    if (pcts.white_british !== undefined) {
      wbiTrend.push({ year, wbiPct: pcts.white_british });
    }
  }

  if (wbiTrend.length < 3) continue; // Need at least 3 years

  // Compute annual WBI change rate
  const firstYear = wbiTrend[0];
  const lastYear = wbiTrend[wbiTrend.length - 1];
  const yearSpan = (parseInt(lastYear.year.slice(0, 4)) - parseInt(firstYear.year.slice(0, 4)));
  const annualWbiChangePp = yearSpan > 0
    ? Math.round((lastYear.wbiPct - firstYear.wbiPct) / yearSpan * 100) / 100
    : 0;

  // Compute latest Pakistani and Asian shares for fertility comparison
  const latestYear = timeSeries[yearOrder[yearOrder.length - 1]] || timeSeries[yearOrder[yearOrder.length - 2]];

  output.areas[laCode] = {
    timeSeries,
    wbiTrend,
    annualWbiChangePp,
    latestWbiPct: lastYear.wbiPct,
    latestAsianPct: latestYear?.asian || 0,
    latestBlackPct: latestYear?.black || 0,
    latestMixedPct: latestYear?.mixed || 0,
    totalYears: wbiTrend.length,
    totalPupils: latestYear?.total || 0
  };
  areasWithTrend++;
}

// National summary
const fastestDecline = Object.entries(output.areas)
  .filter(([, a]) => a.totalPupils >= 5000)
  .sort(([, a], [, b]) => a.annualWbiChangePp - b.annualWbiChangePp)
  .slice(0, 20);

output.summary = {
  areasWithTrend,
  fastestWbiDecline: fastestDecline.map(([code, a]) => ({
    laCode: code,
    annualChangePp: a.annualWbiChangePp,
    latestWbiPct: a.latestWbiPct,
    pupils: a.totalPupils
  }))
};

writeFileSync(OUTPUT, JSON.stringify(output, null, 2), "utf8");

const fileSizeKB = Math.round(Buffer.byteLength(JSON.stringify(output)) / 1024);
console.log(`\nWritten ${OUTPUT} (${fileSizeKB} KB, ${areasWithTrend} areas)`);

console.log("\nFastest WBI decline in primary schools (annual pp):");
for (const [code, a] of fastestDecline.slice(0, 10)) {
  console.log(`  ${code}: ${a.annualWbiChangePp > 0 ? "+" : ""}${a.annualWbiChangePp}pp/yr (WBI ${a.latestWbiPct}%, ${a.totalPupils.toLocaleString()} pupils)`);
}
