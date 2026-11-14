#!/usr/bin/env node
/**
 * run-ge-predictions.mjs — bulk-predict the next UK general election for all
 * 650 PCONs using the current Westminster polling snapshot.
 *
 * Default mode: forecast "next-GE-as-if-held-this-week" — uses the current
 * Westminster polling snapshot (exported as UK_WESTMINSTER_2026_APRIL_AVERAGE,
 * which nationalPolling.js overrides from data/polling/override.json) as the
 * current national share and UK_WESTMINSTER_2024_GE_RESULT as the baseline.
 *
 * assumptions.json is built from GE_MODEL_OPTIONS, the object every seat's
 * predictConstituencyGE call spreads, so the published parameters cannot drift
 * from the run (tests/ge-assumptions.test.ts). Each record also carries a win
 * probability and p10/p90 shares from data/calibration/ge-win-probability.json,
 * and summary.json a seat range per party (src/lib/geWinProbability.js).
 *
 * Output:
 *   data/predictions/ge-next/constituencies.json
 *   data/predictions/ge-next/summary.json
 *   data/predictions/ge-next/assumptions.json
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { predictConstituencyGE } from "../src/lib/electionModel.js";
import { buildMpRosterFromGe2024 } from "../src/lib/incumbencyTracker.js";
import {
  UK_WESTMINSTER_2024_GE_RESULT,
  UK_WESTMINSTER_2026_APRIL_AVERAGE,
} from "../src/lib/nationalPolling.js";
import {
  loadGeWinProbability,
  geWinProbabilityApplies,
  leaderWinProbability,
  shareIntervals,
  simulateSeatRanges,
} from "../src/lib/geWinProbability.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");
const FORECAST_KEY = "ge-next";

function readJson(p) { return JSON.parse(readFileSync(join(REPO, p), "utf8")); }

/**
 * The options every seat shares. Per-seat inputs (BES prior, MP, by-election
 * shares, demographics, LAD) are added in main(). tacticalOpts states the
 * values tacticalVoting.js would otherwise take as defaults, so the published
 * assumptions are read from what the model receives, not from a comment.
 */
export const GE_MODEL_OPTIONS = Object.freeze({
  useSTM: true,
  geDampening: 1.0,
  besPriorWeight: 0.05,
  applyTacticalVoting: true,
  tacticalOpts: Object.freeze({ competitivenessGap: 0.10, tacticalFloor: 0.05, transferRate: 0.15 }),
  byElectionWeight: 0.30,
});

/**
 * Incumbency constants are not options: they live in incumbencyTracker.js.
 * They are restated here for the published file and the test checks them
 * against applyIncumbencyAdjustment's behaviour.
 */
export const INCUMBENCY_CONSTANTS = Object.freeze({
  incumbency_personal_vote_pp: { ">=20yr": 4.0, ">=10yr": 3.0, ">=5yr": 2.0, "<5yr": 1.0 },
  retirement_drag_pp: { ">=20yr": 3.0, ">=10yr": 2.5, "<10yr": 2.0 },
  defection_open_seat_drag_pp: 1.5,
});

export function buildGeAssumptions(options = GE_MODEL_OPTIONS, generatedAt = new Date().toISOString()) {
  return {
    snapshot: {
      snapshot_id: `${FORECAST_KEY}-assumptions-${generatedAt.slice(0, 10)}`,
      generated_at: generatedAt,
      built_from: "GE_MODEL_OPTIONS in scripts/run-ge-predictions.mjs, the object passed to predictConstituencyGE for every seat",
    },
    parameters: {
      use_strong_transition_model: options.useSTM === true,
      ge_dampening: options.geDampening,
      bes_prior_weight: options.besPriorWeight,
      tactical_voting_applied: options.applyTacticalVoting !== false,
      tactical_voting_competitiveness_gap: options.tacticalOpts.competitivenessGap,
      tactical_voting_floor: options.tacticalOpts.tacticalFloor,
      tactical_voting_transfer_rate: options.tacticalOpts.transferRate,
      by_election_overlay_weight: options.byElectionWeight,
      ...INCUMBENCY_CONSTANTS,
    },
  };
}

/** "Wikipedia table, unweighted trailing 14-day mean, 9 polls, fieldwork 2026-10-19 to 2026-10-26" */
export function describePollingSource(snapshot) {
  const meta = snapshot?._meta || {};
  if (meta.review_status === "draft_placeholder") {
    return `${meta.label || "Static placeholder"} (not refreshed from polling)`;
  }
  const parts = [meta.source, meta.fieldwork ? `fieldwork ${meta.fieldwork}` : null].filter(Boolean);
  return parts.length ? parts.join(", ") : "unknown";
}

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

