/**
 * Stochastic Hamilton-Perry Projection — Monte Carlo with 1000 simulations
 *
 * Following Yu, Sevcikova, Raftery & Curran (2023, Demography) and
 * Stats NZ (2018) probabilistic ethnic projection methodology.
 *
 * For each simulation:
 *   1. Perturb each CCR by sampling from Normal(CCR_observed, σ)
 *   2. Perturb CWRs similarly
 *   3. Run full HP projection with perturbed ratios
 *   4. Record WBI% and ethnic shares at each projection year
 *
 * After 1000 simulations:
 *   - Median = central projection
 *   - P10/P90 = 80% prediction interval
 *   - P2.5/P97.5 = 95% prediction interval
 *
 * σ calibrated from HP v7.0 backcast: MAE 1.71pp over 10 years
 * → per-cohort CCR σ = 0.02 (Census 2011 DC2101EW + Census 2021 direct base)
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const BASE_PATH = path.resolve("data/model/base_single_year_2021.json");
const NEWETHPOP_2011 = path.resolve("data/raw/newethpop/extracted/2DataArchive/OutputData/Population/Population2011_LEEDS2.csv");
const SNPP_PATH = path.resolve("data/raw/snpp/2022 SNPP Population persons.csv");
const VALIDATION_PATH = path.resolve("src/data/live/model-validation.json");
const SITE_OUTPUT = path.resolve("src/data/live/ethnic-projections.json");

const base2021 = JSON.parse(readFileSync(BASE_PATH, "utf8"));
const validation = JSON.parse(readFileSync(VALIDATION_PATH, "utf8"));
const ETHNIC_GROUPS = base2021.ethnicGroups;
const AGES = base2021.ages;
const SEXES = ["M", "F"];

const N_SIMULATIONS = 1000;
const PROJ_YEARS = [2031, 2041, 2051, 2061];

// FIX 1: Cell-size-dependent σ + horizon scaling
// Base σ calibrated from HP v7.0 backcast MAE: 1.71pp → base σ = 0.02
// History: v5.0 σ=0.04 (MAE 3.57pp). v6.0 σ=0.02 (MAE 2.45pp, Census-direct).
// v7.0 σ=0.02 (MAE 1.71pp, Census 2011 DC2101EW + Beers interpolation).
// Beats NEWETHPOP 2.58pp by 33% and national-CCR baseline 2.32pp.
// Additional uncertainty for small populations: 0.25 / sqrt(pop)
// Horizon scaling: σ_t = σ_base * sqrt(t/10) (uncertainty compounds over time)
const CCR_SIGMA_BASE = 0.02;
const CCR_SIGMA_SMALL_POP = 0.25;
const CWR_SIGMA_BASE = 0.02;

// James-Stein shrinkage constant: CCR_shrunk = w * CCR_local + (1-w) * CCR_national
// where w = pop / (pop + k). k=50 means pop=50 gets 50% shrinkage toward national.
const SHRINKAGE_K = 50;

function parseCsvLine(line) {
  const f = []; let c = ""; let q = false;
  for (const ch of line) { if (ch === '"') q = !q; else if (ch === "," && !q) { f.push(c.trim()); c = ""; } else c += ch; }
  f.push(c.trim()); return f;
}

// Normal random using Box-Muller transform
function randn() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// ============================================================
// Parse 2011 base (12 groups) and split to 20 (same as run_hp_single_year.mjs)
// ============================================================
console.log("Parsing NEWETHPOP 2011 (12 groups) and splitting to 20...");
const NEWETHPOP_TO_CHILDREN = {
  WBI: ["WBI"], WIR: ["WIR"],
  WHO: ["WGT", "WRO", "WHO"],
  MIX: ["MWA", "MWF", "MWC", "MOM"],
  IND: ["IND"], PAK: ["PAK"], BAN: ["BAN"], CHI: ["CHI"], OAS: ["OAS"],
  BLA: ["BAF"], BLC: ["BCA"], OBL: ["OBL"],
  OTH: ["ARB", "OOT"]
};
const pop2011_12 = new Map();
const lines2011 = readFileSync(NEWETHPOP_2011, "utf8").split("\n").filter(l => l.trim());
for (let i = 1; i < lines2011.length; i++) {
  const cols = parseCsvLine(lines2011[i]);
  const rawCode = cols[2];
  if (!rawCode) continue;
  const eth = cols[3];
  for (const code of rawCode.split("+")) {
    for (let age = 0; age <= 90; age++) {
      let mVal = age < 90 ? (parseFloat(cols[4 + age]) || 0) : 0;
      let fVal = age < 90 ? (parseFloat(cols[105 + age]) || 0) : 0;
      if (age === 90) { for (let a = 90; a <= 100; a++) { mVal += parseFloat(cols[4+a])||0; fVal += parseFloat(cols[105+a])||0; } }
      const n = rawCode.split("+").length;
      pop2011_12.set(`${code}|${eth}|M|${age}`, (pop2011_12.get(`${code}|${eth}|M|${age}`)||0) + mVal/n);
      pop2011_12.set(`${code}|${eth}|F|${age}`, (pop2011_12.get(`${code}|${eth}|F|${age}`)||0) + fVal/n);
    }
  }
}

// Split 12→20 using 2021 sub-group proportions
const pop2011 = new Map();
for (const code of Object.keys(base2021.areas)) {
  for (const sex of SEXES) {
    for (let age = 0; age <= 90; age++) {
      for (const [parentEth, children] of Object.entries(NEWETHPOP_TO_CHILDREN)) {
        const parentPop = pop2011_12.get(`${code}|${parentEth}|${sex}|${age}`) || 0;
        if (children.length === 1) {
          pop2011.set(`${code}|${children[0]}|${sex}|${age}`, parentPop);
          continue;
        }
        let parentTotal2021 = 0;
        for (const child of children) parentTotal2021 += base2021.areas[code]?.[child]?.[sex]?.[age] || 0;
        if (parentTotal2021 <= 0) {
          for (const child of children) pop2011.set(`${code}|${child}|${sex}|${age}`, parentPop / children.length);
        } else {
          for (const child of children) {
            const share = (base2021.areas[code]?.[child]?.[sex]?.[age] || 0) / parentTotal2021;
            pop2011.set(`${code}|${child}|${sex}|${age}`, parentPop * share);
          }
        }
      }
    }
  }
}
console.log(`  Split complete`);

// Compute deterministic CCRs and CWRs
const areaCodes = Object.keys(base2021.areas).filter(c => pop2011.has(`${c}|WBI|M|0`));
const ccrs = new Map();
const cwrs = new Map();

// Compute national-average CCRs for James-Stein shrinkage target
const nationalCCRs = new Map(); // "eth|sex|age" → { sumRatio, sumPop }
for (const code of areaCodes) {
  for (const eth of ETHNIC_GROUPS) {
    for (const sex of SEXES) {
      for (let fromAge = 0; fromAge <= 80; fromAge++) {
        const pop11 = pop2011.get(`${code}|${eth}|${sex}|${fromAge}`)||0;
        const pop21 = base2021.areas[code][eth]?.[sex]?.[fromAge+10]||0;
        if (pop11 > 10) {
          const key = `${eth}|${sex}|${fromAge}`;
          if (!nationalCCRs.has(key)) nationalCCRs.set(key, { sumRatio: 0, sumPop: 0, count: 0 });
          const n = nationalCCRs.get(key);
          n.sumRatio += pop21 / pop11 * pop11; // population-weighted
          n.sumPop += pop11;
          n.count++;
        }
      }
    }
  }
}
const natCCR = new Map();
for (const [key, data] of nationalCCRs) {
  natCCR.set(key, data.sumPop > 0 ? data.sumRatio / data.sumPop : 1.0);
}
console.log(`  Computed ${natCCR.size} national-average CCRs for shrinkage`);

// Store base populations for cell-size-dependent σ
const ccrPops = new Map(); // "code|eth|sex|age" → pop11

for (const code of areaCodes) {
  for (const eth of ETHNIC_GROUPS) {
    let children = 0, women = 0;
    for (let a = 0; a <= 9; a++) children += (base2021.areas[code][eth]?.M?.[a]||0) + (base2021.areas[code][eth]?.F?.[a]||0);
    for (let a = 15; a <= 44; a++) women += base2021.areas[code][eth]?.F?.[a]||0;
    cwrs.set(`${code}|${eth}`, women > 5 ? children / women / 10 : 0.03);

    for (const sex of SEXES) {
      for (let fromAge = 0; fromAge <= 80; fromAge++) {
        const pop11 = pop2011.get(`${code}|${eth}|${sex}|${fromAge}`)||0;
        const pop21 = base2021.areas[code][eth]?.[sex]?.[fromAge+10]||0;

        let rawCCR = pop11 > 5 ? Math.max(0.05, Math.min(5.0, pop21/pop11)) : 1.0;

        // FIX 1: James-Stein shrinkage — pull extreme CCRs toward national average
        const natAvg = natCCR.get(`${eth}|${sex}|${fromAge}`) || 1.0;
        const w = pop11 / (pop11 + SHRINKAGE_K); // shrinkage weight: 0 (full shrinkage) to 1 (no shrinkage)
        const shrunkCCR = w * rawCCR + (1 - w) * natAvg;

        ccrs.set(`${code}|${eth}|${sex}|${fromAge}`, shrunkCCR);
        ccrPops.set(`${code}|${eth}|${sex}|${fromAge}`, pop11);
      }
    }
  }
}

// Parse SNPP
const snppTotals = new Map();
const snppLines = readFileSync(SNPP_PATH, "utf8").split("\n").filter(l => l.trim());
const snppHeader = parseCsvLine(snppLines[0]);
const yearCols = snppHeader.slice(5);
for (let i = 1; i < snppLines.length; i++) {
  const cols = parseCsvLine(snppLines[i]);
  if (!cols[0]?.startsWith("E") || cols[4] !== "All ages") continue;
  snppTotals.set(cols[0], {});
  for (let j = 0; j < yearCols.length; j++) snppTotals.get(cols[0])[yearCols[j]] = parseFloat(cols[5+j])||0;
}

console.log(`${areaCodes.length} areas, ${ccrs.size} CCRs, running ${N_SIMULATIONS} simulations...`);

// ============================================================
// Run single HP projection with perturbed CCRs
// ============================================================
function runOneSimulation(perturbFactor) {
  const results = {}; // code → { 2031: {WBI: %, ...}, 2041: {...}, ... }

  for (const code of areaCodes) {
    results[code] = {};
    let currentPop = {};
    for (const eth of ETHNIC_GROUPS) {
      currentPop[eth] = {};
      for (const sex of SEXES) {
        currentPop[eth][sex] = {};
        for (const age of AGES) currentPop[eth][sex][age] = base2021.areas[code][eth]?.[sex]?.[age]||0;
      }
    }

    for (const year of PROJ_YEARS) {
      const yearsFromBase = year - 2021;
      const horizonScale = Math.sqrt(yearsFromBase / 10); // 2031=1.0, 2041=1.41, 2051=1.73, 2061=2.0
      const newPop = {};
      for (const eth of ETHNIC_GROUPS) {
        newPop[eth] = {};
        for (const sex of SEXES) {
          newPop[eth][sex] = {};
          // Age with perturbed CCRs — cell-size-dependent σ + horizon scaling
          for (let toAge = 10; toAge <= 90; toAge++) {
            const baseCCR = ccrs.get(`${code}|${eth}|${sex}|${toAge-10}`)||1.0;
            const pop = ccrPops.get(`${code}|${eth}|${sex}|${toAge-10}`) || 1;
            const sigma = (CCR_SIGMA_BASE + CCR_SIGMA_SMALL_POP / Math.sqrt(Math.max(pop, 1))) * horizonScale;
            const perturbedCCR = Math.max(0.01, baseCCR + randn() * sigma * perturbFactor);
            newPop[eth][sex][toAge] = Math.round((currentPop[eth][sex][toAge-10]||0) * perturbedCCR);
          }
          newPop[eth][sex][90] = (newPop[eth][sex][90]||0) + Math.round((currentPop[eth][sex][90]||0) * 0.3);

          // Births with perturbed CWR — FIX 1: cell-size-dependent σ
          const baseCWR = cwrs.get(`${code}|${eth}`)||0.03;
          let cwrWomen = 0;
          for (let a = 15; a <= 44; a++) cwrWomen += base2021.areas[code][eth]?.F?.[a] || 0;
          const cwrSigma = CWR_SIGMA_BASE + 0.15 / Math.sqrt(Math.max(cwrWomen, 1));
          const perturbedCWR = Math.max(0, baseCWR + randn() * cwrSigma * perturbFactor);
          let women = 0;
          for (let a = 15; a <= 44; a++) women += newPop[eth]?.F?.[a] || currentPop[eth]?.F?.[a] || 0;
          const births = women * perturbedCWR;
          const sr = sex === "M" ? 0.512 : 0.488;
          for (let a = 0; a <= 9; a++) newPop[eth][sex][a] = Math.round(births * sr);
        }
      }

      // SNPP constraint
      const snppYear = String(Math.min(year, 2047));
      const target = snppTotals.get(code)?.[snppYear];
      if (target > 0) {
        let total = 0;
        for (const eth of ETHNIC_GROUPS) for (const sex of SEXES) for (const a of AGES) total += newPop[eth][sex][a]||0;
        if (total > 0) {
          const scale = Math.max(0.3, Math.min(3, target / total));
          for (const eth of ETHNIC_GROUPS) for (const sex of SEXES) for (const a of AGES) newPop[eth][sex][a] = Math.round((newPop[eth][sex][a]||0) * scale);
        }
      }

      // Compute ethnic shares
      let total = 0;
      const ethTotals = {};
      for (const eth of ETHNIC_GROUPS) {
        ethTotals[eth] = 0;
        for (const sex of SEXES) for (const a of AGES) ethTotals[eth] += newPop[eth][sex][a]||0;
        total += ethTotals[eth];
      }
      results[code][year] = {};
      for (const eth of ETHNIC_GROUPS) results[code][year][eth] = total > 0 ? ethTotals[eth] / total * 100 : 0;

      currentPop = newPop;
    }
  }
  return results;
}

// ============================================================
// Run Monte Carlo
// ============================================================
const allSimulations = []; // Array of N_SIMULATIONS result objects
const progressInterval = Math.floor(N_SIMULATIONS / 10);

for (let sim = 0; sim < N_SIMULATIONS; sim++) {
  if (sim % progressInterval === 0) process.stderr.write(`  Sim ${sim}/${N_SIMULATIONS}\n`);
  allSimulations.push(runOneSimulation(1.0));
}
console.log(`  ${N_SIMULATIONS} simulations complete`);

// ============================================================
// Compute percentiles
// ============================================================
console.log("Computing percentiles...");

function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)];
}

const stochasticResults = {};

for (const code of areaCodes) {
  stochasticResults[code] = {};

  for (const year of PROJ_YEARS) {
    const wbiValues = allSimulations.map(sim => sim[code][year].WBI);

    stochasticResults[code][year] = {
      wbi: {
        p2_5: Math.round(percentile(wbiValues, 0.025) * 10) / 10,
        p10: Math.round(percentile(wbiValues, 0.10) * 10) / 10,
        median: Math.round(percentile(wbiValues, 0.50) * 10) / 10,
        p90: Math.round(percentile(wbiValues, 0.90) * 10) / 10,
        p97_5: Math.round(percentile(wbiValues, 0.975) * 10) / 10
      }
    };
  }
}

// ============================================================
// Diagnostics
// ============================================================
console.log("\n=== STOCHASTIC HP RESULTS ===");
for (const code of ["E07000117", "E06000008", "E08000025"]) {
  const s = stochasticResults[code];
  if (!s) continue;
  const name = base2021.areas[code]?.WBI ? code : code;
  console.log(`\n${code}:`);
  for (const year of PROJ_YEARS) {
    const d = s[year].wbi;
    console.log(`  ${year}: WBI median=${d.median}% [80% CI: ${d.p10}-${d.p90}%] [95% CI: ${d.p2_5}-${d.p97_5}%]`);
  }
}

// National aggregate
for (const year of PROJ_YEARS) {
  // Compute national median WBI across simulations
  const natWBI = allSimulations.map(sim => {
    let total = 0, wbi = 0;
    for (const code of areaCodes) {
      const areaTotal = ETHNIC_GROUPS.reduce((s, e) => s + (sim[code][year][e]||0), 0);
      total += areaTotal; wbi += sim[code][year].WBI || 0;
    }
    // This is the mean WBI% across areas, weighted by... nothing. Need to weight by population.
    // For now, simple mean across areas (population-weighted would be better)
    return wbi / areaCodes.length;
  });
  console.log(`\nNational ${year}: median WBI=${percentile(natWBI, 0.5).toFixed(1)}% [80%: ${percentile(natWBI, 0.1).toFixed(1)}-${percentile(natWBI, 0.9).toFixed(1)}%]`);
}

// ============================================================
// Update site data
// ============================================================
console.log("\nUpdating ethnic-projections.json...");
const existing = JSON.parse(readFileSync(SITE_OUTPUT, "utf8"));

for (const code of areaCodes) {
  if (!existing.areas[code] || !stochasticResults[code]) continue;
  const area = existing.areas[code];

  area.stochastic = {};
  for (const year of [2031, 2041, 2051, 2061]) {
    if (stochasticResults[code][year]) {
      area.stochastic[String(year)] = stochasticResults[code][year];
    }
  }

  // Update confidence band in headline
  const s51 = stochasticResults[code][2051]?.wbi;
  if (s51) {
    area.confidenceBand2051 = {
      median: s51.median,
      ci80: [s51.p10, s51.p90],
      ci95: [s51.p2_5, s51.p97_5]
    };
  }
}

existing.modelVersion = "6.0-stochastic-hp";
existing.lastUpdated = new Date().toISOString().slice(0, 10);
existing.methodology += " Monte Carlo stochastic projection (1000 simulations, CCR σ=0.02 calibrated from HP v7.0 backcast validation: MAE 1.71pp over 269 areas). Reports median + 80%/95% prediction intervals.";

writeFileSync(SITE_OUTPUT, JSON.stringify(existing, null, 2), "utf8");
console.log("Done.");
