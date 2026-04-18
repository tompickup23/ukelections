/**
 * Integrate all supplementary data dimensions into ethnic-projections.json
 *
 * Adds:
 * - English proficiency (TS029) — observed 2021
 * - Language (TS024) — observed 2021
 * - Convergence index (Index of Dissimilarity) — computed from ethnic composition
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const SITE_OUTPUT = path.resolve("src/data/live/ethnic-projections.json");
const PROFICIENCY_PATH = path.resolve("data/raw/census_base/ts029_english_proficiency_2021.csv");

const existing = JSON.parse(readFileSync(SITE_OUTPUT, "utf8"));

function parseCsvLine(line) {
  const f = []; let c = ""; let q = false;
  for (const ch of line) { if (ch === '"') q = !q; else if (ch === "," && !q) { f.push(c.trim()); c = ""; } else c += ch; }
  f.push(c.trim()); return f;
}

// ============================================================
// English Proficiency (TS029)
// ============================================================
console.log("Integrating English proficiency...");
const profLines = readFileSync(PROFICIENCY_PATH, "utf8").split("\n").filter(l => l.trim());

const proficiency = new Map();
for (let i = 1; i < profLines.length; i++) {
  const cols = parseCsvLine(profLines[i]);
  const code = cols[0], name = cols[2], pop = parseFloat(cols[3]);
  if (!code || isNaN(pop)) continue;
  if (!proficiency.has(code)) proficiency.set(code, { total: 0, english: 0, notEnglish: 0, canSpeak: 0, cannotSpeak: 0 });
  const p = proficiency.get(code);

  if (name?.includes("Total")) p.total = pop;
  else if (name?.includes("Main language is English")) p.english = pop;
  else if (name?.includes("Main language is not English")) p.notEnglish += pop;
  else if (name?.includes("Can speak English")) p.canSpeak += pop;
  else if (name?.includes("Cannot speak English")) p.cannotSpeak += pop;
}

let profCount = 0;
for (const [code, area] of Object.entries(existing.areas)) {
  const p = proficiency.get(code);
  if (!p || p.total === 0) continue;

  area.englishProficiency = {
    mainLanguageEnglishPct: Math.round(p.english / p.total * 1000) / 10,
    notEnglishPct: Math.round(p.notEnglish / p.total * 1000) / 10,
    cannotSpeakEnglishPct: Math.round(p.cannotSpeak / p.total * 1000) / 10,
    source: "Census 2021 TS029"
  };
  profCount++;
}
console.log(`  ${profCount} areas with English proficiency data`);

// ============================================================
// C2: Convergence/Divergence Index
// ============================================================
console.log("Computing convergence indices...");

// Index of Dissimilarity: measures how evenly distributed ethnic groups are
// D = 0.5 × Σ |p_i - P| where p_i = area ethnic share, P = national ethnic share
// D ranges 0 (perfectly even) to ~1 (completely segregated)

// National ethnic composition (from Census 2021 base)
const national = { white_british: 0, white_other: 0, asian: 0, black: 0, mixed: 0, other: 0, total: 0 };
for (const [, area] of Object.entries(existing.areas)) {
  if (!area.current?.groups_absolute) continue;
  for (const g of Object.keys(national)) {
    if (g === "total") national.total += area.current.total_population || 0;
    else national[g] += area.current.groups_absolute[g] || 0;
  }
}
const nationalPct = {};
for (const g of ["white_british", "white_other", "asian", "black", "mixed", "other"]) {
  nationalPct[g] = national.total > 0 ? national[g] / national.total * 100 : 0;
}

let divCount = 0;
for (const [code, area] of Object.entries(existing.areas)) {
  if (!area.current?.groups) continue;

  // Dissimilarity from national composition
  let dissimilarity = 0;
  for (const g of ["white_british", "white_other", "asian", "black", "mixed", "other"]) {
    dissimilarity += Math.abs((area.current.groups[g] || 0) - nationalPct[g]);
  }
  dissimilarity = Math.round(dissimilarity / 2 * 10) / 10; // Scale to 0-100

  // Entropy (diversity) index: H = -Σ p_i × ln(p_i) / ln(n)
  let entropy = 0;
  for (const g of ["white_british", "white_other", "asian", "black", "mixed", "other"]) {
    const p = (area.current.groups[g] || 0) / 100;
    if (p > 0) entropy -= p * Math.log(p);
  }
  entropy = Math.round(entropy / Math.log(6) * 100) / 100; // Normalise to 0-1

  // Classify
  let diversityLevel;
  if (entropy > 0.7) diversityLevel = "highly diverse";
  else if (entropy > 0.5) diversityLevel = "diverse";
  else if (entropy > 0.3) diversityLevel = "moderately diverse";
  else diversityLevel = "low diversity";

  area.diversityIndex = {
    dissimilarity,
    entropy,
    diversityLevel,
    source: "Computed from Census 2021 ethnic composition"
  };
  divCount++;
}
console.log(`  ${divCount} areas with diversity indices`);

// Update metadata
existing.modelVersion = "6.1-stochastic-hp-full";
existing.lastUpdated = new Date().toISOString().slice(0, 10);

writeFileSync(SITE_OUTPUT, JSON.stringify(existing, null, 2), "utf8");

// Spot checks
for (const code of ["E07000117", "E06000008", "E08000025", "E09000002"]) {
  const a = existing.areas[code]; if (!a) continue;
  console.log(`\n${a.areaName}:`);
  if (a.englishProficiency) console.log(`  English: ${a.englishProficiency.mainLanguageEnglishPct}%, Cannot speak: ${a.englishProficiency.cannotSpeakEnglishPct}%`);
  if (a.diversityIndex) console.log(`  Entropy: ${a.diversityIndex.entropy}, Level: ${a.diversityIndex.diversityLevel}`);
}

console.log("\nDone.");
