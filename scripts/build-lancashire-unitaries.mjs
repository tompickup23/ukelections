#!/usr/bin/env node
// build-lancashire-unitaries.mjs
//
// Forecast the political composition of Lancashire's proposed new unitary
// councils (the government-decided 4-unitary model, plus the rejected 3- and
// 5-unitary options for comparison), for the May 2027 shadow-authority
// elections.
//
// Method (electorate-weighted blend of the most recent actual elections):
//   For each of the 14 current areas we resolve a "latest local vote share"
//   from the best available actual results, in this order:
//     - LCC 2025 county divisions (whole-county, captures Reform's May 2025
//       breakthrough) for the 12 two-tier districts, aggregated via the
//       division -> district crosswalk;
//     - May 2026 borough results where the borough voted that cycle;
//     - GE2024 constituency shares as a Reform-era proxy for Blackpool, which
//       is a standalone unitary with no county divisions and no recent locals
//       in the corpus (last all-out 2023).
//   Where both a 2025 county and a 2026 borough signal exist, they are blended
//   50/50 (both recent, both post-Reform-surge). Each area's blended vector is
//   then electorate-weighted into its unitary. Control is projected from the
//   aggregate share; a notional d'Hondt seat split is given as an illustrative
//   proportional guide only (real elections are FPTP; new ward boundaries are
//   not yet drawn by the LGBCE).
//
// Output: data/predictions/lancashire-unitaries/forecast.json
//
// Pure read of committed data files. No network. Deterministic.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const p = (rel) => path.join(ROOT, rel);
const readJson = (rel) => JSON.parse(readFileSync(p(rel), "utf8"));

const PARTIES = ["Reform UK", "Labour", "Conservative", "Liberal Democrats", "Green Party", "Independent", "Other"];

// Full registered electorate for the two standalone unitaries, which have no
// LCC county divisions to sum (Blackpool has no recent local in the corpus;
// Blackburn votes in thirds so a single cycle undercounts it). Approx ONS
// register figures, used only as electorate weights within a unitary.
// Two-tier districts derive their full electorate from LCC 2025 division sums.
const UNITARY_ELECTORATE = {
  "blackburn-with-darwen": 104600,
  "blackpool": 105000,
};

// Canonicalise Democracy Club / declared-result party names to our fixed set.
function canonParty(name) {
  if (!name) return "Other";
  const s = String(name).trim();
  if (/^Labour( Party)?$/i.test(s)) return "Labour";
  if (/^Labour and Co-operative Party$/i.test(s)) return "Labour";
  if (/^Conservative( and Unionist Party)?$/i.test(s)) return "Conservative";
  if (/^Liberal Democrats?$/i.test(s)) return "Liberal Democrats";
  if (/^Reform UK$/i.test(s)) return "Reform UK";
  if (/^(Green Party|Green Party of England and Wales)$/i.test(s)) return "Green Party";
  if (/independent/i.test(s)) return "Independent";
  if (/^(Local Conservatives|Conservatives)$/i.test(s)) return "Conservative";
  return "Other";
}

// Aggregate a set of result rows (each with .candidates[].votes and .electorate)
// into { shares: {party: frac}, votes, electorate }.
function aggregateRows(rows) {
  const partyVotes = {};
  let totalVotes = 0;
  let electorate = 0;
  for (const r of rows) {
    const ballot = (r.candidates || []).reduce((s, c) => s + (c.votes || 0), 0);
    if (ballot <= 0) continue;
    for (const c of r.candidates || []) {
      const party = canonParty(c.party_name);
      partyVotes[party] = (partyVotes[party] || 0) + (c.votes || 0);
    }
    totalVotes += ballot;
    electorate += r.electorate || 0;
  }
  if (totalVotes <= 0) return null;
  const shares = {};
  for (const party of PARTIES) shares[party] = +((partyVotes[party] || 0) / totalVotes).toFixed(4);
  return { shares, votes: totalVotes, electorate };
}

function blendShares(a, b, wa = 0.5) {
  const out = {};
  for (const party of PARTIES) out[party] = +((wa * (a[party] || 0) + (1 - wa) * (b[party] || 0)).toFixed(4));
  return out;
}

function topTwo(shares) {
  const sorted = Object.entries(shares).filter(([party]) => party !== "Other").sort((x, y) => y[1] - x[1]);
  return { first: sorted[0], second: sorted[1] };
}

// d'Hondt over a share map onto a notional council size (proportional guide).
function dhondt(shares, seats) {
  const alloc = {};
  for (const party of Object.keys(shares)) alloc[party] = 0;
  for (let i = 0; i < seats; i += 1) {
    let best = null;
    let bestQ = -1;
    for (const [party, share] of Object.entries(shares)) {
      const q = share / (alloc[party] + 1);
      if (q > bestQ) { bestQ = q; best = party; }
    }
    alloc[best] += 1;
  }
  return alloc;
}

