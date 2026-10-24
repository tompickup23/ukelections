#!/usr/bin/env node
/**
 * replay-may-2026-candidate.mjs: score the 24 October 2026 candidate local
 * engine on May 2026, held out, against the polling-day forecast it would have
 * replaced. Protocol: docs/local-engine-holdout-2026-10-24.md.
 *
 * Stage replay. The polling-day forecast (5e85c84) records, per ward, Step 9b's
 * Reform share before its lift and its base target, and the Final-C multipliers.
 * From those this recovers the forecast as it stood before Step 9b, then re-runs
 * Step 9b and Final-C exactly as the 7 May engine did, or with the candidate's
 * changes. Upstream stages are not re-run. The recorded figures are rounded, so
 * the replay of the 7 May engine lands within a few wards of the published file;
 * every arm goes through the same replay so the comparison is like for like.
 *
 * Arms, each scored once on scripts/score-may-2026-like-for-like.mjs:
 *   replay    the 7 May engine as published (polling-day polls)
 *   control   the 7 May engine with the polls to 25 April 2026
 *   c2        Final-C aimed at the local-election target
 *   c1        Step 9b with the refitted multipliers
 *   candidate c1 and c2 together
 *
 * Needs the full git history and the gitignored data/history/dc-historic-results.json.
 *
 * Usage:
 *   node scripts/replay-may-2026-candidate.mjs [--write-predictions=<path>]
 *   writes data/transparency/may-2026-candidate-2026-10-24.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { ge2024ForArea, localElectionTargets } from "../src/lib/localElectionTarget.js";
import { upliftTier, MULTIPLIERS_7_MAY } from "./fit-candidate-engine-2026-10-24.mjs";
import { ACTUALS_PATH, POSTAUDIT_PATH, scoreCandidateForecast, readJson as readRepoJson } from "./score-may-2026-like-for-like.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const COMMIT = "5e85c84";
const CAND_DIR = "data/calibration/candidate-2026-10-24";
const CALIBRATION_PARTIES = ["Labour", "Conservative", "Reform UK", "Liberal Democrats", "Green Party", "SNP", "Plaid Cymru"];
const CALIBRATION_STRENGTH = 0.65;

const atCommit = (rel) => JSON.parse(execFileSync("git", ["show", `${COMMIT}:${rel}`], { cwd: ROOT, maxBuffer: 256 * 1024 * 1024 }).toString("utf8"));
const norm = (o) => { const s = Object.values(o).reduce((a, b) => a + b, 0); return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, s ? v / s : 0])); };

// Step 9b base target, as reformRealignmentUplift.js computed it at 5e85c84.
const LADDER = [[0, 0.36], [0.05, 0.36], [0.15, 0.30], [0.30, 0.24], [0.45, 0.18], [0.60, 0.14], [0.80, 0.12], [1, 0.10]];
function baseTarget(a) {
  if (a == null || Number.isNaN(a)) return 0.28;
  if (a <= LADDER[0][0]) return LADDER[0][1];
  if (a >= 1) return 0.10;
  for (let i = 0; i < LADDER.length - 1; i += 1) {
    const [x0, y0] = LADDER[i];
    const [x1, y1] = LADDER[i + 1];
    if (a >= x0 && a <= x1) return y0 + ((a - x0) / (x1 - x0)) * (y1 - y0);
  }
  return 0.10;
}

// Demographic lookup as run-bulk-predictions.mjs did it at 5e85c84, including its county overrides.
function baseTargets() {
  const identity = atCommit("data/identity/wards-may-2026.json");
  const demo = atCommit("data/features/ward-demographics-2021.json").wards || {};
  const slugMap = atCommit("data/identity/council-slug-to-lad24.json");
  const laProj = atCommit("data/features/la-ethnic-projections.json").projections || {};
  const byLadName = {};
  for (const d of Object.values(demo)) if (d.lad22cd && d.ward_name) byLadName[`${d.lad22cd}::${d.ward_name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`] = d;
  const overrides = { "hampshire": 0.022, "east-sussex": 0.018, "west-sussex": 0.030, "surrey": 0.090, "kent": 0.038, "essex": 0.038, "norfolk": 0.020, "suffolk": 0.024, "oxfordshire": 0.075, "cornwall": 0.010, "isle-of-wight": 0.011 };
  const out = {};
  for (const w of identity.wards) {
    const lad = slugMap.map[w.council_slug]?.lad24cd;
    let d = (w.gss_code && demo[w.gss_code]) || (lad && w.ward_name && byLadName[`${lad}::${w.ward_name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`]) || null;
    if (!d && overrides[w.council_slug] != null) d = { asian_pct: overrides[w.council_slug] };
    if (!d && lad && laProj[lad]) d = { asian_pct: laProj[lad].asian_pct_projected };
    if (d && d.asian_pct != null) out[w.ballot_paper_id] = baseTarget(d.asian_pct);
  }
  return out;
}

function sharesOf(entry) {
  const out = {};
  for (const [p, d] of Object.entries(entry.prediction || {})) out[p] = d.pct || 0;
  return out;
}

// The forecast before Step 9b, recovered from the published file.
function pre9bStage(predictions) {
  const stage = {};
  for (const [id, e] of Object.entries(predictions)) {
    if (!e.prediction) continue;
    const fin = sharesOf(e);
    const c = e.methodology.find((m) => m.step === "Final-C");
    const mult = {};
    if (c) for (const [, p, v] of c.description.matchAll(/([A-Z][A-Za-z ]+?) ×([0-9.]+)/g)) mult[p.trim()] = Number(v);
    const preC = norm(Object.fromEntries(Object.entries(fin).map(([p, v]) => [p, v / (mult[p] || 1)])));
    const b3 = e.methodology.find((m) => m.step === "Final-B3");
    let pre = preC;
    if (b3) {
      const before = Number(b3.description.match(/Reform ([0-9.]+)% →/)[1]) / 100;
      const after = preC["Reform UK"];
      pre = Object.fromEntries(Object.entries(preC).map(([p, v]) => [p, p === "Reform UK" ? before : (v * (1 - before)) / (1 - after)]));
    }
    stage[id] = { shares: pre, votes: Object.values(e.prediction).reduce((a, d) => a + (d.votes || 0), 0), anchored: e.county_2025_anchor != null };
  }
  return stage;
}

function step9b(stage, base, multipliers) {
  const out = {};
  for (const [id, s] of Object.entries(stage)) {
    let shares = s.shares;
    if (!s.anchored && base[id] != null) {
      const target = base[id] * multipliers[upliftTier(id.split(".")[1])];
      const before = shares["Reform UK"] || 0;
      if (target > before + 1e-6) {
        shares = Object.fromEntries(Object.entries(shares).map(([p, v]) => [p, p === "Reform UK" ? target : (v * (1 - target)) / (1 - before)]));
        if (!("Reform UK" in shares)) shares["Reform UK"] = target;
      }
    }
    out[id] = { ...s, shares };
  }
  return out;
}

function finalC(stage, targets) {
  const agg = {};
  let total = 0;
  for (const s of Object.values(stage)) for (const [p, v] of Object.entries(s.shares)) { agg[p] = (agg[p] || 0) + v * s.votes; total += v * s.votes; }
  const m = {};
  for (const p of CALIBRATION_PARTIES) {
    const a = (agg[p] || 0) / total;
    const t = targets[p] || 0;
    m[p] = a < 0.005 || t < 0.005 ? 1 : Math.pow(t / a, CALIBRATION_STRENGTH);
  }
  const out = {};
  for (const [id, s] of Object.entries(stage)) out[id] = norm(Object.fromEntries(Object.entries(s.shares).map(([p, v]) => [p, v * (m[p] || 1)])));
  return { shares: out, multipliers: m };
}

function c2Targets(stage, history, ratioDoc) {
  const areaCache = new Map();
  const areaShares = (slug) => { if (!areaCache.has(slug)) areaCache.set(slug, ge2024ForArea(history, slug)?.shares || null); return areaCache.get(slug); };
  const wards = Object.entries(stage).map(([id, s]) => ({ council_slug: id.split(".")[1], votes: s.votes, shares: s.shares }));
  return localElectionTargets(wards, { poll: ratioDoc.polls_to_cutoff.shares, ge24National: ratioDoc.snapshot.ge2024_national, ratio: ratioDoc.ratio, areaShares });
}

function asPredictions(shares) {
  return Object.fromEntries(Object.entries(shares).map(([id, sh]) => [id, { prediction: Object.fromEntries(Object.entries(sh).map(([p, v]) => [p, { pct: v }])) }]));
}

function summarise(label, result, extra = {}) {
  const pp = (x) => (x == null ? null : Number((100 * x).toFixed(1)));
  return {
    label,
    ...extra,
    vote_leader: result.vote_leader,
    seat_leader: result.seat_leader,
    named_first: Object.fromEntries(Object.entries(result.by_party).map(([p, b]) => [p, b.predicted_wins])),
    won: Object.fromEntries(Object.entries(result.by_party).map(([p, b]) => [p, b.actual_wins])),
    recall_pct: Object.fromEntries(Object.entries(result.by_party).map(([p, b]) => [p, pp(b.recall)])),
    precision_pct: Object.fromEntries(Object.entries(result.by_party).map(([p, b]) => [p, pp(b.precision)])),
    signed_bias_pp: Object.fromEntries(Object.entries(result.signed_bias).map(([p, b]) => [p, Number(b.signed_bias_pp.toFixed(2))])),
    largest_misses: result.largest_misses.slice(0, 6),
    miss_matrix: result.miss_matrix,
  };
}

function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true]; }));
  const published = atCommit("data/predictions/may-2026/local-and-mayor.json");
  const history = readRepoJson("data/history/dc-historic-results.json");
  const postaudit = readRepoJson(POSTAUDIT_PATH);
  const actuals = readRepoJson(ACTUALS_PATH).by_ballot;
  const c1Doc = readRepoJson(`${CAND_DIR}/reform-regional-multiplier.json`);
  const ratioDoc = readRepoJson(`${CAND_DIR}/local-national-ratio.json`);
  const C1 = Object.fromEntries(Object.entries(c1Doc.tiers).map(([t, v]) => [t, v.multiplier]));
  const pollingDay = published.snapshot.input_polling;
  const preLock = ratioDoc.polls_to_cutoff.shares;

  const base = baseTargets();
  const pre = pre9bStage(published.predictions);
  const lifted7May = step9b(pre, base, MULTIPLIERS_7_MAY);
  const liftedC1 = step9b(pre, base, C1);

  const score = (shares) => scoreCandidateForecast(asPredictions(shares), postaudit, actuals);
  const replay = finalC(lifted7May, pollingDay);
  let maxDiff = 0;
  let leaderFlips = 0;
  const L = { top: (sh) => Object.entries(sh).sort((a, b) => b[1] - a[1])[0]?.[0] };
  for (const [id, sh] of Object.entries(replay.shares)) {
    const pub = sharesOf(published.predictions[id]);
    for (const p of Object.keys(pub)) maxDiff = Math.max(maxDiff, Math.abs((sh[p] || 0) - pub[p]));
    if (L.top(sh) !== L.top(pub)) leaderFlips += 1;
  }
  const control = finalC(lifted7May, preLock);
  const c2t = c2Targets(lifted7May, history, ratioDoc);
  const c2 = finalC(lifted7May, c2t);
  const c1 = finalC(liftedC1, preLock);
  const candT = c2Targets(liftedC1, history, ratioDoc);
  const cand = finalC(liftedC1, candT);

  const round = (o) => Object.fromEntries(Object.entries(o).filter(([p]) => CALIBRATION_PARTIES.includes(p)).map(([p, v]) => [p, Number(v.toFixed(4))]));
  const out = {
    generated_by: "scripts/replay-may-2026-candidate.mjs",
    protocol: "docs/local-engine-holdout-2026-10-24.md",
    yardstick: "scripts/score-may-2026-like-for-like.mjs; bar 1,623 of 2,897 (56.0%), the polling-day version as published",
    replay_check: {
      max_abs_share_difference_against_published: Number(maxDiff.toFixed(5)),
      wards_with_a_different_top_party: leaderFlips,
      note: "Rounding in the figures the forecast file records; every arm uses the same replay.",
    },
    arms: {
      replay: summarise("7 May engine, replayed (polling-day polls)", score(replay.shares), { final_c_multipliers: round(replay.multipliers) }),
      control: summarise("7 May engine, polls to 25 April", score(control.shares), { final_c_multipliers: round(control.multipliers) }),
      c2: summarise("C2 only: Final-C aimed at the local-election target", score(c2.shares), { final_c_targets: round(c2t), final_c_multipliers: round(c2.multipliers) }),
      c1: summarise("C1 only: Step 9b multipliers refitted on pre-lock by-elections", score(c1.shares), { step9b_multipliers: C1, final_c_multipliers: round(c1.multipliers) }),
      candidate: summarise("Candidate: C1 and C2", score(cand.shares), { step9b_multipliers: C1, final_c_targets: round(candT), final_c_multipliers: round(cand.multipliers) }),
    },
    pollcheck_reference: "67.7% ward leader accuracy on 2,951 wards for Pollcheck's 6 May 2026 projection, its own published claim, not re-scored here",
  };
  writeFileSync(path.join(ROOT, "data/transparency/may-2026-candidate-2026-10-24.json"), JSON.stringify(out, null, 2) + "\n");
  if (args["write-predictions"]) writeFileSync(path.resolve(args["write-predictions"]), JSON.stringify({ snapshot: { generated_by: "scripts/replay-may-2026-candidate.mjs", arm: "candidate" }, predictions: asPredictions(cand.shares) }) + "\n");
  console.log(`replay check: max share difference ${maxDiff.toFixed(4)}, ${leaderFlips} wards with a different top party`);
  for (const [k, a] of Object.entries(out.arms)) console.log(`${k.padEnd(10)} ${a.vote_leader.correct} of ${a.vote_leader.wards} = ${(100 * a.vote_leader.accuracy).toFixed(1)}%  Reform named first ${a.named_first["Reform UK"]} (won ${a.won["Reform UK"]})`);
}

main();
