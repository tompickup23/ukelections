#!/usr/bin/env node
// build-lancashire-unitaries.mjs
//
// Ward-by-ward forecast of Lancashire's four new unitary councils (the
// government-decided model, 16 July 2026) for the May 2027 shadow-authority
// elections, plus vote-share comparisons for the rejected 3- and 5-unitary
// bids.
//
// The four-unitary model is forecast against its ACTUAL proposed warding
// (data/geography/lancashire-4ua-warding.json: 107 wards, 313 councillors).
// Each proposed ward is predicted from the best-matching real result:
//   - LCC-division wards  -> that division's May 2025 county result, then
//     nudged by the district's 2025->2026 swing (from the May 2026 borough
//     elections and any 2025-26 by-elections in the district);
//   - Blackburn wards     -> aggregate of the constituent May 2026 borough
//     wards (all-out on the new boundaries, so already current);
//   - Blackpool wards     -> a proxy pooled from Blackpool's recent local
//     by-elections and its 2024 general-election shares (no borough-wide
//     local exists in the corpus), applied uniformly.
// Seats are allocated winner-takes-all per (multi-member) ward, and a seeded
// Monte Carlo (2,000 draws, per-ward noise scaled by signal quality) produces
// seat ranges, the majority probability and the no-overall-control probability.
//
// Output: data/predictions/lancashire-unitaries/forecast.json
// Deterministic (seeded PRNG). Pure read of committed data. No network.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const p = (rel) => path.join(ROOT, rel);
const readJson = (rel) => JSON.parse(readFileSync(p(rel), "utf8"));

const PARTIES = ["Reform UK", "Labour", "Conservative", "Liberal Democrats", "Green Party", "Independent", "Other"];
const SEAT_PARTIES = PARTIES.filter((x) => x !== "Other");

// ---- helpers ----------------------------------------------------------------
function canonParty(name) {
  if (!name) return "Other";
  const s = String(name).trim();
  if (/^Labour( Party)?$/i.test(s)) return "Labour";
  if (/^Labour and Co-operative Party$/i.test(s)) return "Labour";
  if (/^Conservative( and Unionist Party)?$/i.test(s)) return "Conservative";
  if (/^(Local Conservatives|Conservatives)$/i.test(s)) return "Conservative";
  if (/^Liberal Democrats?$/i.test(s)) return "Liberal Democrats";
  if (/^Reform UK$/i.test(s)) return "Reform UK";
  if (/^(Green Party|Green Party of England and Wales)$/i.test(s)) return "Green Party";
  if (/independent/i.test(s)) return "Independent";
  return "Other";
}

function sharesFromRows(rows) {
  const pv = {};
  let total = 0;
  let electorate = 0;
  for (const r of rows) {
    const ballot = (r.candidates || []).reduce((s, c) => s + (c.votes || 0), 0);
    if (ballot <= 0) continue;
    for (const c of r.candidates || []) pv[canonParty(c.party_name)] = (pv[canonParty(c.party_name)] || 0) + (c.votes || 0);
    total += ballot;
    electorate += r.electorate || 0;
  }
  if (total <= 0) return null;
  const shares = {};
  for (const party of PARTIES) shares[party] = (pv[party] || 0) / total;
  return { shares, votes: total, electorate };
}

function normaliseShares(s) {
  const sum = PARTIES.reduce((a, party) => a + Math.max(0, s[party] || 0), 0) || 1;
  const out = {};
  for (const party of PARTIES) out[party] = Math.max(0, s[party] || 0) / sum;
  return out;
}

function applySwing(base, swing) {
  const out = {};
  for (const party of PARTIES) out[party] = (base[party] || 0) + (swing[party] || 0);
  return normaliseShares(out);
}

function topTwo(shares) {
  const sorted = Object.entries(shares).sort((a, b) => b[1] - a[1]);
  return { first: sorted[0], second: sorted[1] || ["", 0] };
}

// Seeded PRNG (mulberry32) + Box-Muller normal, so the committed forecast is stable.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20270507);
function gauss() {
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[idx];
}

// ---- load -------------------------------------------------------------------
const history = readJson("data/history/dc-historic-results.json");
const may2026 = readJson("data/results/may-2026/local-and-mayor.merged.json");
const config = readJson("data/geography/lancashire-unitaries.json");
const crosswalk = readJson("data/geography/lcc-2025-division-to-district.json").division_to_district;
const warding = readJson("data/geography/lancashire-4ua-warding.json");
const wardDemographics = readJson("data/features/ward-demographics-2021.json").wards;
const slugToLad = readJson("data/identity/council-slug-to-lad24.json").map;

const hist = history.results || [];
const RECENT_SINCE = "2025-05-02"; // by-elections after the 2025 LCC baseline

// LCC 2025 division shares, keyed by division slug.
const divisionShares = {};
const lccRowsByDistrict = {};
for (const r of hist) {
  if (r.year === 2025 && r.council_slug === "lancashire" && !r.is_by_election) {
    const s = sharesFromRows([r]);
    if (s) divisionShares[r.ward_slug] = s;
    const d = crosswalk[r.ward_slug];
    if (d) (lccRowsByDistrict[d] ||= []).push(r);
  }
}

