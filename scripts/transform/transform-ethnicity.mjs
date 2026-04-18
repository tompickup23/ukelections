/**
 * Transform ONS Census 2011 & 2021 ethnicity data into ethnic-projections.json
 * for ALL local authorities that appear in local-route-latest.json.
 *
 * Input:  data/raw/census_ethnicity/census_2021_ethnicity.csv
 *         data/raw/census_ethnicity/census_2011_ethnicity.csv
 * Output: src/data/live/ethnic-projections.json
 *
 * Method: Linear extrapolation of 2011→2021 decadal percentage-point change
 * rates per ethnic group, projected to 2030/2040/2050.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const routeDataPath = path.resolve("src/data/live/local-route-latest.json");
const csv2021Path = path.resolve("data/raw/census_ethnicity/census_2021_ethnicity.csv");
const csv2011Path = path.resolve("data/raw/census_ethnicity/census_2011_ethnicity.csv");
const outputPath = path.resolve("src/data/live/ethnic-projections.json");

// Load route data to get the list of area codes and names
const routeData = JSON.parse(readFileSync(routeDataPath, "utf8"));
const areaLookup = new Map(routeData.areas.map((a) => [a.areaCode, a.areaName]));

/**
 * Map detailed ONS ethnic group names to our 6 simplified categories.
 * Census 2021 uses TS021 categories; Census 2011 uses KS201/QS211 categories.
 */
function mapEthnicGroup(groupName) {
  const name = groupName.toLowerCase().trim();

  // Total / all categories
  if (name === "total" || name === "total: all usual residents" || name.includes("all categories")) return "total";

  // Skip parent/summary rows (Census 2021 has both parent + child rows)
  // Parent rows are exact matches — children have ": subcategory" suffix
  const PARENT_ROWS = new Set([
    "white",
    "asian",
    "black",
    "mixed or multiple ethnic groups",
    "other ethnic group",
    "asian, asian british or asian welsh",
    "black, black british, black welsh, caribbean or african",
    // 2011 parent rows
    "mixed/multiple ethnic groups",
    "asian/asian british",
    "black/african/caribbean/black british"
  ]);
  if (PARENT_ROWS.has(name)) return null;

  // White British (the specific detailed row)
  if (name.includes("english") || name.includes("welsh, scottish") ||
      name.includes("northern irish") ||
      name === "white: english/welsh/scottish/northern irish/british") return "white_british";

  // White Other (Irish, Gypsy, Roma, Other White)
  if (name.includes("irish") || name.includes("gypsy") || name.includes("roma") ||
      name.includes("other white")) return "white_other";

  // Asian (Indian, Pakistani, Bangladeshi, Chinese, Other Asian)
  if (name.includes("indian") || name.includes("pakistani") || name.includes("bangladeshi") ||
      name.includes("chinese") || name.includes("other asian")) return "asian";

  // Black (African, Caribbean, Other Black)
  if (name.includes("african") || name.includes("caribbean") ||
      name.includes("other black")) return "black";

  // Mixed (all mixed sub-categories)
  if (name.includes("white and black") || name.includes("white and asian") ||
      name.includes("other mixed")) return "mixed";

  // Other
  if (name.includes("arab") || name.includes("any other ethnic")) return "other";

  // Unrecognized
  return null;
}

/**
 * Parse CSV with proper quoted-field handling (fields containing commas).
 */
function parseCsvLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }

  fields.push(current.trim());
  return fields;
}