// ---- Load inputs ------------------------------------------------------------
const history = readJson("data/history/dc-historic-results.json");
const may2026 = readJson("data/results/may-2026/local-and-mayor.merged.json");
const config = readJson("data/geography/lancashire-unitaries.json");
const crosswalk = readJson("data/geography/lcc-2025-division-to-district.json").division_to_district;

const results = history.results || [];

// LCC 2025 divisions grouped by district (via crosswalk).
const lccByDistrict = {};
for (const r of results) {
  if (r.year !== 2025 || r.tier !== "local" || r.council_slug !== "lancashire" || r.is_by_election) continue;
  const district = crosswalk[r.ward_slug];
  if (!district) continue;
  (lccByDistrict[district] ||= []).push(r);
}

// May 2026 borough wards grouped by council (from the actual declared results).
const boroughByCouncil = {};
for (const r of may2026.results || []) {
  if (r.tier !== "local" || r.is_by_election) continue;
  (boroughByCouncil[r.council_slug] ||= []).push(r);
}

// Blackpool GE2024 proxy: mean of the two Blackpool-area constituencies.
function blackpoolGe2024() {
  const rows = results.filter((r) =>
    r.tier === "parl" && r.year === 2024 &&
    /parl\.(blackpool-south|blackpool-north-and-fleetwood)\.2024-07-04/.test(r.ballot_paper_id));
  const agg = aggregateRows(rows);
  return agg;
}

// ---- Per-district signal resolution ----------------------------------------
const ALL_AREAS = [
  ...config.meta.current_structure.two_tier_districts,
  ...config.meta.current_structure.existing_unitaries,
];

const districtSignal = {};
for (const area of ALL_AREAS) {
  const lcc = lccByDistrict[area] ? aggregateRows(lccByDistrict[area]) : null;
  const borough = boroughByCouncil[area] ? aggregateRows(boroughByCouncil[area]) : null;

  // Full-district electorate: LCC division sums for two-tier districts, register
  // figures for the two standalone unitaries.
  const fullElectorate = UNITARY_ELECTORATE[area] || (lcc ? lcc.electorate : null);

  let shares, provenance, electorate, quality;
  if (lcc && borough) {
    shares = blendShares(lcc.shares, borough.shares, 0.5);
    provenance = "lcc-2025 + borough-2026 (50/50 blend)";
    electorate = fullElectorate;
    quality = "actual-local";
  } else if (lcc) {
    shares = lcc.shares;
    provenance = "lcc-2025 county divisions";
    electorate = fullElectorate;
    quality = "actual-local";
  } else if (borough) {
    shares = borough.shares;
    provenance = "borough-2026 (unitary)";
    electorate = fullElectorate || borough.electorate;
    quality = "actual-local";
  } else if (area === "blackpool") {
    const ge = blackpoolGe2024();
    shares = ge.shares;
    provenance = "ge2024 constituency proxy (no recent Blackpool local in corpus)";
    electorate = UNITARY_ELECTORATE.blackpool;
    quality = "proxy";
  } else {
    console.warn(`  ! no signal for ${area}`);
    continue;
  }
  districtSignal[area] = { area, shares, provenance, electorate, quality };
}

// ---- Aggregate to unitaries -------------------------------------------------
// Base per-party uncertainty (as a fraction) by unitary signal quality and
// heterogeneity. Wider when any constituent area relies on a proxy signal.
function unitaryUncertainty(members) {
  const hasProxy = members.some((m) => m.quality === "proxy");
  const base = hasProxy ? 0.055 : 0.035;
  // Between-area dispersion in Reform share adds uncertainty.
  const refShares = members.map((m) => m.shares["Reform UK"] || 0);
  const mean = refShares.reduce((s, v) => s + v, 0) / refShares.length;
  const variance = refShares.reduce((s, v) => s + (v - mean) ** 2, 0) / refShares.length;
  return +(base + Math.sqrt(variance) * 0.5).toFixed(4);
}

