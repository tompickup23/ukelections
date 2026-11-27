#!/usr/bin/env node
/**
 * Replay the 24 October candidate's stages over the polling-day forecast with
 * the bridged wards' fallback forecasts replaced by the engine's forecasts from
 * a notional previous result. ENGINE_NOTIONAL_SPEC.md. Prints checks only.
 *
 * Usage: node engine_notional_replay.mjs <engine run with notional results.json>
 * Output: cache/arms/candidate-notional.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ge2024ForArea, localElectionTargets } from "../../src/lib/localElectionTarget.js";
import { asPredictions, atCommit, baseTargets, finalC, pre9bStage, step9b } from "../../scripts/replay-may-2026-candidate.mjs";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, "../..");
const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const CAND_DIR = path.join(ROOT, "data/calibration/candidate-2026-10-24");

const published = atCommit("data/predictions/may-2026/local-and-mayor.json").predictions;
const rerun = read(path.resolve(process.argv[2])).predictions;
const notional = read(path.join(HERE, "cache/engine_notional.json"));
const stored = read(path.join(HERE, "cache/arms/candidate-2026-10-24.json")).predictions;
const history = read(path.join(ROOT, "data/history/dc-historic-results.json"));
const c1Doc = read(path.join(CAND_DIR, "reform-regional-multiplier.json"));
const ratioDoc = read(path.join(CAND_DIR, "local-national-ratio.json"));
const C1 = Object.fromEntries(Object.entries(c1Doc.tiers).map(([t, v]) => [t, v.multiplier]));
const base = baseTargets();

function candidate(predictions) {
  const lifted = step9b(pre9bStage(predictions), base, C1);
  const cache = new Map();
  const areaShares = (slug) => { if (!cache.has(slug)) cache.set(slug, ge2024ForArea(history, slug)?.shares || null); return cache.get(slug); };
  const wards = Object.entries(lifted).map(([id, s]) => ({ council_slug: id.split(".")[1], votes: s.votes, shares: s.shares }));
  const targets = localElectionTargets(wards, { poll: ratioDoc.polls_to_cutoff.shares, ge24National: ratioDoc.snapshot.ge2024_national, ratio: ratioDoc.ratio, areaShares });
  return finalC(lifted, targets);
}
const gap = (a, b) => { let d = 0; for (const p of new Set([...Object.keys(a), ...Object.keys(b)])) d = Math.max(d, Math.abs((a[p] || 0) - (b[p] || 0))); return d; };
const pct = (e) => Object.fromEntries(Object.entries(e.prediction).map(([p, v]) => [p, v.pct || 0]));

// Check 1: with nothing replaced, the replay is the stored candidate arm.
const plain = candidate(published);
let maxPlain = 0;
for (const [id, sh] of Object.entries(plain.shares)) if (stored[id]?.prediction) maxPlain = Math.max(maxPlain, gap(sh, pct(stored[id])));
console.log(`check: replay against the stored candidate arm, ${Object.keys(plain.shares).length} wards, largest difference ${maxPlain.toExponential(2)}`);

// Check 2: outside the bridged wards the engine run is the published forecast.
let maxOther = 0;
let replaced = 0;
let stillFallback = 0;
const merged = { ...published };
for (const [id, e] of Object.entries(rerun)) {
  if (notional[id]) {
    if (e.prediction && e.baseline_date) { merged[id] = e; replaced += 1; } else stillFallback += 1;
  } else if (e.prediction && published[id]?.prediction) maxOther = Math.max(maxOther, gap(pct(e), pct(published[id])));
}
console.log(`engine run: ${replaced} bridged wards forecast from a notional result, ${stillFallback} still on the fallback; other wards differ from published by at most ${maxOther.toExponential(2)}`);

const out = candidate(merged);
writeFileSync(path.join(HERE, "cache/arms/candidate-notional.json"), JSON.stringify({
  snapshot: { generated_by: "research/ward-model-2026-11/engine_notional_replay.mjs", arm: "candidate, notional previous result on bridged wards" },
  final_c_multipliers: { before: plain.multipliers, after: out.multipliers },
  bridged: Object.keys(notional).filter((id) => merged[id] !== published[id]),
  predictions: asPredictions(out.shares),
}) + "\n");
console.log("Final-C multipliers before", JSON.stringify(Object.fromEntries(Object.entries(plain.multipliers).map(([p, v]) => [p, +v.toFixed(4)]))));
console.log("Final-C multipliers after ", JSON.stringify(Object.fromEntries(Object.entries(out.multipliers).map(([p, v]) => [p, +v.toFixed(4)]))));
