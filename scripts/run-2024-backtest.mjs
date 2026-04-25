#!/usr/bin/env node
// Phase 3: Backtest the model on May 2024 local results.
// For each ward with a 2024 cycle result in our DC bundle:
//   - Strip 2024+ records from history
//   - Predict 2024 result using GE2019 baseline + May 2024 polling
//   - Compare predicted shares vs actual
// Persist data/backtests/may-2024-replay.json + may-2024-summary.json.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildWardData } from "../src/lib/adaptDcToWardData.js";
import { predictWard, DEFAULT_ASSUMPTIONS } from "../src/lib/electionModel.js";
import {
  UK_WESTMINSTER_2019_GE_RESULT,
  UK_WESTMINSTER_2024_MAY_AVERAGE,
} from "../src/lib/nationalPolling.js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function readJson(p) { return JSON.parse(readFileSync(path.join(ROOT, p), "utf8")); }

function writeJson(rel, payload) {
  const full = path.join(ROOT, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, JSON.stringify(payload, null, 2));
  return full;
}

function dcPartyToCanonical(dcName) {
  if (!dcName) return "Unknown";
  const p = String(dcName).trim();
  if (/^Labour Party$/i.test(p)) return "Labour";
  if (/^Labour and Co-operative Party$/i.test(p)) return "Labour";
  if (/^Conservative and Unionist Party$/i.test(p)) return "Conservative";
  if (/^Scottish National Party \(SNP\)$/i.test(p)) return "SNP";
  if (/^Plaid Cymru/i.test(p)) return "Plaid Cymru";
  if (/^Liberal Democrats?$/i.test(p)) return "Liberal Democrats";
  if (/^Reform UK$/i.test(p)) return "Reform UK";
  if (/^Green Party$/i.test(p)) return "Green Party";
  if (/^Scottish Green Party$/i.test(p)) return "Green Party";
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

function actualWinnerFromResult(result) {
  const ranked = [...(result.candidates || [])].sort((a, b) => (b.votes || 0) - (a.votes || 0));
  return ranked[0] ? dcPartyToCanonical(ranked[0].party_name) : null;
}

function predictedWinner(prediction) {
  const ranked = Object.entries(prediction || {}).sort((a, b) => (b[1].pct || 0) - (a[1].pct || 0));
  return ranked[0]?.[0] || null;
}

function buildHistoricalWardData(currentWard, history2024Date, fullHistoryBundle) {
  // Build wardData using only history rows BEFORE the 2024 backtest target date.
  // Same key as our normal pipeline.
  const wardKey = `${currentWard.tier}::${currentWard.council_slug}::${currentWard.ward_slug}`;
  const ballotIds = (fullHistoryBundle.by_ward_slug || {})[wardKey] || [];
  const priorBallots = ballotIds
    .map((id) => fullHistoryBundle.by_ballot[id])
    .filter((r) => r && r.election_date < history2024Date);
  // Use the same buildWardData adapter but pass a synthetic narrowed bundle
  const narrowedBundle = {
    by_ballot: Object.fromEntries(priorBallots.map((r) => [r.ballot_paper_id, r])),
    by_ward_slug: { [wardKey]: priorBallots.map((r) => r.ballot_paper_id) },
  };
  return buildWardData(currentWard, narrowedBundle);
}

function aggregateMae(rows) {
  // Per-party MAE across all backtest rows
  const totals = {};
  const counts = {};
  for (const row of rows) {
    if (!row.predicted_shares || !row.actual_shares) continue;
    const allParties = new Set([...Object.keys(row.predicted_shares), ...Object.keys(row.actual_shares)]);
    for (const p of allParties) {
      const pred = row.predicted_shares[p] || 0;
      const act = row.actual_shares[p] || 0;
      totals[p] = (totals[p] || 0) + Math.abs(pred - act);
      counts[p] = (counts[p] || 0) + 1;
    }
  }
  const mae = {};
  for (const p of Object.keys(totals)) {
    mae[p] = +(totals[p] / counts[p]).toFixed(4);
  }
  return mae;
}

function residualSdByParty(rows) {
  // Per-party residual standard deviation (predicted - actual), over all rows
  const residuals = {};
  for (const row of rows) {
    if (!row.predicted_shares || !row.actual_shares) continue;
    const allParties = new Set([...Object.keys(row.predicted_shares), ...Object.keys(row.actual_shares)]);
    for (const p of allParties) {
      const pred = row.predicted_shares[p] || 0;
      const act = row.actual_shares[p] || 0;
      if (!residuals[p]) residuals[p] = [];
      residuals[p].push(pred - act);
    }
  }
  const sd = {};
  for (const [p, arr] of Object.entries(residuals)) {
    const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
    const variance = arr.reduce((s, v) => s + (v - mean) * (v - mean), 0) / Math.max(1, arr.length - 1);
    sd[p] = +Math.sqrt(variance).toFixed(4);
  }
  return sd;
}

function main() {
  console.log("Loading inputs...");
  const identity = readJson("data/identity/wards-may-2026.json");
  const history = readJson("data/history/dc-historic-results.json");
  const slugMap = readJson("data/identity/council-slug-to-lad24.json");
  const laProj = readJson("data/features/la-ethnic-projections.json");
  const laImd = readJson("data/features/la-imd.json");

  const polling2024 = UK_WESTMINSTER_2024_MAY_AVERAGE.shares;
  const baseline2019 = UK_WESTMINSTER_2019_GE_RESULT.shares;

  const target2024Date = "2024-05-02";

  console.log(`Backtesting model against ${target2024Date} ...`);
  const rows = [];
  let processed = 0, predicted = 0, with_actual = 0, no_history = 0;

  for (const ward of identity.wards) {
    if (ward.tier !== "local") continue;
    const wardKey = `${ward.tier}::${ward.council_slug}::${ward.ward_slug}`;
    const ballotIds = (history.by_ward_slug || {})[wardKey] || [];
    const actualResult = ballotIds
      .map((id) => history.by_ballot[id])
      .find((r) => r && r.election_date === target2024Date && !r.is_by_election);
    if (!actualResult) continue;
    processed += 1;

    const wd = buildHistoricalWardData(ward, target2024Date, history);
    if (!wd.history.length) {
      no_history += 1;
      continue;
    }

    const ladCode = slugMap.map[ward.council_slug]?.lad24cd;
    const proj = ladCode ? laProj.projections[ladCode] : null;
    const imd = ladCode ? laImd.imd[ladCode] : null;
    const demographics = proj
      ? { white_british_pct: proj.white_british_pct_projected, asian_pct: proj.asian_pct_projected }
      : null;
    const deprivation = imd ? { avg_imd_decile: imd.avg_imd_decile } : null;
    const ethnicProjections = proj
      ? { white_british_pct_projected: proj.white_british_pct_projected, asian_pct_projected: proj.asian_pct_projected }
      : null;

    const result = predictWard(
      wd,
      DEFAULT_ASSUMPTIONS,
      polling2024,      // current polling = May 2024
      baseline2019,     // prior GE = 2019
      demographics,
      deprivation,
      baseline2019,     // constituency-level = use GE2019 national
      null, null, null, null,
      ethnicProjections,
    );

    if (!result.prediction) continue;
    predicted += 1;
    const predictedShares = Object.fromEntries(
      Object.entries(result.prediction).map(([p, d]) => [p, d.pct])
    );
    const actualShares = actualSharesFromResult(actualResult);
    if (actualShares) with_actual += 1;
    const aw = actualWinnerFromResult(actualResult);
    const pw = predictedWinner(result.prediction);

    rows.push({
      ballot_paper_id: actualResult.ballot_paper_id,
      ward_name: ward.ward_name,
      council_slug: ward.council_slug,
      lad24cd: ladCode || null,
      predicted_shares: predictedShares,
      actual_shares: actualShares,
      predicted_winner: pw,
      actual_winner: aw,
      winner_correct: pw === aw,
      baseline_count_used: wd.history.length,
    });
  }

  const mae = aggregateMae(rows);
  const sd = residualSdByParty(rows);
  const winnerCorrect = rows.filter((r) => r.winner_correct).length;
  const overallMaeMajor = ["Labour", "Conservative", "Reform UK", "Liberal Democrats", "Green Party"].reduce(
    (s, p) => s + (mae[p] || 0), 0,
  ) / 5;

  // Per-LAD MAE for the per-council backtest section
  const perLad = {};
  for (const r of rows) {
    if (!r.lad24cd) continue;
    if (!perLad[r.lad24cd]) perLad[r.lad24cd] = { sumAbs: 0, n: 0, winnerCorrect: 0 };
    const allParties = new Set([...Object.keys(r.predicted_shares), ...Object.keys(r.actual_shares)]);
    let absSum = 0; let count = 0;
    for (const p of allParties) {
      absSum += Math.abs((r.predicted_shares[p] || 0) - (r.actual_shares[p] || 0));
      count += 1;
    }
    perLad[r.lad24cd].sumAbs += absSum / count;
    perLad[r.lad24cd].n += 1;
    if (r.winner_correct) perLad[r.lad24cd].winnerCorrect += 1;
  }
  const ladMae = {};
  for (const [k, v] of Object.entries(perLad)) {
    ladMae[k] = {
      mae: +(v.sumAbs / v.n).toFixed(4),
      ward_count: v.n,
      winner_accuracy: +(v.winnerCorrect / v.n).toFixed(3),
    };
  }

  // Worst 30 misses by mean abs share error on major parties
  const scored = rows.map((r) => {
    const allParties = new Set([...Object.keys(r.predicted_shares), ...Object.keys(r.actual_shares)]);
    let absSum = 0; let count = 0;
    for (const p of allParties) {
      absSum += Math.abs((r.predicted_shares[p] || 0) - (r.actual_shares[p] || 0));
      count += 1;
    }
    return { ...r, _ward_mae: absSum / count };
  });
  const worstMisses = [...scored].sort((a, b) => b._ward_mae - a._ward_mae).slice(0, 30);

  const summary = {
    snapshot: { generated_at: new Date().toISOString(), target_date: target2024Date },
    totals: { processed, predicted, with_actual, no_history },
    overall_mae: { major_parties_avg: +overallMaeMajor.toFixed(4), per_party: mae },
    residual_sd_per_party: sd,
    winner_accuracy: rows.length ? +(winnerCorrect / rows.length).toFixed(3) : 0,
    worst_30_misses: worstMisses.map((r) => ({
      ballot_paper_id: r.ballot_paper_id,
      council_slug: r.council_slug,
      ward_name: r.ward_name,
      ward_mae: +r._ward_mae.toFixed(4),
      predicted_winner: r.predicted_winner,
      actual_winner: r.actual_winner,
    })),
    per_lad: ladMae,
  };

  writeJson("data/backtests/may-2024-summary.json", summary);
  writeJson("data/backtests/may-2024-replay.json", { snapshot: summary.snapshot, rows });

  console.log("\nBacktest summary:");
  console.log(`  Processed: ${processed}, predicted: ${predicted}, with_actual: ${with_actual}, no_history: ${no_history}`);
  console.log(`  Overall MAE (major parties avg): ${(overallMaeMajor * 100).toFixed(2)}pp`);
  console.log(`  Per-party MAE:`);
  for (const [p, v] of Object.entries(mae).sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`    ${p.padEnd(28)} ${(v * 100).toFixed(2)}pp`);
  }
  console.log(`  Winner accuracy: ${(summary.winner_accuracy * 100).toFixed(1)}%`);
  console.log(`  Residual SDs: ${JSON.stringify(sd)}`);
}

main();