// May 2026 borough wards, keyed by council + ward.
const boroughRowsByCouncil = {};
const boroughWard = {};
for (const r of may2026.results || []) {
  if (r.tier !== "local" || r.is_by_election) continue;
  (boroughRowsByCouncil[r.council_slug] ||= []).push(r);
  boroughWard[`${r.council_slug}::${r.ward_slug}`] = r;
}

// Recent by-elections (post-2025-baseline) grouped by council.
const byElectionRowsByCouncil = {};
for (const r of hist) {
  if (!r.is_by_election || r.election_date < RECENT_SINCE) continue;
  (byElectionRowsByCouncil[r.council_slug] ||= []).push(r);
}

// District-level 2025->2026 swing (borough + by-elections vs LCC 2025).
const LANCS_DISTRICTS = config.meta.current_structure.two_tier_districts;
const districtSwing = {};
const districtSwingSource = {};
const districtRecency = {};
for (const d of LANCS_DISTRICTS) {
  const lcc = sharesFromRows(lccRowsByDistrict[d] || []);
  const recentRows = [...(boroughRowsByCouncil[d] || []), ...(byElectionRowsByCouncil[d] || [])];
  const recent = sharesFromRows(recentRows);
  const swing = {};
  for (const party of PARTIES) swing[party] = 0;
  // Own swing at ANY volume; how much it counts is decided later by a
  // volume weight, so one small by-election can inform but never dominate.
  const hasOwn = !!(lcc && recent && recent.votes >= 500);
  if (hasOwn) {
    for (const party of PARTIES) {
      let s = (recent.shares[party] || 0) - (lcc.shares[party] || 0);
      s = Math.max(-0.15, Math.min(0.15, s)); // clamp extrapolation
      swing[party] = s;
    }
  }
  districtSwing[d] = swing;
  districtSwingSource[d] = hasOwn ? "observed-2026" : "none";
  districtRecency[d] = {
    has_borough_2026: !!(boroughRowsByCouncil[d] || []).length,
    by_elections: (byElectionRowsByCouncil[d] || []).map((r) => `${r.ward_slug} ${r.election_date}`),
    recent_votes: recent ? recent.votes : 0,
  };
}

// ---- demographic swing borrowing --------------------------------------------
// Districts with no qualifying 2026 signal previously received ZERO swing,
// freezing them at May 2025. Instead, borrow swing from demographically
// similar districts that do have observed 2025->2026 swing: each borrower's
// swing is the similarity-weighted average of the donors' swings (Gaussian
// kernel over standardised Census-2021 district profiles), shrunk toward zero
// because a transferred swing is weaker evidence than an observed one.
const DEMO_FEATURES = [
  "retired_pct", "degree_pct", "no_quals_pct", "social_rented_pct",
  "owned_outright_pct", "private_rented_pct", "white_british_pct",
  "muslim_pct", "uk_born_pct", "avg_imd_decile",
];
const BORROW_SHRINK = 0.7;

// The identity map is incomplete for five Lancashire districts; their ONS
// codes are stable (E07000117..128, alphabetical), so carry a local fallback.
const LANCS_LAD_FALLBACK = {
  burnley: "E07000117", chorley: "E07000118", fylde: "E07000119",
  hyndburn: "E07000120", lancaster: "E07000121", pendle: "E07000122",
  preston: "E07000123", "ribble-valley": "E07000124", rossendale: "E07000125",
  "south-ribble": "E07000126", "west-lancashire": "E07000127", wyre: "E07000128",
};

function districtDemoVector(slug) {
  const lad = (slugToLad[slug] && slugToLad[slug].lad24cd) || LANCS_LAD_FALLBACK[slug];
  if (!lad) return null;
  const rows = Object.values(wardDemographics).filter((w) => w.lad22cd === lad);
  if (!rows.length) return null;
  const vec = {};
  let pop = 0;
  for (const r of rows) pop += r.total_residents || 0;
  for (const f of DEMO_FEATURES) {
    let acc = 0;
    for (const r of rows) acc += (r[f] || 0) * (r.total_residents || 0);
    vec[f] = pop ? acc / pop : 0;
  }
  return vec;
}

const demoVec = {};
for (const d of LANCS_DISTRICTS) demoVec[d] = districtDemoVector(d);

// Standardise features across the districts that have vectors.
const demoZ = {};
{
  const have = LANCS_DISTRICTS.filter((d) => demoVec[d]);
  const mean = {}, sd = {};
  for (const f of DEMO_FEATURES) {
    const vals = have.map((d) => demoVec[d][f]);
    mean[f] = vals.reduce((a, b) => a + b, 0) / vals.length;
    sd[f] = Math.sqrt(vals.reduce((a, b) => a + (b - mean[f]) ** 2, 0) / vals.length) || 1;
  }
  for (const d of have) {
    demoZ[d] = DEMO_FEATURES.map((f) => (demoVec[d][f] - mean[f]) / sd[f]);
  }
}

