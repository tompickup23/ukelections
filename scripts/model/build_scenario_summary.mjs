/**
 * Build scenario summary data for the frontend.
 *
 * Extracts WBI% trajectories for all 9 scenarios from the full
 * projections.json (22.8 MB) into a lightweight summary file (~500KB)
 * suitable for client-side scenario comparison.
 *
 * Input:  data/model/projections.json
 * Output: src/data/live/scenario-summaries.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const INPUT = path.resolve("data/model/projections.json");
const OUTPUT = path.resolve("src/data/live/scenario-summaries.json");

console.log("Loading projections.json...");
const data = JSON.parse(readFileSync(INPUT, "utf8"));

const scenarios = data.scenarios;
const centralScenario = data.centralScenario;
const projections = data.projections;

console.log(`Scenarios: ${scenarios.join(", ")}`);
console.log(`Central: ${centralScenario}`);

// Human-readable scenario labels
const SCENARIO_LABELS = {
  "constant__principal": { fertility: "Constant fertility", migration: "ONS principal", short: "Constant / Principal" },
  "constant__high_migration": { fertility: "Constant fertility", migration: "High migration", short: "Constant / High" },
  "constant__low_migration": { fertility: "Constant fertility", migration: "Low migration", short: "Constant / Low" },
  "half_convergence__principal": { fertility: "Half convergence", migration: "ONS principal", short: "Half-conv / Principal" },
  "half_convergence__high_migration": { fertility: "Half convergence", migration: "High migration", short: "Half-conv / High" },
  "half_convergence__low_migration": { fertility: "Half convergence", migration: "Low migration", short: "Half-conv / Low" },
  "full_convergence__principal": { fertility: "Full convergence", migration: "ONS principal", short: "Full-conv / Principal" },
  "full_convergence__high_migration": { fertility: "Full convergence", migration: "High migration", short: "Full-conv / High" },
  "full_convergence__low_migration": { fertility: "Full convergence", migration: "Low migration", short: "Full-conv / Low" }
};

// Scenario descriptions for the UI
const SCENARIO_DESCRIPTIONS = {
  fertility: {
    "constant": "Ethnic fertility rates stay at current levels indefinitely",
    "half_convergence": "Ethnic fertility rates move halfway toward the national average by 2061",
    "full_convergence": "All ethnic groups converge to the national average fertility rate by 2061"
  },
  migration: {
    "principal": "ONS principal projection: net migration ~315,000/year",
    "high_migration": "ONS high variant: net migration ~476,000/year",
    "low_migration": "ONS low variant: net migration ~108,000/year"
  }
};

// Extract WBI trajectories + total population for all areas × scenarios
const decadeYears = ["2031", "2041", "2051", "2061"];
const areas = {};
let areaCount = 0;

for (const scenario of scenarios) {
  const scenarioData = projections[scenario];
  if (!scenarioData) {
    console.log(`  Warning: no data for scenario ${scenario}`);
    continue;
  }

  for (const [areaCode, yearData] of Object.entries(scenarioData)) {
    if (!areaCode.startsWith("E")) continue;

    if (!areas[areaCode]) {
      areas[areaCode] = {};
      areaCount++;
    }

    const scenarioEntry = {};
    for (const year of decadeYears) {
      const d = yearData[year];
      if (d) {
        // Data shape: { total, groups: { WBI, ... }, pct: { WBI, ... } }
        const total = d.total || 0;
        const wbiPct = d.pct?.WBI ?? (total > 0 && d.groups?.WBI ? Math.round(d.groups.WBI / total * 1000) / 10 : 0);
        scenarioEntry[year] = {
          wbiPct,
          total: Math.round(total)
        };
      }
    }

    if (Object.keys(scenarioEntry).length > 0) {
      areas[areaCode][scenario] = scenarioEntry;
    }
  }
}

// Compute national aggregates per scenario
const national = {};
for (const scenario of scenarios) {
  const natEntry = {};
  for (const year of decadeYears) {
    let totalWBI = 0, totalPop = 0;
    for (const [code, scenarioMap] of Object.entries(areas)) {
      const d = scenarioMap[scenario]?.[year];
      if (d) {
        totalWBI += d.total * d.wbiPct / 100;
        totalPop += d.total;
      }
    }
    if (totalPop > 0) {
      natEntry[year] = {
        wbiPct: Math.round(totalWBI / totalPop * 1000) / 10,
        total: Math.round(totalPop)
      };
    }
  }
  national[scenario] = natEntry;
}

// Compute scenario ranges for each area
const scenarioRanges = {};
for (const [code, scenarioMap] of Object.entries(areas)) {
  const wbi2051 = scenarios
    .map(s => scenarioMap[s]?.["2051"]?.wbiPct)
    .filter(v => v !== undefined);

  if (wbi2051.length > 0) {
    scenarioRanges[code] = {
      min2051: Math.min(...wbi2051),
      max2051: Math.max(...wbi2051),
      central2051: scenarioMap[centralScenario]?.["2051"]?.wbiPct ?? null,
      spreadPp: Math.round((Math.max(...wbi2051) - Math.min(...wbi2051)) * 10) / 10
    };
  }
}

const output = {
  generatedAt: new Date().toISOString(),
  scenarios,
  centralScenario,
  scenarioLabels: SCENARIO_LABELS,
  scenarioDescriptions: SCENARIO_DESCRIPTIONS,
  areaCount,
  national,
  areas,
  scenarioRanges
};

writeFileSync(OUTPUT, JSON.stringify(output, null, 2), "utf8");

const fileSizeKB = Math.round(Buffer.byteLength(JSON.stringify(output)) / 1024);
console.log(`\nWritten ${OUTPUT} (${fileSizeKB} KB, ${areaCount} areas)`);

// Print some interesting findings
console.log(`\nNational WBI by scenario (2051):`);
for (const scenario of scenarios) {
  const d = national[scenario]?.["2051"];
  const label = SCENARIO_LABELS[scenario]?.short || scenario;
  console.log(`  ${label}: ${d?.wbiPct}%`);
}

// Biggest scenario spread
const bigSpreads = Object.entries(scenarioRanges)
  .sort(([, a], [, b]) => b.spreadPp - a.spreadPp)
  .slice(0, 10);
console.log(`\nBiggest scenario spreads (WBI 2051):`);
for (const [code, r] of bigSpreads) {
  console.log(`  ${code}: ${r.min2051}% - ${r.max2051}% (spread ${r.spreadPp}pp)`);
}