function buildBesPriorMap(pcons, pconPriors, ladPriors) {
  // Three-tier prior selection per PCON, in preference order:
  //   1. PCON24-level prior (BES respondents mapped via PCON10→PCON24 lookup)
  //   2. Multi-LAD weighted blend (BES priors keyed by LAD24CD, averaged
  //      across all LADs the PCON intersects)
  //   3. Regional marginal (England/Wales/Scotland 11-region rolled-up vote intent)
  const out = {};
  for (const pcon of pcons) {
    // Tier 1: direct PCON24 prior
    if (pcon.pcon24cd && pconPriors?.priors?.[pcon.pcon24cd]) {
      const p = pconPriors.priors[pcon.pcon24cd];
      out[pcon.slug] = {
        region: p.region,
        shares: p.shares,
        n_respondents_in_region: p.n_respondents,
        source: "pcon",
      };
      continue;
    }
    // Tier 2: multi-LAD blend
    if (ladPriors?.priors) {
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
          source: "lad_blend",
        };
        continue;
      }
    }
    // Tier 3: regional marginal
    const regional = pconPriors?.regions?.[pcon.region] || ladPriors?.regions?.[pcon.region];
    if (pcon.region && regional) {
      out[pcon.slug] = {
        region: pcon.region,
        shares: regional,
        n_respondents_in_region: null,
        source: "region",
      };
    }
  }
  return out;
}

/** Latest fieldwork date of a polling snapshot ("2026-10-19 to 2026-10-26" → "2026-10-26"). */
export function pollingFieldworkLatest(snapshot) {
  const f = String(snapshot?._meta?.fieldwork || "");
  const dates = f.match(/\d{4}-\d{2}-\d{2}/g);
  return dates ? dates[dates.length - 1] : null;
}

export const SEAT_RANGE_DRAWS = 10000;
export const SEAT_RANGE_SEED = 20261109;

/**
 * Adds win_probability and share_intervals to every predicted seat and returns
 * the summary blocks. Exported so the Restore Britain overlay can re-run it
 * after it changes Great Yarmouth.
 */
export function annotateUncertainty(predictions, calibration) {
  let annotated = 0;
  const seats = [];
  Object.values(predictions).forEach((p, i) => {
    if (!p?.prediction) return;
    const wp = leaderWinProbability(p.prediction, calibration);
    p.win_probability = wp ? wp.win_probability : null;
    p.win_probability_bin = wp ? wp.bin : null;
    p.share_intervals = shareIntervals(p.prediction, calibration, { seed: 1 + i });
    if (wp) annotated += 1;
    seats.push({ winner: p.winner, runner_up: p.runner_up, win_probability: p.win_probability });
  });
  const rho = calibration.correlation?.rho ?? 0;
  const sim = simulateSeatRanges(seats, { draws: SEAT_RANGE_DRAWS, seed: SEAT_RANGE_SEED, rho });
  return {
    annotated,
    win_probability: {
      calibration: "data/calibration/ge-win-probability.json",
      fitted_on: calibration.fitted_on,
      fitted_at: calibration.fitted_at,
      fitted_n: calibration.n,
      meaning: "Share of 2024 rerun seats with a similar predicted margin that the projected leader went on to win",
      share_intervals: "p10 and p90 per party on at least 1 per cent, drawn from the 2024 rerun residual SDs (src/lib/intervals.js)",
    },
    seat_ranges: {
      method:
        "Each seat's winner drawn from its win probability: the leader holds it, otherwise the runner-up takes it. Seats share a national shock per party (Gaussian copula) with correlation rho from the 2024 rerun, so seats with the same pairing move together.",
      interval: "5th to 95th percentile of simulated seat totals (a 90 in 100 range)",
      draws: sim.draws,
      seed: sim.seed,
      rho: sim.rho,
      by_party: sim.by_party,
      limits: "A seat can only go to its projected leader or runner-up, so a party projected third everywhere gets no range. Replayed on 2024, the actual Labour, Conservative and Reform UK totals fell inside this range and the Liberal Democrat and SNP totals did not (data/calibration/ge-win-probability.json, seat_range_check_2024).",
    },
  };
}

