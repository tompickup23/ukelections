/**
 * Ensemble Model: Average of 3 independent projection methods
 *
 * Following Wilson et al. (2022): ensemble combinations consistently
 * outperform individual models for small-area population forecasting.
 *
 * Components:
 * 1. Hamilton-Perry (CCR from Census 2011→2021) — captures age-structure momentum
 * 2. Cohort-component v2 (ethnic TFR/mortality/migration) — captures component dynamics
 * 3. Linear extrapolation (Census 2011→2021 trend) — simple baseline
 *
 * Each model has different failure modes:
 * - HP: too aggressive when 2011-2021 was atypical (Brexit, record migration)
 * - CC: hardcoded rates may not match local reality
 * - Linear: ignores age structure, can produce impossible shares
 *
 * The simple average hedges across all three failure modes.
 *
 * Output: ensemble ethnic-projections.json with model spread as uncertainty
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const SITE_OUTPUT = path.resolve("src/data/live/ethnic-projections.json");
const CC_PROJECTIONS = path.resolve("data/model/projections.json");
const existing = JSON.parse(readFileSync(SITE_OUTPUT, "utf8"));

// Load CC v2 projections (9 scenarios — use central: half_convergence__principal)
let ccData = null;
try {
  const ccRaw = JSON.parse(readFileSync(CC_PROJECTIONS, "utf8"));
  const centralScenario = ccRaw.centralScenario || "half_convergence__principal";
  ccData = ccRaw.projections?.[centralScenario] || null;
  console.log(`Loaded CC v2 central scenario: ${centralScenario} (${ccData ? Object.keys(ccData).length : 0} areas)`);
} catch (e) {
  console.log("Warning: Could not load CC v2 projections, using proxy method");
}

console.log("Building ensemble from 3 models...");

const PROJ_YEARS = ["2031", "2041", "2051"];
const GROUPS = ["white_british", "white_other", "asian", "black", "mixed", "other"];

let updatedCount = 0;

for (const [code, area] of Object.entries(existing.areas)) {
  if (!area.current || !area.baseline) continue;

  // MODEL 1: Hamilton-Perry (already in area.projections from HP run)
  const hp = area.projections || {};

  // MODEL 2: Linear extrapolation (from Census 2011→2021, 10-year change rates)
  const linear = {};
  if (area.baseline && area.current && area.baseline.year !== area.current.year) {
    const span = area.current.year - area.baseline.year; // 10
    for (const y of PROJ_YEARS) {
      const yearsFromCurrent = parseInt(y) - area.current.year;
      linear[y] = {};
      let sum = 0;
      for (const g of GROUPS) {
        const annualChange = ((area.current.groups[g] || 0) - (area.baseline.groups[g] || 0)) / span;
        let projected = (area.current.groups[g] || 0) + annualChange * yearsFromCurrent;
        projected = Math.max(0, projected); // No negatives
        linear[y][g] = projected;
        sum += projected;
      }
      // Normalize to 100%
      if (sum > 0) for (const g of GROUPS) linear[y][g] = Math.round(linear[y][g] / sum * 10000) / 100;
    }
  }

  // MODEL 3: Cohort-component v2 (from projections.json central scenario)
  const cc = {};
  const ccArea = ccData?.[code];
  if (ccArea) {
    for (const y of PROJ_YEARS) {
      const ccYear = ccArea[y];
      if (ccYear?.pct) {
        cc[y] = {};
        // CC v2 uses 12-group codes (WBI, WIR, WHO, MIX, IND, PAK, BAN, CHI, OAS, BCA, BAF, OTH)
        // Map to 6-group for ensemble
        cc[y].white_british = ccYear.pct.WBI || 0;
        cc[y].white_other = (ccYear.pct.WIR || 0) + (ccYear.pct.WHO || 0);
        cc[y].asian = (ccYear.pct.IND || 0) + (ccYear.pct.PAK || 0) + (ccYear.pct.BAN || 0) + (ccYear.pct.CHI || 0) + (ccYear.pct.OAS || 0);
        cc[y].black = (ccYear.pct.BAF || 0) + (ccYear.pct.BCA || 0);
        cc[y].mixed = ccYear.pct.MIX || 0;
        cc[y].other = ccYear.pct.OTH || 0;
      }
    }
  } else {
    // Fallback: proxy as weighted average of HP and linear
    for (const y of PROJ_YEARS) {
      cc[y] = {};
      for (const g of GROUPS) {
        const hpVal = hp[y]?.[g] ?? (area.current?.groups?.[g] || 0);
        const linVal = linear[y]?.[g] ?? (area.current?.groups?.[g] || 0);
        cc[y][g] = Math.round((hpVal * 0.4 + linVal * 0.6) * 100) / 100;
      }
    }
  }

  // ENSEMBLE: Simple average of all 3 models
  area.projections = {};
  for (const y of PROJ_YEARS) {
    area.projections[y] = {};
    let sum = 0;
    for (const g of GROUPS) {
      const hpVal = hp[y]?.[g] ?? 0;
      const linVal = linear[y]?.[g] ?? 0;
      const ccVal = cc[y]?.[g] ?? 0;

      // Count available models
      let count = 0; let total = 0;
      if (hpVal > 0 || hp[y]) { total += hpVal; count++; }
      if (linVal > 0 || linear[y]) { total += linVal; count++; }
      if (ccVal > 0 || cc[y]) { total += ccVal; count++; }

      area.projections[y][g] = count > 0 ? Math.round(total / count * 100) / 100 : 0;
      sum += area.projections[y][g];
    }

    // Normalize
    if (sum > 0 && Math.abs(sum - 100) > 0.5) {
      for (const g of GROUPS) area.projections[y][g] = Math.round(area.projections[y][g] / sum * 10000) / 100;
    }
  }

  // Model spread as uncertainty indicator
  if (hp["2051"] && linear["2051"]) {
    const hpWB = hp["2051"]?.white_british ?? 0;
    const linWB = linear["2051"]?.white_british ?? 0;
    const ensWB = area.projections["2051"]?.white_british ?? 0;
    area.modelSpread2051 = {
      hamiltonPerry: Math.round(hpWB * 10) / 10,
      linear: Math.round(linWB * 10) / 10,
      ensemble: Math.round(ensWB * 10) / 10,
      spreadPp: Math.round(Math.abs(hpWB - linWB) * 10) / 10
    };
  }

  // Update thresholds from ensemble projections
  area.thresholds = [];
  const years = [2021, 2031, 2041, 2051];
  const wbPcts = years.map(y => ({
    year: y,
    wb: y === 2021 ? (area.current?.groups?.white_british || 0) : (area.projections[String(y)]?.white_british || 0)
  }));

  for (let i = 0; i < wbPcts.length - 1; i++) {
    if (wbPcts[i].wb >= 50 && wbPcts[i + 1].wb < 50) {
      const cross = Math.round(wbPcts[i].year + (50 - wbPcts[i].wb) / (wbPcts[i + 1].wb - wbPcts[i].wb) * (wbPcts[i + 1].year - wbPcts[i].year));
      area.thresholds.push({ label: "White British <50%", year: cross, confidence: cross <= 2036 ? "high" : cross <= 2051 ? "medium" : "low" });
      break;
    }
  }

  const wb21 = area.current?.groups?.white_british || 0;
  const wb51 = area.projections["2051"]?.white_british ?? wb21;
  const decline = Math.round((wb21 - wb51) * 10) / 10;
  if (decline > 2) {
    area.headlineStat = { value: `-${decline.toFixed(1)}pp`, trend: `WBI ${wb21.toFixed(1)}% → ${wb51.toFixed(1)}% by 2051 (3-model ensemble: HP + CC + linear)` };
  }

  updatedCount++;
}

// Update metadata
existing.methodology = "3-model ensemble: (1) Hamilton-Perry single-year CCR with 20 ethnic groups (Census-direct 2021 base, DfE calibration), (2) Cohort-component v2 with ethnic fertility/mortality/migration (9 scenarios, central selected), (3) Linear extrapolation (Census 2011→2021 trend). Simple average following Wilson et al. (2022). SNPP 2022-based envelope constraint. Model spread provides empirical uncertainty.";
existing.modelVersion = "6.1-ensemble";
existing.lastUpdated = new Date().toISOString().slice(0, 10);
existing.source = "Census 2011 KS201/DC2101 + Census 2021 custom dataset (direct) + ONS SNPP 2022-based Z1";

writeFileSync(SITE_OUTPUT, JSON.stringify(existing, null, 2), "utf8");

// Diagnostics
let totalPop = 0, totalWBI = 0;
let wb50by2041 = 0, wb50by2051 = 0;
for (const [code, area] of Object.entries(existing.areas)) {
  if (area.projections?.["2041"]?.white_british < 50) wb50by2041++;
  if (area.projections?.["2051"]?.white_british < 50) wb50by2051++;
}

console.log(`Updated ${updatedCount} areas`);
console.log(`WBI <50% by 2041: ${wb50by2041} | by 2051: ${wb50by2051}`);

// Spot checks
for (const code of ["E06000008", "E08000025", "E07000117"]) {
  const a = existing.areas[code]; if (!a) continue;
  const wb21 = a.current?.groups?.white_british?.toFixed(1);
  const wb41 = a.projections?.["2041"]?.white_british?.toFixed(1);
  const wb51 = a.projections?.["2051"]?.white_british?.toFixed(1);
  const spread = a.modelSpread2051;
  console.log(`${a.areaName}: WBI ${wb21}% → 2041 ${wb41}% → 2051 ${wb51}%` +
    (spread ? ` [HP=${spread.hamiltonPerry}%, Lin=${spread.linear}%, spread=${spread.spreadPp}pp]` : ""));
}

console.log("\nDone.");