function demoDistance(a, b) {
  if (!demoZ[a] || !demoZ[b]) return null;
  let s = 0;
  for (let i = 0; i < demoZ[a].length; i += 1) s += (demoZ[a][i] - demoZ[b][i]) ** 2;
  return Math.sqrt(s);
}

function borrowSwing(target, donors, bandwidth, shrink, srcMap = districtSwing) {
  const weights = [];
  for (const d of donors) {
    const dist = demoDistance(target, d);
    if (dist === null) continue;
    weights.push([d, Math.exp(-(dist * dist) / (2 * bandwidth * bandwidth))]);
  }
  const wSum = weights.reduce((a, [, w]) => a + w, 0);
  if (!wSum) return null;
  const swing = {};
  for (const party of PARTIES) {
    let acc = 0;
    for (const [d, w] of weights) acc += (srcMap[d][party] || 0) * w;
    swing[party] = Math.max(-0.15, Math.min(0.15, shrink * (acc / wSum)));
  }
  const top = weights.sort((a, b) => b[1] - a[1]).slice(0, 3).map(([d]) => d);
  return { swing, donors: top };
}

// Donors are districts whose swing comes from a full May 2026 borough
// election (a lone ward by-election can inform its own district a little,
// via the volume weight below, but never teaches other districts).
const donors = LANCS_DISTRICTS.filter(
  (d) => districtRecency[d].has_borough_2026 && districtRecency[d].recent_votes >= 8000 && demoZ[d]);
// Bandwidth: median pairwise donor distance keeps the kernel scale honest.
const pairDists = [];
for (let i = 0; i < donors.length; i += 1)
  for (let j = i + 1; j < donors.length; j += 1) pairDists.push(demoDistance(donors[i], donors[j]));
const BANDWIDTH = pairDists.sort((a, b) => a - b)[Math.floor(pairDists.length / 2)] || 1;

// Shrink chosen empirically: leave-one-out over the donors, grid over lambda,
// pick the lambda that minimises MAE of (lambda x borrowed) vs actual swing.
// If freezing at zero were genuinely better, the grid returns lambda = 0 and
// the model self-honestly stops borrowing.
const LOO_PARTIES = ["Reform UK", "Labour", "Conservative", "Liberal Democrats", "Green Party"];
const looRows = [];
for (const d of donors) {
  const rest = donors.filter((x) => x !== d);
  const borrowed = borrowSwing(d, rest, BANDWIDTH, 1); // unshrunk
  if (!borrowed) continue;
  looRows.push({ district: d, borrowed: borrowed.swing, actual: districtSwing[d] });
}
function looMae(lambda) {
  const errs = [];
  for (const r of looRows)
    for (const party of LOO_PARTIES)
      errs.push(Math.abs(lambda * (r.borrowed[party] || 0) - (r.actual[party] || 0)));
  return errs.reduce((a, b) => a + b, 0) / (errs.length || 1);
}
let LAMBDA = 0, bestMae = Infinity;
for (let l = 0; l <= 1.0001; l += 0.1) {
  const m = looMae(l);
  if (m < bestMae - 1e-9) { bestMae = m; LAMBDA = +l.toFixed(1); }
}

// Final swing per district: volume-weighted blend of its own observed swing
// and the demographic borrow. w = votes/(votes + K): a full borough election
// (~25-40k votes) keeps w near 1; a single by-election (~2k) keeps w near
// 0.15, so it nudges rather than speaks for the district.
const VOTES_K = 10000;
const observedSwing = JSON.parse(JSON.stringify(districtSwing)); // pre-blend snapshot
for (const d of LANCS_DISTRICTS) {
  const ownVotes = districtRecency[d].recent_votes || 0;
  const own = observedSwing[d];
  const hasOwn = districtSwingSource[d] === "observed-2026";
  const borrowed = borrowSwing(d, donors.filter((x) => x !== d), BANDWIDTH, LAMBDA, observedSwing);
  const w = hasOwn ? ownVotes / (ownVotes + VOTES_K) : 0;
  const final = {};
  for (const party of PARTIES) {
    const b = borrowed ? borrowed.swing[party] || 0 : 0;
    final[party] = Math.max(-0.15, Math.min(0.15, w * (own[party] || 0) + (1 - w) * b));
  }
  districtSwing[d] = final;
  districtRecency[d].own_weight = +w.toFixed(2);
  if (w >= 0.5) districtSwingSource[d] = "observed-2026";
  else if (borrowed && w > 0) districtSwingSource[d] = "blended-own-plus-borrowed";
  else if (borrowed) districtSwingSource[d] = "borrowed-demographic";
  else districtSwingSource[d] = hasOwn ? "observed-2026" : "none";
  if (borrowed && w < 0.5) districtRecency[d].borrowed_from = borrowed.donors;
}

