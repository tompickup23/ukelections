#!/usr/bin/env node
// build-mayoral-forecasts.mjs
//
// Party-level projections for upcoming directly elected mayoral contests
// (data/contests/mayoral.json registry), under the supplementary vote
// restored by the English Devolution and Community Empowerment Act 2026.
//
// Per the Makerfield post-mortem rule: methods are shown SEPARATELY and are
// never blended into a single point estimate. Each method gets its own
// central first-preference shares, p10/p90 band, and its own Monte Carlo
// P(reach runoff) / P(win) under the supplementary vote.
//
// Methods:
//   ge_swing_2024   GE2024 constituency results apportioned onto the contest
//                   geography via the ONS postcode crosswalk, plus uniform
//                   national swing from the latest Westminster poll average.
//                   Available for every contest.
//   prior_swing     The mayoralty's own previous first-preference result plus
//                   national swing since. Only for re-election contests with a
//                   verified prior result. Understates Reform UK where the
//                   prior predates Reform's rise; stated in the description.
//
// Candidate effects are unknowable before nominations close, so these are
// party-level projections with wide bands, not seat calls.
//
// Output: data/predictions/mayoral/forecast.json
// Deterministic (seeded PRNG). Pure read of committed data. No network.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const p = (rel) => path.join(ROOT, rel);
const readJson = (rel) => JSON.parse(readFileSync(p(rel), "utf8"));

const PARTIES = ["Reform UK", "Labour", "Conservative", "Liberal Democrats", "Green Party", "Independent", "Other"];
const DRAWS = 2000;

// ---- party canonicalisation -------------------------------------------------
function canonParty(name) {
  if (!name) return "Other";
  const s = String(name).trim();
  if (/^Labour( Party)?$/i.test(s)) return "Labour";
  if (/labour and co-?operative/i.test(s)) return "Labour";
  if (/^Conservative( and Unionist Party)?$/i.test(s)) return "Conservative";
  if (/^Liberal Democrats?$/i.test(s)) return "Liberal Democrats";
  if (/^Reform UK$/i.test(s)) return "Reform UK";
  if (/^Green Party( of England and Wales)?$/i.test(s)) return "Green Party";
  if (/independent/i.test(s)) return "Independent";
  return "Other";
}

function normalise(shares) {
  const sum = PARTIES.reduce((a, k) => a + Math.max(0, shares[k] || 0), 0) || 1;
  const out = {};
  for (const k of PARTIES) out[k] = Math.max(0, shares[k] || 0) / sum;
  return out;
}

// ---- national anchors -------------------------------------------------------
// GE2024 actual UK-wide vote share. Source: HoC Library CBP-10009 (matches
// UK_WESTMINSTER_2024_GE_RESULT in src/lib/nationalPolling.js). SNP and Plaid
// folded into Other because every contest here is in England.
const GE2024_NATIONAL = normalise({
  "Labour": 0.337, "Conservative": 0.236, "Reform UK": 0.143,
  "Liberal Democrats": 0.122, "Green Party": 0.069, "Independent": 0,
  "Other": 0.061 + 0.025 + 0.007,
});

// Approximate GB Westminster voting intention, early May 2023 (Wikipedia
// polling averages for the period of the May 2023 locals). A modelled input
// for the prior_swing method only; labelled approximate in the output.
const MAY_2023_NATIONAL = normalise({
  "Labour": 0.44, "Conservative": 0.29, "Liberal Democrats": 0.09,
  "Reform UK": 0.06, "Green Party": 0.06, "Independent": 0, "Other": 0.06,
});

function latestNational() {
  const latest = readJson("data/polling/latest.json");
  const uk = latest.sources.uk_westminster;
  const raw = {};
  for (const [party, v] of Object.entries(uk.shares)) {
    const k = canonParty(party) === "Other" && (party === "SNP" || party === "Plaid Cymru") ? "Other" : canonParty(party);
    raw[k] = (raw[k] || 0) + v;
  }
  return {
    shares: normalise(raw),
    label: `${uk.polls_used} polls, fieldwork to ${uk.fieldwork_window.latest}`,
    source_url: uk.url,
  };
}

