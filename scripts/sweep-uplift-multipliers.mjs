#!/usr/bin/env node
// sweep-uplift-multipliers.mjs
//
// Fit the Reform realignment uplift's regional multipliers instead of choosing
// them by hand.
//
// The uplift (step 9b) is the single most effective change ever made to this
// model: on its 1,573-ward cohort it cut Reform MAE from 16.73pp to 9.00pp. But
// its multipliers were set by reading a post-audit table and picking round
// numbers, and it over-corrected into running Reform 3.35pp hot. Round numbers
// picked by eye are a hypothesis, not a calibration.
//
// Method: one coordinate pass. For each tier, re-run the whole ward model once
// per candidate value with the other tiers held at their current values, and
// keep every ward's score. Then, fold by fold, pick the value that scores best
// on the training councils and apply it to the held-out councils. Reporting the
// best value found on the whole set would be fitting the answer key.
//
// This costs one full model run per candidate value, so keep the grid small.
//
// Usage: node scripts/sweep-uplift-multipliers.mjs [--folds=5] [--out=path]

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const p = (rel) => path.join(ROOT, rel);
const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const FOLDS = Number(arg("folds", "5"));
const OUT = arg("out", "data/calibration/reform-regional-multiplier.fitted.json");
const PREDICTIONS = p("data/predictions/may-2026/local-and-mayor.json");
const ACTUALS = p("data/results/may-2026/local-and-mayor.merged.json");
const MAJOR = ["Labour", "Conservative", "Liberal Democrats", "Reform UK", "Green Party"];

const TIERS = {
  london: [0, 0.25, 0.5],
  metropolitan: [0.5, 0.75, 1.0],
  other: [0.6, 0.85, 1.0],
  northern_unitary: [0.75, 1.0, 1.25],
};

const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const actuals = JSON.parse(readFileSync(ACTUALS, "utf8")).by_ballot;

function runAndScore(env) {
  execFileSync("node", [p("scripts/run-bulk-predictions.mjs")], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: "ignore",
  });
  const predictions = JSON.parse(readFileSync(PREDICTIONS, "utf8")).predictions;
  const rows = {};
  for (const [ballotId, entry] of Object.entries(predictions)) {
    const prediction = entry?.prediction;
    const actual = actuals?.[ballotId]?.vote_shares;
    if (!prediction || !actual) continue;
    const shares = Object.fromEntries(Object.entries(prediction).map(([k, v]) => [k, v?.pct || 0]));
    const top = Object.entries(shares).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const actualTop = Object.entries(actual).sort((a, b) => b[1] - a[1])[0][0];
    const errs = MAJOR.filter((party) => party in shares || party in actual)
      .map((party) => Math.abs((shares[party] || 0) - (actual[party] || 0)));
    rows[ballotId] = { council: ballotId.split(".")[1], correct: top === actualTop, mae: errs.length ? mean(errs) : null };
  }
  return rows;
}

const score = (rows, ids) => ({
  winners: (ids.filter((id) => rows[id]?.correct).length / ids.length) * 100,
  mae: mean(ids.map((id) => rows[id]?.mae).filter((m) => m != null)) * 100,
});

function main() {
  const current = { london: 0, metropolitan: 0.75, other: 0.85, northern_unitary: 1.0 };
  const runs = {};
  const baselineEnv = Object.fromEntries(Object.entries(current).map(([t, v]) => [`UKE_UPLIFT_${t.toUpperCase()}`, String(v)]));
  process.stderr.write("baseline run ...\n");
  runs["baseline"] = runAndScore(baselineEnv);

  for (const [tier, values] of Object.entries(TIERS)) {
    for (const value of values) {
      if (value === current[tier]) continue;
      const key = `${tier}=${value}`;
      process.stderr.write(`${key} ...\n`);
      runs[key] = runAndScore({ ...baselineEnv, [`UKE_UPLIFT_${tier.toUpperCase()}`]: String(value) });
    }
  }

  const ids = Object.keys(runs["baseline"]);
  const councils = [...new Set(ids.map((id) => runs["baseline"][id].council))].sort();
  const folds = Array.from({ length: FOLDS }, (_, i) => new Set(councils.filter((_, j) => j % FOLDS === i)));

  const perFold = [];
  for (const fold of folds) {
    const test = ids.filter((id) => fold.has(runs["baseline"][id].council));
    const train = ids.filter((id) => !fold.has(runs["baseline"][id].council));
    const picks = {};
    for (const [tier, values] of Object.entries(TIERS)) {
      let best = { value: current[tier], mae: score(runs["baseline"], train).mae };
      for (const value of values) {
        const key = `${tier}=${value}`;
        if (!runs[key]) continue;
        const m = score(runs[key], train).mae;
        if (m < best.mae) best = { value, mae: m };
      }
      picks[tier] = best.value;
    }
    // Score the held-out fold under each tier pick separately, since only one
    // tier was varied per run. Summing single-tier deltas assumes the tiers do
    // not interact, which is true here: each ward sits in exactly one tier.
    let winnerDelta = 0;
    let maeDelta = 0;
    const base = score(runs["baseline"], test);
    for (const [tier, value] of Object.entries(picks)) {
      if (value === current[tier]) continue;
      const key = `${tier}=${value}`;
      const alt = score(runs[key], test);
      winnerDelta += alt.winners - base.winners;
      maeDelta += alt.mae - base.mae;
    }
    perFold.push({
      wards: test.length,
      picks,
      winner_delta_pp: Number(winnerDelta.toFixed(3)),
      mae_delta_pp: Number(maeDelta.toFixed(4)),
    });
  }

  // The shipped value per tier is the one the folds agreed on most often.
  const fitted = {};
  for (const tier of Object.keys(TIERS)) {
    const counts = {};
    for (const f of perFold) counts[f.picks[tier]] = (counts[f.picks[tier]] || 0) + 1;
    const [value, votes] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    fitted[tier] = { multiplier: Number(value), folds_agreeing: votes, of_folds: perFold.length, hand_set_was: current[tier] };
  }

  const doc = {
    schema_version: "2.0.0",
    fitted_on: "local.2026-05-07",
    fitted_at: new Date().toISOString(),
    method:
      "One coordinate pass: each tier's multiplier swept with the others held fixed, one full model run per value, then chosen fold by fold on training councils and scored on held-out councils.",
    grid: TIERS,
    hand_set: current,
    fitted,
    validation: {
      folds: perFold.length,
      mean_winner_delta_pp: Number(mean(perFold.map((f) => f.winner_delta_pp)).toFixed(3)),
      mean_mae_delta_pp: Number(mean(perFold.map((f) => f.mae_delta_pp)).toFixed(4)),
      per_fold: perFold,
    },
  };
  mkdirSync(path.dirname(p(OUT)), { recursive: true });
  writeFileSync(p(OUT), `${JSON.stringify(doc, null, 2)}\n`);
  console.log(JSON.stringify({ fitted, validation: doc.validation }, null, 2));
  console.log(`wrote ${OUT}`);
}

main();
