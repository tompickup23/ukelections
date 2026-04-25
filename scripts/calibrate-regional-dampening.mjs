#!/usr/bin/env node
// P5: Per-region dampening calibration.
//
// Run the 2024 backtest with multiple dampening factors per region and pick
// the per-region value that minimises major-party MAE. Persist the calibrated
// values to data/calibration/regional-dampening.json so the bulk-predict step
// can read them.
//
// Region groupings (broad — borough type proxy):
//   - london (London boroughs)
//   - metropolitan (English met boroughs / unitaries on cycle)
//   - county_district (2-tier districts in counties with 2025 elections)
//   - other (everything else: districts in 1-tier counties, unitaries, etc.)

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildWardData, restrictToBallot } from "../src/lib/adaptDcToWardData.js";
import { predictWard, DEFAULT_ASSUMPTIONS } from "../src/lib/electionModel.js";
import {
  UK_WESTMINSTER_2019_GE_RESULT,
  UK_WESTMINSTER_2024_MAY_AVERAGE,
} from "../src/lib/nationalPolling.js";
import { DISTRICT_TO_PARENT_COUNTY_2025 } from "../src/lib/county2025.js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DAMPENING_GRID = [0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.50, 0.65, 0.80];

// London borough slugs (32) — all in our 2026 scope (all-out cycle).
const LONDON_BOROUGHS = new Set([
  "barking-and-dagenham", "barnet", "bexley", "brent", "bromley", "camden",
  "city-of-london", "croydon", "ealing", "enfield", "greenwich", "hackney",
  "hammersmith-and-fulham", "haringey", "harrow", "havering", "hillingdon",
  "hounslow", "islington", "kensington-and-chelsea", "kingston-upon-thames",
  "lambeth", "lewisham", "merton", "newham", "redbridge", "richmond-upon-thames",
  "southwark", "sutton", "tower-hamlets", "waltham-forest", "wandsworth",
  "westminster",
]);

const METROPOLITAN_BOROUGHS = new Set([
  "barnsley", "birmingham", "bolton", "bradford", "bury", "calderdale",
  "coventry", "doncaster", "dudley", "gateshead", "kirklees", "knowsley",
  "leeds", "liverpool", "manchester", "newcastle-upon-tyne", "north-tyneside",
  "oldham", "rochdale", "rotherham", "salford", "sandwell", "sefton",
  "sheffield", "solihull", "south-tyneside", "st-helens", "stockport",
  "sunderland", "tameside", "trafford", "wakefield", "walsall", "wigan",
  "wirral", "wolverhampton",
]);

function regionOf(councilSlug) {
  if (LONDON_BOROUGHS.has(councilSlug)) return "london";
  if (METROPOLITAN_BOROUGHS.has(councilSlug)) return "metropolitan";
  if (DISTRICT_TO_PARENT_COUNTY_2025[councilSlug]) return "county_district";
  return "other";
}

function readJson(p) { return JSON.parse(readFileSync(path.join(ROOT, p), "utf8")); }

function writeJson(rel, payload) {
  const full = path.join(ROOT, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, JSON.stringify(payload, null, 2));
}

function dcPartyToCanonical(dcName) {
  if (!dcName) return "Unknown";
  const p = String(dcName).trim();
  if (/^Labour Party$/i.test(p)) return "Labour";
  if (/^Labour and Co-operative Party$/i.test(p)) return "Labour";
  if (/^Conservative and Unionist Party$/i.test(p)) return "Conservative";
  if (/^Liberal Democrats?$/i.test(p)) return "Liberal Democrats";
  if (/^Reform UK$/i.test(p)) return "Reform UK";
  if (/^Green Party$/i.test(p)) return "Green Party";
  if (/independent/i.test(p)) return "Independent";
  return p;
}

function actualSharesFromResult(result) {
  const total = (result.candidates || []).reduce((s, c) => s + (c.votes || 0), 0);
  if (total <= 0) return null;
  const shares = {};
  for (const c of result.candidates) {
    const p = dcPartyToCanonical(c.party_name);
    shares[p] = (shares[p] || 0) + (c.votes / total);
  }
  return shares;
}

function buildHistoricalWardData(currentWard, history2024Date, fullHistoryBundle) {
  const wardKey = `${currentWard.tier}::${currentWard.council_slug}::${currentWard.ward_slug}`;
  const ballotIds = (fullHistoryBundle.by_ward_slug || {})[wardKey] || [];
  const priorBallots = ballotIds
    .map((id) => fullHistoryBundle.by_ballot[id])
    .filter((r) => r && r.election_date < history2024Date);
  const narrowedBundle = {
    by_ballot: Object.fromEntries(priorBallots.map((r) => [r.ballot_paper_id, r])),
    by_ward_slug: { [wardKey]: priorBallots.map((r) => r.ballot_paper_id) },
  };
  return buildWardData(currentWard, narrowedBundle);
}

function sumMajorPartyMae(rows) {
  // Mean abs error over Labour/Conservative/Reform UK/Liberal Democrats/Green Party
  const major = ["Labour", "Conservative", "Reform UK", "Liberal Democrats", "Green Party"];
  let sumAbs = 0; let n = 0;
  for (const r of rows) {
    if (!r.predicted_shares || !r.actual_shares) continue;
    for (const p of major) {
      const pred = r.predicted_shares[p] || 0;
      const act = r.actual_shares[p] || 0;
      sumAbs += Math.abs(pred - act);
      n += 1;
    }
  }
  return n ? sumAbs / n : null;
}