function projectUnitary(unitary) {
  const members = unitary.districts.map((d) => districtSignal[d]).filter(Boolean);
  const totalElectorate = members.reduce((s, m) => s + (m.electorate || 0), 0) || members.length;

  // Electorate-weighted mean share per party.
  const shares = {};
  for (const party of PARTIES) {
    let acc = 0;
    for (const m of members) acc += (m.shares[party] || 0) * ((m.electorate || 1) / totalElectorate);
    shares[party] = +acc.toFixed(4);
  }
  // Renormalise (rounding drift).
  const sum = Object.values(shares).reduce((s, v) => s + v, 0);
  for (const party of PARTIES) shares[party] = +(shares[party] / sum).toFixed(4);

  const sigma = unitaryUncertainty(members);
  const bands = {};
  for (const party of PARTIES) {
    const s = shares[party];
    bands[party] = {
      pct: s,
      p10: +Math.max(0, s - 1.28 * sigma).toFixed(4),
      p90: +Math.min(1, s + 1.28 * sigma).toFixed(4),
    };
  }

  const { first, second } = topTwo(shares);
  const lead = first[1] - (second ? second[1] : 0);

  // Notional council size: LGBCE draws these later. Use a stated divisor as an
  // illustrative guide, clamped to the range recent new unitaries have landed in.
  const pop = unitary.population || totalElectorate / 0.73;
  const notionalSeats = Math.min(87, Math.max(55, Math.round(pop / 5500)));
  const dhondtShares = {};
  for (const party of PARTIES) if (party !== "Other") dhondtShares[party] = shares[party];
  const seatProjection = dhondt(dhondtShares, notionalSeats);
  const majoritySeats = Math.floor(notionalSeats / 2) + 1;
  const largestSeats = Math.max(...Object.values(seatProjection));
  const largestSeatParty = Object.entries(seatProjection).sort((a, b) => b[1] - a[1])[0][0];

  // Qualitative control call. FPTP winner's-bonus means the largest party
  // typically clears the proportional projection, so we lean the call toward
  // "on course for majority" when the vote lead is strong.
  let controlCall;
  if (first[1] >= 0.40 && lead >= 0.12) controlCall = `${first[0]} on course for a majority`;
  else if (lead >= 0.06) controlCall = `${first[0]} likely largest party, no overall control`;
  else controlCall = "Too close to call, no overall control likely";

  return {
    id: unitary.id,
    name: unitary.name,
    bid_name: unitary.bid_name || unitary.name,
    govt_label: unitary.govt_label || null,
    districts: unitary.districts,
    population: unitary.population || null,
    total_electorate: Math.round(totalElectorate),
    predicted_shares: bands,
    largest_party: first[0],
    lead_pp: +(lead * 100).toFixed(1),
    control_call: controlCall,
    uncertainty_sigma_pp: +(sigma * 100).toFixed(1),
    notional_council_size: notionalSeats,
    seat_projection_dhondt: seatProjection,
    majority_threshold: majoritySeats,
    largest_seat_party: largestSeatParty,
    largest_seat_count: largestSeats,
    member_signals: members.map((m) => ({ area: m.area, provenance: m.provenance, quality: m.quality })),
  };
}

// ---- Build all models -------------------------------------------------------
const output = {
  snapshot: {
    generated_at: process.env.SNAPSHOT_AT || "2026-07-22T00:00:00.000Z",
    model_version: "ukelections.lancashire-unitaries.v0.1.0",
    method: "Electorate-weighted blend of the most recent actual elections (May 2025 LCC county divisions + May 2026 borough where held + GE2024 proxy for Blackpool), aggregated into each proposed unitary. Control projected from aggregate vote share; d'Hondt seat split is an illustrative proportional guide only.",
    election_target: "May 2027 shadow-authority elections",
    decision_context: config.meta.process_timeline,
    name_caveat: config.meta.name_caveat,
    sources: config.meta.sources,
    caveats: [
      "The government's decision (16 July 2026) is subject to Parliamentary approval via a Structural Change Order; not yet legally confirmed.",
      "New unitary ward boundaries have not been drawn by the LGBCE, so exact seat counts cannot be forecast. The d'Hondt figures are an illustrative proportional guide; FPTP will hand the largest party a winner's bonus above that.",
      "Blackpool has no recent local election in the data corpus (last all-out 2023) and no county divisions, so its signal is the weaker GE2024 constituency proxy.",
      "Unitary names are working geographic shorthand only; none are statutory.",
    ],
  },
  models: {},
};

for (const [key, model] of Object.entries(config.models)) {
  output.models[key] = {
    label: model.label,
    short_label: model.short_label,
    status: model.status,
    status_note: model.status_note,
    proposer: model.proposer,
    is_decided: !!model.is_decided,
    unitaries: model.unitaries.map(projectUnitary),
  };
}

// Deterministic hash (excludes generated_at).
const hashPayload = JSON.stringify(output.models);
output.snapshot.sha256 = createHash("sha256").update(hashPayload).digest("hex");

mkdirSync(p("data/predictions/lancashire-unitaries"), { recursive: true });
writeFileSync(p("data/predictions/lancashire-unitaries/forecast.json"), JSON.stringify(output, null, 2));

// ---- Console summary --------------------------------------------------------
console.log(`\nLancashire unitary forecast: ${output.snapshot.model_version}`);
for (const [key, m] of Object.entries(output.models)) {
  console.log(`\n${m.label}${m.is_decided ? "  [GOVERNMENT-DECIDED]" : `  [${m.status}]`}`);
  for (const u of m.unitaries) {
    const ref = (u.predicted_shares["Reform UK"].pct * 100).toFixed(1);
    const lab = (u.predicted_shares["Labour"].pct * 100).toFixed(1);
    console.log(`  ${u.name.padEnd(28)} Ref ${ref}%  Lab ${lab}%  → ${u.control_call}`);
  }
}
console.log(`\nWrote data/predictions/lancashire-unitaries/forecast.json (sha ${output.snapshot.sha256.slice(0, 12)})`);