const swingValidation = {
  method: "leave-one-out over full-borough-election districts; shrink lambda chosen from the LOO grid",
  lambda: LAMBDA,
  mae_pp: {
    borrowed_at_lambda: +(bestMae * 100).toFixed(2),
    zero_swing_baseline: +(looMae(0) * 100).toFixed(2),
    unshrunk_borrow: +(looMae(1) * 100).toFixed(2),
  },
  per_district: looRows.map((r) => {
    const row = { district: r.district };
    for (const party of ["Reform UK", "Labour", "Conservative"]) {
      row[party] = { actual_pp: +((r.actual[party] || 0) * 100).toFixed(1),
                     borrowed_pp: +((LAMBDA * (r.borrowed[party] || 0)) * 100).toFixed(1) };
    }
    return row;
  }),
};

// Blackpool: the May 2023 all-out borough election, ward by ward (council's
// own declared results, cross-verified against LEAP and Democracy Club),
// plus a borough-wide swing from Blackpool's 2024-26 by-elections measured
// against the same wards' 2023 results and volume-weighted like the district
// swings. The old pooled proxy remains only as a fallback.
const blackpool2023 = readJson("data/results/blackpool-2023.json");
const bp2023ByWard = {};
for (const w of blackpool2023.wards) bp2023ByWard[w.ward] = w;

// Level correction, not a nudge: May 2023 predates Reform UK as a real local
// force in Blackpool (four paper candidates, ~100-170 votes each), so raw 2023
// shares systematically understate today's Reform level and overstate the 2023
// duopoly. Estimate the CURRENT borough-wide level from the 2024-26 by-election
// pool blended with GE2024 (the two Blackpool constituencies), then apply the
// full difference from the 2023 borough-wide result to every ward: 2023 gives
// the geography (which wards lean where), the correction gives the level.
function blackpoolSwing() {
  const beRows = hist.filter((r) => r.is_by_election && r.council_slug === "blackpool" && r.election_date >= "2024-01-01");
  const geRows = hist.filter((r) => r.tier === "parl" && r.year === 2024 &&
    /parl\.(blackpool-south|blackpool-north-and-fleetwood)\.2024-07-04/.test(r.ballot_paper_id));
  const be = sharesFromRows(beRows);
  const ge = sharesFromRows(geRows);
  const base = sharesFromRows(blackpool2023.wards);
  let current = null, note = "";
  if (be && ge) {
    current = {};
    for (const party of PARTIES) current[party] = 0.55 * (be.shares[party] || 0) + 0.45 * (ge.shares[party] || 0);
    note = `level from by-elections 2024-26 (${be.votes} votes) 55% + GE2024 45%`;
  } else if (be || ge) {
    current = (be || ge).shares;
    note = be ? "level from by-elections 2024-26" : "level from GE2024";
  }
  if (!current || !base) return { swing: Object.fromEntries(PARTIES.map((pt) => [pt, 0])), note: "no level correction available" };
  const swing = {};
  for (const party of PARTIES) {
    const s = (current[party] || 0) - (base.shares[party] || 0);
    // Wider clamp than the district swings: this is a known structural
    // realignment (Reform from ~1% to the mid-20s), not extrapolation noise.
    swing[party] = Math.max(-0.3, Math.min(0.3, s));
  }
  return { swing, note };
}
const bpSwing = blackpoolSwing();

function blackpoolProxyFallback() {
  const beRows = hist.filter((r) => r.is_by_election && r.council_slug === "blackpool" && r.election_date >= "2024-01-01");
  const be = sharesFromRows(beRows);
  if (be) return { shares: be.shares, provenance: "blackpool by-elections 2024-26 (fallback)" };
  const all = sharesFromRows(blackpool2023.wards);
  return { shares: all.shares, provenance: "Blackpool 2023 borough-wide (fallback)" };
}
const bpProxy = blackpoolProxyFallback();

// ---- per-ward base shares ---------------------------------------------------
function wardBase(w) {
  const src = w.source;
  if (src.type === "lcc-division") {
    const base = divisionShares[src.division];
    if (!base) return null;
    const d = crosswalk[src.division];
    const shares = applySwing(base.shares, districtSwing[d] || {});
    const source = districtSwingSource[d] || "none";
    if (source === "borrowed-demographic") {
      const from = (districtRecency[d].borrowed_from || []).join(", ");
      // A transferred swing is weaker evidence than an observed one: widen sigma.
      return { shares, quality: "actual-local", sigma: 0.075,
        provenance: `LCC 2025 ${src.division} + demographic-similarity swing (from ${from})` };
    }
    const hasSwing = source === "observed-2026";
    return { shares, quality: "actual-local", sigma: 0.06,
      provenance: `LCC 2025 ${src.division}${hasSwing ? " + 2026 district swing" : ""}` };
  }
  if (src.type === "borough-2026") {
    const rows = src.wards.map((ws) => boroughWard[`blackburn-with-darwen::${ws}`]).filter(Boolean);
    const s = sharesFromRows(rows);
    if (!s) return null;
    return { shares: normaliseShares(s.shares), quality: "actual-local", sigma: 0.05,
      provenance: `Blackburn 2026 borough (${src.wards.join(", ")})` };
  }
  // Blackpool: aggregate the proposed ward's constituent 2023 wards.
  const constituents = w.ward === "Park" ? ["Park"] : w.ward.split(" and ").map((s) => s.trim());
  const rows = constituents.map((name) => bp2023ByWard[name]).filter(Boolean);
  if (rows.length === constituents.length) {
    const s = sharesFromRows(rows);
    if (s) {
      return { shares: applySwing(s.shares, bpSwing.swing), quality: "actual-local", sigma: 0.08,
        provenance: `Blackpool 2023 (${constituents.join(" + ")}) + by-election swing (${bpSwing.note})` };
    }
  }
  return { shares: bpProxy.shares, quality: "proxy", sigma: 0.11, provenance: bpProxy.provenance };
}

