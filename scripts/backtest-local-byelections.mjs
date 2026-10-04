#!/usr/bin/env node
/**
 * Leave-one-out back-test of the council by-election model, offline.
 *
 * Builds the swing corpus from the local history files exactly as
 * build-local-byelections.mjs does, minus the network sweep, and prints the
 * figures to compare before and after a change to the model: winners called,
 * mean absolute error, Brier score and the published calibration bands, all
 * time and since the realignment. Run it before and after any change to
 * scripts/lib/local-byelection-model.mjs and quote both.
 *
 * Needs data/history/dc-historic-results.json (gitignored; present on vps-main
 * and this Mac). Without it the corpus is the tracked sidecar only.
 *
 *   node scripts/backtest-local-byelections.mjs
 */
import { backtest, buildSwingCorpus, RECENT_SINCE } from "./lib/local-byelection-model.mjs";
import { loadHistory, buildPriorIndex } from "./build-local-byelections.mjs";

const priors = buildPriorIndex(loadHistory());
const corpus = buildSwingCorpus(priors.byelectionRows, (row) =>
  priors.find({ council_slug: row.council_slug, ward_slug: row.ward_slug, gss: null, before: row.election_date }),
);
const bt = backtest(corpus);
const summary = (rows) => {
  const n = rows.length;
  const called = rows.filter((r) => r.projected_winner === r.actual_winner).length;
  const mae = rows.reduce((a, r) => a + r.mae_pp, 0) / n;
  let brier = 0;
  for (const r of rows) for (const [p, q] of Object.entries(r.win_probability || {})) brier += (q - (p === r.actual_winner ? 1 : 0)) ** 2;
  return `n=${n}, winners ${called}/${n} (${((called / n) * 100).toFixed(1)}%), MAE ${mae.toFixed(2)}pp, Brier ${(brier / n).toFixed(3)}`;
};
console.log(`corpus ${corpus.length} by-elections, ${corpus[0]?.date} to ${corpus.at(-1)?.date}`);
console.log(`all time:            ${summary(bt.rows)}`);
console.log(`since ${RECENT_SINCE}:   ${summary(bt.rows.filter((r) => r.date >= RECENT_SINCE))}`);
for (const b of bt.calibration) {
  console.log(`  said ${Math.round(b.from * 100)}-${Math.round(b.to * 100)}%: n=${b.n}, right ${Math.round(b.observed * 100)}%`);
}