function main() {
  console.log("Loading inputs ...");
  const pcons = readJson("data/identity/pcons-ge-next.json").pcons;
  const dcRaw = readJson("data/history/dc-historic-results.json");
  let ladPriors = null;
  try { ladPriors = readJson("data/features/ward-mrp-priors.json"); } catch {}
  let pconPriors = null;
  try { pconPriors = readJson("data/features/pcon-mrp-priors.json"); } catch {}
  let pconDemographics = null;
  try { pconDemographics = readJson("data/features/pcon-demographics.json"); } catch {}
  let standingDown = null;
  try { standingDown = readJson("data/identity/mps-standing-down.json"); } catch {}
  // 20 May 2026 — local-party register (per-LAD Independent ceiling override)
  let localRegister = null;
  try { localRegister = readJson("data/identity/local-party-register.json"); } catch {}
  console.log(`  ${pcons.length} PCONs loaded`);
  if (localRegister) console.log(`  ${localRegister.register?.length || 0} local-party register entries available`);
  if (pconPriors) console.log(`  ${Object.keys(pconPriors.priors || {}).length} PCON-level BES priors available (preferred)`);
  if (ladPriors) console.log(`  ${Object.keys(ladPriors.priors || {}).length} LAD-level BES priors available (fallback)`);
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

  // Build BES prior map: prefer PCON24-direct, fall back LAD blend, then regional
  const besPriorMap = buildBesPriorMap(pcons, pconPriors, ladPriors);
  const sourceCounts = Object.values(besPriorMap).reduce((acc, v) => {
    acc[v.source] = (acc[v.source] || 0) + 1;
    return acc;
  }, {});
  console.log(`  ${Object.keys(besPriorMap).length} PCONs have a BES prior — by source:`, sourceCounts);

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
      ...GE_MODEL_OPTIONS,
      besPrior: besPriorMap[pcon.slug] || null,
      mp: mpRoster[pcon.slug] || null,
      byElectionShares: byElectionShareMap[pcon.slug] || null,
      demographics: pcon.pcon24cd ? pconDemographics?.by_pcon?.[pcon.pcon24cd] || null : null,
      allowHighIndependent: standingDownMap[pcon.slug]?.allow_high_independent === true,
      // PCON's primary LAD (first of lad24cds); register lookup is per-LAD.
      lad24cd: Array.isArray(pcon.lad24cds) && pcon.lad24cds.length > 0 ? pcon.lad24cds[0] : null,
      localRegister,
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

  // Uncertainty: win probability, p10/p90 shares, seat ranges.
  const calibration = loadGeWinProbability(REPO);
  if (!calibration) throw new Error("data/calibration/ge-win-probability.json missing; run scripts/calibrate-ge-win-probability.mjs");
  const pollingLatest = pollingFieldworkLatest(UK_WESTMINSTER_2026_APRIL_AVERAGE);
  if (!geWinProbabilityApplies(calibration, { pollingLatest })) {
    throw new Error(`ge-win-probability.json was fitted on ${calibration.fitted_on}; refusing to apply it to polling dated ${pollingLatest}`);
  }
  const uncertainty = annotateUncertainty(predictions, calibration);
  console.log(`  win probability on ${uncertainty.annotated} seats; seat range ${uncertainty.seat_ranges.draws} draws, rho ${uncertainty.seat_ranges.rho}`);

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
      polling_source: describePollingSource(UK_WESTMINSTER_2026_APRIL_AVERAGE),
      polling_fieldwork_latest: pollingLatest,
      polling_constant: "UK_WESTMINSTER_2026_APRIL_AVERAGE",
      baseline_source: "UK_WESTMINSTER_2024_GE_RESULT",
      methodology_version: "1.0.0-GE",
      sources: [
        { path: "data/identity/pcons-ge-next.json", role: "650-PCON identity table" },
        { path: "data/history/dc-historic-results.json", role: "Historic + by-election data" },
        { path: "data/features/ward-mrp-priors.json", role: "BES Wave 1-30 LAD priors" },
        { path: "src/lib/nationalPolling.js", role: "Current Westminster polling" },
        { path: "data/polling/override.json", role: "Westminster polling snapshot read by nationalPolling.js" },
        { path: "data/calibration/ge-win-probability.json", role: "Win probability, share intervals and seat-range correlation" },
      ],
    },
    win_probability: uncertainty.win_probability,
    seat_ranges: uncertainty.seat_ranges,
    seat_tallies_by_party: tally.by_winner,
    seat_tallies_by_country: tally.by_country,
    national_vote_share: nationalVoteShare,
    pcons_evaluated: tally.ok,
    pcons_skipped: tally.no_baseline,
  };

  const assumptions = buildGeAssumptions(GE_MODEL_OPTIONS, summary.snapshot.generated_at);

  const outDir = `data/predictions/${FORECAST_KEY}`;
  mkdirSync(join(REPO, outDir), { recursive: true });
  writeFileSync(join(REPO, outDir, "constituencies.json"), JSON.stringify({ snapshot: summary.snapshot, predictions }, null, 2));
  writeFileSync(join(REPO, outDir, "summary.json"), JSON.stringify(summary, null, 2));
  writeFileSync(join(REPO, outDir, "assumptions.json"), JSON.stringify(assumptions, null, 2));
  console.log(`\nWrote ${outDir}/{constituencies,summary,assumptions}.json`);
  console.log(`Seat winners: ${Object.entries(tally.by_winner).sort((a, b) => b[1] - a[1]).map(([p, n]) => `${p}: ${n}`).join(", ")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