// ---- national-drift scenarios ----------------------------------------------
// The central forecast is a last-election model: May 2027 assumed to look like
// Lancashire's 2025-26 votes. National polling has since moved (the change of
// Prime Minister). These scenarios shift every ward by the national movement
// between the spring 2026 baseline (when the local votes were cast) and the
// current polling average, at two strengths, and are shown SEPARATELY, never
// blended into the central call (Makerfield rule):
//   calibrated: dampening 0.10, the 2024-backtest optimum for county districts
//     (data/calibration/regional-dampening.json; a boundary solution, i.e. the
//     backtest wanted the LOWEST tested transfer of national swing to local
//     results - local elections are sticky);
//   stress: dampening 1.0, the full national move as an upper bound.
// Spring 2026 baseline: the model's own April 2026 rolling average constant.
const NATIONAL_BASELINE_SPRING_2026 = {
  "Labour": 0.230, "Conservative": 0.180, "Reform UK": 0.300,
  "Liberal Democrats": 0.130, "Green Party": 0.090,
};
const pollingLatest = readJson("data/polling/latest.json");
const NATIONAL_CURRENT = pollingLatest.sources.uk_westminster.shares;
const NATIONAL_DRIFT = {};
for (const party of PARTIES) {
  const base = NATIONAL_BASELINE_SPRING_2026[party];
  const cur = NATIONAL_CURRENT[party];
  NATIONAL_DRIFT[party] = base !== undefined && cur !== undefined ? cur - base : 0;
}
const DRIFT_SCENARIOS = [
  { key: "calibrated_drift", label: "National drift, calibrated (0.10)", dampening: 0.10 },
  { key: "full_drift_stress", label: "National drift, full (stress bound)", dampening: 1.0 },
];

// Build predicted wards for the four-unitary model.
const UA_ID = warding.meta.ua_id_map;
const COUNCIL_SIZE = warding.meta.council_size;
const wardsByUa = {};
for (const w of warding.wards) {
  const base = wardBase(w);
  if (!base) { console.warn(`  ! no base for ${w.ua} / ${w.ward}`); continue; }
  const { first, second } = topTwo(base.shares);
  const scenarioShares = {};
  for (const sc of DRIFT_SCENARIOS) {
    const scaled = {};
    for (const party of PARTIES) scaled[party] = sc.dampening * (NATIONAL_DRIFT[party] || 0);
    scenarioShares["shares_" + sc.key] = applySwing(base.shares, scaled);
  }
  const ward = {
    ua: w.ua, ua_id: UA_ID[w.ua], district: w.district, ward: w.ward,
    cllrs: w.cllrs, electorate: w.electorate,
    shares: base.shares, ...scenarioShares, winner: first[0], winner_pct: first[1],
    margin_pp: +((first[1] - second[1]) * 100).toFixed(1),
    marginal: (first[1] - second[1]) < 0.10,
    quality: base.quality, sigma: base.sigma, provenance: base.provenance,
  };
  (wardsByUa[w.ua] ||= []).push(ward);
}

// ---- Monte Carlo seat model -------------------------------------------------
// Noise is split into a district-wide shock (wards in a district swing together,
// as they do in real elections) plus a small per-ward idiosyncratic term. This
// correlates a district's wards and, crucially, stops Blackpool's 11 identical
// proxy wards from behaving like 11 independent coin flips.
const N_SIM = 2000;
const SIGMA_WARD = 0.03; // idiosyncratic per-ward
function districtSigma(quality) { return quality === "proxy" ? 0.10 : 0.055; }

// Bloc-vote FPTP seat allocation for a multi-member ward. The leading party's
// slate sweeps a safe ward, but a close runner-up (or strong independent) picks
// off a seat when the gap is small, and both split a near-tie in a big ward.
const SPLIT_CLOSE = 0.10; // runner-up takes one seat within 10pp
const SPLIT_NEAR = 0.03;  // near-tie: runner-up takes two in a 4-seat ward
function allocateWard(shares, n) {
  const ranked = SEAT_PARTIES.map((party) => [party, shares[party] || 0]).sort((a, b) => b[1] - a[1]);
  const p1 = ranked[0][0], p2 = ranked[1][0];
  const gap = ranked[0][1] - ranked[1][1];
  const out = { [p1]: n };
  if (n >= 2 && gap <= SPLIT_CLOSE) {
    let steal = 1;
    if (n >= 4 && gap <= SPLIT_NEAR) steal = 2;
    out[p1] -= steal;
    out[p2] = (out[p2] || 0) + steal;
  }
  return out;
}