function parseCensusCsv(csvText) {
  const lines = csvText.split("\n").filter((l) => l.trim());
  const header = parseCsvLine(lines[0]);

  const codeIdx = header.findIndex((h) => h === "GEOGRAPHY_CODE");
  const nameIdx = header.findIndex((h) => h === "GEOGRAPHY_NAME");
  const groupIdx = header.findIndex((h) => h.includes("ETH") || h.includes("ETHPUK") || h.includes("CELL_NAME"));
  const valueIdx = header.findIndex((h) => h === "OBS_VALUE");

  if (codeIdx < 0 || valueIdx < 0) {
    throw new Error(`Missing required columns. Header: ${header.join(", ")}`);
  }

  // Aggregate by area code → { total, white_british, white_other, asian, black, mixed, other }
  const areas = new Map();

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const areaCode = cols[codeIdx];
    const groupName = cols[groupIdx];
    const value = parseFloat(cols[valueIdx]);

    if (!areaCode || isNaN(value)) continue;

    const category = mapEthnicGroup(groupName);
    if (!category) continue;

    if (!areas.has(areaCode)) {
      areas.set(areaCode, {
        areaCode,
        areaName: cols[nameIdx] || "",
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
    if (category === "total") {
      area.total = value;
    } else {
      area[category] += value;
    }
  }

  return areas;
}

function computePercentages(area) {
  const total = area.total || (area.white_british + area.white_other + area.asian + area.black + area.mixed + area.other);
  if (total === 0) return null;

  return {
    white_british: round((area.white_british / total) * 100),
    white_other: round((area.white_other / total) * 100),
    asian: round((area.asian / total) * 100),
    black: round((area.black / total) * 100),
    mixed: round((area.mixed / total) * 100),
    other: round((area.other / total) * 100)
  };
}

function round(n) {
  return Math.round(n * 100) / 100;
}

function projectYear(baseline, current, targetYear) {
  const span = 10; // 2011 → 2021
  const yearsFromCurrent = targetYear - 2021;
  const groups = {};

  for (const key of ["white_british", "white_other", "asian", "black", "mixed", "other"]) {
    const annualChange = (current[key] - baseline[key]) / span;
    groups[key] = round(Math.max(0, Math.min(100, current[key] + annualChange * yearsFromCurrent)));
  }

  // Normalize to 100%
  const sum = Object.values(groups).reduce((a, b) => a + b, 0);
  if (sum > 0 && Math.abs(sum - 100) > 0.1) {
    const factor = 100 / sum;
    for (const key of Object.keys(groups)) {
      groups[key] = round(groups[key] * factor);
    }
  }

  return groups;
}

function findThresholds(baseline, current) {
  const thresholds = [];
  const annualWbChange = (current.white_british - baseline.white_british) / 10;

  if (annualWbChange >= 0) return thresholds; // WB not declining

  // WB < 50%
  if (current.white_british > 50) {
    const yearsTo50 = (50 - current.white_british) / annualWbChange;
    const year = Math.round(2021 + yearsTo50);
    if (year > 2021 && year <= 2100) {
      thresholds.push({
        label: "White British <50%",
        year,
        confidence: year <= 2035 ? "high" : year <= 2050 ? "medium" : "low"
      });
    }
  }

  // WB < 40%
  if (current.white_british > 40) {
    const yearsTo40 = (40 - current.white_british) / annualWbChange;
    const year = Math.round(2021 + yearsTo40);
    if (year > 2021 && year <= 2100) {
      thresholds.push({
        label: "White British <40%",
        year,
        confidence: year <= 2035 ? "high" : year <= 2050 ? "medium" : "low"
      });
    }
  }

  // WB < 30%
  if (current.white_british > 30) {
    const yearsTo30 = (30 - current.white_british) / annualWbChange;
    const year = Math.round(2021 + yearsTo30);
    if (year > 2021 && year <= 2100) {
      thresholds.push({
        label: "White British <30%",
        year,
        confidence: year <= 2035 ? "high" : year <= 2050 ? "medium" : "low"
      });
    }
  }

  return thresholds;
}

// Parse CSV files
console.log("Parsing Census 2021 data...");
const areas2021 = parseCensusCsv(readFileSync(csv2021Path, "utf8"));
console.log(`  ${areas2021.size} areas parsed`);

console.log("Parsing Census 2011 data...");
const areas2011 = parseCensusCsv(readFileSync(csv2011Path, "utf8"));
console.log(`  ${areas2011.size} areas parsed`);

// Build projections for all areas that exist in route data AND have Census data
const output = {
  source: "ONS Census 2011 & 2021 — TS021 / KS201 ethnic group by local authority",
  methodology: "Linear extrapolation of 2011-2021 decadal percentage-point change rates per ethnic group",
  lastUpdated: new Date().toISOString().slice(0, 10),
  areas: {}
};

let matched = 0;
let skipped2021 = 0;
let skipped2011 = 0;
let skippedCalc = 0;

for (const [areaCode, areaName] of areaLookup) {
  const raw2021 = areas2021.get(areaCode);
  const raw2011 = areas2011.get(areaCode);

  if (!raw2021) {
    skipped2021++;
    continue;
  }

  const pct2021 = computePercentages(raw2021);
  if (!pct2021) {
    skippedCalc++;
    continue;
  }

  // If no 2011 data, still include 2021 snapshot but skip projections
  const pct2011 = raw2011 ? computePercentages(raw2011) : null;

  const annualChangePp = {};
  if (pct2011) {
    for (const key of ["white_british", "white_other", "asian", "black", "mixed", "other"]) {
      annualChangePp[key] = round((pct2021[key] - pct2011[key]) / 10);
    }
  }

  // If no 2011 data, use 2021 as both baseline and current (no projections possible)
  const baselinePct = pct2011 ?? pct2021;
  const baselineRaw = raw2011 ?? raw2021;
  const baselineYear = pct2011 ? 2011 : 2021;

  const finalAnnualChangePp = {};
  for (const key of ["white_british", "white_other", "asian", "black", "mixed", "other"]) {
    finalAnnualChangePp[key] = pct2011 ? annualChangePp[key] : 0;
  }

  // Generate projection years (2025, 2030, 2035, 2040, 2045, 2050)
  const projections = {};
  if (pct2011) {
    for (const year of [2025, 2030, 2035, 2040, 2045, 2050]) {
      projections[String(year)] = projectYear(pct2011, pct2021, year);
    }
  }

  // Headline stat
  const wbDecline = pct2011 ? round(pct2011.white_british - pct2021.white_british) : 0;
  const headlineStat = pct2011 && wbDecline > 1
    ? { value: `-${wbDecline.toFixed(1)}pp`, trend: `White British fell from ${pct2011.white_british.toFixed(1)}% to ${pct2021.white_british.toFixed(1)}% (2011-2021)` }
    : null;

  const entry = {
    areaName: areaName || raw2021.areaName,
    baseline: {
      year: baselineYear,
      total_population: baselineRaw.total,
      groups: baselinePct,
      groups_absolute: {
        white_british: baselineRaw.white_british,
        white_other: baselineRaw.white_other,
        asian: baselineRaw.asian,
        black: baselineRaw.black,
        mixed: baselineRaw.mixed,
        other: baselineRaw.other
      }
    },
    current: {
      year: 2021,
      total_population: raw2021.total,
      groups: pct2021,
      groups_absolute: {
        white_british: raw2021.white_british,
        white_other: raw2021.white_other,
        asian: raw2021.asian,
        black: raw2021.black,
        mixed: raw2021.mixed,
        other: raw2021.other
      }
    },
    annualChangePp: finalAnnualChangePp,
    projections,
    headlineStat,
    thresholds: pct2011 ? findThresholds(pct2011, pct2021) : []
  };

  output.areas[areaCode] = entry;
  matched++;
}

console.log(`\nResults: ${matched} areas with ethnic data`);
console.log(`  Skipped (no 2021 data): ${skipped2021}`);
console.log(`  Skipped (no 2011 data): ${skipped2011} (included with 2021-only snapshot)`);
console.log(`  Skipped (calc error): ${skippedCalc}`);

writeFileSync(outputPath, JSON.stringify(output, null, 2), "utf8");
console.log(`\nWritten ${outputPath}`);
