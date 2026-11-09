#!/usr/bin/env node
// calibrate-ge-win-probability.mjs
//
// Fit the Westminster win probability: how often the model's projected leader
// actually won, as a function of the predicted margin between first and second.
// The construction is data/calibration/confidence.json's, moved from wards to
// constituencies.
//
// The rows are the 2024 rerun of the GE model (scripts/run-ge-backtest.mjs):
// the 2019 result (notional where boundaries changed) swung by the Strong
// Transition Model to the May 2024 polling average, scored against 4 July 2024.
// That is the run a forecaster would have published two months out, so its
// error includes the polling miss as well as the seat model's own error. The
// perfect-polling run (fed the actual 2024 national shares) is fitted beside it
// as a sensitivity and not applied.
//
// ge-2024.json stores only the anti-attenuated rows, which the live forecast
// does not use, so the rows are rebuilt here with the same function.
//
// Held out: bins are scored by leave-one-region-out. Each region's seats are
// quoted a probability fitted on the other eleven regions only, and the
// reliability table is built from those out-of-fold quotes.
//
// Also written: per-party residual SDs for the p10/p90 shares, their
// out-of-fold coverage, and rho, the share of margin error common to every
// seat, which the seat-range simulation needs.
//
// Refuses to fit on predictions that already carry a win probability, so a
// fitted curve can never be fitted again on its own output.
//
// Usage: node scripts/calibrate-ge-win-probability.mjs [--predictions=rows.json] [--out=path]

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runBacktest, readJson } from "./run-ge-backtest.mjs";
import { simulateSeatRanges, shareIntervals, INTERVAL_CONTENDER_SHARE } from "../src/lib/geWinProbability.js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const OUT = path.join(ROOT, arg("out", "data/calibration/ge-win-probability.json"));
const PREDICTIONS = arg("predictions", null);

const FITTED_ON = "parl.2024-07-04";
const FITTED_ON_DATE = "2024-07-04";
const EDGES = [0, 0.02, 0.05, 0.1, 0.15, 0.2, 0.3, 1.01];
const MAJOR = ["Labour", "Conservative", "Liberal Democrats", "Reform UK", "Green Party", "SNP", "Plaid Cymru"];
const MIN_PARTY_SEATS = 30;
const CONTENDER = INTERVAL_CONTENDER_SHARE;
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const r4 = (x) => (x == null ? null : Number(x.toFixed(4)));

export function assertUncalibrated(rows) {
  for (const row of rows) {
    if (row?.win_probability != null || row?.calibrated_win_probability != null) {
      throw new Error(`${row.slug || "a row"} already carries a win probability; refit on uncalibrated predictions`);
    }
    for (const v of Object.values(row?.predicted || {})) {
      if (v && typeof v === "object" && ("win_probability" in v || "p10" in v)) {
        throw new Error(`${row.slug || "a row"} predicted shares already carry intervals or a probability; refit on uncalibrated predictions`);
      }
    }
  }
}

function buildRows(useRealPolling) {
  const pcons = readJson("data/identity/pcons-ge-next.json").pcons;
  const dc = readJson("data/history/dc-historic-results.json");
  const notional2019 = readJson("data/history/ge-notional-2019.json");
  const pconDemographics = readJson("data/features/pcon-demographics.json");
  const out = runBacktest({
    pcons, dcResults: dc.results, baseYear: 2019, targetYear: 2024, mode: "stm",
    notional2019, useRealPolling, pconDemographics,
  });
  return { rows: out.rows, metrics: out.metrics };
}

function marginRow(row) {
  const p = Object.entries(row.predicted).sort((a, b) => b[1] - a[1]);
  const a = Object.entries(row.actual).sort((a, b) => b[1] - a[1]);
  if (p.length < 2 || !a.length) return null;
  return { ...row, leader: p[0][0], second: p[1][0], margin: p[0][1] - p[1][1], correct: p[0][0] === a[0][0], actualWinner: a[0][0] };
}

function enforceMonotonic(bins) {
  const live = bins.filter((b) => b.n > 0);
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < live.length - 1; i += 1) {
      if (live[i].winner_probability > live[i + 1].winner_probability) {
        const n = live[i].n + live[i + 1].n;
        const pooled = (live[i].winner_probability * live[i].n + live[i + 1].winner_probability * live[i + 1].n) / n;
        live[i] = { ...live[i], n, winner_probability: r4(pooled), margin_to_pp: live[i + 1].margin_to_pp, pooled: true };
        live.splice(i + 1, 1);
        changed = true;
        break;
      }
    }
  }
  return live;
}