function simulateUa(uaName, sharesKey = "shares") {
  const wards = wardsByUa[uaName];
  const size = COUNCIL_SIZE[uaName];
  const majority = Math.floor(size / 2) + 1;
  const districts = [...new Set(wards.map((w) => w.district))];

  const seatDraws = {}; for (const party of SEAT_PARTIES) seatDraws[party] = [];
  const majorityCount = {}; for (const party of SEAT_PARTIES) majorityCount[party] = 0;
  let nocCount = 0;
  const largestCount = {}; for (const party of SEAT_PARTIES) largestCount[party] = 0;
  const seatSum = {}; for (const party of SEAT_PARTIES) seatSum[party] = 0;

  for (let i = 0; i < N_SIM; i += 1) {
    // Shared district shocks this draw.
    const shock = {};
    for (const d of districts) {
      const q = wards.find((w) => w.district === d).quality;
      const sd = districtSigma(q);
      shock[d] = {}; for (const party of PARTIES) shock[d][party] = gauss() * sd;
    }
    const seats = {}; for (const party of SEAT_PARTIES) seats[party] = 0;
    for (const w of wards) {
      const draw = {};
      for (const party of PARTIES) draw[party] = ((w[sharesKey] || w.shares)[party] || 0) + shock[w.district][party] + gauss() * SIGMA_WARD;
      const ns = normaliseShares(draw);
      const alloc = allocateWard(ns, w.cllrs); // bloc-vote FPTP, splits close wards
      for (const [party, n] of Object.entries(alloc)) seats[party] += n;
    }
    for (const party of SEAT_PARTIES) { seatDraws[party].push(seats[party]); seatSum[party] += seats[party]; }
    const ranked = Object.entries(seats).sort((a, b) => b[1] - a[1]);
    largestCount[ranked[0][0]] += 1;
    if (ranked[0][1] >= majority) majorityCount[ranked[0][0]] += 1;
    else nocCount += 1;
  }

  const perParty = {};
  for (const party of SEAT_PARTIES) {
    const sorted = seatDraws[party].slice().sort((a, b) => a - b);
    perParty[party] = {
      expected: Math.round(seatSum[party] / N_SIM),
      p10: quantile(sorted, 0.10), p50: quantile(sorted, 0.50), p90: quantile(sorted, 0.90),
      majority_prob: +(majorityCount[party] / N_SIM).toFixed(3),
      largest_prob: +(largestCount[party] / N_SIM).toFixed(3),
    };
  }
  const nocProb = +(nocCount / N_SIM).toFixed(3);

  // Aggregate vote share (electorate-weighted).
  const totalElec = wards.reduce((s, w) => s + (w.electorate || 0), 0) || wards.length;
  const voteShare = {};
  for (const party of PARTIES) {
    let acc = 0; for (const w of wards) acc += (w.shares[party] || 0) * ((w.electorate || 1) / totalElec);
    voteShare[party] = +acc.toFixed(4);
  }

  // Control call from probabilities.
  const ranked = Object.entries(perParty).sort((a, b) => b[1].expected - a[1].expected);
  const lead = ranked[0][0];
  const leadMajProb = perParty[lead].majority_prob;
  let controlCall;
  if (leadMajProb >= 0.65) controlCall = `${lead} majority likely`;
  else if (leadMajProb >= 0.35) controlCall = `${lead} largest, majority on a knife-edge`;
  else if (perParty[lead].largest_prob >= 0.6) controlCall = `${lead} largest party, no overall control likely`;
  else controlCall = "No overall control, largest party unclear";

  return {
    id: UA_ID[uaName], ua_name: uaName, council_size: size, majority_threshold: majority,
    total_electorate: Math.round(totalElec), ward_count: wards.length,
    vote_share: voteShare, seats: perParty, noc_prob: nocProb,
    largest_party: lead, control_call: controlCall,
    wards: wards.map((w) => {
      const split = allocateWard(w.shares, w.cllrs);
      return {
        ward: w.ward, district: w.district, cllrs: w.cllrs, electorate: w.electorate,
        winner: w.winner === "Other" ? "Independent" : w.winner,
        winner_pct: +(w.winner_pct * 100).toFixed(1), margin_pp: w.margin_pp,
        marginal: w.marginal, quality: w.quality, provenance: w.provenance,
        seat_split: Object.fromEntries(Object.entries(split).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])),
        shares: Object.fromEntries(PARTIES.map((party) => [party, +((w.shares[party] || 0) * 100).toFixed(1)])),
      };
    }),
  };
}

