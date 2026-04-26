#!/usr/bin/env node
/**
 * run-ge-backtest.mjs — backtest the GE constituency model.
 *
 * Default mode: predict GE2024 from GE2019 baseline + GE2024 actual national
 * shares (UK Westminster). This tests the swing model in a clean,
 * outcome-known setting — the same benchmark all 2024-vintage UK MRP
 * forecasters publish post-mortems against.
 *
 * Reports per-party MAE, RMSE, winner accuracy, vs UNS counterfactual,
 * Brier score on top-party probability. Also runs the same backtest with
 * STM disabled (legacy UNS) so the lift is auditable.
 *
 * Output: data/backtests/ge-2024.json
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { predictConstituencyGE } from "../src/lib/electionModel.js";
import { applyAntiAttenuation, computeHistoricSigmas } from "../src/lib/antiAttenuation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");

function readJson(p) { return JSON.parse(readFileSync(join(REPO, p), "utf8")); }

// Canonicalise party names — DC results carry varied spellings.
function canonParty(p) {
  if (!p) return "Unknown";
  if (/^Labour Party$/i.test(p)) return "Labour";
  if (/^Labour and Co-operative Party$/i.test(p)) return "Labour";
  if (/^Conservative and Unionist Party$/i.test(p)) return "Conservative";
  if (/^The Conservative Party/i.test(p)) return "Conservative";
  if (/^Liberal Democrats?$/i.test(p)) return "Liberal Democrats";
  if (/^Reform UK$/i.test(p)) return "Reform UK";
  if (/^The Brexit Party$/i.test(p)) return "Reform UK"; // 2019 lineage
  if (/^UK Independence Party/i.test(p)) return "Reform UK";
  if (/^Green Party$/i.test(p)) return "Green Party";
  if (/^The Green Party/i.test(p)) return "Green Party";
  if (/^Plaid Cymru/i.test(p)) return "Plaid Cymru";
  if (/^Scottish National Party/i.test(p)) return "SNP";
  if (/independent/i.test(p)) return "Independent";
  return p;
}

function pcononicalShares(candidates) {
  const total = candidates.reduce((s, c) => s + (c.votes || 0), 0);
  if (total <= 0) return {};
  const shares = {};
  for (const c of candidates) {
    const p = canonParty(c.party_name || c.party);
    shares[p] = (shares[p] || 0) + (c.votes || 0) / total;
  }
  return shares;
}

function nationalShares(year, results) {
  const acc = {};
  for (const r of results) {
    if (r.year !== year || r.tier !== "parl" || r.is_by_election) continue;
    for (const c of r.candidates || []) {
      const p = canonParty(c.party_name);
      acc[p] = (acc[p] || 0) + (c.votes || 0);
    }
  }
  const total = Object.values(acc).reduce((s, v) => s + v, 0);
  if (total <= 0) return {};
  for (const k of Object.keys(acc)) acc[k] = acc[k] / total;
  return acc;
}

function buildIndex(results, year) {
  const out = {};
  for (const r of results) {
    if (r.year !== year || r.tier !== "parl" || r.is_by_election) continue;
    out[r.ward_slug] = r;
  }
  return out;
}

function metrics(rows, parties) {
  const partyMae = {};
  const partyRmse = {};
  const partyN = {};
  let winnerCorrect = 0;
  let evaluated = 0;
  let brierSum = 0;
  for (const row of rows) {
    if (!row.predicted || !row.actual) continue;
    evaluated += 1;
    const allParties = new Set([...Object.keys(row.predicted), ...Object.keys(row.actual)]);
    for (const p of allParties) {
      const pred = row.predicted[p] || 0;
      const act = row.actual[p] || 0;
      const diff = pred - act;
      partyMae[p] = (partyMae[p] || 0) + Math.abs(diff);
      partyRmse[p] = (partyRmse[p] || 0) + diff * diff;
      partyN[p] = (partyN[p] || 0) + 1;
    }
    // Winner accuracy + Brier
    const predWinner = Object.entries(row.predicted).sort((a, b) => b[1] - a[1])[0]?.[0];
    const actWinner = Object.entries(row.actual).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (predWinner === actWinner) winnerCorrect += 1;
    // Brier: did we put high probability mass on the actual winner? Use
    // predicted share of the actual winner as our probability proxy.
    const probActualWinner = row.predicted[actWinner] || 0;
    brierSum += (1 - probActualWinner) * (1 - probActualWinner);
  }
  const mae = {};
  const rmse = {};
  for (const p of parties) {
    if (!partyN[p]) continue;
    mae[p] = partyMae[p] / partyN[p];
    rmse[p] = Math.sqrt(partyRmse[p] / partyN[p]);
  }
  const majorParties = ["Labour", "Conservative", "Liberal Democrats", "Reform UK", "Green Party"];
  const majorAvg = majorParties
    .filter((p) => mae[p] != null)
    .reduce((s, p) => s + mae[p], 0) / Math.max(1, majorParties.filter((p) => mae[p] != null).length);
  return {
    evaluated,
    winner_accuracy: evaluated > 0 ? winnerCorrect / evaluated : 0,
    major_party_mae_avg: majorAvg,
    per_party_mae: mae,
    per_party_rmse: rmse,
    brier_top_winner: evaluated > 0 ? brierSum / evaluated : 0,
  };
}

function runBacktest({ pcons, dcResults, baseYear, targetYear, mode, polling, notional2019 }) {
  const baseIdx = buildIndex(dcResults, baseYear);
  const targetIdx = buildIndex(dcResults, targetYear);
  const baseNational = nationalShares(baseYear, dcResults);
  const targetNational = nationalShares(targetYear, dcResults);

  const rows = [];
  let usedNotional = 0;
  for (const pcon of pcons) {
    const targetRecord = targetIdx[pcon.slug];
    if (!targetRecord) continue;

    // Build baseline shares: prefer the actual base-year DC record (slug match);
    // fall back to the notional-2019 record where the slug differs (boundary
    // change). This restores the 211 PCONs we previously dropped.
    let baselineShares = null;
    let baselineSource = "actual";
    const baseRecord = baseIdx[pcon.slug];
    if (baseRecord) {
      baselineShares = pcononicalShares(baseRecord.candidates || []);
    } else if (notional2019 && baseYear === 2019) {
      // Try notional 2019: keyed by GSS first, then slug
      const notional = (pcon.pcon24cd && notional2019.by_gss?.[pcon.pcon24cd])
        || notional2019.by_slug?.[pcon.slug];
      if (notional?.candidates?.length > 0) {
        baselineShares = pcononicalShares(notional.candidates || []);
        baselineSource = "notional";
        usedNotional += 1;
      }
    }
    if (!baselineShares) continue;

    const actualShares = pcononicalShares(targetRecord.candidates || []);
    if (Object.keys(baselineShares).length === 0 || Object.keys(actualShares).length === 0) continue;

    // Constituency object expected by predictConstituencyGE
    const constituency = {
      name: pcon.name,
      ge2024: {
        results: Object.entries(baselineShares).map(([party, pct]) => ({ party, pct })),
      },
    };
    const pollingArg = {
      aggregate: polling || targetNational,
      ge2024_baseline: baseNational,
    };
    const opts = {
      useSTM: mode === "stm",
      geDampening: 1.0,
    };
    const result = predictConstituencyGE(constituency, pollingArg, {}, opts);
    if (!result?.prediction) continue;

    const predicted = {};
    for (const [p, v] of Object.entries(result.prediction)) predicted[p] = v.pct || 0;

    rows.push({
      slug: pcon.slug,
      name: pcon.name,
      country: pcon.country,
      region: pcon.region,
      baseline: baselineShares,
      baseline_source: baselineSource,
      predicted,
      actual: actualShares,
      methodology_steps: result.methodology.length,
    });
  }
  console.log(`    used notional-2019 baseline for ${usedNotional} boundary-changed PCONs`);
  const allParties = new Set();
  for (const r of rows) {
    for (const p of Object.keys(r.actual)) allParties.add(p);
    for (const p of Object.keys(r.predicted)) allParties.add(p);
  }
  return { rows, parties: [...allParties], metrics: metrics(rows, [...allParties]) };
}

function applyUnwindingToRows(rows, calibrationShares) {
  // Calibration sigmas should come from an INDEPENDENT historic election —
  // never from the same dataset we're predicting (that's circular). The
  // caller passes a list of {shares} from a prior GE; we measure between-PCON
  // SD per party there and use it as the target spread for predictions.
  const historicSigmas = computeHistoricSigmas(
    calibrationShares.map((s) => ({ shares: s })),
    null,
  );
  const adj = applyAntiAttenuation(
    rows.map((r) => ({ shares: r.predicted, slug: r.slug })),
    historicSigmas,
  );
  const out = rows.map((r, i) => ({ ...r, predicted: adj.adjusted[i].shares }));
  const allParties = new Set();
  for (const r of out) {
    for (const p of Object.keys(r.actual)) allParties.add(p);
    for (const p of Object.keys(r.predicted)) allParties.add(p);
  }
  return { rows: out, parties: [...allParties], metrics: metrics(out, [...allParties]), gammas: adj.gammas };
}

function main() {
  console.log("Loading inputs ...");
  const pcons = readJson("data/identity/pcons-ge-next.json").pcons;
  const dcRaw = readJson("data/history/dc-historic-results.json");
  let notional2019 = null;
  try { notional2019 = readJson("data/history/ge-notional-2019.json"); } catch {}
  console.log(`  ${pcons.length} PCONs, ${dcRaw.results.length} historic DC records${notional2019 ? `, ${Object.keys(notional2019.by_gss || {}).length} notional-2019 PCONs` : ''}`);

  // Run three modes back-to-back so the audit log shows STM lift + unwinding lift
  console.log("\n=== GE2024 backtest: GE2019 baseline → GE2024 actuals ===");
  const baseYear = 2019;
  const targetYear = 2024;

  const uns = runBacktest({ pcons, dcResults: dcRaw.results, baseYear, targetYear, mode: "uns", notional2019 });
  console.log(`UNS:        ${uns.rows.length} PCONs evaluated`);
  console.log(`  winner accuracy: ${(uns.metrics.winner_accuracy * 100).toFixed(1)}%`);
  console.log(`  major-party MAE avg: ${(uns.metrics.major_party_mae_avg * 100).toFixed(2)}pp`);
  console.log(`  Brier (top): ${uns.metrics.brier_top_winner.toFixed(4)}`);

  const stm = runBacktest({ pcons, dcResults: dcRaw.results, baseYear, targetYear, mode: "stm", notional2019 });
  console.log(`STM:        ${stm.rows.length} PCONs evaluated`);
  console.log(`  winner accuracy: ${(stm.metrics.winner_accuracy * 100).toFixed(1)}%`);
  console.log(`  major-party MAE avg: ${(stm.metrics.major_party_mae_avg * 100).toFixed(2)}pp`);
  console.log(`  Brier (top): ${stm.metrics.brier_top_winner.toFixed(4)}`);

  // Calibration set: the GE2019 BASELINE shares per PCON. This gives us the
  // historic between-PCON spread of each party's vote — independent of the
  // GE2024 target, so unwinding doesn't peek at the answer.
  const calibrationShares = stm.rows.map((r) => r.baseline);
  const unwound = applyUnwindingToRows(stm.rows, calibrationShares);
  console.log(`STM+unwind: ${unwound.rows.length} PCONs evaluated`);
  console.log(`  winner accuracy: ${(unwound.metrics.winner_accuracy * 100).toFixed(1)}%`);
  console.log(`  major-party MAE avg: ${(unwound.metrics.major_party_mae_avg * 100).toFixed(2)}pp`);
  console.log(`  Brier (top): ${unwound.metrics.brier_top_winner.toFixed(4)}`);

  const out = {
    snapshot: {
      snapshot_id: `ge-backtest-${targetYear}-${new Date().toISOString().slice(0, 10)}`,
      generated_at: new Date().toISOString(),
      base_year: baseYear,
      target_year: targetYear,
      modes: ["uns", "stm", "stm_unwound"],
      target_metrics: {
        winner_accuracy_target: 0.92,
        major_party_mae_target_pp: 4.0,
        brier_target: 0.10,
        beat_uns_by_target_pp: 1.5,
      },
    },
    summary: {
      uns: uns.metrics,
      stm: stm.metrics,
      stm_unwound: { ...unwound.metrics, gammas: unwound.gammas },
      stm_lift_over_uns_pp: (uns.metrics.major_party_mae_avg - stm.metrics.major_party_mae_avg) * 100,
      unwinding_lift_over_stm_pp: (stm.metrics.major_party_mae_avg - unwound.metrics.major_party_mae_avg) * 100,
      total_lift_pp: (uns.metrics.major_party_mae_avg - unwound.metrics.major_party_mae_avg) * 100,
    },
    rows: unwound.rows.map((r) => ({
      slug: r.slug, name: r.name, country: r.country, region: r.region,
      predicted: Object.fromEntries(Object.entries(r.predicted).map(([p, v]) => [p, Number(v.toFixed(4))])),
      actual: Object.fromEntries(Object.entries(r.actual).map(([p, v]) => [p, Number(v.toFixed(4))])),
    })),
  };
  const outPath = `data/backtests/ge-${targetYear}.json`;
  mkdirSync(dirname(join(REPO, outPath)), { recursive: true });
  writeFileSync(join(REPO, outPath), JSON.stringify(out, null, 2));
  console.log(`\nWrote ${outPath} (${unwound.rows.length} rows)`);
  console.log(`STM lift over UNS:     ${out.summary.stm_lift_over_uns_pp.toFixed(2)}pp`);
  console.log(`Unwinding lift over STM:${out.summary.unwinding_lift_over_stm_pp.toFixed(2)}pp`);
  console.log(`Total lift:            ${out.summary.total_lift_pp.toFixed(2)}pp`);
}

main();