function applySwing(base, from, to) {
  const out = {};
  for (const k of PARTIES) out[k] = (base[k] || 0) + ((to[k] || 0) - (from[k] || 0));
  return normalise(out);
}

// Proportional swing for stale baselines (the prior_swing method). Additive
// swing fails when the national move exceeds the local share (Labour's fall
// from ~44% in May 2023 to ~21% now would zero every Labour lane), so each
// party present in the prior moves by the RATIO of national now / national
// then, clamped to x2.5. Parties absent from the prior but polling above 5%
// nationally (Reform UK everywhere, the Greens where they did not stand) get
// an entry lane at 60% of national polling: new entrants without a local
// machine routinely underperform their national number in mayoral contests.
// Independent lanes are carried unswung. Renormalised at the end.
const ENTRY_THRESHOLD = 0.05;
const ENTRY_FACTOR = 0.6;
const PROP_CLAMP = 2.5;
function applyProportionalSwing(base, from, to) {
  const out = {};
  for (const k of PARTIES) {
    const b = base[k] || 0;
    if (k === "Independent") { out[k] = b; continue; }
    if (b > 0) {
      const ratio = (from[k] || 0) > 0.005 ? Math.min(PROP_CLAMP, (to[k] || 0) / from[k]) : 1;
      out[k] = b * ratio;
    } else if ((to[k] || 0) >= ENTRY_THRESHOLD) {
      out[k] = (to[k] || 0) * ENTRY_FACTOR;
    } else {
      out[k] = 0;
    }
  }
  return normalise(out);
}

// ---- GE2024 aggregation onto contest geography ------------------------------
function buildGeBase(contest, pcons, crosswalkRows) {
  const ladSet = new Set(contest.constituent_councils.map((c) => c.lad25cd));
  // weight of each PCON inside the contest geography, by live postcode share
  const weights = {};
  for (const row of crosswalkRows) {
    if (ladSet.has(row.lad25cd)) weights[row.pcon24cd] = (weights[row.pcon24cd] || 0) + row.pcon_postcode_share;
  }
  const tallies = {};
  let totalVotes = 0;
  let pconCount = 0;
  for (const pc of pcons) {
    const w = weights[pc.pcon24cd];
    if (!w || !pc.ge2024) continue;
    pconCount += 1;
    for (const cand of pc.ge2024.candidates || []) {
      const k = canonParty(cand.party_name);
      tallies[k] = (tallies[k] || 0) + cand.votes * w;
    }
    totalVotes += (pc.ge2024.turnout_votes || 0) * w;
  }
  return { shares: normalise(tallies), weighted_votes: Math.round(totalVotes), pcon_count: pconCount };
}

// ---- seeded PRNG ------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashSeed(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function gaussFactory(rand) {
  return function () {
    let u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}
function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[idx];
}

// ---- supplementary vote runoff ----------------------------------------------
// Bloc adjacency for second preferences. Calibration anchors: the 30 July 2026
// Greater Manchester by-election (first SV contest of the restored system) and
// the 2021 SV era contests. Parameters carry wide noise; see method text.
const BLOC = {
  "Labour": "left", "Green Party": "left", "Liberal Democrats": "left",
  "Conservative": "right", "Reform UK": "right",
  "Independent": "none", "Other": "none",
};
// Share of an eliminated party's voters whose second preference reaches one of
// the two finalists (the rest exhaust). Verified anchors: 60.8% in Greater
// Manchester 2026, 44.3% in London 2021 (data/contests/mayoral.json
// sv_calibration). Centre 0.52, sd 0.15, clamp [0.15, 0.85].
const TRANSFER_REACH = { mu: 0.52, sd: 0.15, lo: 0.15, hi: 0.85 };
// Of transfers that reach the finalists: share to the same-bloc finalist when
// the finalists straddle blocs. GM 2026 implies stronger left-bloc cohesion
// than a symmetric 72/28 (Labour took 56.2% of transfers against a
// right-leaning eliminated pool). Centre 0.74, sd 0.12. 50/50 when no bloc
// signal (independents, minor parties, Restore Britain under "Other").
const SAME_BLOC_SPLIT = { mu: 0.74, sd: 0.12 };

