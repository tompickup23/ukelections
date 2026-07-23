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
const districtRecency = {};
for (const d of LANCS_DISTRICTS) {
  const lcc = sharesFromRows(lccRowsByDistrict[d] || []);
  const recentRows = [...(boroughRowsByCouncil[d] || []), ...(byElectionRowsByCouncil[d] || [])];
  const recent = sharesFromRows(recentRows);
  const swing = {};
  for (const party of PARTIES) swing[party] = 0;
  if (lcc && recent && recent.votes >= 1500) {
    for (const party of PARTIES) {
      let s = (recent.shares[party] || 0) - (lcc.shares[party] || 0);
      s = Math.max(-0.15, Math.min(0.15, s)); // clamp extrapolation
      swing[party] = s;
    }
  }
  districtSwing[d] = swing;
  districtRecency[d] = {
    has_borough_2026: !!(boroughRowsByCouncil[d] || []).length,
    by_elections: (byElectionRowsByCouncil[d] || []).map((r) => `${r.ward_slug} ${r.election_date}`),
    recent_votes: recent ? recent.votes : 0,
  };
}

// Blackpool proxy: pool recent Blackpool by-elections (2024+) + GE2024 constituencies.
function blackpoolProxy() {
  const beRows = hist.filter((r) => r.is_by_election && r.council_slug === "blackpool" && r.election_date >= "2024-01-01");
  const geRows = hist.filter((r) => r.tier === "parl" && r.year === 2024 &&
    /parl\.(blackpool-south|blackpool-north-and-fleetwood)\.2024-07-04/.test(r.ballot_paper_id));
  const be = sharesFromRows(beRows);
  const ge = sharesFromRows(geRows);
  // GE understates Reform locally and overstates the majors; weight the recent
  // local by-elections more heavily where they exist.
  if (be && ge) {
    const out = {};
    for (const party of PARTIES) out[party] = 0.55 * be.shares[party] + 0.45 * ge.shares[party];
    return { shares: normaliseShares(out), electorate: 0, provenance: "blackpool by-elections 2024-26 + GE2024" };
  }
  const only = be || ge;
  return { shares: only.shares, electorate: 0, provenance: be ? "blackpool by-elections 2024-26" : "GE2024 proxy" };
}
const bpProxy = blackpoolProxy();

// ---- per-ward base shares ---------------------------------------------------
function wardBase(w) {
  const src = w.source;
  if (src.type === "lcc-division") {
    const base = divisionShares[src.division];
    if (!base) return null;
    const d = crosswalk[src.division];
    const shares = applySwing(base.shares, districtSwing[d] || {});
    const hasSwing = PARTIES.some((party) => Math.abs((districtSwing[d] || {})[party] || 0) > 0.0001);
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
  // blackpool-proxy
  return { shares: bpProxy.shares, quality: "proxy", sigma: 0.11, provenance: bpProxy.provenance };
}

// Build predicted wards for the four-unitary model.
const UA_ID = warding.meta.ua_id_map;
const COUNCIL_SIZE = warding.meta.council_size;
const wardsByUa = {};
for (const w of warding.wards) {
  const base = wardBase(w);
  if (!base) { console.warn(`  ! no base for ${w.ua} / ${w.ward}`); continue; }
  const { first, second } = topTwo(base.shares);
  const ward = {
    ua: w.ua, ua_id: UA_ID[w.ua], district: w.district, ward: w.ward,
    cllrs: w.cllrs, electorate: w.electorate,
    shares: base.shares, winner: first[0], winner_pct: first[1],
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

function simulateUa(uaName) {
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
      for (const party of PARTIES) draw[party] = (w.shares[party] || 0) + shock[w.district][party] + gauss() * SIGMA_WARD;
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

const output = {
  snapshot: {
    generated_at: process.env.SNAPSHOT_AT || "2026-07-22T00:00:00.000Z",
    model_version: "ukelections.lancashire-unitaries.v0.2.0-wardlevel",
    method: "Ward-by-ward forecast against the proposed 4UA warding (107 wards, 313 councillors). Each ward predicted from its LCC 2025 division result (nudged by the district's 2025->2026 borough and by-election swing), the constituent Blackburn 2026 borough wards, or a Blackpool proxy. Seats allocated under first-past-the-post bloc vote: the leading party's slate sweeps a safe ward, but a runner-up within 10 points picks off one seat (two in a near-tied four-seat ward). Seat ranges and majority probabilities from a seeded 2,000-draw Monte Carlo. The rejected 3- and 5-unitary bids have no warding and are shown as district-aggregate vote share only.",
    voting_system: "First-past-the-post. English principal-council elections are FPTP by statute (multi-member wards use the bloc vote); the Elections Act 2022 moved mayors and PCCs to FPTP too. No change is legislated or proposed for the 2027 shadow elections. Confirmed by default via the Structural Change Order rather than by a Lancashire-specific ruling; the order is still subject to Parliamentary approval.",
    election_target: "May 2027 shadow-authority elections",
    monte_carlo_draws: N_SIM,
    total_councillors: warding.meta.total_councillors,
    decision_context: config.meta.process_timeline,
    name_caveat: config.meta.name_caveat,
    sources: config.meta.sources,
    warding_source: warding.meta.source,
    caveats: [
      "The government's decision (16 July 2026) is subject to Parliamentary approval via a Structural Change Order.",
      "Warding is the proposed 4UA scheme, not yet confirmed by the Local Government Boundary Commission; ward names and councillor counts may change.",
      "Seats use first-past-the-post bloc vote: the leading party sweeps a safe ward, and a runner-up within 10 points takes one seat (two in a near-tied four-seat ward). Marginal wards are flagged; their split is where most of the uncertainty sits.",
      "Blackpool has no borough-wide local election in the corpus, so its 11 wards share a proxy pooled from recent Blackpool by-elections and the 2024 general election.",
      "The 3- and 5-unitary options were rejected and have no ward plan, so only their vote share is shown.",
    ],
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
