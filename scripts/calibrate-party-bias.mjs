#!/usr/bin/env node
// calibrate-party-bias.mjs
//
// Fit the ward model's per-party bias against a completed election, validate it
// out of sample, and write data/calibration/party-bias.json.
//
// Why: the 7 May 2026 post-audit showed a systematic per-party offset (Greens
// 7.6pp cold, Labour 6.1pp hot) that is stable across councils. Subtracting it
// is worth roughly 4.8 points of winner accuracy and 0.9pp of MAE.
//
// Method: mean signed error per party over the fit set, then k-fold validation
// grouped BY COUNCIL so the correction is never tested on a council it was
// fitted on. Folds are by council rather than by ward because wards inside one
// council share a baseline, and a ward-level split would leak.
//
// Honest limit, stated in the output file: this is a geographic hold-out, not a
// temporal one. It shows the offset is real rather than fitted noise. It does
// not prove the offset persists into the next election, so refit after every
// real election and watch whether a party moves by more than its fold sd.
//
// Usage:
//   node scripts/calibrate-party-bias.mjs                        # May 2026
//   node scripts/calibrate-party-bias.mjs --predictions=P --actuals=A --label=L

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const p = (rel) => path.join(ROOT, rel);
const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const PREDICTIONS = arg("predictions", "data/predictions/may-2026/local-and-mayor.json");
const ACTUALS = arg("actuals", "data/results/may-2026/local-and-mayor.merged.json");
const LABEL = arg("label", "local.2026-05-07");
const OUT = p("data/calibration/party-bias.json");
const FOLDS = Number(arg("folds", "5"));
const MAJOR = ["Labour", "Conservative", "Liberal Democrats", "Reform UK", "Green Party"];

const readJson = (rel) => JSON.parse(readFileSync(path.isAbsolute(rel) ? rel : p(rel), "utf8"));
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const sd = (xs) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};

function loadRows() {
  const predDoc = readJson(PREDICTIONS);
  const predictions = predDoc.predictions || predDoc.by_ballot || predDoc;
  const actuals = readJson(ACTUALS).by_ballot;
  const rows = [];
  for (const [ballotId, entry] of Object.entries(predictions)) {
    const prediction = entry?.prediction;
    const actual = actuals?.[ballotId]?.vote_shares;
    if (!prediction || !actual) continue;
    const predicted = {};
    for (const [party, payload] of Object.entries(prediction)) predicted[party] = payload?.pct || 0;
    rows.push({
      ballotId,
      council: ballotId.split(".")[1],
      predicted,
      actual,
      calibrated: Boolean(entry?.party_bias_calibration),
    });
  }
  return rows;
}

function fitBias(rows) {
  const acc = {};
  for (const row of rows) {
    for (const party of MAJOR) {
      if (!(party in row.predicted) && !(party in row.actual)) continue;
      (acc[party] ||= []).push((row.predicted[party] || 0) - (row.actual[party] || 0));
    }
  }
  const out = {};
  for (const [party, errs] of Object.entries(acc)) out[party] = mean(errs);
  return out;
}

function correct(predicted, bias) {
  const out = {};
  let total = 0;
  for (const [party, pct] of Object.entries(predicted)) {
    const v = Math.max(0, pct - (bias[party] || 0));
    out[party] = v;
    total += v;
  }
  if (total <= 0) return predicted;
  for (const party of Object.keys(out)) out[party] /= total;
  return out;
}

function score(rows, bias) {
  let winners = 0;
  const maes = [];
  for (const row of rows) {
    const shares = bias ? correct(row.predicted, bias) : row.predicted;
    const top = (obj) => Object.entries(obj).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    if (top(shares) && top(shares) === top(row.actual)) winners += 1;
    const errs = MAJOR.filter((party) => party in shares || party in row.actual)
      .map((party) => Math.abs((shares[party] || 0) - (row.actual[party] || 0)));
    if (errs.length) maes.push(mean(errs));
  }
  return { winnerPct: (winners / rows.length) * 100, maePp: mean(maes) * 100 };
}

