/**
 * Fetch Census 2011 UKMIG003: Migration by ethnic group × age × LA.
 *
 * This provides NET internal migration rates per LA per ethnic group — the key
 * data needed for ethnic-specific migration modelling.
 *
 * NOMIS dataset: NM_1282_1 (UKMIG003)
 * Geography: TYPE464 (local authority district/unitary, 2011 boundaries)
 *
 * Migration types of interest:
 *   2: Inflow total
 *   6: Outflow total
 *   9: Net migration within UK
 *
 * Ethnic groups: 0=All, 1=White, 2=Gypsy/Traveller, 3=Mixed, 4=Indian,
 *   5=Pakistani, 6=Bangladeshi, 7=Chinese, 8=Other Asian, 9=Black, 10=Other
 *
 * Output: data/raw/census_2011_migration/ukmig003_net_migration_ethnicity_la.csv
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const rawDir = path.resolve("data/raw/census_2011_migration");
mkdirSync(rawDir, { recursive: true });

const BASE_URL = "https://www.nomisweb.co.uk/api/v01/dataset/NM_1282_1.data.csv";
const SELECT = "GEOGRAPHY_CODE,GEOGRAPHY_NAME,C_AGE,C_AGE_NAME,CELL,CELL_NAME,C_MIGR,C_MIGR_NAME,OBS_VALUE";

// Fetch net migration (C_MIGR=9), inflow (2), outflow (6) for all ethnic groups
// Split into batches to stay under 25K row limit
const MIG_TYPES = "2,6,9"; // Inflow, Outflow, Net
const ETH_BATCHES = [
  "0,1,2,3",     // All, White, Gypsy, Mixed
  "4,5,6,7",     // Indian, Pakistani, Bangladeshi, Chinese
  "8,9,10"        // Other Asian, Black, Other
];

async function fetchBatch(ethCodes, batchName) {
  // Use full URL without select= to get all columns, then TYPE464 for 2011 LA boundaries
  const url = `${BASE_URL}?date=latest&geography=TYPE464&c_age=0&cell=${ethCodes}&c_migr=${MIG_TYPES}&measures=20100&select=${SELECT}`;
  console.log(`  Fetching batch: ${batchName}...`);
  console.log(`  URL: ${url.slice(0, 120)}...`);
  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text();
    console.log(`  Error: ${response.status} — ${text.slice(0, 200)}`);
    // Try without select parameter
    const url2 = `${BASE_URL}?date=latest&geography=TYPE464&c_age=0&cell=${ethCodes}&c_migr=${MIG_TYPES}&measures=20100`;
    console.log(`  Retrying without select...`);
    const r2 = await fetch(url2);
    if (!r2.ok) throw new Error(`HTTP ${r2.status}`);
    const text2 = await r2.text();
    const lines = text2.split("\n").filter(l => l.trim());
    console.log(`    ${lines.length - 1} data rows`);
    return lines;
  }
  const text = await response.text();
  const lines = text.split("\n").filter(l => l.trim());
  console.log(`    ${lines.length - 1} data rows`);
  return lines;
}

try {
  console.log("Fetching Census 2011 UKMIG003 (migration by ethnic group × LA)...");
  let allLines = [];
  let header = null;

  for (const ethBatch of ETH_BATCHES) {
    const lines = await fetchBatch(ethBatch, `eth=${ethBatch}`);
    if (!header) { header = lines[0]; allLines.push(header); }
    allLines.push(...lines.slice(1));
    await new Promise(r => setTimeout(r, 500));
  }

  const outputPath = path.join(rawDir, "ukmig003_net_migration_ethnicity_la.csv");
  writeFileSync(outputPath, allLines.join("\n"), "utf8");
  console.log(`\nWritten ${outputPath} (${allLines.length - 1} data rows, ${Math.round(allLines.join("\n").length / 1024)} KB)`);
} catch (error) {
  console.error("Error:", error.message);
  process.exit(1);
}