// ---- comparison models (3/5): district-aggregate vote share only ------------
const UNITARY_ELECTORATE = { "blackburn-with-darwen": 104600, "blackpool": 105000 };
function districtBlendShares(area) {
  const lccRows = lccRowsByDistrict[area];
  const lcc = lccRows ? sharesFromRows(lccRows) : null;
  const borough = boroughRowsByCouncil[area] ? sharesFromRows(boroughRowsByCouncil[area]) : null;
  if (area === "blackpool") return { shares: bpProxy.shares, electorate: UNITARY_ELECTORATE.blackpool };
  if (lcc && borough) {
    const out = {}; for (const party of PARTIES) out[party] = 0.5 * lcc.shares[party] + 0.5 * borough.shares[party];
    return { shares: normaliseShares(out), electorate: UNITARY_ELECTORATE[area] || lcc.electorate };
  }
  if (lcc) return { shares: lcc.shares, electorate: UNITARY_ELECTORATE[area] || lcc.electorate };
  if (borough) return { shares: borough.shares, electorate: UNITARY_ELECTORATE[area] || borough.electorate };
  return null;
}
function projectComparisonUnitary(u) {
  const members = u.districts.map((d) => ({ d, ...districtBlendShares(d) })).filter((m) => m.shares);
  const totalElec = members.reduce((s, m) => s + (m.electorate || 0), 0) || members.length;
  const shares = {};
  for (const party of PARTIES) {
    let acc = 0; for (const m of members) acc += (m.shares[party] || 0) * ((m.electorate || 1) / totalElec);
    shares[party] = +acc.toFixed(4);
  }
  const norm = normaliseShares(shares);
  const { first, second } = topTwo(norm);
  const lead = first[1] - second[1];
  let call;
  if (first[1] >= 0.40 && lead >= 0.12) call = `${first[0]} on course to be largest`;
  else if (lead >= 0.06) call = `${first[0]} likely largest party`;
  else call = "Too close to call";
  return { id: u.id, name: u.name, districts: u.districts, population: u.population || null,
    vote_share: Object.fromEntries(PARTIES.map((party) => [party, +norm[party].toFixed(4)])),
    largest_party: first[0], lead_pp: +(lead * 100).toFixed(1), control_call: call };
}

// ---- assemble output --------------------------------------------------------
const fourUnitaryOrder = ["Fylde Coast/West", "North", "Pennine/East", "South"];
const fourModel = config.models["four-unitary"];
const fourUnitaries = fourUnitaryOrder.map((uaName) => {
  const sim = simulateUa(uaName);
  const cfg = fourModel.unitaries.find((x) => x.id === sim.id);
  return { ...sim, name: cfg ? cfg.name : uaName, districts: cfg ? cfg.districts : [], population: cfg ? cfg.population : null };
});

// Scenario runs: same wards, shares shifted by the dampened national drift.
const driftScenarios = DRIFT_SCENARIOS.map((sc) => ({
  key: sc.key,
  label: sc.label,
  dampening: sc.dampening,
  unitaries: fourUnitaryOrder.map((uaName) => {
    const sim = simulateUa(uaName, "shares_" + sc.key);
    const reform = sim.seats["Reform UK"];
    return {
      id: sim.id, ua_name: uaName,
      reform_expected: reform.expected, reform_p10: reform.p10, reform_p90: reform.p90,
      reform_majority_prob: reform.majority_prob,
      labour_expected: sim.seats["Labour"].expected,
      noc_prob: sim.noc_prob, largest_party: sim.largest_party,
    };
  }),
}));