function svRunoffDraw(shares, gauss, clamp01) {
  const ranked = PARTIES.map((k) => [k, shares[k] || 0]).sort((a, b) => b[1] - a[1]);
  const [f1, f2] = [ranked[0], ranked[1]];
  let v1 = f1[1], v2 = f2[1];
  for (const [party, share] of ranked.slice(2)) {
    if (share <= 0) continue;
    const reach = clamp01(TRANSFER_REACH.mu + gauss() * TRANSFER_REACH.sd, TRANSFER_REACH.lo, TRANSFER_REACH.hi);
    const pool = share * reach;
    const b = BLOC[party], b1 = BLOC[f1[0]], b2 = BLOC[f2[0]];
    let toF1 = 0.5;
    if (b !== "none" && b1 !== b2) {
      const same = clamp01(SAME_BLOC_SPLIT.mu + gauss() * SAME_BLOC_SPLIT.sd, 0.5, 0.92);
      toF1 = b === b1 ? same : 1 - same;
    } else {
      toF1 = clamp01(0.5 + gauss() * 0.1, 0.2, 0.8);
    }
    v1 += pool * toF1;
    v2 += pool * (1 - toF1);
  }
  return { finalists: [f1[0], f2[0]], final: [v1, v2], winner: v1 >= v2 ? f1[0] : f2[0] };
}

// ---- Monte Carlo per method -------------------------------------------------
function runMethod(contestSlug, methodId, central, sigmaPp) {
  const rand = mulberry32(hashSeed(`${contestSlug}:${methodId}:20270506`));
  const gauss = gaussFactory(rand);
  const clamp01 = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

  const winCount = {}, runoffCount = {}, pairCount = {};
  const shareDraws = Object.fromEntries(PARTIES.map((k) => [k, []]));
  const finalSplits = {};

  for (let i = 0; i < DRAWS; i++) {
    const drawn = {};
    for (const k of PARTIES) drawn[k] = Math.max(0, (central[k] || 0) + gauss() * sigmaPp);
    const shares = normalise(drawn);
    for (const k of PARTIES) shareDraws[k].push(shares[k]);
    const { finalists, final, winner } = svRunoffDraw(shares, gauss, clamp01);
    winCount[winner] = (winCount[winner] || 0) + 1;
    for (const f of finalists) runoffCount[f] = (runoffCount[f] || 0) + 1;
    const pairKey = [...finalists].sort().join(" v ");
    pairCount[pairKey] = (pairCount[pairKey] || 0) + 1;
    const total = final[0] + final[1];
    if (!finalSplits[pairKey]) finalSplits[pairKey] = {};
    for (let j = 0; j < 2; j++) {
      if (!finalSplits[pairKey][finalists[j]]) finalSplits[pairKey][finalists[j]] = [];
      finalSplits[pairKey][finalists[j]].push(final[j] / total);
    }
  }

  const bands = {};
  for (const k of PARTIES) {
    const sorted = shareDraws[k].sort((a, b) => a - b);
    bands[k] = {
      central: Number((central[k] || 0).toFixed(4)),
      p10: Number(quantile(sorted, 0.1).toFixed(4)),
      p90: Number(quantile(sorted, 0.9).toFixed(4)),
      p_reach_runoff: Number(((runoffCount[k] || 0) / DRAWS).toFixed(3)),
      p_win: Number(((winCount[k] || 0) / DRAWS).toFixed(3)),
    };
  }
  const modalPair = Object.entries(pairCount).sort((a, b) => b[1] - a[1])[0];
  const modalSplit = {};
  if (modalPair) {
    for (const [party, arr] of Object.entries(finalSplits[modalPair[0]])) {
      const s = arr.sort((a, b) => a - b);
      modalSplit[party] = Number(quantile(s, 0.5).toFixed(3));
    }
  }
  return {
    parties: bands,
    modal_runoff: modalPair ? { pair: modalPair[0], probability: Number((modalPair[1] / DRAWS).toFixed(3)), median_final_split: modalSplit } : null,
  };
}

// ---- main -------------------------------------------------------------------
const registry = readJson("data/contests/mayoral.json");
const pcons = readJson("data/identity/pcons-ge-next.json").pcons.filter((x) => x.country === "england");
const crosswalkRows = readJson("data/ons-pcon24-lad25-postcode-crosswalk.json").rows;
const national = latestNational();

