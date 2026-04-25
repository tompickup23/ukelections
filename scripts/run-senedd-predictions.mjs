#!/usr/bin/env node
// Phase 4: Senedd 2026 — 16 super-constituencies × 6 list seats (closed-list PR).
//
// Stage 1 simplification: super-constituency pairings from the Senedd Cymru (Members
// and Elections) Act 2024 Schedule 1 are not yet sourced into a structured file in
// our repo. We use a Wales-wide GE2024 baseline applied uniformly to each of the
// 16 super-constituencies, with Welsh-specific April 2026 polling adjustment, then
// run d'Hondt independently per super-constituency. This is an honest "first public
// estimate under the new system" — geographic differentiation is a Stage 1.5 task.
//
// Output: data/predictions/may-2026/senedd.json

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { allocateDhondtWithIntervals } from "../src/lib/dhondt.js";
import {
  WELSH_2024_GE_RESULT,
  WELSH_2026_APRIL_AVERAGE,
} from "../src/lib/nationalPolling.js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const MODEL_VERSION = "ukelections.senedd.v0.1.0-may2026-stage1";
const SEATS_PER_SUPER = 6;
const INTERVAL_SAMPLES = 2000;
const SIGMA = 0.05; // 5pp per-party noise — wider than locals to reflect new-system uncertainty

function readJson(p) { return JSON.parse(readFileSync(path.join(ROOT, p), "utf8")); }

function writeJson(rel, payload) {
  const full = path.join(ROOT, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, JSON.stringify(payload, null, 2));
  return full;
}

function applySwing(baseline, current) {
  // baseline: prior result share dict; current: current polling share dict.
  // Apply additive swing (nationalCurrent - baseline) per party, floor at 0,
  // re-normalise.
  const allParties = new Set([...Object.keys(baseline), ...Object.keys(current)]);
  const adjusted = {};
  for (const p of allParties) {
    const b = baseline[p] || 0;
    const c = current[p] || 0;
    // Apply swing as additive: predicted = max(0, baseline + (current - baseline))
    // Simplified: predicted = current (since this is a Wales-wide application)
    // For super-constituency-specific baselines (Stage 1.5), the formula would be
    //   predicted = baseline_constituency + (current_national - baseline_national)
    adjusted[p] = c;
  }
  // Re-normalise
  const sum = Object.values(adjusted).reduce((s, v) => s + v, 0);
  for (const k of Object.keys(adjusted)) adjusted[k] = adjusted[k] / (sum || 1);
  return adjusted;
}

function summariseSeatAllocations(perSuperResults) {
  const totals = {};
  for (const r of perSuperResults) {
    for (const [party, summary] of Object.entries(r.per_party)) {
      if (!totals[party]) totals[party] = { p10: 0, p50: 0, p90: 0, central: 0 };
      totals[party].p50 += summary.p50;
      totals[party].central += summary.central;
      // p10/p90 totals are sum-of-quantiles (approximation; not the same as joint p10/p90)
      totals[party].p10 += summary.p10;
      totals[party].p90 += summary.p90;
    }
  }
  return totals;
}

function main() {
  console.log("Loading inputs...");
  const identity = readJson("data/identity/wards-may-2026.json");
  const seneddBallots = identity.wards.filter((w) => w.tier === "senedd");
  console.log(`  ${seneddBallots.length} Senedd super-constituencies in scope`);

  const baseline = WELSH_2024_GE_RESULT.shares;
  const polling = WELSH_2026_APRIL_AVERAGE.shares;
  const adjusted = applySwing(baseline, polling);

  console.log(`  Welsh GE2024 baseline: ${JSON.stringify(baseline)}`);
  console.log(`  Welsh Apr2026 polling: ${JSON.stringify(polling)}`);
  console.log(`  Adjusted shares (used per super-constituency):`);
  for (const [p, s] of Object.entries(adjusted).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${p.padEnd(20)} ${(s * 100).toFixed(1)}%`);
  }

  const perSuper = [];
  for (let i = 0; i < seneddBallots.length; i += 1) {
    const b = seneddBallots[i];
    const allocation = allocateDhondtWithIntervals({
      shares: adjusted,
      totalVotes: 100000,
      seats: SEATS_PER_SUPER,
      intervalSamples: INTERVAL_SAMPLES,
      sigma: SIGMA,
      seed: i + 1,
    });
    perSuper.push({
      ballot_paper_id: b.ballot_paper_id,
      super_constituency: b.ward_name,
      seats: SEATS_PER_SUPER,
      central: allocation.central,
      per_party: allocation.per_party,
      candidates_locked: b.candidates_locked,
      candidate_count: b.candidate_count,
      sopn_url: b.sopn_url,
    });
  }

  const totals = summariseSeatAllocations(perSuper);

  const sha = createHash("sha256").update(JSON.stringify(perSuper)).digest("hex");
  const payload = {
    snapshot: {
      generated_at: new Date().toISOString(),
      model_version: MODEL_VERSION,
      sha256: sha,
      method_summary: "Stage 1 estimate under Senedd Cymru (Members and Elections) Act 2024 closed-list PR. 16 super-constituencies × 6 seats. Geographic differentiation between super-constituencies deferred — current model applies the Welsh-wide April 2026 polling average uniformly to each super-constituency and runs d'Hondt independently per area. Wider intervals (sigma=5pp) reflect zero prior elections under the new geography. Per-super-constituency baselines from 2024 GE Welsh subsets to be added in Stage 1.5.",
      input_baseline_2024_welsh_ge: baseline,
      input_polling_2026_welsh: polling,
      input_polling_meta: WELSH_2026_APRIL_AVERAGE._meta,
      sigma_used: SIGMA,
      bootstrap_samples: INTERVAL_SAMPLES,
    },
    welsh_seat_total_projection: totals,
    per_super_constituency: perSuper,
  };
  writeJson("data/predictions/may-2026/senedd.json", payload);

  console.log(`\nWelsh seat total projection (96 seats):`);
  for (const [p, t] of Object.entries(totals).sort((a, b) => b[1].p50 - a[1].p50)) {
    console.log(`  ${p.padEnd(20)} central=${t.central}  p10=${t.p10}  p50=${t.p50}  p90=${t.p90}`);
  }
}

main();