function runOneScenario(rowsByRegion, dampening, region) {
  const subset = rowsByRegion[region] || [];
  const reroll = [];
  for (const baseRow of subset) {
    // Re-predict with overridden dampening assumption
    const wd = baseRow._wardData;
    const ladImd = baseRow._ladImd;
    const ladProj = baseRow._ladProj;
    const ward = baseRow._ward;
    const actualResult = baseRow._actualResult;
    const assumptions = { ...DEFAULT_ASSUMPTIONS, nationalToLocalDampening: dampening };
    const result = predictWard(
      wd, assumptions,
      UK_WESTMINSTER_2024_MAY_AVERAGE.shares,
      UK_WESTMINSTER_2019_GE_RESULT.shares,
      ladProj ? { white_british_pct: ladProj.white_british_pct_projected, asian_pct: ladProj.asian_pct_projected } : null,
      ladImd ? { avg_imd_decile: ladImd.avg_imd_decile } : null,
      UK_WESTMINSTER_2019_GE_RESULT.shares,
      null, null, null, null,
      ladProj ? { white_british_pct_projected: ladProj.white_british_pct_projected, asian_pct_projected: ladProj.asian_pct_projected } : null,
    );
    if (!result.prediction) continue;
    const partiesIn2024 = new Set((actualResult.candidates || []).map((c) => dcPartyToCanonical(c.party_name)).filter(Boolean));
    const { prediction: filtered } = restrictToBallot(result.prediction, partiesIn2024);
    const predictedShares = Object.fromEntries(Object.entries(filtered || {}).map(([p, d]) => [p, d.pct]));
    reroll.push({ predicted_shares: predictedShares, actual_shares: baseRow.actual_shares });
  }
  return { mae: sumMajorPartyMae(reroll), n: reroll.length };
}

function main() {
  console.log("Loading inputs...");
  const identity = readJson("data/identity/wards-may-2026.json");
  const history = readJson("data/history/dc-historic-results.json");
  const slugMap = readJson("data/identity/council-slug-to-lad24.json");
  const laProj = readJson("data/features/la-ethnic-projections.json");
  const laImd = readJson("data/features/la-imd.json");
  const target = "2024-05-02";

  console.log("Building per-ward backtest fixtures...");
  const rowsByRegion = { london: [], metropolitan: [], county_district: [], other: [] };
  for (const ward of identity.wards) {
    if (ward.tier !== "local") continue;
    const wardKey = `${ward.tier}::${ward.council_slug}::${ward.ward_slug}`;
    const ballotIds = (history.by_ward_slug || {})[wardKey] || [];
    const actualResult = ballotIds.map((id) => history.by_ballot[id]).find((r) => r && r.election_date === target && !r.is_by_election);
    if (!actualResult) continue;
    const wd = buildHistoricalWardData(ward, target, history);
    if (!wd.history.length) continue;
    const ladCode = slugMap.map[ward.council_slug]?.lad24cd;
    const ladImdRow = ladCode ? laImd.imd[ladCode] : null;
    const ladProjRow = ladCode ? laProj.projections[ladCode] : null;
    const region = regionOf(ward.council_slug);
    const actualShares = actualSharesFromResult(actualResult);
    if (!actualShares) continue;
    rowsByRegion[region].push({
      _wardData: wd, _ward: ward, _actualResult: actualResult, _ladImd: ladImdRow, _ladProj: ladProjRow,
      actual_shares: actualShares,
    });
  }
  console.log(`  Per-region fixture counts: ${Object.fromEntries(Object.entries(rowsByRegion).map(([k, v]) => [k, v.length]))}`);

  console.log("\nGrid search per region:");
  const calibration = {};
  for (const region of Object.keys(rowsByRegion)) {
    if (rowsByRegion[region].length === 0) {
      calibration[region] = { dampening: 0.65, mae: null, ward_count: 0, note: "no fixtures available — defaulting to 0.65" };
      continue;
    }
    const trials = [];
    for (const damp of DAMPENING_GRID) {
      const { mae, n } = runOneScenario(rowsByRegion, damp, region);
      trials.push({ dampening: damp, mae, ward_count: n });
      console.log(`  ${region.padEnd(18)} damp=${damp.toFixed(2)}  MAE=${(mae * 100).toFixed(2)}pp  (n=${n})`);
    }
    const best = trials.sort((a, b) => a.mae - b.mae)[0];
    calibration[region] = { dampening: best.dampening, mae: best.mae, ward_count: best.ward_count, trials };
    console.log(`  → BEST for ${region}: damp=${best.dampening.toFixed(2)} MAE=${(best.mae * 100).toFixed(2)}pp`);
  }

  writeJson("data/calibration/regional-dampening.json", {
    snapshot: {
      generated_at: new Date().toISOString(),
      method: "Grid search over dampening ∈ [0.4, 0.8] using 2024 backtest fixtures restricted to actual 2024 ballot. MAE is averaged across Labour/Conservative/Reform UK/Liberal Democrats/Green Party.",
      grid: DAMPENING_GRID,
      regions: ["london", "metropolitan", "county_district", "other"],
    },
    calibration,
  });
  console.log(`\nWrote data/calibration/regional-dampening.json`);
}

main();
