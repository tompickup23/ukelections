/**
 * Fetch Census 2011 DC2101EW: Ethnic group × Sex × Age at LA level.
 *
 * This provides 18 detailed ethnic groups × 21 age bands × 2 sexes × 348 LAs.
 * Used to replace proportional 12→18 group splitting when computing CCRs.
 *
 * NOMIS dataset: NM_651_1 (DC2101EW)
 * Geography: TYPE464 (local authority district/unitary, 2011 boundaries)
 *
 * Output: data/raw/census_2011_ethnicity_age/dc2101ew_ethnicity_sex_age_la.csv
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const rawDir = path.resolve("data/raw/census_2011_ethnicity_age");
mkdirSync(rawDir, { recursive: true });

// DC2101EW: Ethnic group by sex by age
// c_ethpuk11: 1-23 (ethnic groups — 1-5 are totals, 6-23 are detailed 18 groups)
//   2=White, 3=Mixed, 4=Asian, 5=Black/African/Caribbean, 6=Other
//   7=White:British, 8=White:Irish, 9=White:Gypsy/Traveller, 10=White:Other
//   11=Mixed:White+BC, 12=Mixed:White+BA, 13=Mixed:White+Asian, 14=Mixed:Other
//   15=Asian:Indian, 16=Asian:Pakistani, 17=Asian:Bangladeshi, 18=Asian:Chinese, 19=Asian:Other
//   20=Black:African, 21=Black:Caribbean, 22=Black:Other
//   23=Other:Arab, (no separate code—Arab is within Other for 2011, code may vary)
//
// c_age: age bands (1=Total, then specific bands)
// c_sex: 1=Male, 2=Female

// NOMIS has a 25,000 row limit. We need ~348 LAs × 17 detailed ethnic groups × 21 ages × 2 sexes = ~248K rows
// Strategy: fetch one sex at a time, split ethnic groups into batches

const BASE_URL = "https://www.nomisweb.co.uk/api/v01/dataset/NM_651_1.data.csv";
const SELECT = "GEOGRAPHY_CODE,GEOGRAPHY_NAME,C_ETHPUK11,C_ETHPUK11_NAME,C_SEX,C_SEX_NAME,C_AGE,C_AGE_NAME,OBS_VALUE";

// Detailed ethnic group codes only (skip totals: 1, 6, 11, 17, 21)
// 2=WB, 3=Irish, 4=Gypsy, 5=Other White, 7=M:WBC, 8=M:WBA, 9=M:WA, 10=M:Other,
// 12=Indian, 13=Pakistani, 14=Bangladeshi, 15=Chinese, 16=Other Asian,
// 18=African, 19=Caribbean, 20=Other Black, 22=Arab, 23=Other
// Each batch: ~348 LAs × N groups × 21 ages = max ~7,300 rows per group
// Need < 25,000 rows per batch → max 3 groups per batch
const ETH_BATCHES = [
  "2,3",      // White British, Irish
  "4,5",      // Gypsy, Other White
  "7,8",      // Mixed: WBC, WBA
  "9,10",     // Mixed: WA, Other
  "12,13",    // Indian, Pakistani
  "14,15",    // Bangladeshi, Chinese
  "16,18",    // Other Asian, African
  "19,20",    // Caribbean, Other Black
  "22,23"     // Arab, Other
];

const AGES = "1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21";

async function fetchBatch(ethCodes, sex, batchName) {
  const url = `${BASE_URL}?date=latest&geography=TYPE464&c_ethpuk11=${ethCodes}&c_age=${AGES}&c_sex=${sex}&measures=20100&select=${SELECT}`;
  console.log(`  Fetching batch: ${batchName} (sex=${sex})...`);

  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
  }

  const text = await response.text();
  const lines = text.split("\n").filter(l => l.trim());
  console.log(`    ${lines.length - 1} data rows`);
  return lines;
}

try {
  console.log("Fetching Census 2011 DC2101EW in batches...");
  let allLines = [];
  let header = null;

  for (const ethBatch of ETH_BATCHES) {
    for (const sex of [1, 2]) {
      const sexLabel = sex === 1 ? "Males" : "Females";
      const lines = await fetchBatch(ethBatch, sex, `eth=${ethBatch}, ${sexLabel}`);

      if (!header) {
        header = lines[0];
        allLines.push(header);
      }
      // Skip header line for subsequent batches
      allLines.push(...lines.slice(1));

      // Rate limit: small delay between requests
      await new Promise(r => setTimeout(r, 500));
    }
  }

  const outputPath = path.join(rawDir, "dc2101ew_ethnicity_sex_age_la.csv");
  writeFileSync(outputPath, allLines.join("\n"), "utf8");
  console.log(`\nWritten ${outputPath} (${allLines.length - 1} data rows, ${Math.round(allLines.join("\n").length / 1024)} KB)`);
  console.log("Done.");
} catch (error) {
  console.error("Error:", error.message);
  process.exit(1);
}
