#!/usr/bin/env node
/**
 * finalise-makerfield-result.mjs — post-mortem updater for the 18 June 2026
 * Makerfield parliamentary by-election.
 *
 * The contest is over. This script FREEZES the pre-election forecast
 * (makerfield-2026-06-18.json, produced by forecast-makerfield-byelection.mjs
 * on 26 May 2026) and layers on top of it, WITHOUT mutating the original
 * `forecast` / `scenarios` / `methodology` blocks:
 *
 *   - `final_polls`        the five fieldwork-based constituency polls that
 *                          landed 18 May–12 Jun 2026 (the model never ingested
 *                          any of them) + a poll-of-polls central estimate.
 *   - `result`            the declared outcome.
 *   - `forecast_vs_result` winner-call + per-party accuracy of the published
 *                          forecast, each scenario branch, and the poll average,
 *                          graded against the result.
 *   - `status: "concluded"` so the page renders result-first and the daily
 *                          generator refuses to overwrite it.
 *
 * Re-runnable / idempotent. The only field that has to be backfilled once the
 * returning officer publishes the per-candidate breakdown is RESULT.shares /
 * RESULT.votes — everything else is computed.
 *
 * NB on "exit polls": a single-seat by-election gets NO broadcaster exit poll
 * (that only runs at a general election). The only "exit-poll"-labelled number
 * in circulation was a self-selecting Wigan Today reader click-poll (n≈3,956),
 * which is not a probability sample and is excluded as a forecast anchor. The
 * five Survation / More in Common / Opinium / Convergent Opinion constituency
 * polls below are the proper final-polls anchor.
 *
 * Input/Output: data/predictions/by-elections/makerfield-2026-06-18.json
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const FILE = path.join(ROOT, "data/predictions/by-elections/makerfield-2026-06-18.json");

// ---------------------------------------------------------------------------
// 1. Final constituency polls (all fieldwork-based, unlike the 15 May
//    Survation / Britain Elects pre-poll *forecasts* the model was built on).
//    Sources: PollCheck by-election tracker + Survation releases. Shares are
//    decimal fractions; each row also stores the headline Lab-minus-Ref lead.
// ---------------------------------------------------------------------------
const FINAL_POLLS = [
  {
    pollster: "Survation",
    client: "Election Data Ltd",
    fieldwork: "2026-05-18/2026-05-22",
    sample: 504,
    shares: { Labour: 0.43, "Reform UK": 0.40, Conservative: 0.02, "Liberal Democrats": 0.04, "Green Party": 0.03, "Restore Britain": 0.07, Other: 0.01 },
    lead_pp: 0.03,
    note: "First published fieldwork-based Makerfield constituency poll. Burnham premium = small lead.",
  },
  {
    pollster: "Survation",
    client: null,
    fieldwork: "2026-05-26/2026-06-01",
    sample: 518,
    shares: { Labour: 0.49, "Reform UK": 0.39, Conservative: 0.01, "Liberal Democrats": 0.01, "Green Party": 0.02, "Restore Britain": 0.08, Other: 0.01 },
    lead_pp: 0.10,
    note: "'Left consolidates, right splits, Burnham ahead' — Restore Britain eating Reform's right flank.",
  },
  {
    pollster: "More in Common",
    client: null,
    fieldwork: "2026-05-28/2026-06-12",
    sample: 515,
    shares: { Labour: 0.45, "Reform UK": 0.40, Conservative: 0.02, "Liberal Democrats": 0.01, "Green Party": 0.03, "Restore Britain": 0.08, Other: 0.01 },
    lead_pp: 0.05,
  },
  {
    pollster: "Opinium",
    client: "Forward Democracy",
    fieldwork: "2026-06-03/2026-06-11",
    sample: 543,
    shares: { Labour: 0.46, "Reform UK": 0.41, Conservative: 0.03, "Liberal Democrats": 0.01, "Green Party": 0.02, "Restore Britain": 0.07, Other: 0.01 },
    lead_pp: 0.05,
  },
  {
    pollster: "Convergent Opinion",
    client: "The Sunday Times",
    fieldwork: "2026-06-02/2026-06-12",
    sample: 525,
    shares: { Labour: 0.49, "Reform UK": 0.37, Conservative: 0.03, "Liberal Democrats": 0.01, "Green Party": 0.05, "Restore Britain": 0.05, Other: 0.01 },
    lead_pp: 0.12,
    note: "Final poll; largest Labour lead of the campaign.",
  },
];

const PARTIES = ["Labour", "Reform UK", "Conservative", "Liberal Democrats", "Green Party", "Restore Britain", "Other"];

// ---------------------------------------------------------------------------
// 2. Declared result. Confirmed facts are populated; per-candidate vote
//    SHARES/VOTES are backfilled from the returning officer's declaration.
//    Set `shares` (decimal fractions, must sum ~1) + `votes` once published;
//    leave null to render an "awaiting figures" state. winner/turnout below
//    are confirmed from Wikipedia infobox (after_election = Andy Burnham,
//    turnout 45,510 / 58.75%) + the LBC/ITV live coverage.
// ---------------------------------------------------------------------------
const RESULT = {
  declared: true,
  outcome: "Labour hold",
  winner_party: "Labour",
  winner_candidate: "Andy Burnham",
  runner_up_party: "Reform UK",
  runner_up_candidate: "Robert Kenyon",
  third_party: "Restore Britain",
  third_candidate: "Rebecca Shepherd",
  finishing_order_top3: ["Labour", "Reform UK", "Restore Britain"],
  turnout_votes: 45476,
  turnout_pct: 0.5875,
  turnout_change_pp: 0.0635,
  rejected_ballots: 48,
  electorate_ge2024: 76641,
  // Declared per-candidate figures (returning officer, via Wikipedia result box).
  shares: {
    Labour: 0.5481,
    "Reform UK": 0.3451,
    "Restore Britain": 0.0684,
    Conservative: 0.0219,
    "Green Party": 0.0068,
    "Liberal Democrats": 0.0036,
    Other: 0.0061, // Binface 95 + Hope 45 + Dyer 37 + Ward 35 + Clarke 18 + Gemmell 18 + Pownall 18 + Gould 8
  },
  votes: {
    Labour: 24927,
    "Reform UK": 15696,
    "Restore Britain": 3111,
    Conservative: 997,
    "Green Party": 308,
    "Liberal Democrats": 163,
    Other: 274,
  },
  majority_votes: 9231,
  majority_pp: 0.203,
  margin_note:
    "Labour majority 9,231 votes (+20.3pp) — a landslide hold, WIDER than the 5,399-vote / 13.4pp " +
    "GE2024 majority and wider than every final poll. Burnham 54.81% (+9.61pp on GE2024) overshot " +
    "even the most Labour-favourable poll; Reform 34.51% (+2.71pp) was held below its ward-signal ceiling.",
  figures_status: "declared_full_breakdown",
  sources: [
    "https://en.wikipedia.org/wiki/2026_Makerfield_by-election",
    "https://www.wigan.gov.uk/Council/Voting-and-Elections/Makerfield/index.aspx",
  ],
};

// GE2024 baseline votes (for result swing), from the Wikipedia infobox.
const GE2024 = {
  electorate: 76641,
  turnout_votes: 40263,
  shares: { Labour: 0.452, "Reform UK": 0.318, Conservative: 0.109, "Liberal Democrats": 0.068, "Green Party": 0.044, Other: 0.009 },
};

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const r4 = (x) => Math.round(x * 1e4) / 1e4;

function meanShares(polls) {
  const acc = {};
  for (const p of PARTIES) acc[p] = 0;
  for (const poll of polls) for (const p of PARTIES) acc[p] += poll.shares[p] || 0;
  for (const p of PARTIES) acc[p] = r4(acc[p] / polls.length);
  return acc;
}

function rank(shares) {
  return Object.entries(shares)
    .filter(([, v]) => v > 0.0005)
    .sort((a, b) => b[1] - a[1])
    .map(([party, pct]) => ({ party, pct: r4(pct) }));
}

// Mean absolute error of a forecast's shares vs the result, over the parties
// the result actually reports. Returns null until result shares are known.
function maeVsResult(shares, resultShares) {
  if (!resultShares) return null;
  const keys = Object.keys(resultShares).filter((k) => k !== "Other");
  let sum = 0;
  let n = 0;
  const per = {};
  for (const k of keys) {
    const f = shares[k] ?? 0;
    const a = resultShares[k];
    per[k] = r4(f - a); // signed error (forecast minus actual)
    sum += Math.abs(f - a);
    n += 1;
  }
  return { per_party_signed_error_pp: per, mae_pp: r4(sum / n) };
}

function winnerOf(shares) {
  return rank(shares)[0]?.party ?? null;
}

// Signed Labour-minus-Reform margin (positive = Labour ahead) for a share dict.
function labMargin(shares) {
  return r4((shares["Labour"] ?? 0) - (shares["Reform UK"] ?? 0));
}

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------
const data = JSON.parse(readFileSync(FILE, "utf8"));

const pollAvg = meanShares(FINAL_POLLS);
const pollAvgRanked = rank(pollAvg);
const pollLead = r4((pollAvg["Labour"] || 0) - (pollAvg["Reform UK"] || 0));
const junePolls = FINAL_POLLS.filter((p) => p.fieldwork >= "2026-06");
const juneAvg = meanShares(junePolls);

data.final_polls = {
  note:
    "Five fieldwork-based Makerfield constituency polls landed between 18 May and 12 June 2026. " +
    "The published UKE forecast (generated 26 May, then re-run daily by cron with no new inputs) " +
    "ingested NONE of them — it stayed anchored on the 15 May Survation/Britain Elects pre-poll " +
    "FORECASTS. Every one of the five polls put Labour/Burnham ahead (leads of +3 to +12).",
  no_exit_poll_note:
    "By-elections get no broadcaster exit poll. The only 'exit-poll'-labelled figure in circulation " +
    "was a self-selecting Wigan Today reader click-poll (n≈3,956), not a probability sample; excluded.",
  polls: FINAL_POLLS,
  poll_of_polls: {
    method: "Simple mean of the five final constituency polls.",
    shares: pollAvg,
    ranked: pollAvgRanked,
    labour_lead_pp: pollLead,
    winner: winnerOf(pollAvg),
    june_only_mean: { shares: juneAvg, labour_lead_pp: r4((juneAvg["Labour"] || 0) - (juneAvg["Reform UK"] || 0)) },
    headline:
      `Final-polls central estimate: Labour ${(pollAvg["Labour"] * 100).toFixed(1)}% vs ` +
      `Reform UK ${(pollAvg["Reform UK"] * 100).toFixed(1)}% ` +
      `(Labour +${(pollLead * 100).toFixed(1)}pp), Restore Britain ${(pollAvg["Restore Britain"] * 100).toFixed(1)}% third.`,
  },
};

// result block (+ swing vs GE2024 where shares are known)
let resultSwing = null;
if (RESULT.shares) {
  resultSwing = {};
  for (const p of Object.keys(RESULT.shares)) {
    if (GE2024.shares[p] != null) resultSwing[p] = r4(RESULT.shares[p] - GE2024.shares[p]);
  }
}
data.result = { ...RESULT, ranked: RESULT.shares ? rank(RESULT.shares) : null, swing_vs_ge2024_pp: resultSwing };

// forecast-vs-result accuracy
const contenders = [
  {
    id: "uke_published_forecast",
    label: "UKE published forecast (probability-weighted central)",
    shares: data.forecast.central_shares,
    called_winner: data.forecast.winner,
  },
  {
    id: "uke_scenario_a_burnham_stands",
    label: "UKE Scenario A — Burnham stands (85% branch)",
    shares: data.scenarios.burnham_stands.central,
    called_winner: winnerOf(data.scenarios.burnham_stands.central),
  },
  {
    id: "uke_scenario_b_burnham_withdraws",
    label: "UKE Scenario B — Burnham withdraws (15% branch)",
    shares: data.scenarios.burnham_withdraws.central,
    called_winner: winnerOf(data.scenarios.burnham_withdraws.central),
  },
  {
    id: "final_poll_of_polls",
    label: "Final-polls poll-of-polls (5 constituency polls)",
    shares: pollAvg,
    called_winner: winnerOf(pollAvg),
  },
].map((c) => ({
  ...c,
  winner_call_correct: RESULT.winner_party ? c.called_winner === RESULT.winner_party : null,
  accuracy: maeVsResult(c.shares, RESULT.shares),
}));

// Margin grading (Labour-minus-Reform), available now from the >9,000 majority
// even before the full per-candidate breakdown is published.
const resultMargin = RESULT.shares ? labMargin(RESULT.shares) : RESULT.margin_pp_estimate;
const marginComparison = {
  actual_labour_margin_pp: resultMargin,
  actual_basis: RESULT.shares ? "declared shares" : "lower bound from >9,000 majority / 45,510 turnout",
  contenders: [
    { id: "uke_published_forecast", labour_margin_pp: labMargin(data.forecast.central_shares) },
    { id: "uke_scenario_a_burnham_stands", labour_margin_pp: labMargin(data.scenarios.burnham_stands.central) },
    { id: "final_poll_of_polls", labour_margin_pp: pollLead },
    { id: "most_labour_favourable_poll_convergent", labour_margin_pp: 0.12 },
  ].map((c) => ({
    ...c,
    signed_error_pp: r4(c.labour_margin_pp - resultMargin),
    direction_correct: c.labour_margin_pp > 0, // Labour actually led
  })),
  note:
    "Everyone understated Labour's margin; only the UKE published forecast got the SIGN wrong too " +
    "(it had Reform +1.4). Even the most Labour-favourable poll (+12) trailed the ≈+20pp actual.",
};

data.forecast_vs_result = {
  actual: {
    winner: `${RESULT.winner_party} (${RESULT.winner_candidate})`,
    outcome: RESULT.outcome,
    runner_up: `${RESULT.runner_up_party} (${RESULT.runner_up_candidate})`,
    third: `${RESULT.third_party} (${RESULT.third_candidate})`,
    turnout: `${RESULT.turnout_votes.toLocaleString()} (${(RESULT.turnout_pct * 100).toFixed(2)}%)`,
    majority: RESULT.majority_votes
      ? `${RESULT.majority_votes.toLocaleString()} votes (+${(RESULT.majority_pp * 100).toFixed(1)}pp)`
      : `≈ +${(resultMargin * 100).toFixed(0)}pp`,
  },
  margin_comparison: marginComparison,
  contenders,
  winner_call_summary: {
    uke_published_forecast: `${data.forecast.winner} — ${data.forecast.winner === RESULT.winner_party ? "CORRECT" : "INCORRECT"}`,
    uke_scenario_a: `${winnerOf(data.scenarios.burnham_stands.central)} — ${winnerOf(data.scenarios.burnham_stands.central) === RESULT.winner_party ? "CORRECT" : "INCORRECT"}`,
    final_polls: `Labour — CORRECT (all 5 of 5 polls had Labour ahead)`,
  },
  miss_attribution: [
    "The published central forecast (Reform UK 41.1% vs Labour 39.8%) inverted the actual winner. " +
      "The inversion was an artefact of the probability-BLEND, not of the fundamentals: the 85%-weighted " +
      "Scenario A already had Labour ahead (42.0 vs 39.0). Folding in 15% of a Burnham-withdraws landslide " +
      "(Reform 53 / Lab 27) dragged the blended central across the line to a spurious Reform 'win'. This is " +
      "the 'never collapse a bimodal forecast to one point estimate' failure mode — present scenarios + " +
      "P(win) separately instead.",
    "Scenario B was already moot. Nominations closed in late May with Burnham confirmed on the ballot, so " +
      "P(Burnham withdraws) should have decayed to ~0 by polling day. The forecast was last meaningfully " +
      "regenerated on 26 May and never updated this probability, despite the daily cron re-running the script.",
    "The model ingested zero fieldwork-based constituency polls. Five landed (18 May–12 Jun), all with Labour " +
      "ahead by +3 to +12; the script's own `next_refresh` promised to 're-fit on any new constituency poll' " +
      "and never did. The final-polls poll-of-polls (Lab +7) called the seat correctly.",
    "Restore Britain was under-modelled. The forecast carried them at ~1.8% (Step 8: '1–4%, from Reform's " +
      "right flank'); the polls put them at 5–8% and they finished THIRD. Reform's right flank fragmented " +
      "harder than assumed, which is part of why Reform underperformed its ward-signal ceiling.",
  ],
};

// status flags so the page renders result-first and the generator won't clobber
data.status = "concluded";
data.concluded_at = RESULT.shares ? "result-final" : "result-partial-awaiting-figures";
data.next_refresh = "None. Contest concluded 18 June 2026; forecast frozen for post-mortem.";

writeFileSync(FILE, JSON.stringify(data, null, 2) + "\n", "utf8");

console.log(`Updated ${path.relative(ROOT, FILE)}`);
console.log(`  status: ${data.status} (${data.concluded_at})`);
console.log(`  final-polls poll-of-polls: ${data.final_polls.poll_of_polls.headline}`);
console.log(`  winner calls — published: ${data.forecast_vs_result.winner_call_summary.uke_published_forecast}; ` +
  `scenario A: ${data.forecast_vs_result.winner_call_summary.uke_scenario_a}; polls: CORRECT`);
if (!RESULT.shares) console.log("  NB: RESULT.shares still null — backfill per-candidate figures + re-run for MAE.");
