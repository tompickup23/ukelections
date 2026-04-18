/**
 * Fetch official supplementary data files for crime, SEND, and ASC.
 *
 * Crime: ONS "Recorded crime data at Community Safety Partnership area" (XLSX)
 * SEND: DfE "Special educational needs in England" SEN2 return (XLSX)
 * ASC: NHS Digital "Adult Social Care Activity and Finance Report" (XLSX)
 *
 * These are direct downloads from GOV.UK and ONS — no API parsing needed.
 * The transform scripts will parse the XLSX files.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const rawDir = path.resolve("data/raw/supplementary");
mkdirSync(rawDir, { recursive: true });

const downloads = [
  {
    id: "crime",
    fileName: "ons-recorded-crime-csp.xlsx",
    // ONS recorded crime by CSP area — year ending March 2024
    url: "https://www.ons.gov.uk/file?uri=/peoplepopulationandcommunity/crimeandjustice/datasets/recordedcrimedatabycommunitysafetypartnershiparea/current/csptablesyemar24correction.xlsx"
  },
  {
    id: "send",
    fileName: "dfe-sen2-2024.xlsx",
    // DfE SEN2 return 2023/24 — local authority level
    url: "https://content.explore-education-statistics.service.gov.uk/api/releases/07dcbb52-5ee2-4a62-b03e-9b12e8ee2baa/files/e03c7acd-a5c3-417e-8b51-c3e8e5c505f4"
  },
  {
    id: "asc",
    fileName: "nhs-asc-finance-2024.xlsx",
    // NHS Digital Adult Social Care Finance Report 2023/24
    url: "https://files.digital.nhs.uk/C1/C75014/Activity_and_Finance_Report_2023-24_-_ASCFR-Tables.xlsx"
  }
];

for (const dl of downloads) {
  const outputPath = path.join(rawDir, dl.fileName);
  console.log(`Fetching ${dl.id}: ${dl.fileName}...`);

  try {
    const response = await fetch(dl.url, {
      headers: { "User-Agent": "asylumstats-data-pipeline/1.0" }
    });

    if (!response.ok) {
      console.log(`  WARNING: HTTP ${response.status} — skipping ${dl.id}`);
      continue;
    }

    const buffer = await response.arrayBuffer();
    writeFileSync(outputPath, Buffer.from(buffer));
    const sizeMb = (buffer.byteLength / 1024 / 1024).toFixed(1);
    console.log(`  Written ${outputPath} (${sizeMb} MB)`);
  } catch (error) {
    console.log(`  ERROR: ${error.message} — skipping ${dl.id}`);
  }
}

console.log("Done.");
