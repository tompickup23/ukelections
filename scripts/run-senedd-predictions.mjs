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

function applyNationalSwing(baselineConstituency, baselineNational, currentNational) {
  // Per-party additive swing applied to a constituency baseline:
  //   predicted = max(0, baseline_constituency + (national_current - national_baseline))
  // Re-normalise to 1.0.
  const allParties = new Set([
    ...Object.keys(baselineConstituency),
    ...Object.keys(baselineNational),
    ...Object.keys(currentNational),
  ]);
  const adjusted = {};
  for (const p of allParties) {
    const swing = (currentNational[p] || 0) - (baselineNational[p] || 0);
    adjusted[p] = Math.max(0, (baselineConstituency[p] || 0) + swing);
  }
  const sum = Object.values(adjusted).reduce((s, v) => s + v, 0);
  for (const k of Object.keys(adjusted)) adjusted[k] = adjusted[k] / (sum || 1);
  return adjusted;
}

function dcPartyToCanonical(dcName) {
  if (!dcName) return "Unknown";
  const p = String(dcName).trim();
  if (/^Labour Party$/i.test(p)) return "Labour";
  if (/^Labour and Co-operative Party$/i.test(p)) return "Labour";
  if (/^Conservative and Unionist Party$/i.test(p)) return "Conservative";
  if (/^Plaid Cymru/i.test(p)) return "Plaid Cymru";
  if (/^Liberal Democrats?$/i.test(p)) return "Liberal Democrats";
  if (/^Reform UK$/i.test(p)) return "Reform UK";
  if (/^Green Party$/i.test(p)) return "Green Party";
  if (/independent/i.test(p)) return "Independent";
  return p;
}

function pairBaselineFromGE2024(westminsterPair, history) {
  // Aggregate vote shares across the two paired Westminster constituencies' GE2024 results.
  // Weight by total votes cast in each.
  const ge24 = (id) => history.results.find((r) => r.tier === "parl" && r.election_date === "2024-07-04" && r.ballot_paper_id === `parl.${id}.2024-07-04`);
  const r1 = ge24(westminsterPair[0]);
  const r2 = ge24(westminsterPair[1]);
  const collect = (r) => {
    if (!r) return { shares: {}, total: 0 };
    const total = (r.candidates || []).reduce((s, c) => s + (c.votes || 0), 0);
    const shares = {};
    for (const c of r.candidates || []) {
      const p = dcPartyToCanonical(c.party_name);
      shares[p] = (shares[p] || 0) + (c.votes / total);
    }
    return { shares, total };
  };
  const a = collect(r1);
  const b = collect(r2);
  const totalVotes = a.total + b.total;
  if (totalVotes === 0) return null;
  const merged = {};
  const allParties = new Set([...Object.keys(a.shares), ...Object.keys(b.shares)]);
  for (const p of allParties) {
    merged[p] = ((a.shares[p] || 0) * a.total + (b.shares[p] || 0) * b.total) / totalVotes;
  }
  return { shares: merged, totalVotes, sources: [r1?.source, r2?.source].filter(Boolean) };
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
  const history = readJson("data/history/dc-historic-results.json");
  const pairs = readJson("data/identity/senedd-2026-super-constituency-pairs.json");
  const seneddBallots = identity.wards.filter((w) => w.tier === "senedd");
  console.log(`  ${seneddBallots.length} Senedd super-constituencies in scope`);

  const baselineNational = WELSH_2024_GE_RESULT.shares;
  const polling = WELSH_2026_APRIL_AVERAGE.shares;

  console.log(`  Welsh GE2024 baseline: ${JSON.stringify(baselineNational)}`);
  console.log(`  Welsh Apr2026 polling: ${JSON.stringify(polling)}`);

  const perSuper = [];
  for (let i = 0; i < seneddBallots.length; i += 1) {
    const b = seneddBallots[i];
    const slug = b.ward_slug || b.ballot_paper_id.split(".")[1];
    const pair = pairs.pairs[slug];
    let supBaseline = null;
    let supBaselineSource = "Welsh national fallback (no super-constituency pairing in repo)";
    if (pair) {
      const ge24Pair = pairBaselineFromGE2024(pair.westminster_pair, history);
      if (ge24Pair) {
        supBaseline = ge24Pair.shares;
        supBaselineSource = `2024 GE Welsh constituency pair: ${pair.westminster_pair.join(" + ")} (${pair.confidence})`;
      }
    }
    if (!supBaseline) supBaseline = baselineNational;

    // Apply Welsh polling swing since 2024 GE per-party
    const adjusted = applyNationalSwing(supBaseline, baselineNational, polling);

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
      adjusted_shares: adjusted,
      pair_source: supBaselineSource,
      pair: pair?.westminster_pair || null,
      pair_confidence: pair?.confidence || null,
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
      method_summary: "Senedd 2026 (Senedd Cymru Act 2024 Schedule 1 — closed-list PR, 16 super-constituencies × 6 seats). Per-super-constituency baseline aggregated from the constituent 2024 GE Welsh constituency pair (using hardcoded pairings with confidence flags), then Welsh-wide swing applied per party from the Apr 2026 Welsh polling average. d'Hondt allocation per area with σ=5pp bootstrap intervals.",
      input_baseline_2024_welsh_ge: baselineNational,
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