function main() {
  const rows = loadRows();
  if (rows.length < 200) throw new Error(`only ${rows.length} scoreable wards; refusing to fit a calibration on that`);
  // Refuse to fit on predictions that already carry a correction. Doing so
  // measures the residual after correction and reports it as the correction,
  // which silently shrinks the offsets: fitting on once-corrected May 2026
  // predictions gave Labour 4.91pp where the truth was 6.45pp. The engine
  // stamps party_bias_calibration on any ward it corrected, so this is checkable.
  if (rows.some((r) => r.calibrated)) {
    const n = rows.filter((r) => r.calibrated).length;
    throw new Error(
      `${n} of ${rows.length} predictions already carry a party-bias correction. Regenerate them uncorrected before fitting.`,
    );
  }
  const bias = fitBias(rows);
  const baseline = score(rows, null);

  // k-fold by council
  const councils = [...new Set(rows.map((r) => r.council))].sort();
  const folds = Array.from({ length: FOLDS }, (_, i) => new Set(councils.filter((_, j) => j % FOLDS === i)));
  const perFold = [];
  const foldFits = [];
  for (const fold of folds) {
    const test = rows.filter((r) => fold.has(r.council));
    const train = rows.filter((r) => !fold.has(r.council));
    if (!test.length || !train.length) continue;
    const foldBias = fitBias(train);
    foldFits.push(foldBias);
    const before = score(test, null);
    const after = score(test, foldBias);
    perFold.push({
      councils: fold.size,
      wards: test.length,
      winner_delta_pp: Number((after.winnerPct - before.winnerPct).toFixed(3)),
      mae_delta_pp: Number((after.maePp - before.maePp).toFixed(4)),
    });
  }

  const stability = {};
  for (const party of MAJOR) {
    const vals = foldFits.map((f) => (f[party] || 0) * 100);
    stability[party] = { per_fold_pp: vals.map((v) => Number(v.toFixed(2))), sd_pp: Number(sd(vals).toFixed(3)) };
  }

  const doc = {
    schema_version: "1.0.0",
    fitted_on: LABEL,
    fitted_on_date: LABEL.split(".").pop(),
    fitted_at: new Date().toISOString(),
    method:
      "Mean signed error per party (predicted minus actual share), fitted across every scoreable ward, validated by k-fold hold-out grouped by council.",
    inputs: { predictions: PREDICTIONS, actuals: ACTUALS, wards_scored: rows.length, councils: councils.length },
    parties: Object.fromEntries(Object.entries(bias).map(([k, v]) => [k, Number(v.toFixed(6))])),
    parties_pp: Object.fromEntries(Object.entries(bias).map(([k, v]) => [k, Number((v * 100).toFixed(2))])),
    baseline: { winner_accuracy_pct: Number(baseline.winnerPct.toFixed(2)), major_party_mae_pp: Number(baseline.maePp.toFixed(3)) },
    validation: {
      design: "k-fold by council, fitted on the other folds, scored on the held-out fold",
      folds: perFold.length,
      mean_winner_delta_pp: Number(mean(perFold.map((f) => f.winner_delta_pp)).toFixed(3)),
      mean_mae_delta_pp: Number(mean(perFold.map((f) => f.mae_delta_pp)).toFixed(4)),
      per_fold: perFold,
      stability,
      caveat:
        "Geographic hold-out, not temporal. It shows the offset is a real constant rather than fitted noise. It does not prove the offset survives to the next election, so refit after every real election and treat a party moving by more than its fold standard deviation as a signal that the model changed, not as a number to paste in.",
    },
    // Applying a correction to the election it was fitted on scores the answer
    // key. The engine refuses to do it.
    do_not_apply_to: [LABEL],
  };

  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`Fitted on ${rows.length} wards across ${councils.length} councils.`);
  console.log(`  bias (pp): ${JSON.stringify(doc.parties_pp)}`);
  console.log(`  baseline: ${doc.baseline.winner_accuracy_pct}% winners, ${doc.baseline.major_party_mae_pp}pp MAE`);
  console.log(`  held out: winners ${doc.validation.mean_winner_delta_pp >= 0 ? "+" : ""}${doc.validation.mean_winner_delta_pp}pp, MAE ${doc.validation.mean_mae_delta_pp}pp`);
  console.log(`  wrote ${path.relative(ROOT, OUT)}`);
}

main();
