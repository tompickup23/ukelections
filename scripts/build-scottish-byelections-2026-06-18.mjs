#!/usr/bin/env node
/**
 * build-scottish-byelections-2026-06-18.mjs — build the result + signal +
 * accuracy data files for the two Scottish Westminster by-elections held
 * 18 June 2026 alongside Makerfield:
 *
 *   - Aberdeen South            (SNP seat, vacated by Stephen Flynn → Holyrood)
 *   - Arbroath and Broughty Ferry (SNP seat, vacated by Stephen Gethins → Holyrood)
 *
 * Both were triggered by the dual-mandate ban in the Scottish Elections
 * (Representation and Reform) Act 2025 after the 7 May 2026 Holyrood election.
 *
 * NEITHER seat had any published constituency poll, so there is no poll-based
 * forecast to grade (unlike Makerfield). The honest pre-election "prediction"
 * is the freshest *actual-vote* signal in the area: the 7 May 2026 Holyrood
 * result in the overlapping constituency, with the GE2024 result as a naive
 * prior. This script grades BOTH of those signals, plus the published
 * Ballot Box Scotland qualitative call, against the declared result.
 *
 * Output (status:"concluded", result-first):
 *   data/predictions/by-elections/aberdeen-south-2026-06-18.json
 *   data/predictions/by-elections/arbroath-and-broughty-ferry-2026-06-18.json
 *
 * All figures primary-source verified (Wikipedia result-box wikitext + Ballot
 * Box Scotland + the council declarations). Where Wikipedia's result box had a
 * live-edit typo, the corrected figure is used and noted:
 *   - Aberdeen turnout: 37.4% (28,897/77,328), NOT Wikipedia's flagged 31.36%.
 *   - Arbroath Con votes: 4,524 (NOT 4,624); majority 5,278 (NOT 5,178).
 */

import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "data/predictions/by-elections");

const r4 = (x) => Math.round(x * 1e4) / 1e4;
const rankOf = (shares) =>
  Object.entries(shares).filter(([, v]) => v > 0.0005).sort((a, b) => b[1] - a[1]).map(([party, pct]) => ({ party, pct: r4(pct) }));
const winnerOf = (shares) => rankOf(shares)[0]?.party ?? null;

// Mean abs error of a share dict vs the result, over the result's main parties.
function maeVsResult(shares, resultShares) {
  const keys = Object.keys(resultShares).filter((k) => k !== "Other");
  let sum = 0, n = 0;
  const per = {};
  for (const k of keys) {
    const f = shares[k] ?? 0;
    per[k] = r4(f - resultShares[k]);
    sum += Math.abs(f - resultShares[k]);
    n += 1;
  }
  return { per_party_signed_error_pp: per, mae_pp: r4(sum / n) };
}

function swing(resultShares, baseShares) {
  const out = {};
  for (const p of Object.keys(resultShares)) {
    if (baseShares[p] != null) out[p] = r4(resultShares[p] - baseShares[p]);
  }
  return out;
}

// MAE over only the parties a forecaster reported (fair to partial/qualitative).
function maeOverReported(shares, resultShares) {
  const keys = Object.keys(shares || {}).filter((k) => k !== "Other");
  if (!keys.length) return null;
  let sum = 0;
  for (const k of keys) sum += Math.abs((shares[k] ?? 0) - (resultShares[k] ?? 0));
  return { mae_pp: r4(sum / keys.length), n_parties: keys.length };
}

