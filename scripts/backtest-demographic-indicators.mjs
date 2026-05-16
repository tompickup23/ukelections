#!/usr/bin/env node
/**
 * backtest-demographic-indicators.mjs
 *
 * Tests whether the demographic theories we inferred from 1 May 2025 hold
 * up against the much bigger 1 May 2026 dataset. Two backtests + one
 * per-party signature analysis.
 *
 * Backtest A — coefficient stability:
 *   Run the same regression separately on 2025 (n≈24) and 2026 (n≈156)
 *   council aggregates. Compare coefficients and R². If demographics
 *   genuinely drive vote share, coefficients should be reasonably stable.
 *
 * Backtest B — predictive accuracy:
 *   Use the 2025-trained coefficients to predict each 2026 council's
 *   vote share. Compare to actual. Report MAE per party.
 *
 * Per-party signatures:
 *   Same regression but for Labour, Conservative, Liberal Democrats, Green,
 *   not just Reform. Each party's coefficient pattern is its
 *   "demographic signature".
 *
 * Output:
 *   data/predictions/historical/demographic-indicator-backtest.json
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const readJson = (rel) =>
  JSON.parse(readFileSync(path.join(ROOT, rel), "utf8"));

const PARTIES = ["Reform UK", "Labour", "Conservative", "Liberal Democrats", "Green Party"];
const PREDICTORS = ["imd", "white_british", "asian", "no_quals", "degree", "retired"];

// ---------------------------------------------------------------------------
// Council → constituent LAD24 mapping
// Pulled from 2025 analysis (extended for 2026 LGR-pending shadow councils
// and 2026-only county councils).
// ---------------------------------------------------------------------------
const COUNCIL_LADS = {
  // 2025 unitaries
  buckinghamshire: ["E06000060"], cornwall: ["E06000052"], "county-durham": ["E06000047"],
  "isles-of-scilly": ["E06000053"], "north-northamptonshire": ["E06000061"],
  "north-tyneside": ["E08000022"], northumberland: ["E06000057"], shropshire: ["E06000051"],
  "west-northamptonshire": ["E06000062"], wiltshire: ["E06000054"], doncaster: ["E08000017"],
  // 2025 county councils
  cambridgeshire: ["E07000008","E07000009","E07000010","E07000011","E07000012"],
  derbyshire: ["E07000032","E07000033","E07000034","E07000035","E07000036","E07000037","E07000038","E07000039"],
  devon: ["E07000040","E07000041","E07000042","E07000043","E07000044","E07000045","E07000046","E07000047"],
  gloucestershire: ["E07000078","E07000079","E07000080","E07000081","E07000082","E07000083"],
  hertfordshire: ["E07000095","E07000096","E07000098","E07000099","E07000102","E07000103","E07000240","E07000242","E07000243","E07000241"],
  kent: ["E07000105","E07000106","E07000107","E07000108","E07000109","E07000110","E07000111","E07000112","E07000113","E07000114","E07000115","E07000116"],
  lancashire: ["E07000117","E07000118","E07000119","E07000120","E07000121","E07000122","E07000123","E07000124","E07000125","E07000126","E07000127","E07000128"],
  leicestershire: ["E07000129","E07000130","E07000131","E07000132","E07000133","E07000134","E07000135"],
  lincolnshire: ["E07000136","E07000137","E07000138","E07000139","E07000140","E07000141","E07000142"],
  nottinghamshire: ["E07000170","E07000171","E07000172","E07000173","E07000174","E07000175","E07000176"],
  oxfordshire: ["E07000177","E07000178","E07000179","E07000180","E07000181"],
  staffordshire: ["E07000192","E07000193","E07000194","E07000195","E07000196","E07000197","E07000198","E07000199"],
  warwickshire: ["E07000218","E07000219","E07000220","E07000221","E07000222"],
  worcestershire: ["E07000234","E07000235","E07000236","E07000237","E07000238","E07000239"],
  // 2026 county councils
  hampshire: ["E07000085","E07000086","E07000084","E07000087","E07000088","E07000089","E07000090","E07000091","E07000092","E07000093","E07000094"],
  essex: ["E07000066","E07000067","E07000068","E07000069","E07000070","E07000071","E07000072","E07000073","E07000074","E07000075","E07000076","E07000077"],
  norfolk: ["E07000143","E07000144","E07000145","E07000146","E07000147","E07000148","E07000149"],
  suffolk: ["E07000200","E07000202","E07000244","E07000245"],
  "east-sussex": ["E07000061","E07000062","E07000063","E07000064","E07000065"],
  "west-sussex": ["E07000223","E07000224","E07000225","E07000226","E07000227","E07000228","E07000229"],
  // 2026 LGR-pending Surrey shadow split
  "east-surrey": ["E07000209","E07000210","E07000211","E07000215","E07000216"],
  "west-surrey": ["E07000207","E07000208","E07000212","E07000213","E07000214","E07000217"],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const round = (n, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

function canonParty(name) {
  if (!name) return "Other";
  const n = name.toLowerCase();
  if (n.includes("labour")) return "Labour";
  if (n.includes("conservative")) return "Conservative";
  if (n.includes("reform")) return "Reform UK";
  if (n.includes("green")) return "Green Party";
  if (n.includes("liberal democrat") || n.includes("lib dem")) return "Liberal Democrats";
  if (n.includes("independent")) return "Independent";
  return "Other";
}

function olsCoefficients(y, X) {
  const N = X.length, K = X[0].length;
  const XtX = Array.from({ length: K }, () => Array(K).fill(0));
  const Xty = Array(K).fill(0);
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < K; j++) {
      Xty[j] += X[i][j] * y[i];
      for (let k = 0; k < K; k++) XtX[j][k] += X[i][j] * X[i][k];
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

function mae(y, yhat) {
  return y.reduce((a, v, i) => a + Math.abs(v - yhat[i]), 0) / y.length;
}

// ---------------------------------------------------------------------------
// LA demographics — population-weighted aggregate over a list of LAD24 codes
// ---------------------------------------------------------------------------
let _ladAgg = null;
let _imd = null;
let _ethnic = null;

function loadDemographicsCaches() {
  if (_ladAgg) return;
  _imd = readJson("data/features/la-imd.json").imd;
  _ethnic = readJson("data/features/la-ethnic-projections.json").projections;
  const wardDem = readJson("data/features/ward-demographics-2021.json").wards;
  _ladAgg = {};
  for (const w of Object.values(wardDem)) {
    if (!w.lad22cd) continue;
    if (!_ladAgg[w.lad22cd]) _ladAgg[w.lad22cd] = { pop: 0, no_quals_sum: 0, degree_sum: 0, retired_sum: 0, social_rent_sum: 0 };
    const e = _ladAgg[w.lad22cd];
    const p = w.total_residents || 0;
    e.pop += p;
    e.no_quals_sum += (w.no_quals_pct || 0) * p;
    e.degree_sum += (w.degree_pct || 0) * p;
    e.retired_sum += (w.retired_pct || 0) * p;
    e.social_rent_sum += (w.social_rented_pct || 0) * p;
  }
}

function aggregateDemographicsForLADs(lads) {
  loadDemographicsCaches();
  let pop = 0, imdSum = 0, wbSum = 0, asianSum = 0;
  let noQualsSum = 0, degreeSum = 0, retiredSum = 0;
  for (const ladcd of lads) {
    const wardRec = _ladAgg[ladcd] || { pop: 1, no_quals_sum: 0, degree_sum: 0, retired_sum: 0, social_rent_sum: 0 };
    const p = wardRec.pop || 1;
    pop += p;
    if (_imd[ladcd]) imdSum += _imd[ladcd].avg_imd_decile * p;
    if (_ethnic[ladcd]) {
      wbSum += (_ethnic[ladcd].white_british_pct_projected || 0) * p;
      asianSum += (_ethnic[ladcd].asian_pct_projected || 0) * p;
    }
    noQualsSum += wardRec.no_quals_sum;
    degreeSum += wardRec.degree_sum;
    retiredSum += wardRec.retired_sum;
  }
  if (pop === 0) return null;
  return {
    population: pop,
    imd: round(imdSum / pop, 3),
    white_british: round(wbSum / pop, 4),
    asian: round(asianSum / pop, 4),
    no_quals: round(noQualsSum / pop, 4),
    degree: round(degreeSum / pop, 4),
    retired: round(retiredSum / pop, 4),
  };
}

// ---------------------------------------------------------------------------
// Resolve council slug → LAD list
// ---------------------------------------------------------------------------
let _slugMap = null;
function getSlugMap() {
  if (_slugMap) return _slugMap;
  _slugMap = readJson("data/identity/council-slug-to-lad24.json").map;
  return _slugMap;
}

function ladsForCouncil(slug) {
  if (COUNCIL_LADS[slug]) return COUNCIL_LADS[slug];
  const map = getSlugMap();
  if (map[slug]?.lad24cd) return [map[slug].lad24cd];
  return null;
}

// ---------------------------------------------------------------------------
// Aggregate council vote shares from results array
// ---------------------------------------------------------------------------
function aggregateCouncilShares(results) {
  // Group by council and compute weighted vote shares
  const byCouncil = {};
  for (const r of results) {
    if (!byCouncil[r.council_slug]) byCouncil[r.council_slug] = [];
    byCouncil[r.council_slug].push(r);
  }
  const out = [];
  for (const [slug, divisions] of Object.entries(byCouncil)) {
    const lads = ladsForCouncil(slug);
    if (!lads) continue; // can't map demographics
    const demo = aggregateDemographicsForLADs(lads);
    if (!demo) continue;

    let totalValid = 0;
    const partyVotes = {};
    for (const d of divisions) {
      // Two shapes: results from history have .candidates with .votes,
      // results from 2026 merged have .total_valid_votes + .vote_shares
      if (d.vote_shares) {
        const valid = d.total_valid_votes || 0;
        totalValid += valid;
        for (const [party, share] of Object.entries(d.vote_shares || {})) {
          const canon = canonParty(party) === "Other" ? party : canonParty(party);
          partyVotes[canon] = (partyVotes[canon] || 0) + share * valid;
        }
      } else if (d.candidates) {
        const valid = d.candidates.reduce((a, c) => a + (c.votes || 0), 0);
        totalValid += valid;
        for (const c of d.candidates) {
          const canon = canonParty(c.party_name);
          partyVotes[canon] = (partyVotes[canon] || 0) + (c.votes || 0);
        }
      }
    }
    if (totalValid === 0) continue;
    const shares = {};
    for (const [p, v] of Object.entries(partyVotes)) shares[p] = v / totalValid;
    out.push({
      slug,
      ward_count: divisions.length,
      total_valid_votes: totalValid,
      shares,
      demographics: demo,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Build a regression for one party given a council list
// ---------------------------------------------------------------------------
function regressParty(councils, party) {
  const usable = councils.filter((c) => c.shares[party] != null);
  if (usable.length < 8) return null; // need minimum sample
  const y = usable.map((c) => c.shares[party] || 0);

  // Single-predictor correlations
  const single = {};
  for (const pred of PREDICTORS) {
    single[pred] = round(
      pearson(usable.map((c) => c.demographics[pred]), y),
      3,
    );
  }

  // Multiple regression: intercept + IMD + WB + Asian + no_quals + degree
  const X = usable.map((c) => [
    1, c.demographics.imd, c.demographics.white_british, c.demographics.asian,
    c.demographics.no_quals, c.demographics.degree,
  ]);
  const coeffs = olsCoefficients(y, X);
  const yhat = X.map((row) => row.reduce((a, x, i) => a + x * coeffs[i], 0));
  const fit = r2(y, yhat);

  return {
    n_councils: usable.length,
    mean_share: round(y.reduce((a, b) => a + b, 0) / y.length, 4),
    single_predictor_pearson: single,
    coefficients: {
      intercept: round(coeffs[0], 4),
      imd: round(coeffs[1], 4),
      white_british: round(coeffs[2], 4),
      asian: round(coeffs[3], 4),
      no_quals: round(coeffs[4], 4),
      degree: round(coeffs[5], 4),
    },
    r_squared: round(fit, 3),
  };
}

// ---------------------------------------------------------------------------
// Backtest B — predict 2026 from 2025-trained coefficients
// ---------------------------------------------------------------------------
function predictWith(coeffs, demo) {
  return (
    coeffs.intercept +
    coeffs.imd * demo.imd +
    coeffs.white_british * demo.white_british +
    coeffs.asian * demo.asian +
    coeffs.no_quals * demo.no_quals +
    coeffs.degree * demo.degree
  );
}

function backtestPrediction(coeffs, councils2026, party) {
  const usable = councils2026.filter((c) => c.shares[party] != null);
  if (usable.length === 0) return null;
  const actual = usable.map((c) => c.shares[party]);
  const predicted = usable.map((c) => predictWith(coeffs, c.demographics));
  return {
    n_councils: usable.length,
    mae_pp: round(mae(actual, predicted) * 100, 2),
    correlation: round(pearson(actual, predicted), 3),
    rmse_pp: round(
      Math.sqrt(
        actual.reduce((a, v, i) => a + (v - predicted[i]) ** 2, 0) / actual.length,
      ) * 100,
      2,
    ),
    fit_r2: round(r2(actual, predicted), 3),
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const history = readJson("data/history/dc-historic-results.json");
  const merged2026 = readJson("data/results/may-2026/local-and-mayor.merged.json");

  const results2025 = history.results.filter(
    (r) => r.election_date === "2025-05-01" && !r.is_by_election && r.tier === "local",
  );
  const results2026 = merged2026.results.filter(
    (r) => r.election_date === "2026-05-07" && r.tier === "local" && !r.is_by_election,
  );

  const councils2025 = aggregateCouncilShares(results2025);
  const councils2026 = aggregateCouncilShares(results2026);

  console.log(`2025: ${councils2025.length} councils with demographics + results`);
  console.log(`2026: ${councils2026.length} councils with demographics + results`);

  // Backtest A — per-party regressions in both years
  const perPartyBacktest = {};
  for (const party of PARTIES) {
    const r2025 = regressParty(councils2025, party);
    const r2026 = regressParty(councils2026, party);
    const stability =
      r2025 && r2026
        ? {
            no_quals_2025: r2025.single_predictor_pearson.no_quals,
            no_quals_2026: r2026.single_predictor_pearson.no_quals,
            no_quals_stability: round(
              1 -
                Math.abs(
                  r2025.single_predictor_pearson.no_quals -
                    r2026.single_predictor_pearson.no_quals,
                ),
              3,
            ),
            r2_2025: r2025.r_squared,
            r2_2026: r2026.r_squared,
          }
        : null;
    perPartyBacktest[party] = {
      regression_2025: r2025,
      regression_2026: r2026,
      stability,
    };
  }

  // Backtest B — train on 2025, predict 2026
  const predictiveBacktest = {};
  for (const party of PARTIES) {
    const r2025 = perPartyBacktest[party].regression_2025;
    if (!r2025) {
      predictiveBacktest[party] = null;
      continue;
    }
    predictiveBacktest[party] = backtestPrediction(
      r2025.coefficients,
      councils2026,
      party,
    );
  }

  // Determine the "best single indicator" per party using 2026 data (larger sample)
  const bestIndicator = {};
  for (const party of PARTIES) {
    const r2026 = perPartyBacktest[party].regression_2026;
    if (!r2026) continue;
    const sorted = Object.entries(r2026.single_predictor_pearson).sort(
      (a, b) => Math.abs(b[1]) - Math.abs(a[1]),
    );
    bestIndicator[party] = {
      predictor: sorted[0][0],
      pearson_r: sorted[0][1],
      direction: sorted[0][1] > 0 ? "positive" : "negative",
    };
  }

  const out = {
    schema_version: "1.0.0",
    generated_at: new Date().toISOString(),
    summary: {
      n_councils_2025: councils2025.length,
      n_councils_2026: councils2026.length,
      predictors: PREDICTORS,
      parties: PARTIES,
    },
    per_party: perPartyBacktest,
    predictive_backtest_2025_to_2026: predictiveBacktest,
    best_indicator_per_party: bestIndicator,
    council_panel_2025: councils2025.map((c) => ({
      slug: c.slug,
      ward_count: c.ward_count,
      shares: Object.fromEntries(
        Object.entries(c.shares).map(([k, v]) => [k, round(v, 4)]),
      ),
      demographics: c.demographics,
    })),
    council_panel_2026: councils2026.map((c) => ({
      slug: c.slug,
      ward_count: c.ward_count,
      shares: Object.fromEntries(
        Object.entries(c.shares).map(([k, v]) => [k, round(v, 4)]),
      ),
      demographics: c.demographics,
    })),
  };

  const outDir = path.join(ROOT, "data/predictions/historical");
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "demographic-indicator-backtest.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");

  console.log(`\nWrote ${outPath}\n`);
  console.log("Best single indicator per party (2026, n=" + councils2026.length + "):");
  for (const [p, info] of Object.entries(bestIndicator)) {
    console.log(`  ${p.padEnd(20)} ${info.predictor.padEnd(15)} r=${info.pearson_r >= 0 ? "+" : ""}${info.pearson_r.toFixed(3)}`);
  }
  console.log("\nPredictive backtest (train 2025 coefs, predict 2026 vote share):");
  for (const [p, info] of Object.entries(predictiveBacktest)) {
    if (!info) continue;
    console.log(`  ${p.padEnd(20)} MAE=${info.mae_pp.toFixed(2)}pp  r=${info.correlation.toFixed(3)}  n=${info.n_councils}`);
  }
}

main();
