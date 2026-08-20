#!/usr/bin/env node
// calibrate-confidence.mjs
//
// Turn the ward model's confidence label into a number that means something.
//
// The 7 May 2026 post-audit showed the existing three-band label carries no
// information and is mildly inverted at the top: "high" called 48.7% of winners
// correctly against "medium" on 54.6%. The predicted margin between first and
// second place, by contrast, tracks reality monotonically, from 36.8% correct in
// the 0 to 2 point band up to 66.8% in the 20 to 30 point band.
//
// So: bin by predicted margin, measure the realised hit rate in each bin, and
// publish that hit rate as the probability. A band label is then derived from
// the number rather than the other way round.
//
// Two subtleties, both about not scoring the answer key.
//
//   1. The margins the model will produce in future are POST bias-correction, so
//      the curve has to be fitted on corrected predictions. Correcting May 2026
//      with a May 2026 fit is circular, so the correction applied here is always
//      out of fold: each council's predictions are corrected using a bias fitted
//      on the other folds only.
//   2. The curve itself is then validated by a second k-fold, again by council:
//      fit the bins on four fifths, score calibration error on the held-out
//      fifth. A curve that only works on the councils it saw is noise.
//
// Usage: node scripts/calibrate-confidence.mjs [--folds=5]

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
const FOLDS = Number(arg("folds", "5"));
const OUT = p("data/calibration/confidence.json");
const MAJOR = ["Labour", "Conservative", "Liberal Democrats", "Reform UK", "Green Party"];
// Wide at the bottom where contests are genuinely coin flips, wider at the top
// where there are few wards and the model is rarely wrong for interesting reasons.
const EDGES = [0, 0.02, 0.05, 0.1, 0.15, 0.2, 0.3, 1.01];

const readJson = (rel) => JSON.parse(readFileSync(path.isAbsolute(rel) ? rel : p(rel), "utf8"));
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

function loadRows() {
  const predDoc = readJson(PREDICTIONS);
  const predictions = predDoc.predictions || predDoc.by_ballot || predDoc;
  const actuals = readJson(ACTUALS).by_ballot;
  const rows = [];
  for (const [ballotId, entry] of Object.entries(predictions)) {
    const prediction = entry?.prediction;
    const actual = actuals?.[ballotId]?.vote_shares;
    if (!prediction || !actual) continue;
    if (entry?.party_bias_calibration) {
      throw new Error(`${ballotId} already carries a bias correction; regenerate predictions uncorrected before fitting`);
    }
    const predicted = {};
    for (const [party, payload] of Object.entries(prediction)) predicted[party] = payload?.pct || 0;
    rows.push({
      ballotId,
      council: ballotId.split(".")[1],
      predicted,
      actual,
      actualWinner: Object.entries(actual).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
      declaredConfidence: entry?.confidence ?? null,
    });
  }
  return rows;
}

const foldsOf = (councils, k) =>
  Array.from({ length: k }, (_, i) => new Set(councils.filter((_, j) => j % k === i)));

