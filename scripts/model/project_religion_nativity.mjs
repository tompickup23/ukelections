/**
 * Religion and Nativity Projections using Hamilton-Perry CCRs.
 *
 * Same methodology as ethnic projections:
 * CCR(religion, LA) = Pop(religion, LA, 2021) / Pop(religion, LA, 2011)
 * Project forward in 10-year steps.
 *
 * Religion categories: No religion, Christian, Buddhist, Hindu, Jewish, Muslim, Sikh, Other
 * Nativity categories: UK-born, Europe, Africa, Middle East & Asia, Americas, Other
 *
 * Output: Extends ethnic-projections.json with religion + nativity fields
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const REL_2021 = path.resolve("data/raw/census_base/ts030_religion_2021.csv");
const REL_2011 = path.resolve("data/raw/census_base/ks209_religion_2011.csv");
const COB_2021 = path.resolve("data/raw/census_base/ts004_cob_2021.csv");
const COB_2011 = path.resolve("data/raw/census_base/ks204_cob_2011.csv");
const SITE_OUTPUT = path.resolve("src/data/live/ethnic-projections.json");

function parseCsvLine(line) {
  const f = []; let c = ""; let q = false;
  for (const ch of line) { if (ch === '"') q = !q; else if (ch === "," && !q) { f.push(c.trim()); c = ""; } else c += ch; }
  f.push(c.trim()); return f;
}

function parseDataset(filePath, nameCol, groupCol) {
  const lines = readFileSync(filePath, "utf8").split("\n").filter(l => l.trim());
  const data = new Map(); // "areaCode|group" → population
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const code = cols[0], group = cols[groupCol], pop = parseFloat(cols[cols.length - 1]);
    if (!code || isNaN(pop)) continue;
    const key = `${code}|${group}`;
    data.set(key, (data.get(key) || 0) + pop);
  }
  return data;
}

// ============================================================
// RELIGION
// ============================================================
console.log("=== RELIGION PROJECTIONS ===");

// Map 2011 religion names to standardised categories
const REL_MAP_2011 = {
  "Christian": "Christian", "Buddhist": "Buddhist", "Hindu": "Hindu",
  "Jewish": "Jewish", "Muslim": "Muslim", "Sikh": "Sikh",
  "Other religion": "Other religion", "No religion": "No religion"
};
const REL_MAP_2021 = {
  "Christian": "Christian", "Buddhist": "Buddhist", "Hindu": "Hindu",
  "Jewish": "Jewish", "Muslim": "Muslim", "Sikh": "Sikh",
  "Other religion": "Other religion", "No religion": "No religion",
  "Not answered": null // Exclude
};
const REL_GROUPS = ["No religion", "Christian", "Buddhist", "Hindu", "Jewish", "Muslim", "Sikh", "Other religion"];

const rel2021 = parseDataset(REL_2021, 0, 2);
const rel2011 = parseDataset(REL_2011, 0, 2);

// Compute religion CCRs with James-Stein shrinkage
const relCCRs = new Map();
const relAreas2021 = new Set([...rel2021.keys()].map(k => k.split("|")[0]));
const relAreas2011 = new Set([...rel2011.keys()].map(k => k.split("|")[0]));
const relCommonAreas = [...relAreas2021].filter(c => relAreas2011.has(c));

// Compute national-average CCRs for shrinkage target
const nationalRelCCRs = new Map();
for (const group of REL_GROUPS) {
  let natPop11 = 0, natPop21 = 0;
  for (const code of relCommonAreas) {
    natPop11 += rel2011.get(`${code}|${group}`) || 0;
    natPop21 += rel2021.get(`${code}|${group}`) || 0;
  }
  nationalRelCCRs.set(group, natPop11 > 0 ? natPop21 / natPop11 : 1.0);
}

const SHRINKAGE_K = 50; // Same as ethnic model
for (const code of relCommonAreas) {
  for (const group of REL_GROUPS) {
    const pop11 = rel2011.get(`${code}|${group}`) || 0;
    const pop21 = rel2021.get(`${code}|${group}`) || 0;
    let localCCR = pop11 > 10 ? pop21 / pop11 : 1.0;
    localCCR = Math.max(0.1, Math.min(3.0, localCCR)); // Tighter cap than ethnicity
    // James-Stein shrinkage: small populations pulled toward national average
    const w = pop11 / (pop11 + SHRINKAGE_K);
    const nationalCCR = nationalRelCCRs.get(group) || 1.0;
    const shrunkCCR = w * localCCR + (1 - w) * nationalCCR;
    relCCRs.set(`${code}|${group}`, shrunkCCR);
  }
}
console.log(`  ${relCommonAreas.length} areas, ${relCCRs.size} CCRs (with shrinkage, k=${SHRINKAGE_K})`);

// Project religion forward
const relProjections = {};
for (const code of relCommonAreas) {
  const baseline = {};
  let baseTotal = 0;
  for (const g of REL_GROUPS) {
    baseline[g] = rel2021.get(`${code}|${g}`) || 0;
    baseTotal += baseline[g];
  }

  const timeline = { 2021: {} };
  for (const g of REL_GROUPS) timeline[2021][g] = baseTotal > 0 ? Math.round(baseline[g] / baseTotal * 10000) / 100 : 0;

  let currentPop = { ...baseline };
  for (const year of [2031, 2041, 2051]) {
    const newPop = {};
    let total = 0;
    for (const g of REL_GROUPS) {
      const ccr = relCCRs.get(`${code}|${g}`) || 1.0;
      newPop[g] = Math.round(currentPop[g] * ccr);
      total += newPop[g];
    }
    timeline[year] = {};
    for (const g of REL_GROUPS) timeline[year][g] = total > 0 ? Math.round(newPop[g] / total * 10000) / 100 : 0;
    currentPop = newPop;
  }

  relProjections[code] = timeline;
}

// ============================================================
// NATIVITY (Country of Birth)
// ============================================================
console.log("\n=== NATIVITY PROJECTIONS ===");

const COB_MAP_2021 = {
  "Europe: United Kingdom": "UK-born",
  "Europe: Ireland": "Foreign-born",
  "Europe: Other": "Foreign-born",
  "Africa": "Foreign-born",
  "Middle East and Asia": "Foreign-born",
  "The Americas and the Caribbean": "Foreign-born",
  "Antarctica and Oceania (including Australasia) and Other": "Foreign-born"
};
const COB_MAP_2011 = {
  "Europe: UK Total": "UK-born", "Europe: United Kingdom: Total": "UK-born",
  "Europe: Ireland": "Foreign-born", "Europe: EU countries total": "Foreign-born",
  "Europe: Other Europe total": "Foreign-born",
  "Africa total": "Foreign-born", "Africa: Total": "Foreign-born",
  "Middle East and Asia total": "Foreign-born", "Middle East and Asia: Total": "Foreign-born",
  "The Americas and the Caribbean total": "Foreign-born",
  "Antarctica and Oceania (including Australasia)": "Foreign-born",
  "Other": "Foreign-born"
};
const NAT_GROUPS = ["UK-born", "Foreign-born"];

const cob2021 = new Map();
const cob2021Lines = readFileSync(COB_2021, "utf8").split("\n").filter(l => l.trim());
for (let i = 1; i < cob2021Lines.length; i++) {
  const cols = parseCsvLine(cob2021Lines[i]);
  const code = cols[0], group = cols[2], pop = parseFloat(cols[3]);
  if (!code || isNaN(pop)) continue;
  const nat = COB_MAP_2021[group]; if (!nat) continue;
  cob2021.set(`${code}|${nat}`, (cob2021.get(`${code}|${nat}`) || 0) + pop);
}

const cob2011 = new Map();
const cob2011Lines = readFileSync(COB_2011, "utf8").split("\n").filter(l => l.trim());
for (let i = 1; i < cob2011Lines.length; i++) {
  const cols = parseCsvLine(cob2011Lines[i]);
  const code = cols[0], group = cols[2], pop = parseFloat(cols[3]);
  if (!code || isNaN(pop)) continue;
  // Try multiple mappings
  let nat = null;
  for (const [pattern, target] of Object.entries(COB_MAP_2011)) {
    if (group.includes(pattern) || pattern.includes(group)) { nat = target; break; }
  }
  if (group.includes("United Kingdom") || group.includes("UK")) nat = "UK-born";
  else if (group.includes("Europe") || group.includes("Africa") || group.includes("Asia") || group.includes("Americas")) nat = "Foreign-born";
  if (!nat) continue;
  cob2011.set(`${code}|${nat}`, (cob2011.get(`${code}|${nat}`) || 0) + pop);
}

// Nativity CCRs
const natAreas = [...new Set([...cob2021.keys()].map(k => k.split("|")[0]))].filter(c => cob2011.has(`${c}|UK-born`));
const natProjections = {};

for (const code of natAreas) {
  const uk21 = cob2021.get(`${code}|UK-born`) || 0;
  const fb21 = cob2021.get(`${code}|Foreign-born`) || 0;
  const uk11 = cob2011.get(`${code}|UK-born`) || 0;
  const fb11 = cob2011.get(`${code}|Foreign-born`) || 0;
  const total21 = uk21 + fb21;

  const ukCCR = uk11 > 10 ? Math.max(0.8, Math.min(1.2, uk21 / uk11)) : 1.0;
  const fbCCR = fb11 > 10 ? Math.max(0.8, Math.min(2.0, fb21 / fb11)) : 1.0;

  const timeline = { 2021: { ukBornPct: total21 > 0 ? Math.round(uk21/total21*1000)/10 : 0, foreignBornPct: total21 > 0 ? Math.round(fb21/total21*1000)/10 : 0 } };

  let ukPop = uk21, fbPop = fb21;
  for (const year of [2031, 2041, 2051]) {
    ukPop = Math.round(ukPop * ukCCR);
    fbPop = Math.round(fbPop * fbCCR);
    const total = ukPop + fbPop;
    timeline[year] = { ukBornPct: total > 0 ? Math.round(ukPop/total*1000)/10 : 0, foreignBornPct: total > 0 ? Math.round(fbPop/total*1000)/10 : 0 };
  }

  natProjections[code] = timeline;
}

console.log(`  ${natAreas.length} areas with nativity CCRs`);

// ============================================================
// UPDATE SITE DATA
// ============================================================
console.log("\nUpdating ethnic-projections.json...");
const existing = JSON.parse(readFileSync(SITE_OUTPUT, "utf8"));

for (const [code, area] of Object.entries(existing.areas)) {
  // Religion
  if (relProjections[code]) {
    area.religion = relProjections[code];
    // Muslim 2051 highlight
    const muslim51 = relProjections[code][2051]?.Muslim;
    if (muslim51 && muslim51 > 10) {
      area.muslimPct2051 = muslim51;
    }
  }

  // Nativity
  if (natProjections[code]) {
    area.nativity = natProjections[code];
    area.foreignBornPct2021 = natProjections[code][2021]?.foreignBornPct;
    area.foreignBornPct2051 = natProjections[code][2051]?.foreignBornPct;
  }
}

existing.modelVersion = "5.1-single-year-hp-religion-nativity";
existing.lastUpdated = new Date().toISOString().slice(0, 10);

writeFileSync(SITE_OUTPUT, JSON.stringify(existing, null, 2), "utf8");

// Diagnostics
console.log("\nSpot checks:");
for (const code of ["E07000117", "E06000008", "E08000025"]) {
  const a = existing.areas[code]; if (!a) continue;
  const r = a.religion;
  const n = a.nativity;
  console.log(`\n${a.areaName}:`);
  if (r) console.log(`  Religion 2021: Muslim=${r[2021]?.Muslim}%, Christian=${r[2021]?.Christian}%, None=${r[2021]?.["No religion"]}%`);
  if (r) console.log(`  Religion 2051: Muslim=${r[2051]?.Muslim}%, Christian=${r[2051]?.Christian}%, None=${r[2051]?.["No religion"]}%`);
  if (n) console.log(`  Nativity 2021: UK-born=${n[2021]?.ukBornPct}%, Foreign=${n[2021]?.foreignBornPct}%`);
  if (n) console.log(`  Nativity 2051: UK-born=${n[2051]?.ukBornPct}%, Foreign=${n[2051]?.foreignBornPct}%`);
}

console.log("\nDone.");
