/**
 * intervals.js — bootstrap P10/P50/P90 intervals on per-ward predictions
 * using the per-party residual SDs from the 2024 backtest.
 *
 * For each ward prediction:
 *   - For each party present, treat the predicted pct as the central estimate
 *   - Sample N times from N(predicted_pct, sigma_party) where sigma comes from
 *     the backtest residual SD for that party (or a "default" SD for parties
 *     not observed in the backtest)
 *   - Floor each draw at 0, re-normalise across parties per draw
 *   - Quantile P10/P50/P90 per party
 *
 * Pure function, deterministic given a seed.
 */

function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s += 0x6D2B79F5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand) {
  const u = Math.max(1e-12, rand());
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const DEFAULT_SIGMA_BY_PARTY = {
  "Labour": 0.10,
  "Conservative": 0.08,
  "Reform UK": 0.07,
  "Liberal Democrats": 0.07,
  "Green Party": 0.07,
  "SNP": 0.05,
  "Plaid Cymru": 0.04,
  "Independent": 0.10,
};
const DEFAULT_FALLBACK_SIGMA = 0.06;

export function bootstrapWardIntervals({ prediction, residualSd = {}, samples = 1000, seed = 1 }) {
  if (!prediction) return null;
  const parties = Object.keys(prediction);
  if (parties.length === 0) return prediction;

  const sigmaFor = (p) => {
    const fromBacktest = residualSd[p];
    if (typeof fromBacktest === "number" && fromBacktest > 0) return fromBacktest;
    return DEFAULT_SIGMA_BY_PARTY[p] ?? DEFAULT_FALLBACK_SIGMA;
  };

  const rand = mulberry32(seed);
  const draws = parties.map(() => []);

  for (let i = 0; i < samples; i += 1) {
    const noisy = parties.map((p) => Math.max(0, (prediction[p].pct || 0) + gaussian(rand) * sigmaFor(p)));
    const sum = noisy.reduce((s, v) => s + v, 0);
    if (sum <= 0) continue;
    for (let j = 0; j < parties.length; j += 1) {
      draws[j].push(noisy[j] / sum);
    }
  }

  const out = {};
  parties.forEach((p, idx) => {
    const arr = draws[idx].slice().sort((a, b) => a - b);
    const pct = (q) => arr.length ? arr[Math.floor(q * (arr.length - 1))] : prediction[p].pct;
    out[p] = {
      ...prediction[p],
      p10: pct(0.1),
      p50: pct(0.5),
      p90: pct(0.9),
      win_probability: arr.length ? arr.filter((s, _i, a) => {
        // Approximate per-draw win probability: count draws where this party
        // had the largest noisy share. We compute this in a second pass below
        // for efficiency.
        return false;
      }).length / arr.length : 0,
    };
  });

  // Second pass: per-draw winner counts → win_probability per party
  const drawCount = draws[0]?.length || 0;
  if (drawCount > 0) {
    const winCounts = parties.map(() => 0);
    for (let i = 0; i < drawCount; i += 1) {
      let bestVal = -Infinity; let bestIdx = -1;
      for (let j = 0; j < parties.length; j += 1) {
        if (draws[j][i] > bestVal) { bestVal = draws[j][i]; bestIdx = j; }
      }
      if (bestIdx >= 0) winCounts[bestIdx] += 1;
    }
    parties.forEach((p, idx) => {
      out[p].win_probability = +(winCounts[idx] / drawCount).toFixed(3);
    });
  }

  return out;
}

/**
 * Apply intervals to every ward prediction in a bundle.
 * Mutates each entry's `prediction` to add p10/p50/p90/win_probability.
 */
export function applyIntervalsToBundle(predictions, residualSd, samples = 800) {
  let i = 0;
  for (const [bid, p] of Object.entries(predictions)) {
    if (!p?.prediction) { i += 1; continue; }
    p.prediction = bootstrapWardIntervals({
      prediction: p.prediction,
      residualSd,
      samples,
      seed: 1 + (i % 1_000_000),
    });
    i += 1;
  }
  return predictions;
}
