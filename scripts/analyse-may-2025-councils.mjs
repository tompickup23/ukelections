#!/usr/bin/env node
/**
 * analyse-may-2025-councils.mjs — comprehensive review of the 1 May 2025
 * council results across all 23 county-shaped local elections (excludes
 * the 6 mayoral/combined-authority contests).
 *
 * Outputs:
 *   data/predictions/historical/may-2025-council-analysis.json
 *
 * For each council:
 *   - Aggregate vote share by party (Reform / Lab / Con / LD / Green / Ind)
 *   - Wards/divisions contested, won by each party
 *   - LA-level demographics (population-weighted from constituent LADs)
 *   - Reform-vs-Con swing (the dominant 2025 dynamic, since 2021 winners
 *     were overwhelmingly Conservative in the shires)
 *
 * Cross-cutting:
 *   - National Reform vote share + win-rate
 *   - Single-predictor Pearson correlations: Reform share ~ IMD,
 *     white_british %, asian %, district size
 *   - Multiple regression: Reform share ~ IMD + white_british + asian
 *   - Identify standout over- and under-performers by residual
 *   - Regional breakdown
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const readJson = (rel) =>
  JSON.parse(readFileSync(path.join(ROOT, rel), "utf8"));

// ---------------------------------------------------------------------------
// Council → constituent LAD24 mapping for the 23 local-tier 2025 elections
// (UAs are 1-to-1; county councils are 1-to-many).
// Source: ONS LAD24 register, May 2024 boundaries.
// ---------------------------------------------------------------------------
const COUNCILS = [
  // ---- Unitary authorities (single LAD) ----
  { slug: "buckinghamshire", name: "Buckinghamshire", type: "UA", region: "South East", lads: ["E06000060"] },
  { slug: "cornwall", name: "Cornwall", type: "UA", region: "South West", lads: ["E06000052"] },
  { slug: "county-durham", name: "County Durham", type: "UA", region: "North East", lads: ["E06000047"] },
  { slug: "isles-of-scilly", name: "Isles of Scilly", type: "UA", region: "South West", lads: ["E06000053"] },
  { slug: "north-northamptonshire", name: "North Northamptonshire", type: "UA", region: "East Midlands", lads: ["E06000061"] },
  { slug: "north-tyneside", name: "North Tyneside (council)", type: "UA", region: "North East", lads: ["E08000022"] },
  { slug: "northumberland", name: "Northumberland", type: "UA", region: "North East", lads: ["E06000057"] },
  { slug: "shropshire", name: "Shropshire", type: "UA", region: "West Midlands", lads: ["E06000051"] },
  { slug: "west-northamptonshire", name: "West Northamptonshire", type: "UA", region: "East Midlands", lads: ["E06000062"] },
  { slug: "wiltshire", name: "Wiltshire", type: "UA", region: "South West", lads: ["E06000054"] },
  { slug: "doncaster", name: "Doncaster", type: "UA", region: "Yorkshire & Humber", lads: ["E08000017"] },

  // ---- County councils (multi-district) ----
  { slug: "cambridgeshire", name: "Cambridgeshire CC", type: "CC", region: "East", lads: ["E07000008", "E07000009", "E07000010", "E07000011", "E07000012"] },
  { slug: "derbyshire", name: "Derbyshire CC", type: "CC", region: "East Midlands", lads: ["E07000032", "E07000033", "E07000034", "E07000035", "E07000036", "E07000037", "E07000038", "E07000039"] },
  { slug: "devon", name: "Devon CC", type: "CC", region: "South West", lads: ["E07000040", "E07000041", "E07000042", "E07000043", "E07000044", "E07000045", "E07000046", "E07000047"] },
  { slug: "gloucestershire", name: "Gloucestershire CC", type: "CC", region: "South West", lads: ["E07000078", "E07000079", "E07000080", "E07000081", "E07000082", "E07000083"] },
  { slug: "hertfordshire", name: "Hertfordshire CC", type: "CC", region: "East", lads: ["E07000095", "E07000096", "E07000098", "E07000099", "E07000102", "E07000103", "E07000240", "E07000242", "E07000243", "E07000241"] },
  { slug: "kent", name: "Kent CC", type: "CC", region: "South East", lads: ["E07000105", "E07000106", "E07000107", "E07000108", "E07000109", "E07000110", "E07000111", "E07000112", "E07000113", "E07000114", "E07000115", "E07000116"] },
  { slug: "lancashire", name: "Lancashire CC", type: "CC", region: "North West", lads: ["E07000117", "E07000118", "E07000119", "E07000120", "E07000121", "E07000122", "E07000123", "E07000124", "E07000125", "E07000126", "E07000127", "E07000128"] },
  { slug: "leicestershire", name: "Leicestershire CC", type: "CC", region: "East Midlands", lads: ["E07000129", "E07000130", "E07000131", "E07000132", "E07000133", "E07000134", "E07000135"] },
  { slug: "lincolnshire", name: "Lincolnshire CC", type: "CC", region: "East Midlands", lads: ["E07000136", "E07000137", "E07000138", "E07000139", "E07000140", "E07000141", "E07000142"] },
  { slug: "nottinghamshire", name: "Nottinghamshire CC", type: "CC", region: "East Midlands", lads: ["E07000170", "E07000171", "E07000172", "E07000173", "E07000174", "E07000175", "E07000176"] },
  { slug: "oxfordshire", name: "Oxfordshire CC", type: "CC", region: "South East", lads: ["E07000177", "E07000178", "E07000179", "E07000180", "E07000181"] },
  { slug: "staffordshire", name: "Staffordshire CC", type: "CC", region: "West Midlands", lads: ["E07000192", "E07000193", "E07000194", "E07000195", "E07000196", "E07000197", "E07000198", "E07000199"] },
  { slug: "warwickshire", name: "Warwickshire CC", type: "CC", region: "West Midlands", lads: ["E07000218", "E07000219", "E07000220", "E07000221", "E07000222"] },
  { slug: "worcestershire", name: "Worcestershire CC", type: "CC", region: "West Midlands", lads: ["E07000234", "E07000235", "E07000236", "E07000237", "E07000238", "E07000239"] },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const round = (n, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

function canonParty(name) {
  if (!name) return "Other";
  const n = name.toLowerCase();
  if (n.includes("labour")) return "Labour";
  if (n.includes("conservative")) return "Conservative";
  if (n.includes("reform")) return "Reform UK";
  if (n.includes("green")) return "Green Party";
  if (n.includes("liberal democrat") || n.includes("lib dem")) return "Liberal Democrats";
  if (n.includes("plaid")) return "Plaid Cymru";
  if (n.includes("independent")) return "Independent";
  if (n.includes("rejoin") || n.includes("trade union") || n.includes("workers party")) return "Other left";
  if (n.includes("reclaim") || n.includes("ukip") || n.includes("english democrat") || n.includes("heritage")) return "Other right";
  if (n.includes("yorkshire") || n.includes("mebyon kernow") || n.includes("local") || n.includes("residents")) return "Local";
  return "Other";
}

function olsCoefficients(y, X) {
  const N = X.length;
  const K = X[0].length;
  const XtX = Array.from({ length: K }, () => Array(K).fill(0));
  const Xty = Array(K).fill(0);
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < K; j++) {
      Xty[j] += X[i][j] * y[i];
      for (let k = 0; k < K; k++) {
        XtX[j][k] += X[i][j] * X[i][k];
      }
    }
  }
  const A = XtX.map((row, i) => [...row, Xty[i]]);
  for (let i = 0; i < K; i++) {
    let pivot = A[i][i];
    if (Math.abs(pivot) < 1e-12) { A[i][i] += 1e-9; pivot = A[i][i]; }
    for (let j = i; j <= K; j++) A[i][j] /= pivot;
    for (let r = 0; r < K; r++) {
      if (r === i) continue;
      const factor = A[r][i];
      for (let j = i; j <= K; j++) A[r][j] -= factor * A[i][j];
    }
  }
  return A.map((row) => row[K]);
}

function r2(y, yhat) {
  const ymean = y.reduce((a, b) => a + b, 0) / y.length;
  const ssTot = y.reduce((a, v) => a + (v - ymean) ** 2, 0);
  const ssRes = y.reduce((a, v, i) => a + (v - yhat[i]) ** 2, 0);
  return ssTot === 0 ? 1 : 1 - ssRes / ssTot;
}

function pearson(x, y) {
  const n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (x[i] - mx) * (y[i] - my);
    dx += (x[i] - mx) ** 2;
    dy += (y[i] - my) ** 2;
  }
  return Math.sqrt(dx * dy) === 0 ? 0 : num / Math.sqrt(dx * dy);
}

// ---------------------------------------------------------------------------
// Layer 1 — per-council results aggregation
// ---------------------------------------------------------------------------
function buildCouncilResults() {
  const history = readJson("data/history/dc-historic-results.json");
  const may2025 = history.results.filter(
    (r) => r.election_date === "2025-05-01" && !r.is_by_election && r.tier === "local",
  );

  const byCouncil = {};
  for (const r of may2025) {
    if (!byCouncil[r.council_slug]) byCouncil[r.council_slug] = [];
    byCouncil[r.council_slug].push(r);
  }

  return COUNCILS.map((c) => {
    const divisions = byCouncil[c.slug] || [];
    if (divisions.length === 0) {
      return { ...c, error: "no_2025_results", divisions: 0 };
    }

    // Aggregate vote share weighted by valid votes in each division
    const partyVotes = {};
    let totalValid = 0;
    let totalElectorate = 0;
    let totalSpoilt = 0;
    const winners = {};

    for (const d of divisions) {
      const validVotes = (d.candidates || []).reduce((a, x) => a + (x.votes || 0), 0);
      totalValid += validVotes;
      totalElectorate += d.electorate || 0;
      totalSpoilt += d.spoilt_ballots || 0;
      for (const cand of d.candidates || []) {
        const p = canonParty(cand.party_name);
        partyVotes[p] = (partyVotes[p] || 0) + (cand.votes || 0);
      }
      // Winner (first elected in single-member; for multi-member take all elected then majority party)
      const elected = (d.candidates || []).filter((x) => x.elected);
      const winnerParty = elected.length
        ? canonParty(elected[0].party_name)
        : null;
      if (winnerParty) {
        winners[winnerParty] = (winners[winnerParty] || 0) + 1;
      }
    }

    const shares = {};
    for (const [p, v] of Object.entries(partyVotes)) {
      shares[p] = totalValid > 0 ? v / totalValid : 0;
    }

    const ranked = Object.entries(winners).sort((a, b) => b[1] - a[1]);
    const totalSeats = Object.values(winners).reduce((a, b) => a + b, 0);
    const largest = ranked[0] || [null, 0];
    const control =
      largest[1] > totalSeats / 2
        ? `${largest[0]} majority`
        : `NOC (${largest[0] || "n/a"} largest, ${largest[1]}/${totalSeats})`;

    return {
      slug: c.slug,
      name: c.name,
      type: c.type,
      region: c.region,
      divisions_contested: divisions.length,
      total_electorate: totalElectorate,
      total_valid_votes: totalValid,
      avg_turnout_pct: totalValid / totalElectorate,
      shares: Object.fromEntries(
        Object.entries(shares).map(([k, v]) => [k, round(v, 4)]),
      ),
      seats_won: winners,
      total_seats: totalSeats,
      control,
      reform_won_pct: round((winners["Reform UK"] || 0) / totalSeats, 3),
    };
  });
}

// ---------------------------------------------------------------------------
// Layer 2 — LA-level demographics, aggregated per council
// ---------------------------------------------------------------------------
function buildCouncilDemographics() {
  const imd = readJson("data/features/la-imd.json").imd;
  const ethnic = readJson("data/features/la-ethnic-projections.json").projections;
  const wardDem = readJson("data/features/ward-demographics-2021.json").wards;

  // Pre-aggregate ward demographics by lad22cd for population + ward-level
  // averages (no_quals %, degree %, retired %).
  const ladAgg = {};
  for (const w of Object.values(wardDem)) {
    if (!w.lad22cd) continue;
    if (!ladAgg[w.lad22cd]) ladAgg[w.lad22cd] = { pop: 0, no_quals_sum: 0, degree_sum: 0, retired_sum: 0, social_rent_sum: 0 };
    const e = ladAgg[w.lad22cd];
    const p = w.total_residents || 0;
    e.pop += p;
    e.no_quals_sum += (w.no_quals_pct || 0) * p;
    e.degree_sum += (w.degree_pct || 0) * p;
    e.retired_sum += (w.retired_pct || 0) * p;
    e.social_rent_sum += (w.social_rented_pct || 0) * p;
  }

  const out = {};
  for (const c of COUNCILS) {
    let pop = 0, imdSum = 0, wbSum = 0, asianSum = 0, blackSum = 0;
    let noQualsSum = 0, degreeSum = 0, retiredSum = 0, socialRentSum = 0;
    const ladDetail = [];
    for (const ladcd of c.lads) {
      const imdRec = imd[ladcd];
      const ethRec = ethnic[ladcd];
      const wardRec = ladAgg[ladcd] || { pop: 0, no_quals_sum: 0, degree_sum: 0, retired_sum: 0, social_rent_sum: 0 };
      const p = wardRec.pop || 1;
      pop += p;
      if (imdRec) imdSum += imdRec.avg_imd_decile * p;
      if (ethRec) {
        wbSum += (ethRec.white_british_pct_projected || 0) * p;
        asianSum += (ethRec.asian_pct_projected || 0) * p;
        blackSum += (ethRec.black_pct_projected || 0) * p;
      }
      noQualsSum += wardRec.no_quals_sum;
      degreeSum += wardRec.degree_sum;
      retiredSum += wardRec.retired_sum;
      socialRentSum += wardRec.social_rent_sum;
      ladDetail.push({
        lad: ladcd,
        name: imdRec?.area_name,
        imd: imdRec?.avg_imd_decile,
        pop: wardRec.pop,
      });
    }

    out[c.slug] = {
      population: pop,
      avg_imd_decile: round(imdSum / pop, 2),
      white_british_pct: round(wbSum / pop, 4),
      asian_pct: round(asianSum / pop, 4),
      black_pct: round(blackSum / pop, 4),
      no_quals_pct: round(noQualsSum / pop, 4),
      degree_pct: round(degreeSum / pop, 4),
      retired_pct: round(retiredSum / pop, 4),
      social_rented_pct: round(socialRentSum / pop, 4),
      lad_count: c.lads.length,
      lad_detail: ladDetail,
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Layer 3 — Regression + indicators
// ---------------------------------------------------------------------------
function buildIndicators(councils, demographics) {
  const usable = councils.filter(
    (c) => !c.error && (c.shares["Reform UK"] || 0) > 0 && demographics[c.slug],
  );

  const reform = usable.map((c) => c.shares["Reform UK"] || 0);
  const features = usable.map((c) => ({
    slug: c.slug,
    imd: demographics[c.slug].avg_imd_decile,
    white_british: demographics[c.slug].white_british_pct,
    asian: demographics[c.slug].asian_pct,
    no_quals: demographics[c.slug].no_quals_pct,
    degree: demographics[c.slug].degree_pct,
    retired: demographics[c.slug].retired_pct,
    social_rent: demographics[c.slug].social_rented_pct,
  }));

  const correlations = {
    imd: pearson(features.map((f) => f.imd), reform),
    white_british: pearson(features.map((f) => f.white_british), reform),
    asian: pearson(features.map((f) => f.asian), reform),
    no_quals: pearson(features.map((f) => f.no_quals), reform),
    degree: pearson(features.map((f) => f.degree), reform),
    retired: pearson(features.map((f) => f.retired), reform),
    social_rent: pearson(features.map((f) => f.social_rent), reform),
  };

  // Multiple regression: Reform ~ intercept + IMD + white_british + asian + no_quals
  const X = features.map((f) => [1, f.imd, f.white_british, f.asian, f.no_quals]);
  const coeffs = olsCoefficients(reform, X);
  const yhat = X.map((row) => row.reduce((a, x, i) => a + x * coeffs[i], 0));
  const residuals = reform.map((r, i) => r - yhat[i]);
  const fitR2 = r2(reform, yhat);

  const fits = usable.map((c, i) => ({
    slug: c.slug,
    name: c.name,
    region: c.region,
    actual_reform: round(reform[i], 3),
    predicted_reform: round(yhat[i], 3),
    residual_pp: round(residuals[i] * 100, 2),
    reform_seats: c.seats_won["Reform UK"] || 0,
    total_seats: c.total_seats,
  }));

  return {
    n_councils: usable.length,
    single_predictor_pearson: Object.fromEntries(
      Object.entries(correlations).map(([k, v]) => [k, round(v, 3)]),
    ),
    multiple_regression: {
      predictors: ["intercept", "imd", "white_british", "asian", "no_quals"],
      coefficients: coeffs.map((c) => round(c, 4)),
      r_squared: round(fitR2, 3),
      council_fits: fits,
    },
  };
}

// ---------------------------------------------------------------------------
// Layer 4 — Regional breakdown
// ---------------------------------------------------------------------------
function buildRegional(councils) {
  const byRegion = {};
  for (const c of councils) {
    if (c.error) continue;
    if (!byRegion[c.region]) byRegion[c.region] = [];
    byRegion[c.region].push(c);
  }
  return Object.fromEntries(
    Object.entries(byRegion).map(([region, list]) => {
      const totalSeats = list.reduce((a, c) => a + c.total_seats, 0);
      const reformSeats = list.reduce((a, c) => a + (c.seats_won["Reform UK"] || 0), 0);
      const totalValid = list.reduce((a, c) => a + c.total_valid_votes, 0);
      const reformVotes = list.reduce(
        (a, c) => a + (c.shares["Reform UK"] || 0) * c.total_valid_votes,
        0,
      );
      const labVotes = list.reduce(
        (a, c) => a + (c.shares["Labour"] || 0) * c.total_valid_votes,
        0,
      );
      const conVotes = list.reduce(
        (a, c) => a + (c.shares["Conservative"] || 0) * c.total_valid_votes,
        0,
      );
      return [
        region,
        {
          councils: list.length,
          council_slugs: list.map((c) => c.slug),
          total_seats: totalSeats,
          reform_seats: reformSeats,
          reform_seat_pct: round(reformSeats / totalSeats, 3),
          reform_vote_pct: round(reformVotes / totalValid, 3),
          labour_vote_pct: round(labVotes / totalValid, 3),
          conservative_vote_pct: round(conVotes / totalValid, 3),
        },
      ];
    }),
  );
}

// ---------------------------------------------------------------------------
// Layer 5 — National rollup + narrative findings
// ---------------------------------------------------------------------------
function buildNational(councils, indicators) {
  const usable = councils.filter((c) => !c.error);
  const totalValid = usable.reduce((a, c) => a + c.total_valid_votes, 0);
  const partySums = {};
  for (const c of usable) {
    for (const [p, s] of Object.entries(c.shares)) {
      partySums[p] = (partySums[p] || 0) + s * c.total_valid_votes;
    }
  }
  const nationalShares = Object.fromEntries(
    Object.entries(partySums).map(([k, v]) => [k, round(v / totalValid, 4)]),
  );

  const totalSeats = usable.reduce((a, c) => a + c.total_seats, 0);
  const seatSums = {};
  for (const c of usable) {
    for (const [p, n] of Object.entries(c.seats_won)) {
      seatSums[p] = (seatSums[p] || 0) + n;
    }
  }
  const seatShares = Object.fromEntries(
    Object.entries(seatSums).map(([k, v]) => [k, round(v / totalSeats, 3)]),
  );

  const reformMajorities = usable.filter(
    (c) => (c.seats_won["Reform UK"] || 0) > c.total_seats / 2,
  );

  const overperformers = [...indicators.multiple_regression.council_fits]
    .sort((a, b) => b.residual_pp - a.residual_pp)
    .slice(0, 3);
  const underperformers = [...indicators.multiple_regression.council_fits]
    .sort((a, b) => a.residual_pp - b.residual_pp)
    .slice(0, 3);

  return {
    councils_analysed: usable.length,
    total_seats_contested: totalSeats,
    total_valid_votes: totalValid,
    national_vote_shares: nationalShares,
    national_seat_shares: seatShares,
    seats_by_party: seatSums,
    reform_majority_councils: reformMajorities.map((c) => ({
      slug: c.slug,
      name: c.name,
      reform_seats: c.seats_won["Reform UK"],
      total_seats: c.total_seats,
      reform_vote_pct: c.shares["Reform UK"],
    })),
    reform_overperformers_vs_demographics: overperformers,
    reform_underperformers_vs_demographics: underperformers,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const councils = buildCouncilResults();
  const demographics = buildCouncilDemographics();
  const enriched = councils.map((c) => ({
    ...c,
    demographics: demographics[c.slug] || null,
  }));
  const indicators = buildIndicators(councils, demographics);
  const regional = buildRegional(councils);
  const national = buildNational(councils, indicators);

  const out = {
    schema_version: "1.0.0",
    generated_at: new Date().toISOString(),
    election_date: "2025-05-01",
    councils: enriched,
    regional,
    indicators,
    national,
  };

  const outDir = path.join(ROOT, "data/predictions/historical");
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "may-2025-council-analysis.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");

  console.log(`Wrote ${outPath}`);
  console.log(`  councils analysed: ${national.councils_analysed}/29 (excluding 6 mayoral)`);
  console.log(`  total seats contested: ${national.total_seats_contested}`);
  console.log(`  national Reform vote: ${(national.national_vote_shares["Reform UK"] * 100).toFixed(1)}%`);
  console.log(`  national Reform seats: ${national.seats_by_party["Reform UK"]} (${(national.national_seat_shares["Reform UK"] * 100).toFixed(1)}%)`);
  console.log(`  Reform majorities: ${national.reform_majority_councils.length}`);
  console.log(`  regression R² (IMD + WB + Asian + no-quals): ${indicators.multiple_regression.r_squared}`);
  const top = Object.entries(indicators.single_predictor_pearson)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
  console.log(`  top single predictor: ${top[0]} (r=${top[1]})`);
}

main();
