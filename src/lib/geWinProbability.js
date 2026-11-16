/**
 * Westminster win probability, share intervals and seat ranges.
 *
 * The constituency model produces point shares. This module turns them into
 * the three uncertainty statements the forecast publishes:
 *
 *   1. A probability that the projected leader wins the seat, read from the
 *      realised hit rate of the 2024 rerun binned by predicted margin. Same
 *      construction as data/calibration/confidence.json for wards; fitted by
 *      scripts/calibrate-ge-win-probability.mjs into
 *      data/calibration/ge-win-probability.json.
 *   2. p10 and p90 shares per party, from the same rerun's per-party residual
 *      SDs, drawn with src/lib/intervals.js.
 *   3. A seat range per party, by sampling every seat's winner from its win
 *      probability. Seat outcomes are drawn with a shared national component
 *      (a Gaussian copula) because constituency errors are correlated: the
 *      2024 polling miss moved hundreds of seats the same way. Drawing seats
 *      independently would publish a range far narrower than the evidence.
 *
 * Never apply a calibration to the election it was fitted on: like
 * confidenceCalibration.js, geWinProbabilityApplies refuses the fitted
 * election by date, and also refuses any forecast whose polling predates it.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { predictedMargin } from "./confidenceCalibration.js";
import { bootstrapWardIntervals } from "./intervals.js";

export const GE_WIN_PROBABILITY_FILE = "data/calibration/ge-win-probability.json";

const cache = new Map();
export function loadGeWinProbability(root = process.cwd()) {
  const file = resolve(root, GE_WIN_PROBABILITY_FILE);
  if (!cache.has(file)) cache.set(file, existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null);
  return cache.get(file);
}

const dateOf = (id) => String(id).split(".").pop();

/**
 * @param {object} calibration  ge-win-probability.json
 * @param {{ electionDate?: string|null, pollingLatest?: string|null }} target
 */
export function geWinProbabilityApplies(calibration, { electionDate = null, pollingLatest = null } = {}) {
  if (!calibration?.bins?.length) return false;
  const blocked = [...(calibration.do_not_apply_to || []), calibration.fitted_on, calibration.fitted_on_date]
    .filter(Boolean)
    .map(dateOf);
  if (electionDate && blocked.includes(dateOf(electionDate))) return false;
  // Polling from on or before the fitted election belongs to that election's
  // campaign: a forecast built on it is a forecast of the answer key.
  if (pollingLatest && calibration.fitted_on_date && String(pollingLatest) <= calibration.fitted_on_date) return false;
  return true;
}

export function lookupBin(bins, marginPp) {
  return (
    bins.find((b) => marginPp >= b.margin_from_pp && marginPp < b.margin_to_pp) ||
    bins[bins.length - 1] ||
    null
  );
}

/** @returns {{ win_probability: number, margin_pp: number, bin: object }|null} */
export function leaderWinProbability(prediction, calibration) {
  const margin = predictedMargin(prediction);
  if (margin == null || !calibration?.bins?.length) return null;
  const marginPp = margin * 100;
  const bin = lookupBin(calibration.bins, marginPp);
  if (bin?.winner_probability == null) return null;
  return {
    win_probability: bin.winner_probability,
    margin_pp: Number(marginPp.toFixed(2)),
    bin: { from_pp: bin.margin_from_pp, to_pp: bin.margin_to_pp, n: bin.n },
  };
}

/**
 * p10 and p90 share per party, for parties on at least 1 per cent. Trace
 * parties are drawn as one combined bucket: drawn one by one with the pooled
 * minor-party SD, a dozen 0.1 per cent parties would each take a few points in
 * every renormalised draw and drag every contender's interval down.
 * The intervals library also estimates its own per-party win probability,
 * which is dropped so a seat never carries two different probabilities.
 */
export const INTERVAL_CONTENDER_SHARE = 0.01;
const REST = "__other_parties_combined";

