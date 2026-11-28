#!/usr/bin/env node
/**
 * Candidate engine forecasts under the baseline age rule (BASELINE_AGE_SPEC.md),
 * for each k on the grid. Prints checks only; scoring is in baseline_age_score.py.
 *
 * Usage: node baseline_age_replay.mjs <engine run with notional results.json> <engine run with histories withheld.json>
 * Output: cache/arms/candidate-age.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ge2024ForArea, localElectionTargets } from "../../src/lib/localElectionTarget.js";
import { atCommit, baseTargets, finalC, pre9bStage, step9b } from "../../scripts/replay-may-2026-candidate.mjs";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, "../..");
const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const CAND_DIR = path.join(ROOT, "data/calibration/candidate-2026-10-24");
const GRID = [0, 0.04, 0.08, 0.12, 0.16];
const CAP = 0.8;
const POLL = Date.parse("2026-05-07");

const published = atCommit("data/predictions/may-2026/local-and-mayor.json").predictions;
const withNotional = read(path.resolve(process.argv[2])).predictions;
const withheld = read(path.resolve(process.argv[3])).predictions;
const notional = read(path.join(HERE, "cache/engine_notional.json"));
const history = read(path.join(ROOT, "data/history/dc-historic-results.json"));
const C1 = Object.fromEntries(Object.entries(read(path.join(CAND_DIR, "reform-regional-multiplier.json")).tiers).map(([t, v]) => [t, v.multiplier]));
const ratioDoc = read(path.join(CAND_DIR, "local-national-ratio.json"));
const base = baseTargets();
const areaCache = new Map();
const areaShares = (slug) => { if (!areaCache.has(slug)) areaCache.set(slug, ge2024ForArea(history, slug)?.shares || null); return areaCache.get(slug); };

function candidate(stage) {
  const lifted = step9b(stage, base, C1);
  const wards = Object.entries(lifted).map(([id, s]) => ({ council_slug: id.split(".")[1], votes: s.votes, shares: s.shares }));
  const targets = localElectionTargets(wards, { poll: ratioDoc.polls_to_cutoff.shares, ge24National: ratioDoc.snapshot.ge2024_national, ratio: ratioDoc.ratio, areaShares });
  return finalC(lifted, targets).shares;
}
const norm = (o) => { const s = Object.values(o).reduce((a, b) => a + b, 0); return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, s ? v / s : 0])); };
const gap = (a, b) => { let d = 0; for (const p of new Set([...Object.keys(a), ...Object.keys(b)])) d = Math.max(d, Math.abs((a[p] || 0) - (b[p] || 0))); return d; };

const merged = { ...published };
for (const id of Object.keys(notional)) merged[id] = withNotional[id];
const stageReal = pre9bStage(published);       // 220 bridged wards on their fallback
const stageNotional = pre9bStage(merged);      // 220 bridged wards from a notional result
const stageFallback = pre9bStage(withheld);

// Checks: every ward is on the fallback in the withheld run, and where the published
// forecast was already a fallback the recovered stage agrees with it.
let notFallback = 0;
let maxSame = 0;
let nSame = 0;
for (const [id, e] of Object.entries(withheld)) {
  if (!e.prediction) continue;
  if (e.baseline_date) notFallback += 1;
  if (published[id]?.prediction && !published[id].baseline_date) { maxSame = Math.max(maxSame, gap(stageFallback[id].shares, stageReal[id].shares)); nSame += 1; }
}
console.log(`withheld run: ${Object.keys(stageFallback).length} wards, ${notFallback} not on the fallback; ${nSame} wards already on the fallback agree with the published stage to within ${maxSame.toExponential(2)}`);

const age = {};
for (const [id, e] of Object.entries(merged)) if (e.prediction && e.baseline_date) age[id] = (POLL - Date.parse(e.baseline_date)) / (365.25 * 86400e3);

function ruled(stage, k) {
  const out = {};
  for (const [id, s] of Object.entries(stage)) {
    const f = stageFallback[id];
    const real = (stage === stageNotional ? merged : published)[id];
    if (!k || !f || !real.baseline_date) { out[id] = s; continue; }
    const w = Math.min(CAP, k * age[id]);
    const sh = {};
    for (const p of new Set([...Object.keys(s.shares), ...Object.keys(f.shares)])) sh[p] = (1 - w) * (s.shares[p] || 0) + w * (f.shares[p] || 0);
    out[id] = { ...s, shares: norm(sh) };
  }
  return out;
}
const arms = {};
for (const k of GRID) {
  arms[`real_k${k}`] = candidate(ruled(stageReal, k));
  arms[`notional_k${k}`] = candidate(ruled(stageNotional, k));
}
const stored = read(path.join(HERE, "cache/arms/candidate-2026-10-24.json")).predictions;
let maxStored = 0;
for (const [id, sh] of Object.entries(arms.real_k0)) if (stored[id]?.prediction) maxStored = Math.max(maxStored, gap(sh, Object.fromEntries(Object.entries(stored[id].prediction).map(([p, v]) => [p, v.pct || 0]))));
console.log(`k = 0 against the stored candidate arm: largest difference ${maxStored.toExponential(2)}`);
writeFileSync(path.join(HERE, "cache/arms/candidate-age.json"), JSON.stringify({ grid: GRID, cap: CAP, age, arms }) + "\n");
console.log(`wrote ${Object.keys(arms).length} arms; wards with a base ${Object.keys(age).length}`);
