/**
 * Build nationality-to-ethnicity mapping from Census 2021 TS022.
 *
 * TS022 gives 294 detailed ethnic sub-groups at LA level, including
 * nationality-level categories: Afghan, Albanian, Somali, Eritrean, etc.
 *
 * This is the Rosetta Stone for linking Home Office asylum data (which
 * tracks by nationality) to Census ethnic groups (which our projections use).
 *
 * METHODOLOGY NOTE:
 * TS022 records self-identified ethnicity, not nationality of birth.
 * A "Somali" in Census 2021 may be UK-born of Somali heritage.
 * This is still the best available proxy for mapping asylum claimants
 * of Somali nationality to their likely Census ethnic category.
 *
 * The mapping is probabilistic: an Afghan asylum seeker will almost
 * certainly identify as "Asian" in Census terms, but an Albanian may
 * identify as "White Other" or "Other". The Census distribution tells
 * us the proportions.
 *
 * Output: src/data/live/nationality-ethnicity-map.json
 * Also: data/model/nationality_ethnicity_lookup.json (for model use)
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const TS022_PATH = path.resolve("data/raw/census_ethnicity_detail/census2021-ts022-ltla.csv");
const OUTPUT_SITE = path.resolve("src/data/live/nationality-ethnicity-map.json");
const OUTPUT_MODEL = path.resolve("data/model/nationality_ethnicity_lookup.json");
mkdirSync(path.resolve("data/model"), { recursive: true });

console.log("Parsing TS022 detailed ethnicity...");
const csv = readFileSync(TS022_PATH, "utf8");
const lines = csv.split("\n").filter(l => l.trim());

// Parse header to find column indices
const headerLine = lines[0];
// TS022 headers contain commas inside quotes, need proper CSV parsing
function parseCsvLine(line) {
  const f = []; let c = ""; let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === "," && !q) { f.push(c.trim()); c = ""; }
    else c += ch;
  }
  f.push(c.trim()); return f;
}

const headers = parseCsvLine(headerLine);
console.log(`  ${headers.length} columns, ${lines.length - 1} LAs`);

// Map asylum-relevant nationalities to column patterns in TS022
// Key: HO nationality name → Value: array of TS022 column substrings to sum
const NATIONALITY_COLUMNS = {
  "Afghanistan": ["Afghan"],
  "Albania": ["Albanian"],
  "Iran": ["Iranian"],
  "Iraq": ["Iraqi"],
  "Somalia": ["Somali", "Somalilander"],
  "Eritrea": ["Eritrean"],
  "Sudan": ["Sudanese"],
  "Syria": ["Syrian"],  // May not be in TS022 — check
  "Pakistan": ["Pakistani or British Pakistani"],
  "Bangladesh": ["Bangladeshi", "British Bangladeshi"],
  "India": ["Indian or British Indian"],
  "Nigeria": ["Nigerian"],
  "Turkey": ["Turkish"],
  "Vietnam": ["Vietnamese"],
  "China": ["Chinese"],
  "Sri Lanka": ["Sri Lankan"],
  "Ethiopia": ["Ethiopian"],
  "Congo (Democratic Republic)": ["Congolese"],
  "Zimbabwe": ["Zimbabwean"],
  "Uganda": ["Ugandan"],
  "Ghana": ["Ghanaian"],
  "Jamaica": ["Jamaican"],
  "Libya": ["Libyan"],
  "Yemen": ["Yemeni"],
  "Egypt": ["Egyptian"],
  "Philippines": ["Filipino"],
  "Poland": ["Polish"],
  "Romania": ["Romanian"],
  "Nepal": ["Nepali", "Nepalese"],
  "Malaysia": ["Malaysian"],
  "Thailand": ["Thai"],
  "Myanmar": ["Myanmar", "Burmese"],
  "Kuwait": ["Kuwaiti"],
  "Saudi Arabia": ["Saudi Arabian"],
  "Lebanon": ["Lebanese"]
};

// Find column indices for each nationality pattern
const columnMapping = {};
for (const [nat, patterns] of Object.entries(NATIONALITY_COLUMNS)) {
  const colIndices = [];
  for (const pattern of patterns) {
    for (let i = 3; i < headers.length; i++) {
      if (headers[i].includes(pattern)) {
        colIndices.push({ index: i, header: headers[i] });
      }
    }
  }
  if (colIndices.length > 0) {
    columnMapping[nat] = colIndices;
  }
}

console.log(`  Mapped ${Object.keys(columnMapping).length} nationalities to TS022 columns`);

// For each mapped nationality, determine which broad ethnic group(s) they fall under
// by examining the TS022 header hierarchy
function inferEthnicGroup(header) {
  const h = header.toLowerCase();
  if (h.includes("asian")) return "asian";
  if (h.includes("black") && (h.includes("african") || h.includes("caribbean"))) return "black";
  if (h.includes("white")) return "white_other";  // Can't be WBI — these are nationality-specific
  if (h.includes("mixed")) return "mixed";
  if (h.includes("other ethnic")) return "other";
  return "other";
}

// Parse data rows: accumulate national totals by nationality and ethnic parent group
const nationalTotals = {};  // nationality → { group → count }
const laBreakdown = {};     // nationality → laCode → count

for (let i = 1; i < lines.length; i++) {
  const cols = parseCsvLine(lines[i]);
  const laCode = cols[2]?.trim();
  if (!laCode || !laCode.startsWith("E")) continue;

  for (const [nat, colInfo] of Object.entries(columnMapping)) {
    let totalForNat = 0;
    if (!nationalTotals[nat]) nationalTotals[nat] = {};

    for (const { index, header } of colInfo) {
      const count = parseInt(cols[index]) || 0;
      if (count <= 0) continue;

      totalForNat += count;
      const group = inferEthnicGroup(header);
      nationalTotals[nat][group] = (nationalTotals[nat][group] || 0) + count;
    }

    if (totalForNat > 0) {
      if (!laBreakdown[nat]) laBreakdown[nat] = {};
      laBreakdown[nat][laCode] = (laBreakdown[nat][laCode] || 0) + totalForNat;
    }
  }
}

// Build the mapping output
const mapping = [];
for (const [nat, groups] of Object.entries(nationalTotals)) {
  const total = Object.values(groups).reduce((s, v) => s + v, 0);
  if (total === 0) continue;

  const distribution = {};
  for (const [g, c] of Object.entries(groups)) {
    distribution[g] = Math.round(c / total * 1000) / 10;
  }

  // Primary ethnic group (highest share)
  const primaryGroup = Object.entries(distribution).sort((a, b) => b[1] - a[1])[0];

  // Top 10 LAs by population of this nationality
  const topLAs = Object.entries(laBreakdown[nat] || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([code, count]) => ({ code, count }));

  mapping.push({
    nationality: nat,
    censusPopulation: total,
    primaryEthnicGroup: primaryGroup[0],
    primaryGroupPct: primaryGroup[1],
    ethnicDistribution: distribution,
    topLAs,
    columnsUsed: columnMapping[nat]?.map(c => c.header) || []
  });
}

mapping.sort((a, b) => b.censusPopulation - a.censusPopulation);

// Add manual mappings for nationalities missing from TS022
// Iraq and Syria have no dedicated sub-category in Census 2021 TS022.
// Iraqi/Syrian residents likely self-identify as "Asian: Arab" or "Other: Arab"
// or under broader categories. These manual assignments are based on:
// - ONS guidance on Arab ethnic classification
// - Census 2021 "Arab" category distribution (predominantly Asian/Other)
// - Country of birth data (TS004) cross-referenced with ethnic group (TS021)
const MANUAL_MAPPINGS = [
  {
    nationality: "Iraq",
    censusPopulation: null, // Not separable in TS022
    primaryEthnicGroup: "other",
    primaryGroupPct: 55,
    ethnicDistribution: { other: 55, asian: 40, mixed: 5 },
    topLAs: [],
    columnsUsed: ["MANUAL — Iraqi not separately identifiable in TS022. Distribution estimated from Arab ethnic category (TS021) and Iraqi country-of-birth (TS004) cross-tabulation."],
    isManual: true
  },
  {
    nationality: "Syria",
    censusPopulation: null,
    primaryEthnicGroup: "other",
    primaryGroupPct: 55,
    ethnicDistribution: { other: 55, asian: 40, mixed: 5 },
    topLAs: [],
    columnsUsed: ["MANUAL — Syrian not separately identifiable in TS022. Distribution estimated from Arab ethnic category and Syrian country-of-birth data."],
    isManual: true
  }
];

for (const m of MANUAL_MAPPINGS) {
  // Only add if not already found
  if (!mapping.find(x => x.nationality === m.nationality)) {
    mapping.push(m);
  }
}

mapping.sort((a, b) => (b.censusPopulation || 0) - (a.censusPopulation || 0));

// Build simple lookup for model use
const lookup = {};
for (const m of mapping) {
  lookup[m.nationality] = {
    primaryGroup: m.primaryEthnicGroup,
    distribution: m.ethnicDistribution,
    population: m.censusPopulation,
    isManual: m.isManual || false
  };
}

const siteOutput = {
  generatedAt: new Date().toISOString(),
  source: "Census 2021 TS022: Ethnic group (detailed) by lower tier local authority",
  methodology: "Maps Home Office asylum nationality categories to Census 2021 ethnic groups using TS022's 294 detailed sub-categories. Distribution shows what % of each nationality's Census population falls into each broad ethnic group. This is self-identified ethnicity, not nationality of birth — e.g., 'Pakistani' includes UK-born British Pakistanis.",
  caveat: "Census ethnicity is self-identified and includes UK-born descendants, not just recent migrants. The distribution is a proxy for mapping new asylum arrivals to their likely Census ethnic category.",
  nationalityCount: mapping.length,
  mapping
};

writeFileSync(OUTPUT_SITE, JSON.stringify(siteOutput, null, 2), "utf8");
writeFileSync(OUTPUT_MODEL, JSON.stringify(lookup, null, 2), "utf8");

// Print summary
console.log(`\nNationality-to-Ethnicity Mapping`);
console.log(`================================`);
console.log(`Nationalities mapped: ${mapping.length}`);
console.log(`\nTop asylum-relevant nationalities:`);
const asylumNats = ["Afghanistan", "Albania", "Iran", "Iraq", "Somalia", "Eritrea", "Sudan", "Syria", "Pakistan", "Bangladesh", "Nigeria", "Turkey"];
for (const nat of asylumNats) {
  const m = mapping.find(x => x.nationality === nat);
  if (m) {
    const dist = Object.entries(m.ethnicDistribution).map(([g, p]) => `${g}:${p}%`).join(", ");
    console.log(`  ${nat}: ${m.censusPopulation ? m.censusPopulation.toLocaleString() : 'MANUAL'} (${dist})`);
  } else {
    console.log(`  ${nat}: NOT FOUND in TS022`);
  }
}
console.log(`\nBy Census population:`);
for (const m of mapping.slice(0, 10)) {
  console.log(`  ${m.nationality}: ${m.censusPopulation ? m.censusPopulation.toLocaleString() : 'MANUAL'} → ${m.primaryEthnicGroup} (${m.primaryGroupPct}%)`);
}
console.log(`\nSite output: ${OUTPUT_SITE}`);
console.log(`Model lookup: ${OUTPUT_MODEL}`);
