#!/usr/bin/env node
// Phase 5: Holyrood 2026 — 73 constituency seats (FPTP) + 56 regional list seats
// (d'Hondt over 8 regions × 7 list seats with constituency-win compensation).
//
// Stage 1 simplification: 2026 boundary changes (new "Central Scotland and Lothians
// West" + "Edinburgh and Lothians East") mean a constituency→region mapping built
// from the 2011-2021 boundaries does not exactly fit. We apply Scotland-wide
// polling adjustment uniformly to all 73 constituencies, predict winners FPTP-style
// from 2021 baselines, then per region run d'Hondt over Scottish-wide regional list
// shares with priorSeats apportioned as (total_constituency_seats_won / 8) per region.
// This is an honest "first public estimate under new regions" — region-specific
// baselines are a Stage 1.5 task.
//
// Output: data/predictions/may-2026/holyrood.json

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { allocateDhondtWithIntervals } from "../src/lib/dhondt.js";
import {
  SCOTTISH_2021_HOLYROOD_RESULT,
  SCOTTISH_2026_APRIL_AVERAGE,
} from "../src/lib/nationalPolling.js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const MODEL_VERSION = "ukelections.holyrood.v0.1.0-may2026-stage1";
const REGION_LIST_SEATS = 7;
const N_REGIONS = 8;
const INTERVAL_SAMPLES = 2000;
const SIGMA = 0.04;

function readJson(p) { return JSON.parse(readFileSync(path.join(ROOT, p), "utf8")); }

function writeJson(rel, payload) {
  const full = path.join(ROOT, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, JSON.stringify(payload, null, 2));
  return full;
}

function dcPartyToCanonical(dcName) {
  if (!dcName) return "Unknown";
  const p = String(dcName).trim();
  if (/^Labour Party$/i.test(p)) return "Labour";
  if (/^Labour and Co-operative Party$/i.test(p)) return "Labour";
  if (/^Conservative and Unionist Party$/i.test(p)) return "Conservative";
  if (/^Scottish National Party \(SNP\)$/i.test(p)) return "SNP";
  if (/^Liberal Democrats?$/i.test(p)) return "Liberal Democrats";
  if (/^Reform UK$/i.test(p)) return "Reform UK";
  if (/^Scottish Green Party$/i.test(p)) return "Green Party";
  if (/^Green Party$/i.test(p)) return "Green Party";
  if (/independent/i.test(p)) return "Independent";
  return p;
}

function constituency2021Shares(historyBundle, constituencyBallotId2026) {
  // Find the 2021 equivalent for this constituency.
  // 2026 ballot id: sp.c.aberdeen-central.2026-05-07
  // 2021 ballot id: sp.c.aberdeen-central.2021-05-06 (likely)
  const slug = constituencyBallotId2026.split(".").slice(0, -1).join(".");
  const id2021 = `${slug}.2021-05-06`;
  const r = historyBundle.by_ballot[id2021];
  if (!r) return null;
  const total = (r.candidates || []).reduce((s, c) => s + (c.votes || 0), 0);
  if (total <= 0) return null;
  const shares = {};
  for (const c of r.candidates) {
    const p = dcPartyToCanonical(c.party_name);
    shares[p] = (shares[p] || 0) + c.votes / total;
  }
  return { shares, source: r.source, source_ballot_id: id2021 };
}

function applyScottishSwing(constituencyShares, scotlandBaseline, scotlandPolling) {
  // Per-party additive swing (national_now - national_baseline) applied to constituency shares.
  // Floor at 0, re-normalise.
  const allParties = new Set([
    ...Object.keys(constituencyShares),
    ...Object.keys(scotlandBaseline),
    ...Object.keys(scotlandPolling),
  ]);
  const adjusted = {};
  for (const p of allParties) {
    const base = constituencyShares[p] || 0;
    const swing = (scotlandPolling[p] || 0) - (scotlandBaseline[p] || 0);
    adjusted[p] = Math.max(0, base + swing);
  }
  const sum = Object.values(adjusted).reduce((s, v) => s + v, 0);
  for (const k of Object.keys(adjusted)) adjusted[k] = adjusted[k] / (sum || 1);
  return adjusted;
}

function rankWinner(shares) {
  return Object.entries(shares).sort((a, b) => b[1] - a[1])[0];
}