function fitCurve(rows) {
  const bins = [];
  for (let i = 0; i < EDGES.length - 1; i += 1) {
    const inBin = rows.filter((r) => r.margin >= EDGES[i] && r.margin < EDGES[i + 1]);
    bins.push({
      margin_from_pp: Number((EDGES[i] * 100).toFixed(1)),
      margin_to_pp: Number((EDGES[i + 1] * 100).toFixed(1)),
      n: inBin.length,
      winner_probability: inBin.length ? r4(inBin.filter((r) => r.correct).length / inBin.length) : null,
    });
  }
  return enforceMonotonic(bins);
}

const lookup = (bins, margin) =>
  (bins.find((b) => margin * 100 >= b.margin_from_pp && margin * 100 < b.margin_to_pp) || bins[bins.length - 1])?.winner_probability ?? null;

function residualSd(rows) {
  const acc = {};
  const minor = [];
  for (const row of rows) {
    for (const party of new Set([...Object.keys(row.predicted), ...Object.keys(row.actual)])) {
      const pred = row.predicted[party] || 0;
      const act = row.actual[party] || 0;
      // Contender seats only: averaging Plaid Cymru's error over 600 English
      // seats where it has a trace share gave it a 1pp SD and 19 per cent
      // coverage in Wales.
      if (pred < CONTENDER && act < CONTENDER) continue;
      (acc[party] ||= []).push(pred - act);
    }
  }
  const by_party = {};
  const seats = {};
  for (const [party, errs] of Object.entries(acc)) {
    if (MAJOR.includes(party) && errs.length >= MIN_PARTY_SEATS) {
      by_party[party] = r4(Math.sqrt(mean(errs.map((e) => e * e))));
      seats[party] = errs.length;
    } else {
      minor.push(...errs);
    }
  }
  return { by_party, seats, other_parties: r4(Math.sqrt(mean(minor.map((e) => e * e)))), other_party_rows: minor.length };
}

/** Share of the leader-minus-runner-up error that every seat had in common. */
function commonShare(rows) {
  const bias = {};
  const n = {};
  for (const row of rows) {
    for (const party of new Set([...Object.keys(row.predicted), ...Object.keys(row.actual)])) {
      const pred = row.predicted[party] || 0;
      const act = row.actual[party] || 0;
      if (pred <= 0 && act <= 0) continue;
      bias[party] = (bias[party] || 0) + (pred - act);
      n[party] = (n[party] || 0) + 1;
    }
  }
  for (const p of Object.keys(bias)) bias[p] /= n[p];
  let common = 0;
  let total = 0;
  for (const row of rows) {
    const eL = (row.predicted[row.leader] || 0) - (row.actual[row.leader] || 0);
    const eR = (row.predicted[row.second] || 0) - (row.actual[row.second] || 0);
    const c = (bias[row.leader] || 0) - (bias[row.second] || 0);
    common += c * c;
    total += (eL - eR) ** 2;
  }
  return { rho: r4(Math.min(1, common / total)), national_bias_pp: Object.fromEntries(MAJOR.filter((p) => bias[p] != null).map((p) => [p, Number((bias[p] * 100).toFixed(2))])) };
}

