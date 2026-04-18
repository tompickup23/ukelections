/**
 * Fetch ONS Census 2021 & 2011 ethnicity data for all UK local authorities.
 *
 * Census 2021: NOMIS NM_2041_1 (TS021 Ethnic group) — England & Wales
 * Census 2011: NOMIS NM_608_1 (KS201 Ethnic group) — England & Wales
 *
 * Geography TYPE424 = local authorities: district/unitary (April 2023)
 * Measures 20100 = absolute count
 *
 * Output: data/raw/census_ethnicity/census_2021_ethnicity.csv
 *         data/raw/census_ethnicity/census_2011_ethnicity.csv
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const rawDir = path.resolve("data/raw/census_ethnicity");
mkdirSync(rawDir, { recursive: true });

// Census 2021 TS021: ethnic group by LA (TYPE424), absolute counts
// c2021_eth_20: 0=Total, 1=WB, 2=Irish, 3=Gypsy, 4=Roma, 5=Other White,
//   6-9=Mixed, 10-14=Asian, 15-17=Black, 18=Arab, 19=Other
const NOMIS_2021_URL =
  "https://www.nomisweb.co.uk/api/v01/dataset/NM_2041_1.data.csv?" +
  "date=latest&" +
  "geography=TYPE424&" +
  "c2021_eth_20=0,1,2,3,4,5,1001,6,7,8,9,1003,10,11,12,13,14,1002,15,16,17,1005,18,19,1004&" +
  "measures=20100&" +
  "select=GEOGRAPHY_CODE,GEOGRAPHY_NAME,C2021_ETH_20_NAME,OBS_VALUE";

// Census 2011 KS201EW: ethnic group by LA (TYPE464 for 2011 boundaries)
// cell: 0=Total, 1=WB, 2=Irish, 3=Gypsy, 4=Other White,
//   5-8=Mixed, 9-13=Asian, 14-16=Black, 17=Arab, 18=Other
// rural_urban=0 = total (not split by urban/rural)
const NOMIS_2011_URL =
  "https://www.nomisweb.co.uk/api/v01/dataset/NM_608_1.data.csv?" +
  "date=latest&" +
  "geography=TYPE464&" +
  "rural_urban=0&" +
  "cell=0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18&" +
  "measures=20100&" +
  "select=GEOGRAPHY_CODE,GEOGRAPHY_NAME,CELL_NAME,OBS_VALUE";

async function fetchCsv(url, outputFile) {
  console.log(`Fetching ${outputFile}...`);
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  const outputPath = path.join(rawDir, outputFile);
  writeFileSync(outputPath, text, "utf8");
  const lineCount = text.split("\n").filter((l) => l.trim()).length;
  console.log(`  Written ${outputPath} (${lineCount} rows)`);
}

try {
  await fetchCsv(NOMIS_2021_URL, "census_2021_ethnicity.csv");
  await fetchCsv(NOMIS_2011_URL, "census_2011_ethnicity.csv");
  console.log("Done.");
} catch (error) {
  console.error("Error:", error.message);
  process.exit(1);
}