function fitBias(rows) {
  const acc = {};
  for (const row of rows) {
    for (const party of MAJOR) {
      if (!(party in row.predicted) && !(party in row.actual)) continue;
      (acc[party] ||= []).push((row.predicted[party] || 0) - (row.actual[party] || 0));
    }
  }
  return Object.fromEntries(Object.entries(acc).map(([party, errs]) => [party, mean(errs)]));
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

/** Margin between first and second, and whether first was right. */
function marginRow(shares, actualWinner) {
  const ranked = Object.entries(shares).sort((a, b) => b[1] - a[1]);
  if (ranked.length < 2) return null;
  return { margin: ranked[0][1] - ranked[1][1], correct: ranked[0][0] === actualWinner };
}

/** Out-of-fold bias correction, so no ward is corrected with its own council's error. */
function correctedOutOfFold(rows, k) {
  const councils = [...new Set(rows.map((r) => r.council))].sort();
  const out = [];
  for (const fold of foldsOf(councils, k)) {
    const test = rows.filter((r) => fold.has(r.council));
    const train = rows.filter((r) => !fold.has(r.council));
    if (!test.length || !train.length) continue;
    const bias = fitBias(train);
    for (const row of test) {
      const m = marginRow(correct(row.predicted, bias), row.actualWinner);
      if (m) out.push({ ...row, ...m });
    }
  }
  return out;
}

// Pool adjacent violators: a bigger predicted margin must never carry a lower
// quoted probability. The raw May 2026 curve rises monotonically to 77.3% in the
// 20 to 30 point band and then falls to 67.7% above 30 points, on 96 wards. That
// dip is not "we get blowouts wrong more often", it is a thin bin holding
// independent and local-party strongholds. Pooling is the standard isotonic fix
// and keeps the curve honest without inventing a story about the top end.
function enforceMonotonic(bins) {
  const live = bins.filter((b) => b.n > 0);
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < live.length - 1; i += 1) {
      if (live[i].winner_probability > live[i + 1].winner_probability) {
        const n = live[i].n + live[i + 1].n;
        const pooled = (live[i].winner_probability * live[i].n + live[i + 1].winner_probability * live[i + 1].n) / n;
        live[i] = { ...live[i], n, winner_probability: Number(pooled.toFixed(4)), margin_to_pp: live[i + 1].margin_to_pp, pooled: true };
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
  for (const [lo, hi] of EDGES.slice(0, -1).map((lo, i) => [lo, EDGES[i + 1]])) {
    const inBin = rows.filter((r) => r.margin >= lo && r.margin < hi);
    bins.push({
      margin_from_pp: Number((lo * 100).toFixed(1)),
      margin_to_pp: Number((hi * 100).toFixed(1)),
      n: inBin.length,
      winner_probability: inBin.length ? Number((inBin.filter((r) => r.correct).length / inBin.length).toFixed(4)) : null,
    });
  }
  return enforceMonotonic(bins);
}

const lookup = (bins, margin) => {
  const bin = bins.find((b) => margin * 100 >= b.margin_from_pp && margin * 100 < b.margin_to_pp);
  return bin?.winner_probability ?? null;
};

/**
 * Brier score: mean squared error of the quoted probability against the outcome.
 * This is the metric that decides whether the curve ships, because it rewards
 * BOTH calibration and resolution. Bucket-level calibration error alone punishes
 * a curve for being fine-grained: split the wards into five buckets instead of
 * one and each bucket gets noisier, which is why the flat base rate wins on that
 * measure while being useless in practice. Lower is better.
 */
function brier(bins, rows) {
  const errs = [];
  for (const row of rows) {
    const q = lookup(bins, row.margin);
    if (q == null) continue;
    errs.push((q - (row.correct ? 1 : 0)) ** 2);
  }
  return errs.length ? mean(errs) : null;
}

/** Mean absolute gap between the probability we would have quoted and what happened. */
function calibrationError(bins, rows) {
  const buckets = new Map();
  for (const row of rows) {
    const q = lookup(bins, row.margin);
    if (q == null) continue;
    const key = q.toFixed(3);
    const b = buckets.get(key) || { quoted: q, n: 0, hits: 0 };
    b.n += 1;
    if (row.correct) b.hits += 1;
    buckets.set(key, b);
  }
  let weighted = 0;
  let total = 0;
  for (const b of buckets.values()) {
    weighted += b.n * Math.abs(b.quoted - b.hits / b.n);
    total += b.n;
  }
  return total ? weighted / total : null;
}

function main() {
  const rows = loadRows();
  const corrected = correctedOutOfFold(rows, FOLDS);
  if (corrected.length < 500) throw new Error(`only ${corrected.length} scoreable wards; refusing to fit`);
  const bins = fitCurve(corrected);

  // Validate the curve itself: fit on four fifths of councils, score the fifth.
  const councils = [...new Set(corrected.map((r) => r.council))].sort();
  const perFold = [];
  for (const fold of foldsOf(councils, FOLDS)) {
    const test = corrected.filter((r) => fold.has(r.council));
    const train = corrected.filter((r) => !fold.has(r.council));
    if (!test.length || !train.length) continue;
    // Baseline to beat: quote every ward the overall hit rate from the training
    // councils. A curve that cannot beat one number is not worth publishing.
    const flat = train.filter((r) => r.correct).length / train.length;
    const flatBins = [{ margin_from_pp: 0, margin_to_pp: 101, n: train.length, winner_probability: Number(flat.toFixed(4)) }];
    const curveBins = fitCurve(train);
    perFold.push({
      wards: test.length,
      calibration_error_pp: Number((calibrationError(curveBins, test) * 100).toFixed(3)),
      flat_baseline_error_pp: Number((calibrationError(flatBins, test) * 100).toFixed(3)),
      brier: Number(brier(curveBins, test).toFixed(5)),
      flat_baseline_brier: Number(brier(flatBins, test).toFixed(5)),
    });
  }

  // What the existing three-band label achieved, for comparison.
  const declared = {};
  for (const row of corrected) {
    const key = row.declaredConfidence || "none";
    (declared[key] ||= { n: 0, hits: 0 });
    declared[key].n += 1;
    if (row.correct) declared[key].hits += 1;
  }
  const legacy = Object.fromEntries(
    Object.entries(declared).map(([k, v]) => [k, { n: v.n, winner_accuracy_pct: Number(((v.hits / v.n) * 100).toFixed(1)) }]),
  );

  const doc = {
    schema_version: "1.0.0",
    fitted_on: LABEL,
    fitted_on_date: LABEL.split(".").pop(),
    fitted_at: new Date().toISOString(),
    method:
      "Realised winner accuracy binned by the predicted margin between first and second place, measured on out-of-fold bias-corrected predictions, validated by a second k-fold grouped by council.",
    predictor: "margin_first_minus_second",
    bins,
    bands: { high: 0.6, medium: 0.45 },
    validation: {
      folds: perFold.length,
      mean_calibration_error_pp: Number(mean(perFold.map((f) => f.calibration_error_pp)).toFixed(3)),
      mean_flat_baseline_error_pp: Number(mean(perFold.map((f) => f.flat_baseline_error_pp)).toFixed(3)),
      mean_brier: Number(mean(perFold.map((f) => f.brier)).toFixed(5)),
      mean_flat_baseline_brier: Number(mean(perFold.map((f) => f.flat_baseline_brier)).toFixed(5)),
      per_fold: perFold,
      note:
        "Calibration error is the average gap between the probability the curve would have quoted and the share of those wards we actually got right, on councils the curve never saw.",
    },
    replaces: {
      label: "three-band high / medium / low",
      measured: legacy,
      note:
        "The old label carried no information and was inverted at the top: high scored below medium. It was a statement about how much input data a ward had, not about how often we were right.",
    },
    do_not_apply_to: [LABEL],
  };

  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`Fitted on ${corrected.length} wards across ${councils.length} councils.`);
  for (const b of bins) {
    if (b.n) console.log(`  margin ${b.margin_from_pp} to ${b.margin_to_pp}pp: n=${b.n}, winner probability ${(b.winner_probability * 100).toFixed(1)}%`);
  }
  console.log(`  held-out Brier: ${doc.validation.mean_brier} against flat base rate ${doc.validation.mean_flat_baseline_brier} (lower is better)`);
  console.log(`  held-out calibration error: ${doc.validation.mean_calibration_error_pp}pp (flat base rate ${doc.validation.mean_flat_baseline_error_pp}pp)`);
  console.log(`  old label for comparison: ${JSON.stringify(legacy)}`);
  console.log(`  wrote ${path.relative(ROOT, OUT)}`);
}

main();