function leaveOneRegionOut(rows) {
  const regions = [...new Set(rows.map((r) => r.region))].sort();
  const quoted = [];
  const perFold = [];
  const coverage = {};
  for (const region of regions) {
    const test = rows.filter((r) => r.region === region);
    const train = rows.filter((r) => r.region !== region);
    const bins = fitCurve(train);
    const flat = train.filter((r) => r.correct).length / train.length;
    const sd = residualSd(train);
    let brier = 0;
    let flatBrier = 0;
    for (const [i, row] of test.entries()) {
      const q = lookup(bins, row.margin);
      quoted.push({ ...row, quoted: q });
      brier += (q - (row.correct ? 1 : 0)) ** 2;
      flatBrier += (flat - (row.correct ? 1 : 0)) ** 2;
      const prediction = Object.fromEntries(Object.entries(row.predicted).filter(([, v]) => v > 0).map(([p, v]) => [p, { pct: v }]));
      const iv = shareIntervals(prediction, { residual_sd: sd }, { samples: 1000, seed: 1 + i });
      for (const party of MAJOR) {
        // Score a party only where it was a real contender in the seat (a
        // predicted or actual share of at least 1 per cent); a 0.1 per cent
        // trace inside a wide interval would flatter coverage.
        const act = row.actual[party] || 0;
        if ((row.predicted[party] || 0) < CONTENDER && act < CONTENDER) continue;
        const lo = iv?.[party]?.p10 ?? 0;
        const hi = iv?.[party]?.p90 ?? 0;
        const c = (coverage[party] ||= { n: 0, inside: 0 });
        c.n += 1;
        if (act >= lo && act <= hi) c.inside += 1;
      }
    }
    perFold.push({ region, seats: test.length, brier: r4(brier / test.length), flat_baseline_brier: r4(flatBrier / test.length) });
  }
  return { quoted, perFold, coverage };
}

function reliabilityTable(quoted) {
  const groups = new Map();
  for (const row of quoted) {
    const bin = EDGES.findIndex((e, i) => row.margin >= e && row.margin < EDGES[i + 1]);
    const key = bin < 0 ? EDGES.length - 2 : bin;
    const g = groups.get(key) || { margin_from_pp: EDGES[key] * 100, margin_to_pp: EDGES[key + 1] * 100, n: 0, quoted: 0, won: 0 };
    g.n += 1;
    g.quoted += row.quoted;
    if (row.correct) g.won += 1;
    groups.set(key, g);
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([, g]) => ({
    margin_from_pp: Number(g.margin_from_pp.toFixed(1)),
    margin_to_pp: Number(g.margin_to_pp.toFixed(1)),
    seats: g.n,
    mean_quoted_probability: r4(g.quoted / g.n),
    leader_won_share: r4(g.won / g.n),
  }));
}

/** The 2024 seat tally against the range the simulation would have quoted. */
function seatRangeCheck(quoted, rho) {
  const seats = quoted.map((r) => ({ winner: r.leader, runner_up: r.second, win_probability: r.quoted }));
  const sim = simulateSeatRanges(seats, { draws: 5000, seed: 2024, rho });
  const independent = simulateSeatRanges(seats, { draws: 5000, seed: 2024, rho: 0 });
  const actual = {};
  for (const r of quoted) actual[r.actualWinner] = (actual[r.actualWinner] || 0) + 1;
  const parties = ["Labour", "Conservative", "Liberal Democrats", "Reform UK", "SNP"];
  return parties.map((p) => ({
    party: p,
    actual_seats: actual[p] || 0,
    range_90: sim.by_party[p] ? [sim.by_party[p].p05, sim.by_party[p].p95] : [0, 0],
    inside: sim.by_party[p] ? (actual[p] || 0) >= sim.by_party[p].p05 && (actual[p] || 0) <= sim.by_party[p].p95 : (actual[p] || 0) === 0,
    independent_range_90: independent.by_party[p] ? [independent.by_party[p].p05, independent.by_party[p].p95] : [0, 0],
  }));
}

function fit(rows, label) {
  assertUncalibrated(rows);
  const marked = rows.map(marginRow).filter(Boolean);
  if (marked.length < 600) throw new Error(`only ${marked.length} scoreable seats for ${label}; refusing to fit`);
  const bins = fitCurve(marked);
  const oof = leaveOneRegionOut(marked);
  const sd = residualSd(marked);
  const common = commonShare(marked);
  const brier = mean(oof.perFold.flatMap((f) => Array(f.seats).fill(f.brier)));
  const flatBrier = mean(oof.perFold.flatMap((f) => Array(f.seats).fill(f.flat_baseline_brier)));
  const coverage = Object.fromEntries(Object.entries(oof.coverage).map(([p, c]) => [p, { seats: c.n, inside_p10_p90: r4(c.inside / c.n) }]));
  const allCov = Object.values(oof.coverage).reduce((a, c) => ({ n: a.n + c.n, inside: a.inside + c.inside }), { n: 0, inside: 0 });
  return {
    seats: marked.length,
    leader_won: marked.filter((r) => r.correct).length,
    bins,
    reliability: reliabilityTable(oof.quoted),
    validation: {
      method: "leave one region out: each region's seats quoted from bins fitted on the other regions",
      folds: oof.perFold.length,
      brier: r4(brier),
      flat_baseline_brier: r4(flatBrier),
      per_fold: oof.perFold,
    },
    residual_sd: { ...sd, measure: "root mean square of predicted minus actual share, over seats where the party's predicted or actual share was at least 1 per cent; other_parties pools every remaining party" },
    interval_coverage: {
      nominal: 0.8,
      overall: r4(allCov.inside / allCov.n),
      by_party: coverage,
      method: "out of fold: each region's p10 and p90 drawn with residual SDs fitted on the other regions; a party is scored in a seat where its predicted or actual share was at least 1 per cent",
    },
    correlation: { ...common, measure: "share of the squared leader-minus-runner-up error explained by each party's national mean error; one election, so one realisation" },
    seat_range_check_2024: seatRangeCheck(oof.quoted, common.rho),
  };
}