function main() {
  console.log("Loading inputs...");
  const identity = readJson("data/identity/wards-may-2026.json");
  const history = readJson("data/history/dc-historic-results.json");

  const constituencies = identity.wards.filter((w) => w.tier === "holyrood" && w.election_group_id === "sp.c.2026-05-07");
  const regions = identity.wards.filter((w) => w.tier === "holyrood" && w.election_group_id === "sp.r.2026-05-07");
  console.log(`  ${constituencies.length} constituencies, ${regions.length} regions`);

  const baseline = SCOTTISH_2021_HOLYROOD_RESULT.shares;
  const baselineList = SCOTTISH_2021_HOLYROOD_RESULT.shares_regional_list;
  const polling = SCOTTISH_2026_APRIL_AVERAGE.shares;

  console.log("\n=== Constituency predictions (FPTP) ===");
  const constituencyPredictions = [];
  const constituencyWinnerCounts = {};
  for (const c of constituencies) {
    const baselineRow = constituency2021Shares(history, c.ballot_paper_id);
    let shares, source;
    if (!baselineRow) {
      // Fall back to Scotland-wide constituency baseline + polling
      shares = applyScottishSwing(baseline, baseline, polling);
      source = "Fallback: Scotland-wide 2021 constituency baseline (no per-constituency 2021 result in DC bundle)";
    } else {
      shares = applyScottishSwing(baselineRow.shares, baseline, polling);
      source = `Per-constituency 2021 baseline + Scotland-wide swing. Source: ${baselineRow.source}`;
    }
    const [winner, winnerShare] = rankWinner(shares);
    constituencyWinnerCounts[winner] = (constituencyWinnerCounts[winner] || 0) + 1;
    constituencyPredictions.push({
      ballot_paper_id: c.ballot_paper_id,
      constituency: c.ward_name,
      predicted_winner: winner,
      predicted_winner_share: +winnerShare.toFixed(4),
      shares: Object.fromEntries(Object.entries(shares).map(([k, v]) => [k, +v.toFixed(4)])),
      baseline_source: source,
      sopn_url: c.sopn_url,
    });
  }

  console.log("Constituency winner totals:");
  for (const [p, n] of Object.entries(constituencyWinnerCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${p.padEnd(20)} ${n}`);
  }

  console.log("\n=== Regional list (d'Hondt, with constituency-win compensation) ===");
  const regionPredictions = [];
  const totalConstituencySeats = Object.values(constituencyWinnerCounts).reduce((s, v) => s + v, 0);

  for (let i = 0; i < regions.length; i += 1) {
    const r = regions[i];
    // Apply Scottish-wide swing to 2021 list shares
    const adjustedListShares = applyScottishSwing(baselineList, baselineList, polling);
    // Apportion priorSeats: each region gets (total_party_constituency_wins / 8) of the constituency wins
    const priorSeats = Object.fromEntries(
      Object.entries(constituencyWinnerCounts).map(([p, n]) => [p, Math.round(n / N_REGIONS)])
    );
    const allocation = allocateDhondtWithIntervals({
      shares: adjustedListShares,
      totalVotes: 200000,
      seats: REGION_LIST_SEATS,
      priorSeats,
      intervalSamples: INTERVAL_SAMPLES,
      sigma: SIGMA,
      seed: 100 + i,
    });
    regionPredictions.push({
      ballot_paper_id: r.ballot_paper_id,
      region: r.ward_name,
      list_seats: REGION_LIST_SEATS,
      prior_constituency_seats_apportioned: priorSeats,
      central: allocation.central,
      per_party: allocation.per_party,
      sopn_url: r.sopn_url,
    });
  }

  // National totals = constituency wins + regional list seat sums
  const totals = {};
  for (const [p, n] of Object.entries(constituencyWinnerCounts)) {
    totals[p] = totals[p] || { constituency: 0, list_central: 0, list_p10: 0, list_p50: 0, list_p90: 0 };
    totals[p].constituency = n;
  }
  for (const r of regionPredictions) {
    for (const [party, summary] of Object.entries(r.per_party)) {
      if (!totals[party]) totals[party] = { constituency: 0, list_central: 0, list_p10: 0, list_p50: 0, list_p90: 0 };
      totals[party].list_central += summary.central;
      totals[party].list_p10 += summary.p10;
      totals[party].list_p50 += summary.p50;
      totals[party].list_p90 += summary.p90;
    }
  }
  for (const p of Object.keys(totals)) {
    totals[p].total_central = totals[p].constituency + totals[p].list_central;
    totals[p].total_p50 = totals[p].constituency + totals[p].list_p50;
  }

  const sha = createHash("sha256").update(JSON.stringify({ constituencyPredictions, regionPredictions })).digest("hex");
  const payload = {
    snapshot: {
      generated_at: new Date().toISOString(),
      model_version: MODEL_VERSION,
      sha256: sha,
      method_summary: "Stage 1 estimate. Per-constituency 2021 Holyrood result + Scotland-wide April 2026 polling swing → FPTP winner prediction. Per-region list: 2021 regional-list shares + Scotland-wide polling swing + d'Hondt over 7 list seats with priorSeats apportioned as Scotland-wide constituency wins / 8 regions. Constituency-region mapping reflects 2026 boundary changes — region-specific baselines deferred to Stage 1.5.",
      input_baseline_constituency: baseline,
      input_baseline_list: baselineList,
      input_polling_2026_scotland: polling,
      input_polling_meta: SCOTTISH_2026_APRIL_AVERAGE._meta,
      sigma_used: SIGMA,
      bootstrap_samples: INTERVAL_SAMPLES,
    },
    scottish_seat_total_projection: totals,
    constituency_predictions: constituencyPredictions,
    region_predictions: regionPredictions,
  };
  writeJson("data/predictions/may-2026/holyrood.json", payload);

  console.log("\nScottish total seat projection (129 seats: 73 constituency + 56 list):");
  for (const [p, t] of Object.entries(totals).sort((a, b) => b[1].total_central - a[1].total_central)) {
    console.log(`  ${p.padEnd(20)} const=${t.constituency}  list_central=${t.list_central}  total_central=${t.total_central}  total_p50=${t.total_p50}`);
  }
}

main();