export function shareIntervals(prediction, calibration, { samples = 2000, seed = 1 } = {}) {
  const sd = calibration?.residual_sd;
  if (!prediction || !sd?.by_party) return null;
  const drawInput = {};
  let rest = 0;
  for (const [party, v] of Object.entries(prediction)) {
    const pct = v?.pct || 0;
    if (pct >= INTERVAL_CONTENDER_SHARE) drawInput[party] = { pct };
    else rest += pct;
  }
  if (rest > 0) drawInput[REST] = { pct: rest };
  if (Object.keys(drawInput).length === 0) return null;
  const drawn = bootstrapWardIntervals({
    prediction: drawInput,
    residualSd: sd.by_party,
    fallbackSigma: sd.other_parties,
    samples,
    seed,
  });
  const out = {};
  for (const [party, v] of Object.entries(drawn || {})) {
    if (party === REST) continue;
    out[party] = { p10: Number(v.p10.toFixed(4)), p90: Number(v.p90.toFixed(4)) };
  }
  return out;
}

function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
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

/** Inverse standard normal CDF (Acklam's rational approximation, |error| < 1.2e-9). */
export function normalQuantile(p) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - lo) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/**
 * Seat range per party by sampling each seat's winner.
 *
 * Seat i has a leader L, a runner-up R and a probability p_i that L wins. Per
 * draw, every party gets a national shock g ~ N(0,1); seat i's latent is
 *   x_i = sqrt(rho) * (g_R - g_L) / sqrt(2) + sqrt(1 - rho) * e_i,  e_i ~ N(0,1)
 * and L loses to R when x_i > Phi^-1(p_i). Each x_i is standard normal, so a
 * seat's own probability is exactly p_i; rho only sets how far seats with the
 * same pairing move together. rho = 0 is independent seats.
 *
 * @param {Array<{ winner: string, runner_up: string, win_probability: number }>} seats
 * @returns {{ by_party: Record<string, {p05:number,p50:number,p95:number,mean:number}>, draws:number, seed:number, rho:number }}
 */
export function simulateSeatRanges(seats, { draws = 10000, seed = 20261109, rho = 0 } = {}) {
  const rand = mulberry32(seed);
  const live = seats.filter((s) => s?.winner);
  const parties = [...new Set(live.flatMap((s) => [s.winner, s.runner_up].filter(Boolean)))].sort();
  const index = new Map(parties.map((p, i) => [p, i]));
  const thresholds = live.map((s) =>
    s.runner_up && typeof s.win_probability === "number" ? normalQuantile(s.win_probability) : Infinity,
  );
  const a = Math.sqrt(Math.max(0, Math.min(1, rho)));
  const b = Math.sqrt(1 - a * a);
  const tallies = parties.map(() => new Array(draws));
  const shock = new Array(parties.length);
  const count = new Array(parties.length);
  for (let d = 0; d < draws; d += 1) {
    for (let j = 0; j < parties.length; j += 1) { shock[j] = gaussian(rand); count[j] = 0; }
    for (let i = 0; i < live.length; i += 1) {
      const s = live[i];
      const L = index.get(s.winner);
      if (thresholds[i] === Infinity) { count[L] += 1; continue; }
      const R = index.get(s.runner_up);
      const x = (a * (shock[R] - shock[L])) / Math.SQRT2 + b * gaussian(rand);
      count[x > thresholds[i] ? R : L] += 1;
    }
    for (let j = 0; j < parties.length; j += 1) tallies[j][d] = count[j];
  }
  const by_party = {};
  parties.forEach((p, j) => {
    const arr = tallies[j].sort((x, y) => x - y);
    const q = (f) => arr[Math.min(arr.length - 1, Math.floor(f * arr.length))];
    const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
    if (q(0.95) === 0) return;
    by_party[p] = { p05: q(0.05), p50: q(0.5), p95: q(0.95), mean: Number(mean.toFixed(1)) };
  });
  return { by_party, draws, seed, rho };
}

/** "54 in 100" */
export function inHundred(p) {
  return `${Math.round(p * 100)} in 100`;
}