const contests = [];
for (const contest of registry.contests_2027) {
  if (contest.status === "concluded") continue; // self-guard: never re-forecast a past contest

  const ge = buildGeBase(contest, pcons, crosswalkRows);
  const methods = [];

  // Method 1: GE2024 base + uniform national swing.
  const geCentral = applySwing(ge.shares, GE2024_NATIONAL, national.shares);
  methods.push({
    id: "ge_swing_2024",
    label: "GE2024 base + national swing",
    description: `General election 2024 results across the ${contest.constituent_councils.map((c) => c.name).join(", ")} area (${ge.pcon_count} constituencies apportioned by live postcode share), moved by the uniform national swing between GE2024 and the latest Westminster poll average (${national.label}). No local dampening applied; mayoral contests routinely deviate from national swing, which the bands reflect.`,
    base: { shares: ge.shares, source: "GE2024 constituency results (DC), ONS postcode crosswalk", weighted_votes: ge.weighted_votes },
    ...runMethod(contest.slug, "ge_swing_2024", geCentral, contest.first_election ? 0.065 : 0.06),
  });

  // Method 2: the mayoralty's own previous result + national swing since.
  if (contest.prior_result && contest.prior_result.candidates) {
    const acc = {};
    for (const cand of contest.prior_result.candidates) {
      const k = canonParty(cand.party);
      acc[k] = (acc[k] || 0) + cand.votes;
    }
    const prior = normalise(acc);
    const priorCentral = applyProportionalSwing(prior, MAY_2023_NATIONAL, national.shares);
    methods.push({
      id: "prior_swing",
      label: `${contest.prior_result.year} mayoral result + proportional swing`,
      description: `The mayoralty's own ${contest.prior_result.year} first-preference result, with each party moved by the ratio of its national polling now (${national.label}) to its approximate May 2023 level, clamped at x2.5. Parties that did not stand in ${contest.prior_result.year} but poll above 5% nationally enter at 60% of their national number. Independent votes are carried at their prior level, which only holds if comparable independents stand again. This method carries the incumbency and local-machine signal the GE method misses.`,
      base: { shares: prior, source: contest.prior_result.source_url, year: contest.prior_result.year },
      ...runMethod(contest.slug, "prior_swing", priorCentral, 0.07),
    });
  }

  // Winner-call discipline (Makerfield rule): if methods disagree on the most
  // likely winner, the contest is reported as method-split, never blended.
  const leaders = methods.map((m) => Object.entries(m.parties).sort((a, b) => b[1].p_win - a[1].p_win)[0][0]);
  const methodsAgree = leaders.every((x) => x === leaders[0]);

  contests.push({
    slug: contest.slug,
    label: contest.label,
    authority: contest.authority,
    election_date: contest.election_date,
    status: contest.status,
    status_note: contest.status_note,
    first_election: contest.first_election,
    incumbent: contest.incumbent,
    voting_system: contest.voting_system,
    constituent_councils: contest.constituent_councils,
    declared_candidates_note: contest.declared_candidates_note || null,
    methods_agree_on_leader: methodsAgree,
    consensus_leader: methodsAgree ? leaders[0] : null,
    method_leaders: leaders,
    methods,
    sources: contest.sources,
  });
}