function main() {
  let primary;
  let sensitivity = null;
  if (PREDICTIONS) {
    const doc = JSON.parse(readFileSync(path.resolve(PREDICTIONS), "utf8"));
    const rows = doc.rows || Object.values(doc.predictions || {});
    primary = { label: `rows from ${PREDICTIONS}`, ...fit(rows, PREDICTIONS) };
  } else {
    const real = buildRows(true);
    const perfect = buildRows(false);
    console.log(`May 2024 polling: ${real.rows.length} seats, winner accuracy ${(real.metrics.winner_accuracy * 100).toFixed(1)}%`);
    console.log(`Perfect polling:  ${perfect.rows.length} seats, winner accuracy ${(perfect.metrics.winner_accuracy * 100).toFixed(1)}%`);
    primary = { label: "STM, May 2024 polling average (UK_WESTMINSTER_2024_MAY_AVERAGE)", ...fit(real.rows, "real") };
    const s = fit(perfect.rows, "perfect");
    sensitivity = { label: "STM, actual 2024 national shares (perfect polling); not applied", bins: s.bins, reliability: s.reliability, validation: { brier: s.validation.brier, flat_baseline_brier: s.validation.flat_baseline_brier } };
  }

  const out = {
    schema_version: "1.0.0",
    fitted_on: FITTED_ON,
    fitted_on_date: FITTED_ON_DATE,
    fitted_at: new Date().toISOString(),
    fitted_by: "scripts/calibrate-ge-win-probability.mjs",
    method:
      "Realised share of seats the projected leader won, binned by the predicted margin between first and second place, on the 2024 rerun of the GE model. Adjacent bins are pooled where a wider margin would otherwise quote a lower probability.",
    rows_source: `${primary.label}; rebuilt with runBacktest() from scripts/run-ge-backtest.mjs (2019 result, notional where boundaries changed, scored against 4 July 2024). Same engine and inputs as data/backtests/ge-2024.json summary.stm_real_polling.`,
    predictor: "margin_first_minus_second",
    n: primary.seats,
    leader_won: primary.leader_won,
    bins: primary.bins,
    reliability: primary.reliability,
    validation: primary.validation,
    residual_sd: primary.residual_sd,
    interval_coverage: primary.interval_coverage,
    correlation: primary.correlation,
    seat_range_check_2024: primary.seat_range_check_2024,
    sensitivity_perfect_polling: sensitivity,
    limits: [
      "The rerun quotes polls taken about nine weeks before polling day. A forecast published years before an election carries more uncertainty than this, so these probabilities understate how far opinion can move before the next general election.",
      "The rerun uses the Strong Transition Model with demographics and tactical voting. The live forecast adds a BES prior, incumbency and by-election overlays that the rerun cannot use without look-ahead, so the fit describes the core model.",
      "One election. The bins and the correlation are a single realisation and should be refitted after the next general election.",
    ],
    do_not_apply_to: [FITTED_ON],
  };
  writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`Wrote ${path.relative(ROOT, OUT)}`);
  console.table(primary.reliability);
  console.log("validation brier", primary.validation.brier, "flat", primary.validation.flat_baseline_brier);
  console.log("coverage", primary.interval_coverage.overall, JSON.stringify(primary.interval_coverage.by_party));
  console.log("rho", primary.correlation.rho, JSON.stringify(primary.correlation.national_bias_pp));
  console.table(primary.seat_range_check_2024);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main();
