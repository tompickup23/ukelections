/**
 * Integrate socioeconomic dimensions by ethnicity into ethnic-projections.json
 *
 * B2: Economic activity × ethnicity (RM018) — employment/unemployment by ethnic group
 * B3: Housing tenure × ethnicity (RM134) — ownership/renting by ethnic group
 * B4: Qualifications × ethnicity (RM049) — education level by ethnic group
 * B5: Health × ethnicity (RM043) — general health by ethnic group
 *
 * All data is observed Census 2021, not projected.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const SITE_OUTPUT = path.resolve("src/data/live/ethnic-projections.json");
const ECON_PATH = path.resolve("data/raw/census_base/rm018_econ_ethnicity_2021.csv");
const TENURE_PATH = path.resolve("data/raw/census_base/rm134_tenure_ethnicity_2021.csv");
const QUAL_PATH = path.resolve("data/raw/census_base/rm049_qualification_ethnicity_2021.csv");
const HEALTH_PATH = path.resolve("data/raw/census_base/rm043_health_ethnicity_2021.csv");

const existing = JSON.parse(readFileSync(SITE_OUTPUT, "utf8"));

function parseCsvLine(line) {
  const f = []; let c = ""; let q = false;
  for (const ch of line) { if (ch === '"') q = !q; else if (ch === "," && !q) { f.push(c.trim()); c = ""; } else c += ch; }
  f.push(c.trim()); return f;
}

function parseDataset(filePath) {
  const lines = readFileSync(filePath, "utf8").split("\n").filter(l => l.trim());
  const header = parseCsvLine(lines[0]);
  const data = []; // [{code, name, dim1, dim2, value}]
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (cols.length < 5) continue;
    data.push({ code: cols[0], name: cols[1], cat1: cols[2], cat2: cols[3], value: parseFloat(cols[4]) || 0 });
  }
  return data;
}

// Map 8-category Census 2021 ethnicity to simplified names
const ETH_SIMPLE = {
  "White: English, Welsh, Scottish, Northern Irish or British": "White British",
  "White: Irish": "White Other", "White: Other White": "White Other",
  "White: Gypsy or Irish Traveller, Roma or Other White": "White Other",
  "Mixed or Multiple ethnic groups": "Mixed",
  "Asian, Asian British or Asian Welsh: Indian": "Indian",
  "Asian, Asian British or Asian Welsh: Pakistani, Bangladeshi or Chinese": "Pakistani/Bangladeshi/Chinese",
  "Asian, Asian British or Asian Welsh": "Asian",
  "Black, Black British, Black Welsh, Caribbean or African": "Black",
  "Other ethnic group": "Other",
  // Handle 8-category versions
  "White: English, Welsh, Scottish, Northern Irish or British": "White British",
};

function simplifyEth(name) {
  if (name?.includes("English") || name?.includes("British")) return "White British";
  if (name?.includes("Irish") || name?.includes("Other White") || name?.includes("Gypsy")) return "White Other";
  if (name?.includes("Mixed")) return "Mixed";
  if (name?.includes("Indian")) return "Indian";
  if (name?.includes("Pakistani") || name?.includes("Bangladeshi")) return "South Asian Other";
  if (name?.includes("Asian")) return "Asian Other";
  if (name?.includes("Black") || name?.includes("African") || name?.includes("Caribbean")) return "Black";
  if (name?.includes("Other")) return "Other";
  return name;
}

// ============================================================
// B2: Economic Activity
// ============================================================
console.log("B2: Economic activity × ethnicity...");
const econData = parseDataset(ECON_PATH);
const econByArea = new Map();

for (const row of econData) {
  if (!econByArea.has(row.code)) econByArea.set(row.code, {});
  const area = econByArea.get(row.code);
  const eth = simplifyEth(row.cat2);
  if (!area[eth]) area[eth] = { employed: 0, unemployed: 0, inactive: 0, total: 0 };

  const cat = row.cat1.toLowerCase();
  if (cat.includes("employee") || cat.includes("self-employed") || cat.includes("full-time") || cat.includes("part-time")) {
    area[eth].employed += row.value;
  } else if (cat.includes("unemployed")) {
    area[eth].unemployed += row.value;
  } else if (cat.includes("inactive") || cat.includes("student") || cat.includes("retired") || cat.includes("looking after") || cat.includes("disabled")) {
    area[eth].inactive += row.value;
  }
  area[eth].total += row.value;
}

let econCount = 0;
for (const [code, area] of Object.entries(existing.areas)) {
  const econ = econByArea.get(code);
  if (!econ) continue;

  area.economicActivity = {};
  for (const [eth, data] of Object.entries(econ)) {
    if (data.total > 0) {
      area.economicActivity[eth] = {
        employmentRate: Math.round(data.employed / data.total * 1000) / 10,
        unemploymentRate: Math.round(data.unemployed / (data.employed + data.unemployed || 1) * 1000) / 10
      };
    }
  }
  econCount++;
}
console.log(`  ${econCount} areas`);

// ============================================================
// B3: Housing Tenure
// ============================================================
console.log("B3: Housing tenure × ethnicity...");
const tenureData = parseDataset(TENURE_PATH);
const tenureByArea = new Map();

for (const row of tenureData) {
  if (!tenureByArea.has(row.code)) tenureByArea.set(row.code, {});
  const area = tenureByArea.get(row.code);
  const eth = simplifyEth(row.cat2);
  if (!area[eth]) area[eth] = { owned: 0, socialRented: 0, privateRented: 0, total: 0 };

  const cat = row.cat1.toLowerCase();
  if (cat.includes("owned") || cat.includes("mortgage")) area[eth].owned += row.value;
  else if (cat.includes("social")) area[eth].socialRented += row.value;
  else if (cat.includes("private")) area[eth].privateRented += row.value;
  area[eth].total += row.value;
}

let tenureCount = 0;
for (const [code, area] of Object.entries(existing.areas)) {
  const tenure = tenureByArea.get(code);
  if (!tenure) continue;

  area.housingTenure = {};
  for (const [eth, data] of Object.entries(tenure)) {
    if (data.total > 0) {
      area.housingTenure[eth] = {
        ownershipRate: Math.round(data.owned / data.total * 1000) / 10,
        socialRentRate: Math.round(data.socialRented / data.total * 1000) / 10,
        privateRentRate: Math.round(data.privateRented / data.total * 1000) / 10
      };
    }
  }
  tenureCount++;
}
console.log(`  ${tenureCount} areas`);

// ============================================================
// B4: Qualifications
// ============================================================
console.log("B4: Qualifications × ethnicity...");
const qualData = parseDataset(QUAL_PATH);
const qualByArea = new Map();

for (const row of qualData) {
  if (!qualByArea.has(row.code)) qualByArea.set(row.code, {});
  const area = qualByArea.get(row.code);
  const eth = simplifyEth(row.cat2);
  if (!area[eth]) area[eth] = { level4Plus: 0, noQuals: 0, total: 0 };

  const cat = row.cat1.toLowerCase();
  if (cat.includes("level 4") || cat.includes("degree")) area[eth].level4Plus += row.value;
  else if (cat.includes("no qual")) area[eth].noQuals += row.value;
  area[eth].total += row.value;
}

let qualCount = 0;
for (const [code, area] of Object.entries(existing.areas)) {
  const qual = qualByArea.get(code);
  if (!qual) continue;

  area.qualifications = {};
  for (const [eth, data] of Object.entries(qual)) {
    if (data.total > 0) {
      area.qualifications[eth] = {
        degreeOrAbovePct: Math.round(data.level4Plus / data.total * 1000) / 10,
        noQualsPct: Math.round(data.noQuals / data.total * 1000) / 10
      };
    }
  }
  qualCount++;
}
console.log(`  ${qualCount} areas`);

// ============================================================
// B5: General Health
// ============================================================
console.log("B5: Health × ethnicity...");
const healthData = parseDataset(HEALTH_PATH);
const healthByArea = new Map();

for (const row of healthData) {
  if (!healthByArea.has(row.code)) healthByArea.set(row.code, {});
  const area = healthByArea.get(row.code);
  const eth = simplifyEth(row.cat2);
  if (!area[eth]) area[eth] = { good: 0, bad: 0, total: 0 };

  const cat = row.cat1.toLowerCase();
  if (cat.includes("good") || cat.includes("very good")) area[eth].good += row.value;
  else if (cat.includes("bad") || cat.includes("very bad")) area[eth].bad += row.value;
  area[eth].total += row.value;
}

let healthCount = 0;
for (const [code, area] of Object.entries(existing.areas)) {
  const health = healthByArea.get(code);
  if (!health) continue;

  area.health = {};
  for (const [eth, data] of Object.entries(health)) {
    if (data.total > 0) {
      area.health[eth] = {
        goodHealthPct: Math.round(data.good / data.total * 1000) / 10,
        badHealthPct: Math.round(data.bad / data.total * 1000) / 10
      };
    }
  }
  healthCount++;
}
console.log(`  ${healthCount} areas`);

// Save
existing.modelVersion = "6.2-full-socioeconomic";
existing.lastUpdated = new Date().toISOString().slice(0, 10);
writeFileSync(SITE_OUTPUT, JSON.stringify(existing, null, 2), "utf8");

// Spot checks
for (const code of ["E07000117", "E06000008", "E08000025"]) {
  const a = existing.areas[code]; if (!a) continue;
  console.log(`\n${a.areaName}:`);
  if (a.economicActivity?.["White British"]) console.log(`  Employment: WBI=${a.economicActivity["White British"].employmentRate}%`);
  if (a.housingTenure?.["White British"]) console.log(`  Ownership: WBI=${a.housingTenure["White British"].ownershipRate}%`);
  if (a.qualifications?.["White British"]) console.log(`  Degree+: WBI=${a.qualifications["White British"].degreeOrAbovePct}%`);
  if (a.health?.["White British"]) console.log(`  Good health: WBI=${a.health["White British"].goodHealthPct}%`);
}

console.log("\nDone.");