// ---- validation: ge_swing_2024 backtested on the GM 2026 by-election --------
// The one supplementary vote contest since the system was restored. We project
// it exactly as the method would have, and publish the error honestly.
const GM_LADS = ["E08000001", "E08000002", "E08000003", "E08000004", "E08000005", "E08000006", "E08000007", "E08000008", "E08000009", "E08000010"];
function gmValidation() {
  const cal = registry.sv_calibration && registry.sv_calibration.gm_2026_byelection;
  if (!cal) return null;
  const fake = { constituent_councils: GM_LADS.map((cd) => ({ name: cd, lad25cd: cd })) };
  const ge = buildGeBase(fake, pcons, crosswalkRows);
  const projected = applySwing(ge.shares, GE2024_NATIONAL, national.shares);
  const actualAcc = {};
  let totalFp = 0;
  for (const cand of cal.first_round) {
    actualAcc[canonParty(cand.party)] = (actualAcc[canonParty(cand.party)] || 0) + cand.votes;
    totalFp += cand.votes;
  }
  const actual = normalise(actualAcc);
  const errors = {};
  let mae = 0, n = 0;
  for (const k of PARTIES) {
    const e = (projected[k] || 0) - (actual[k] || 0);
    errors[k] = Number(e.toFixed(4));
    if ((projected[k] || 0) > 0.01 || (actual[k] || 0) > 0.01) { mae += Math.abs(e); n += 1; }
  }
  const projWinner = Object.entries(projected).sort((a, b) => b[1] - a[1])[0][0];
  const actWinner = Object.entries(actual).sort((a, b) => b[1] - a[1])[0][0];
  return {
    contest: "Greater Manchester mayoral by-election, 30 July 2026",
    method: "ge_swing_2024",
    projected_first_pref: Object.fromEntries(PARTIES.map((k) => [k, Number((projected[k] || 0).toFixed(4))])),
    actual_first_pref: Object.fromEntries(PARTIES.map((k) => [k, Number((actual[k] || 0).toFixed(4))])),
    errors_pp: errors,
    mae_pp: Number(((mae / Math.max(1, n)) * 100).toFixed(1)),
    winner_called: projWinner === actWinner,
    note: "The method called the Labour winner correctly but understated Labour's first round by a wide margin: a well known incumbent-adjacent candidate on a 25% turnout beat her party's national baseline decisively. That gap is exactly the candidate effect these projections cannot see before nominations, and it is why the bands are wide and the prior_swing method exists.",
    source_url: cal.source_url,
  };
}
const validation = gmValidation();

const out = {
  snapshot: {
    generated_at: new Date().toISOString(),
    model_version: "ukelections.mayoral.v1.0.0",
    election_target: "May 2027 mayoral elections (supplementary vote)",
    monte_carlo_draws: DRAWS,
    national_polling: { shares: national.shares, label: national.label, source_url: national.source_url },
    voting_system_note: registry.snapshot.voting_system_note,
    method_note: "Methods are reported separately and are never blended into a single point estimate. Where methods disagree on the most likely winner the contest is reported as method-split. Party-level projections only until nominations close; candidate effects in mayoral contests are large and the bands are wide by design.",
    caveats: [
      "Projections are party level. Mayoral contests have strong candidate effects (independents and well known local figures routinely beat party baselines) which cannot be modelled before nominations close.",
      "The supplementary vote transfer model is calibrated on a thin base: one Reform era SV contest (Greater Manchester, 30 July 2026) plus the pre-2022 SV era. Transfer parameters carry deliberately wide noise.",
      "The GE swing method applies uniform national swing to a general election base; local and mayoral elections routinely deviate from national swing (differential turnout, local parties, incumbency).",
      "Mansfield is forecast subject to its caveat: Nottinghamshire reorganisation may abolish the post, and the contest should be re-verified when nominations open.",
      "No constituency level polling exists for any May 2027 mayoral contest as of generation; the first published poll for a contest supersedes these baselines (wire it in, per the Makerfield lesson).",
    ],
    registry_sources: registry.snapshot.sources,
  },
  contests,
  validation,
  watchlist: registry.watchlist,
  roster_2028: registry.roster_2028,
  sv_calibration: registry.sv_calibration,
};

mkdirSync(p("data/predictions/mayoral"), { recursive: true });
writeFileSync(p("data/predictions/mayoral/forecast.json"), JSON.stringify(out, null, 2) + "\n");

console.log(`Wrote data/predictions/mayoral/forecast.json`);
for (const c of contests) {
  const m0 = c.methods[0];
  const top = Object.entries(m0.parties).sort((a, b) => b[1].p_win - a[1].p_win).slice(0, 3);
  console.log(`  ${c.label}: ${c.methods.length} method(s); ge_swing top: ${top.map(([k, v]) => `${k} ${(v.p_win * 100).toFixed(0)}%`).join(", ")}${c.methods_agree_on_leader ? "" : "  [METHOD SPLIT]"}`);
}
