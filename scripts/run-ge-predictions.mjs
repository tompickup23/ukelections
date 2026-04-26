#!/usr/bin/env node
/**
 * run-ge-predictions.mjs — bulk-predict the next UK general election for all
 * 650 PCONs using the current Westminster polling snapshot.
 *
 * Default mode: forecast "next-GE-as-if-held-this-week" — uses
 * UK_WESTMINSTER_2026_APRIL_AVERAGE as the current national share and
 * UK_WESTMINSTER_2024_GE_RESULT as the baseline. This is the standard
 * MRP polling-snapshot use case.
 *
 * Output:
 *   data/predictions/ge-next/constituencies.json
 *   data/predictions/ge-next/summary.json
 *   data/predictions/ge-next/assumptions.json
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { predictConstituencyGE } from "../src/lib/electionModel.js";
import { buildMpRosterFromGe2024 } from "../src/lib/incumbencyTracker.js";
import {
  UK_WESTMINSTER_2024_GE_RESULT,
  UK_WESTMINSTER_2026_APRIL_AVERAGE,
} from "../src/lib/nationalPolling.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");
const FORECAST_KEY = "ge-next";

function readJson(p) { return JSON.parse(readFileSync(join(REPO, p), "utf8")); }

function canonParty(p) {
  if (!p) return "Unknown";
  if (/^Labour Party$/i.test(p)) return "Labour";
  if (/^Labour and Co-operative Party$/i.test(p)) return "Labour";
  if (/^Conservative and Unionist Party$/i.test(p)) return "Conservative";
  if (/^Liberal Democrats?$/i.test(p)) return "Liberal Democrats";
  if (/^Reform UK$/i.test(p)) return "Reform UK";
  if (/^Green Party$/i.test(p)) return "Green Party";
  if (/^Scottish Green Party$/i.test(p)) return "Green Party";
  if (/^Plaid Cymru/i.test(p)) return "Plaid Cymru";
  if (/^Scottish National Party/i.test(p)) return "SNP";
  if (/independent/i.test(p)) return "Independent";
  if (/Sinn F/i.test(p)) return "Sinn Féin";
  if (/^DUP|^Democratic Unionist/i.test(p)) return "DUP";
  if (/^Alliance/i.test(p)) return "Alliance";
  if (/^SDLP|^Social Democratic & Labour/i.test(p)) return "SDLP";
  if (/^UUP|^Ulster Unionist/i.test(p)) return "UUP";
  return p;
}

function pcononicalShares(candidates) {
  const total = candidates.reduce((s, c) => s + (c.votes || 0), 0);
  if (total <= 0) return {};
  const out = {};
  for (const c of candidates) {
    const p = canonParty(c.party_name || c.party);
    out[p] = (out[p] || 0) + (c.votes || 0) / total;
  }
  return out;
}

function buildBesPriorMap(pcons, ladPriors) {
  // Weighted blend across all LADs the PCON intersects. When the LSOA
  // crosswalk gives us multiple LADs per PCON, average their shares (equal
  // weight per LAD; a future upgrade would weight by LAD population share
  // within the PCON, which requires LSOA→PCON+LAD joint counts). Falls back
  // to regional marginal when no LAD prior is available.
  const out = {};
  for (const pcon of pcons) {
    if (!ladPriors?.priors) continue;
    const lads = pcon.lad24cds || [];
    const matchedPriors = lads.map((l) => ladPriors.priors[l]).filter(Boolean);
    if (matchedPriors.length > 0) {
      const blended = {};
      let nResp = 0;
      for (const prior of matchedPriors) {
        for (const [party, share] of Object.entries(prior.shares || {})) {
          blended[party] = (blended[party] || 0) + share;
        }
        nResp += prior.n_respondents_in_region || 0;
      }
      for (const k of Object.keys(blended)) blended[k] /= matchedPriors.length;
      out[pcon.slug] = {
        region: matchedPriors[0].region,
        shares: blended,
        n_respondents_in_region: Math.round(nResp / matchedPriors.length),
        lads_blended: matchedPriors.length,
      };
      continue;
    }
    if (pcon.region && ladPriors.regions?.[pcon.region]) {
      out[pcon.slug] = {
        region: pcon.region,
        shares: ladPriors.regions[pcon.region],
        n_respondents_in_region: null,
        lads_blended: 0,
      };
    }
  }
  return out;
}

function main() {
  console.log("Loading inputs ...");
  const pcons = readJson("data/identity/pcons-ge-next.json").pcons;
  const dcRaw = readJson("data/history/dc-historic-results.json");
  let ladPriors = null;
  try { ladPriors = readJson("data/features/ward-mrp-priors.json"); } catch {}
  let pconDemographics = null;
  try { pconDemographics = readJson("data/features/pcon-demographics.json"); } catch {}
  let standingDown = null;
  try { standingDown = readJson("data/identity/mps-standing-down.json"); } catch {}
  console.log(`  ${pcons.length} PCONs loaded`);
  if (ladPriors) console.log(`  ${Object.keys(ladPriors.priors || {}).length} LAD-level BES priors available`);
  if (pconDemographics) console.log(`  ${Object.keys(pconDemographics.by_pcon || {}).length} PCONs with Census 2021 demographics`);
  if (standingDown) console.log(`  ${Object.keys(standingDown.by_slug || {}).length} MPs flagged with non-default standing status`);

  // Build sitting-MP roster from GE2024 winners + post-2024 by-elections,
  // overlaying any standing-down / defection flags from the manual tracker.
  const byElectionResults = dcRaw.results.filter((r) => r.tier === "parl" && r.is_by_election && r.election_date >= "2024-07-04");
  const standingDownMap = standingDown?.by_slug || {};
  const mpRoster = buildMpRosterFromGe2024(pcons, byElectionResults, standingDownMap);
  console.log(`  ${Object.keys(mpRoster).length} MPs in roster (incl. ${byElectionResults.length} post-GE2024 by-election overrides)`);

  // Build by-election overlay shares (post-GE2024 only)
  const byElectionShareMap = {};
  for (const r of byElectionResults) {
    byElectionShareMap[r.ward_slug] = pcononicalShares(r.candidates || []);
  }
  console.log(`  ${Object.keys(byElectionShareMap).length} post-GE2024 by-elections will overlay`);

  // Build BES PCON-level prior map (currently LAD-derived)
  const besPriorMap = buildBesPriorMap(pcons, ladPriors);
  console.log(`  ${Object.keys(besPriorMap).length} PCONs have a BES prior available`);

  // Polling
  const ge2024National = {};
  for (const [k, v] of Object.entries(UK_WESTMINSTER_2024_GE_RESULT.shares || {})) {
    ge2024National[canonParty(k)] = (ge2024National[canonParty(k)] || 0) + v;
  }
  const currentNational = {};
  for (const [k, v] of Object.entries(UK_WESTMINSTER_2026_APRIL_AVERAGE.shares || {})) {
    currentNational[canonParty(k)] = (currentNational[canonParty(k)] || 0) + v;
  }
  const polling = {
    aggregate: currentNational,
    ge2024_baseline: ge2024National,
  };
  console.log("  current national:", Object.entries(currentNational).map(([k, v]) => `${k}:${(v * 100).toFixed(1)}%`).join(" "));

  // Predict each PCON
  const predictions = {};
  const tally = { ok: 0, no_baseline: 0, by_country: {}, by_winner: {} };
  for (const pcon of pcons) {
    const baselineShares = {};
    for (const c of pcon.ge2024?.candidates || []) {
      const p = canonParty(c.party_name);
      baselineShares[p] = (baselineShares[p] || 0) + (c.pct || 0);
    }
    if (Object.keys(baselineShares).length === 0) {
      tally.no_baseline += 1;
      predictions[pcon.slug] = { prediction: null, reason: "no_baseline" };
      continue;
    }
    const constituency = {
      name: pcon.name,
      ge2024: {
        results: Object.entries(baselineShares).map(([party, pct]) => ({ party, pct })),
      },
      mp: mpRoster[pcon.slug] || null,
    };
    const opts = {
      useSTM: true,
      geDampening: 1.0,
      besPrior: besPriorMap[pcon.slug] || null,
      besPriorWeight: 0.15,
      mp: mpRoster[pcon.slug] || null,
      applyTacticalVoting: true,
      byElectionShares: byElectionShareMap[pcon.slug] || null,
      byElectionWeight: 0.30,
      demographics: pcon.pcon24cd ? pconDemographics?.by_pcon?.[pcon.pcon24cd] || null : null,
      allowHighIndependent: standingDownMap[pcon.slug]?.allow_high_independent === true,
    };
    const result = predictConstituencyGE(constituency, polling, {}, opts);
    if (!result?.prediction) {
      tally.no_baseline += 1;
      continue;
    }
    predictions[pcon.slug] = {
      slug: pcon.slug,
      name: pcon.name,
      country: pcon.country,
      region: pcon.region,
      pcon24cd: pcon.pcon24cd,
      ge2024: pcon.ge2024,
      mp: mpRoster[pcon.slug] || null,
      prediction: result.prediction,
      winner: result.winner,
      runner_up: result.runnerUp,
      majority_pct: result.majorityPct,
      swing: result.swing,
      mp_change: result.mpChange,
      confidence: result.confidence,
      methodology: result.methodology,
    };
    tally.ok += 1;
    tally.by_country[pcon.country] = (tally.by_country[pcon.country] || 0) + 1;
    tally.by_winner[result.winner] = (tally.by_winner[result.winner] || 0) + 1;
  }
  console.log("\nTally:", JSON.stringify(tally, null, 2));

  // Compute national vote share + seat tallies
  const nationalVoteShare = {};
  let totalVotes = 0;
  for (const p of Object.values(predictions)) {
    if (!p.prediction) continue;
    const baseVotes = p.ge2024?.turnout_votes || 50000;
    for (const [party, payload] of Object.entries(p.prediction)) {
      const pct = payload.pct || 0;
      nationalVoteShare[party] = (nationalVoteShare[party] || 0) + pct * baseVotes;
      totalVotes += pct * baseVotes;
    }
  }
  for (const p of Object.keys(nationalVoteShare)) nationalVoteShare[p] /= totalVotes;

  const summary = {
    snapshot: {
      snapshot_id: `${FORECAST_KEY}-${new Date().toISOString().slice(0, 10)}`,
      generated_at: new Date().toISOString(),
      polling_source: "UK_WESTMINSTER_2026_APRIL_AVERAGE",
      baseline_source: "UK_WESTMINSTER_2024_GE_RESULT",
      methodology_version: "1.0.0-GE",
      sources: [
        { path: "data/identity/pcons-ge-next.json", role: "650-PCON identity table" },
        { path: "data/history/dc-historic-results.json", role: "Historic + by-election data" },
        { path: "data/features/ward-mrp-priors.json", role: "BES Wave 1-30 LAD priors" },
        { path: "src/lib/nationalPolling.js", role: "Current Westminster polling" },
      ],
    },
    seat_tallies_by_party: tally.by_winner,
    seat_tallies_by_country: tally.by_country,
    national_vote_share: nationalVoteShare,
    pcons_evaluated: tally.ok,
    pcons_skipped: tally.no_baseline,
  };

  const assumptions = {
    snapshot: { snapshot_id: `${FORECAST_KEY}-assumptions-${new Date().toISOString().slice(0, 10)}`, generated_at: new Date().toISOString() },
    parameters: {
      use_strong_transition_model: true,
      ge_dampening: 1.0,
      bes_prior_weight: 0.15,
      tactical_voting_competitiveness_gap: 0.10,
      tactical_voting_floor: 0.05,
      tactical_voting_transfer_rate: 0.30,
      by_election_overlay_weight: 0.30,
      incumbency_personal_vote_pp: { ">=20yr": 4.0, ">=10yr": 3.0, ">=5yr": 2.0, "<5yr": 1.0 },
      retirement_drag_pp: { ">=20yr": 3.0, ">=10yr": 2.5, "<10yr": 2.0 },
      defection_open_seat_drag_pp: 1.5,
    },
  };

  const outDir = `data/predictions/${FORECAST_KEY}`;
  mkdirSync(join(REPO, outDir), { recursive: true });
  writeFileSync(join(REPO, outDir, "constituencies.json"), JSON.stringify({ snapshot: summary.snapshot, predictions }, null, 2));
  writeFileSync(join(REPO, outDir, "summary.json"), JSON.stringify(summary, null, 2));
  writeFileSync(join(REPO, outDir, "assumptions.json"), JSON.stringify(assumptions, null, 2));
  console.log(`\nWrote ${outDir}/{constituencies,summary,assumptions}.json`);
  console.log(`Seat winners: ${Object.entries(tally.by_winner).sort((a, b) => b[1] - a[1]).map(([p, n]) => `${p}: ${n}`).join(", ")}`);
}

main();