// Grade rival forecasts (winner call + share MAE) against the declared result.
function gradeBenchmarks(list, resultShares, resultWinner) {
  return (list || []).map((b) => {
    const acc = b.shares ? maeOverReported(b.shares, resultShares) : null;
    return {
      ...b,
      winner_correct: b.called === resultWinner,
      mae_pp: acc?.mae_pp ?? null,
      n_parties: acc?.n_parties ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Build one seat's file from a spec.
// ---------------------------------------------------------------------------
function buildSeat(spec) {
  const resultRanked = rankOf(spec.result.shares);
  const resultWinner = resultRanked[0].party;
  const resultRunnerUp = resultRanked[1].party;
  const resultMargin = r4(resultRanked[0].pct - resultRanked[1].pct);

  // Signals we grade against the result.
  const signals = [
    {
      id: "ge2024_baseline",
      label: "GE2024 result (naive prior)",
      shares: spec.ge2024.shares,
    },
    {
      id: "holyrood_overlap_2026_05_07",
      label: `7 May 2026 Holyrood signal (${spec.holyrood.name})`,
      shares: spec.holyrood.shares,
    },
  ].map((s) => ({
    ...s,
    called_winner: winnerOf(s.shares),
    winner_call_correct: winnerOf(s.shares) === resultWinner,
    accuracy: maeVsResult(s.shares, spec.result.shares),
    labour_or_lead_margin_pp: null,
  }));

  // The "forecast" block is the freshest-signal expectation (Holyrood overlap),
  // so siteData + the page have a central call to show. Clearly flagged as a
  // signal nowcast, NOT a poll-based forecast (none existed).
  const signalShares = spec.holyrood.shares;
  const signalRanked = rankOf(signalShares);

  const out = {
    schema_version: "1.0.0",
    model_version: "scottish-byelection-signal-v1",
    status: "concluded",
    concluded_at: "result-final",
    generated_note:
      "Built post-result. No UKE pre-election forecast and no constituency polls existed; " +
      "the 'forecast' block below is the freshest actual-vote signal (7 May 2026 Holyrood overlap), " +
      "graded against the declared result in forecast_vs_result.",
    contest: spec.contest,
    candidates: spec.candidates,
    forecast: {
      basis: "7 May 2026 Holyrood overlap signal (no constituency polls were published).",
      winner: signalRanked[0].party,
      runner_up: signalRanked[1].party,
      central_shares: signalShares,
      ranked: signalRanked,
      classification: "signal-only",
      headline:
        `No constituency polls existed. Freshest signal (${spec.holyrood.name}, 7 May 2026): ` +
        `${signalRanked[0].party} ${(signalRanked[0].pct * 100).toFixed(1)}% ahead of ` +
        `${signalRanked[1].party} ${(signalRanked[1].pct * 100).toFixed(1)}%.`,
    },
    inputs: {
      no_polls_note:
        "No published constituency polling for this by-election (confirmed by PollCheck and Ballot Box Scotland). " +
        "By-elections get no broadcaster exit poll either. The signal below is the substitute.",
      ge2024_baseline: spec.ge2024,
      holyrood_signal_2026_05_07: spec.holyrood,
      preelection_calls: spec.preelection_calls,
    },
    result: {
      ...spec.result,
      ranked: resultRanked,
      winner: resultWinner,
      runner_up: resultRunnerUp,
      margin_pp: resultMargin,
      swing_vs_ge2024_pp: swing(spec.result.shares, spec.ge2024.shares),
      sources: spec.result.sources,
    },
    final_polls: {
      note: "No published constituency polls; no broadcaster exit poll (by-elections never get one).",
      polls: [],
    },
    forecast_vs_result: {
      actual: {
        winner: `${resultWinner} (${spec.result.winner_candidate})`,
        outcome: spec.result.outcome,
        runner_up: `${resultRunnerUp} (${spec.result.runner_up_candidate})`,
        margin: `${spec.result.majority_votes.toLocaleString()} votes (+${(resultMargin * 100).toFixed(1)}pp)`,
        turnout: `${spec.result.turnout_votes.toLocaleString()} (${(spec.result.turnout_pct * 100).toFixed(1)}%)`,
      },
      signals,
      winner_call_summary: signals.map(
        (s) => `${s.label}: predicted ${s.called_winner} — ${s.winner_call_correct ? "CORRECT" : "INCORRECT"}`,
      ),
      narrative: spec.narrative,
    },
    benchmarks: {
      note:
        "How every forecaster did, graded against the declared result. No constituency poll or bespoke " +
        "by-election model existed for this seat; the entries are the freshest signal, the Electoral Calculus " +
        "GE-model seat estimate, betting markets, and the Ballot Box Scotland qualitative call. MAE is over each " +
        "forecaster's reported parties.",
      graded: gradeBenchmarks(spec.benchmarks, spec.result.shares, resultWinner),
    },
  };
  return out;
}

// ---------------------------------------------------------------------------
// ABERDEEN SOUTH — Conservative GAIN (an upset; every signal said SNP)
// ---------------------------------------------------------------------------
const ABERDEEN = {
  contest: {
    constituency_slug: "aberdeen-south",
    constituency_name: "Aberdeen South",
    pcon24cd: "S14000061",
    region: "Scotland",
    trigger: {
      type: "resignation",
      departing_mp: "Stephen Flynn",
      departing_party: "Scottish National Party",
      stated_reason:
        "Flynn was elected to the Scottish Parliament on 7 May 2026; the Scottish Elections (Representation and Reform) Act 2025 bars a dual Holyrood+Westminster mandate, so he resigned the Commons seat on 14 May 2026.",
    },
    polling_day: "2026-06-18",
  },
  candidates: [
    { party: "Scottish National Party", candidate: "Richard Thomson" },
    { party: "Conservative", candidate: "Douglas Lumsden" },
    { party: "Reform UK", candidate: "Jo Hart" },
    { party: "Labour", candidate: "Nurul Hoque Ali" },
    { party: "Liberal Democrats", candidate: "Mel Sullivan" },
    { party: "Green Party", candidate: "Jorg Shelton-Eckstein" },
    { party: "Alliance for Democracy and Freedom", candidate: "David Ballantine" },
  ],
  ge2024: {
    date: "2024-07-04",
    winner_party: "Scottish National Party",
    shares: {
      "Scottish National Party": 0.328,
      Labour: 0.247,
      Conservative: 0.244,
      "Reform UK": 0.069,
      "Liberal Democrats": 0.063,
      "Green Party": 0.035,
      Other: 0.014,
    },
    votes: {
      "Scottish National Party": 15213,
      Labour: 11455,
      Conservative: 11300,
      "Reform UK": 3199,
      "Liberal Democrats": 2921,
      "Green Party": 1609,
      Other: 648,
    },
    majority_pp: 0.081,
    turnout_pct: 0.599,
    electorate: 77328,
  },
  holyrood: {
    name: "Aberdeen Deeside and North Kincardine (Holyrood constituency)",
    date: "2026-05-07",
    note: "Stephen Flynn won this Holyrood seat on 7 May 2026 — the win that triggered the Westminster by-election. Different electorate to the Westminster seat; constituency (first) vote.",
    shares: {
      "Scottish National Party": 0.341,
      Conservative: 0.305,
      "Reform UK": 0.177,
      "Liberal Democrats": 0.083,
      Labour: 0.081,
    },
    majority_pp: 0.036,
    turnout_pct: 0.55,
  },
  preelection_calls: [
    { source: "Ballot Box Scotland", call: "Lean SNP", note: "Pre-election qualitative call, 4 June 2026." },
  ],
  result: {
    outcome: "Conservative gain from SNP",
    winner_candidate: "Douglas Lumsden",
    runner_up_candidate: "Richard Thomson",
    shares: {
      Conservative: 0.4952,
      "Scottish National Party": 0.2858,
      "Reform UK": 0.0858,
      Labour: 0.0536,
      "Liberal Democrats": 0.0439,
      "Green Party": 0.0337,
      Other: 0.002, // Alliance for Democracy and Freedom 59
    },
    votes: {
      Conservative: 14308,
      "Scottish National Party": 8258,
      "Reform UK": 2478,
      Labour: 1550,
      "Liberal Democrats": 1270,
      "Green Party": 974,
      Other: 59,
    },
    majority_votes: 6050,
    majority_pp: 0.2094,
    turnout_votes: 28897,
    turnout_pct: 0.374, // 28,897 / 77,328; Wikipedia's 31.36% is a flagged citation-needed error
    electorate: 77328,
    sources: [
      "https://en.wikipedia.org/wiki/2026_Aberdeen_South_by-election",
      "https://www.pollcheck.co.uk/by-elections/aberdeen-south",
      "https://ballotbox.scot/preview-westminster-aberdeen-south/",
    ],
  },
  benchmarks: [
    { id: "ge2024", forecaster: "GE2024 result (naive prior)", date: "4 Jul 2024", type: "baseline", called: "Scottish National Party", shares: { "Scottish National Party": 0.328, Labour: 0.247, Conservative: 0.244, "Reform UK": 0.069, "Liberal Democrats": 0.063, "Green Party": 0.035 } },
    { id: "uke_signal", forecaster: "UK Elections — Holyrood signal", date: "7 May (basis)", type: "signal", called: "Scottish National Party", shares: { "Scottish National Party": 0.341, Conservative: 0.305, "Reform UK": 0.177, "Liberal Democrats": 0.083, Labour: 0.081 } },
    { id: "electoral_calculus", forecaster: "Electoral Calculus (GE seat model)", date: "9 May", type: "seat model", called: "Scottish National Party", shares: { "Scottish National Party": 0.364, Conservative: 0.215, "Reform UK": 0.182, Labour: 0.121, "Green Party": 0.049, "Liberal Democrats": 0.045 }, note: "82% SNP. Standard GE-model seat estimate, not a bespoke by-election forecast." },
    { id: "betting_markets", forecaster: "Betting markets (eve of poll)", date: "17 Jun", type: "market", called: "Scottish National Party", prob: 0.79, shares: null, note: "SNP ~79% (oddschecker); the Conservatives were a ~20% outsider." },
    { id: "ballot_box_scotland", forecaster: "Ballot Box Scotland (qualitative)", date: "4 Jun", type: "qualitative", called: "Scottish National Party", shares: null, note: "'Lean SNP'." },
  ],
  narrative: [
    "An upset. Every area signal pointed to an SNP hold: the GE2024 baseline (SNP 32.8%), the 7 May 2026 Holyrood overlap (SNP 34.1% ahead of the Conservatives' 30.5%), and Ballot Box Scotland's 'Lean SNP' call. The result was a 21-point Conservative GAIN — the first Conservative gain of a Westminster seat at a Scottish by-election since 1967.",
    "The mechanism was tactical unionist consolidation on a low (37%) by-election turnout. Labour collapsed from 24.7% to 5.4% (-19pp) and the Lib Dems eased, with that vote coalescing behind Douglas Lumsden to beat the SNP. The SNP's own share barely moved (-4pp); they were not so much defeated as outflanked by a unified anti-SNP vote.",
    "Reform UK is the signal's other big miss: 17.7% in the Holyrood overlap five weeks earlier, just 8.6% here. Reform's Holyrood list strength did not transfer to a Westminster by-election framed as a straight SNP-vs-Conservative fight. No area-level signal could have called this; it needed a model of tactical switching that the raw shares do not contain.",
  ],
};

// ---------------------------------------------------------------------------
// ARBROATH AND BROUGHTY FERRY — SNP HOLD (the Holyrood signal nailed it)
// ---------------------------------------------------------------------------
const ARBROATH = {
  contest: {
    constituency_slug: "arbroath-and-broughty-ferry",
    constituency_name: "Arbroath and Broughty Ferry",
    pcon24cd: "S14000091",
    region: "Scotland",
    trigger: {
      type: "resignation",
      departing_mp: "Stephen Gethins",
      departing_party: "Scottish National Party",
      stated_reason:
        "Gethins won the Holyrood seat of Dundee City East on 7 May 2026; the dual-mandate ban (Scottish Elections (Representation and Reform) Act 2025) forced his resignation from the Commons on 14 May 2026.",
    },
    polling_day: "2026-06-18",
  },
  candidates: [
    { party: "Scottish National Party", candidate: "Lara Bird" },
    { party: "Conservative", candidate: "Jack Cruickshanks" },
    { party: "Reform UK", candidate: "Bill Reid" },
    { party: "Labour", candidate: "Heather Doran" },
    { party: "Liberal Democrats", candidate: "Tanvir Ahmad" },
  ],
  ge2024: {
    date: "2024-07-04",
    winner_party: "Scottish National Party",
    shares: {
      "Scottish National Party": 0.353,
      Labour: 0.334,
      Conservative: 0.155,
      "Reform UK": 0.086,
      "Liberal Democrats": 0.051,
      Other: 0.021, // Alba 0.016 + Sovereignty 0.005
    },
    votes: {
      "Scottish National Party": 15581,
      Labour: 14722,
      Conservative: 6841,
      "Reform UK": 3800,
      "Liberal Democrats": 2249,
      Other: 924,
    },
    majority_pp: 0.019,
    turnout_pct: 0.581,
    electorate: 76149,
  },
  holyrood: {
    name: "Angus South (Holyrood constituency, ~94% overlap)",
    date: "2026-05-07",
    note: "Angus South covers ~94% of the Westminster seat and, crucially, the SAME Reform (Bill Reid) and Labour (Heather Doran) candidates stood here five weeks before the by-election. Constituency (first) vote.",
    shares: {
      "Scottish National Party": 0.423,
      Conservative: 0.213,
      "Reform UK": 0.178,
      Labour: 0.107,
      "Liberal Democrats": 0.079,
    },
    majority_pp: 0.211,
    turnout_pct: 0.534,
  },
  preelection_calls: [
    { source: "Ballot Box Scotland", call: "Likely SNP", note: "Pre-election qualitative call." },
  ],
  result: {
    outcome: "SNP hold",
    winner_candidate: "Lara Bird",
    runner_up_candidate: "Jack Cruickshanks",
    shares: {
      "Scottish National Party": 0.412,
      Conservative: 0.19,
      "Reform UK": 0.183,
      Labour: 0.154,
      "Liberal Democrats": 0.061,
    },
    votes: {
      "Scottish National Party": 9802,
      Conservative: 4524, // NOT 4,624 (Wikipedia result-box typo); confirmed by infobox + PollCheck + council
      "Reform UK": 4341,
      Labour: 3651,
      "Liberal Democrats": 1452,
    },
    majority_votes: 5278, // 9,802 - 4,524; Wikipedia result box's 5,178 is a typo
    majority_pp: 0.222,
    turnout_votes: 23827, // total ballots; valid 23,770, rejected 57
    turnout_pct: 0.3136,
    electorate: 76149,
    sources: [
      "https://en.wikipedia.org/wiki/2026_Arbroath_and_Broughty_Ferry_by-election",
      "https://www.angus.gov.uk/news/uk_parliament_by_election_result_arbroath_and_broughty_ferry",
      "https://www.pollcheck.co.uk/by-elections/arbroath-and-broughty-ferry",
    ],
  },
  benchmarks: [
    { id: "ge2024", forecaster: "GE2024 result (naive prior)", date: "4 Jul 2024", type: "baseline", called: "Scottish National Party", shares: { "Scottish National Party": 0.353, Labour: 0.334, Conservative: 0.155, "Reform UK": 0.086, "Liberal Democrats": 0.051 } },
    { id: "uke_signal", forecaster: "UK Elections — Holyrood signal", date: "7 May (basis)", type: "signal", called: "Scottish National Party", shares: { "Scottish National Party": 0.423, Conservative: 0.213, "Reform UK": 0.178, Labour: 0.107, "Liberal Democrats": 0.079 } },
    { id: "electoral_calculus", forecaster: "Electoral Calculus (GE seat model)", date: "9 May", type: "seat model", called: "Scottish National Party", shares: { "Scottish National Party": 0.393, "Reform UK": 0.212, Labour: 0.162, Conservative: 0.127, "Green Party": 0.039, "Liberal Democrats": 0.036 }, note: "87% SNP. Standard GE-model seat estimate, not a bespoke by-election forecast." },
    { id: "betting_markets", forecaster: "Betting markets (eve of poll)", date: "17 Jun", type: "market", called: "Scottish National Party", prob: 0.90, shares: null, note: "SNP ~90% (oddschecker), the strongest favourite of the three seats." },
    { id: "ballot_box_scotland", forecaster: "Ballot Box Scotland (qualitative)", date: "6 Jun", type: "qualitative", called: "Scottish National Party", shares: null, note: "'Likely SNP'." },
  ],
  narrative: [
    "The signal nailed it. The 7 May 2026 Holyrood result in Angus South (which covers ~94% of this seat, with the SAME Reform and Labour candidates) was SNP 42.3 / Con 21.3 / Reform 17.8 / Lab 10.7 / LD 7.9. The by-election five weeks later: SNP 41.2 / Con 19.0 / Reform 18.3 / Lab 15.4 / LD 6.1. Almost a carbon copy, and a comfortable SNP hold exactly as Ballot Box Scotland's 'Likely SNP' call expected.",
    "The GE2024 baseline, by contrast, would have badly misframed the contest: it had Labour second on 33.4%, a 1.9-point SNP-Labour marginal. The Holyrood signal correctly captured what GE2024 could not — that Labour had collapsed (to ~11-15%) and that Reform had risen to overtake them for third. Here the freshest actual-vote signal beat the year-old general-election prior decisively.",
    "Reform UK's 18.3% (up 9.7pp on GE2024, third place) is the structural story: in a seat where it polled 8.6% at the general election, Reform now runs ahead of both Labour and, at Holyrood, tracked almost exactly. The SNP's vote was remarkably stable through a collapse in turnout (58% to 31%), which is what a safe-ish incumbent hold looks like.",
  ],
};

// ---------------------------------------------------------------------------
mkdirSync(OUT_DIR, { recursive: true });
for (const spec of [ABERDEEN, ARBROATH]) {
  const out = buildSeat(spec);
  const file = path.join(OUT_DIR, `${spec.contest.constituency_slug}-2026-06-18.json`);
  writeFileSync(file, JSON.stringify(out, null, 2) + "\n", "utf8");
  const fvr = out.forecast_vs_result;
  console.log(`Wrote ${path.relative(ROOT, file)} — ${out.result.outcome}`);
  for (const s of fvr.signals) {
    console.log(`  ${s.id}: predicted ${s.called_winner} ${s.winner_call_correct ? "✓" : "✗"} | MAE ${(s.accuracy.mae_pp * 100).toFixed(1)}pp`);
  }
}