const output = {
  snapshot: {
    generated_at: process.env.SNAPSHOT_AT || "2026-07-22T00:00:00.000Z",
    model_version: "ukelections.lancashire-unitaries.v0.2.0-wardlevel",
    method: "Ward-by-ward forecast against the proposed warding for the four new unitaries (107 wards, 313 councillors; hypothetical, awaiting confirmation through the statutory boundary process). Lancashire County Council's 82 divisions return 84 councillors (Great Harwood, Rishton and Clayton-le-Moors and Pendle Rural each elect two members); division results enter the model as vote shares, so multi-member divisions are handled consistently here and in the mayoral model. Each ward predicted from its LCC 2025 division result (nudged by the district's observed 2025->2026 borough and by-election swing where one exists; districts with no 2026 contest borrow a shrunk swing from demographically similar districts, weighted by a Gaussian kernel over standardised Census 2021 profiles and validated leave-one-out), the constituent Blackburn 2026 borough wards, or a Blackpool proxy. Seats allocated under first-past-the-post bloc vote: the leading party's slate sweeps a safe ward, but a runner-up within 10 points picks off one seat (two in a near-tied four-seat ward). Seat ranges and majority probabilities from a seeded 2,000-draw Monte Carlo. The rejected 3- and 5-unitary bids have no warding and are shown as district-aggregate vote share only.",
    voting_system: "First-past-the-post, confirmed. Elections to English principal councils, including the new unitaries and their May 2027 shadow authorities, are held under first-past-the-post (multi-member wards use the bloc vote). This is set by general law, not just precedent: the English Devolution and Community Empowerment Act 2026, the same Act that creates these unitaries and reformed mayoral and PCC elections (moving them back to the supplementary vote), deliberately left principal-council elections on first-past-the-post. Campaigners pressed for STV in council elections during the Bill's passage; it was not adopted. A directly-elected Lancashire mayor, if one is created for 2027, would be a separate contest under the supplementary vote and does not affect this council seat model.",
    election_target: "May 2027 shadow-authority elections",
    monte_carlo_draws: N_SIM,
    total_councillors: warding.meta.total_councillors,
    decision_context: config.meta.process_timeline,
    name_caveat: config.meta.name_caveat,
    sources: config.meta.sources,
    warding_source: warding.meta.source,
    caveats: [
      "The government's decision (16 July 2026) is subject to Parliamentary approval via a Structural Change Order.",
      "The warding is proposed and hypothetical: it awaits confirmation through the statutory boundary process before the May 2027 elections, and ward names and councillor counts may change.",
      "Seats use first-past-the-post bloc vote: the leading party sweeps a safe ward, and a runner-up within 10 points takes one seat (two in a near-tied four-seat ward). Marginal wards are flagged; their split is where most of the uncertainty sits.",
      "Blackpool wards are built from the May 2023 all-out borough election (council-declared results, cross-verified), aggregated onto the proposed merged wards, with a volume-weighted swing from Blackpool by-elections since. 2023 is the oldest base in the model, so these wards carry wider noise.",
      "The 3- and 5-unitary options were rejected and have no ward plan, so only their vote share is shown.",
      "Three county divisions (Preston Rural, Great Harwood/Rishton/Clayton-le-Moors, Pendle Rural) each feed more than one proposed ward; those sibling wards inherit the same division result, so differences between them within the division are not modelled.",
      "Districts without a May 2026 election carry a borrowed swing from demographically similar districts (shrunk 0.7x, wider ward noise). The leave-one-out error of that transfer, versus freezing those districts at May 2025, is published in data_vintage.swing_validation.",
    ],
    data_vintage: {
      note: "Per-district data recency: which districts have an observed 2025->2026 swing, which borrow one demographically, and the by-elections ingested for each. Wards in borrowed-swing districts carry wider noise in the Monte Carlo.",
      districts: Object.fromEntries(LANCS_DISTRICTS.map((d) => [d, {
        swing_source: districtSwingSource[d] || "none",
        ...districtRecency[d],
      }])),
      swing_validation: swingValidation,
    },
    national_drift: {
      note: "The central forecast assumes May 2027 looks like Lancashire's 2025-26 votes. These scenarios shift every ward by the national polling movement since the spring 2026 baseline, at the backtested 0.10 transfer strength (the 2024 backtest found national swing carries weakly into local results) and at full strength as a stress bound. Shown separately, never blended into the central call.",
      baseline_spring_2026: NATIONAL_BASELINE_SPRING_2026,
      current_average: Object.fromEntries(Object.entries(NATIONAL_CURRENT).filter(([k]) => NATIONAL_BASELINE_SPRING_2026[k] !== undefined)),
      drift_pp: Object.fromEntries(Object.entries(NATIONAL_DRIFT).filter(([, v]) => v !== 0).map(([k, v]) => [k, +(v * 100).toFixed(1)])),
      polling_fieldwork: pollingLatest.sources.uk_westminster.fieldwork_window,
      scenarios: driftScenarios,
    },
  },
  four_unitary: {
    label: fourModel.label,
    status: fourModel.status,
    status_note: fourModel.status_note,
    proposer: fourModel.proposer,
    total_councillors: warding.meta.total_councillors,
    unitaries: fourUnitaries,
  },
  comparison: {},
};

for (const key of ["three-unitary", "five-unitary"]) {
  const m = config.models[key];
  output.comparison[key] = {
    label: m.label, status: m.status, status_note: m.status_note, proposer: m.proposer,
    unitaries: m.unitaries.map(projectComparisonUnitary),
  };
}

output.snapshot.sha256 = createHash("sha256").update(JSON.stringify([output.four_unitary, output.comparison])).digest("hex");

mkdirSync(p("data/predictions/lancashire-unitaries"), { recursive: true });
writeFileSync(p("data/predictions/lancashire-unitaries/forecast.json"), JSON.stringify(output, null, 2));

// ---- console summary --------------------------------------------------------
console.log(`\nLancashire 4-unitary ward-level forecast: ${output.snapshot.model_version} (${N_SIM} draws)`);
for (const u of fourUnitaries) {
  const s = u.seats;
  const ranked = Object.entries(s).sort((a, b) => b[1].expected - a[1].expected).slice(0, 3);
  const seatStr = ranked.map(([party, v]) => `${party.replace(" UK", "")} ${v.expected} (${v.p10}-${v.p90})`).join(", ");
  console.log(`\n${u.name}  [${u.council_size} seats, maj ${u.majority_threshold}]  ${u.control_call}`);
  console.log(`  ${seatStr}`);
  console.log(`  majority prob: ${u.largest_party} ${(u.seats[u.largest_party].majority_prob * 100).toFixed(0)}% · NOC ${(u.noc_prob * 100).toFixed(0)}% · marginal wards: ${u.wards.filter((w) => w.marginal).length}/${u.ward_count}`);
}
console.log(`\nWrote data/predictions/lancashire-unitaries/forecast.json (sha ${output.snapshot.sha256.slice(0, 12)})`);
