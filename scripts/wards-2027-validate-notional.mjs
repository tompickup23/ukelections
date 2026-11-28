#!/usr/bin/env node
// Test the notional baseline method where the truth is known, before relying
// on it for 2027.
//
// The notional method carries old wards' results to a new ward by the 2021
// LSOAs they share (scripts/lib/wards-2027-lib.mjs, notionalShares). Here it
// is run on real boundary changes that already happened, and scored against
// the result the new wards actually produced:
//
//   pair A: councils that voted in May 2023 and again in May 2024, wards
//           redrawn for 2024 (2023 results on 2023 wards -> 2024 wards);
//   pair B: councils that voted in May 2024 and again in May 2026, wards
//           redrawn for 2026 (2024 results on 2024 wards -> 2026 wards).
//
// A notional baseline is a year older than the result it is scored against,
// so its raw error mixes two things: where the votes sit (what the method
// claims to get right) and how opinion moved in between (which no baseline
// can know). Two comparisons separate them:
//   - same_ward on councils whose wards did NOT change over the same pair:
//     the error a perfect boundary carry would still have;
//   - the council shortcut on the redrawn councils: every new ward given the
//     council-wide result, the shortcut the 26 November diagnosis found made
//     no-baseline wards worse.
// Each is also scored "swing-adjusted": the council's own change between the
// two years (from the actual results) is added to the baseline first, which
// removes the movement in opinion and leaves the geographic error.
//
// The brief's other design, rebuilding unchanged wards from LSOA weights, is
// reported as a sanity row only: with best-fit lookups an unchanged ward is
// rebuilt from exactly its own LSOAs, so it reproduces its own result and
// cannot test anything beyond the lookup itself.
//
// Output: printed table, and the result object returned for build-wards-2027
// to store under notional_validation in data/identity/wards-2027-baselines.json.

import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseCsv, groupDcBallots, loadWardLookupCsv, wardSlugIndex, notionalShares, pooledShares,
  pooledMae, topParty, POOLED, round6, canonicalParty, finishBallot, slugify, ladSlug,
} from "./lib/wards-2027-lib.mjs";
import { buildLsoaToWd26 } from "./wards-2027-lsoa-to-wd26.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, ".cache/wards-2027");

export function load2026Ballots() {
  const merged = JSON.parse(readFileSync(join(ROOT, "data/results/may-2026/local-and-mayor.merged.json"), "utf8"));
  const ids = JSON.parse(readFileSync(join(ROOT, "data/identity/wards-may-2026.json"), "utf8"));
  const gss = new Map(ids.wards.map((w) => [w.ballot_paper_id, w.gss_code]));
  const out = new Map();
  for (const r of merged.results) {
    if (!r.ballot_paper_id.startsWith("local.") || r.is_by_election) continue;
    const b = {
      ballot_paper_id: r.ballot_paper_id, date: r.election_date, council_slug: r.council_slug, ward_slug: r.ward_slug,
      by_election: false, elected: r.candidates.filter((c) => c.elected).length, source: "data/results/may-2026/local-and-mayor.merged.json",
      cands: r.candidates.map((c) => ({ party: canonicalParty(c.party_canonical || c.party_name, c.party_ec_id), votes: c.votes })),
      gss: gss.get(r.ballot_paper_id) || null,
    };
    out.set(b.ballot_paper_id, finishBallot(b));
  }
  return out;
}

// May 2026 wards (England) from the committed ONS layer, in the same shape as
// loadWardLookupCsv's wards.
export function loadWd26Wards() {
  const geo = JSON.parse(readFileSync(join(ROOT, "data/geography/wd26-bgc.geojson"), "utf8"));
  const wards = new Map();
  for (const f of geo.features) {
    const p = f.properties;
    if (!p.WD26CD.startsWith("E")) continue;
    wards.set(p.WD26CD, { code: p.WD26CD, name: p.WD26NM, slug: slugify(p.WD26NM), lad: p.LAD26CD, ladName: p.LAD26NM, ladSlug: ladSlug(p.LAD26NM), lsoas: [] });
  }
  return wards;
}

export function loadInputs() {
  const dc = groupDcBallots(parseCsv(readFileSync(join(CACHE, "ward_results_2016-2026_candidates.csv"), "utf8")));
  const sets = {
    2023: loadWardLookupCsv(readFileSync(join(CACHE, "lsoa21_to_ward_wd23.csv"), "utf8")),
    2024: loadWardLookupCsv(readFileSync(join(CACHE, "lsoa21_to_ward_wd24.csv"), "utf8")),
    2025: loadWardLookupCsv(readFileSync(join(CACHE, "lsoa21_to_ward_wd25.csv"), "utf8")),
  };
  const wd26 = buildLsoaToWd26();
  const lsoaToWard26 = new Map(Object.entries(wd26.lookup));
  const wards26 = loadWd26Wards();
  for (const [l, w] of lsoaToWard26) wards26.get(w).lsoas.push(l);
  sets[2026] = { lsoaToWard: lsoaToWard26, wards: wards26, check: wd26.check };
  return { dc, sets, b2026: load2026Ballots() };
}

// Ordinary results for one year keyed by ward code, grouped by council.
function resultsByCouncil(ballots, year, set) {
  const idx = wardSlugIndex(set.wards);
  const out = new Map();
  let unjoined = 0;
  for (const b of ballots.values()) {
    if (b.by_election || !b.date.startsWith(String(year)) || !b.shares) continue;
    // 2026 ballots carry an ONS code except in the 17 councils redrawn for
    // 2026, where Democracy Club gives its own slug; those join by name.
    const code = b.gss && set.wards.has(b.gss) ? b.gss : idx(b.council_slug, b.ward_slug);
    if (!code || !set.wards.has(code)) { unjoined++; continue; }
    if (!out.has(b.council_slug)) out.set(b.council_slug, new Map());
    out.get(b.council_slug).set(code, b);
  }
  return { out, unjoined };
}

function councilAggregate(wardMap) {
  const votes = {};
  let total = 0;
  for (const b of wardMap.values()) {
    for (const [p, s] of Object.entries(b.shares)) votes[p] = (votes[p] || 0) + s * b.total_votes;
    total += b.total_votes;
  }
  return Object.fromEntries(Object.entries(votes).map(([p, v]) => [p, v / total]));
}

function addSwing(shares, from, to) {
  const s = pooledShares(shares), f = pooledShares(from), t = pooledShares(to);
  const out = {};
  for (const p of POOLED) out[p] = Math.max(0, s[p] + t[p] - f[p]);
  const sum = Object.values(out).reduce((a, b) => a + b, 0);
  for (const p of POOLED) out[p] = out[p] / sum;
  return out;
}

function summarise(rows) {
  if (!rows.length) return { wards: 0 };
  const mean = (k) => round6(rows.reduce((s, r) => s + r[k], 0) / rows.length);
  const hit = (k) => round6(rows.filter((r) => r[k]).length / rows.length);
  return {
    wards: rows.length,
    councils: new Set(rows.map((r) => r.council)).size,
    mae_raw: mean("mae_raw"),
    mae_swing_adjusted: mean("mae_adj"),
    leader_right_raw: hit("lead_raw"),
    leader_right_swing_adjusted: hit("lead_adj"),
  };
}

function scorePair(inputs, yA, yB) {
  const { dc, sets, b2026 } = inputs;
  const A = resultsByCouncil(dc, yA, sets[yA]);
  const B = resultsByCouncil(yB === 2026 ? b2026 : dc, yB, sets[yB]);
  const rows = { notional: [], shortcut: [], same_ward: [], sanity_unchanged_rebuilt: [] };
  const councils = { redrawn: [], unchanged: [], mixed_or_skipped: [] };
  for (const [council, bWards] of B.out) {
    const aWards = A.out.get(council);
    if (!aWards || aWards.size < 3 || bWards.size < 3) continue;
    const aCodes = new Set(aWards.keys());
    const kept = [...bWards.keys()].filter((c) => aCodes.has(c)).length;
    const aggA = councilAggregate(aWards), aggB = councilAggregate(bWards);
    const score = (list, pred, truth, code) => {
      const adj = addSwing(pred, aggA, aggB);
      const t = pooledShares(truth);
      list.push({
        council, ward: code,
        mae_raw: pooledMae(pred, truth), mae_adj: pooledMae(adj, truth),
        lead_raw: topParty(pooledShares(pred)) === topParty(t), lead_adj: topParty(adj) === topParty(t),
      });
    };
    if (kept === 0) {
      councils.redrawn.push(council);
      const lsoaToOld = sets[yA].lsoaToWard;
      const oldShares = new Map([...aWards].map(([c, b]) => [c, b.shares]));
      for (const [code, b] of bWards) {
        const n = notionalShares(sets[yB].wards.get(code).lsoas, lsoaToOld, oldShares);
        if (!n.shares) continue;
        score(rows.notional, n.shares, b.shares, code);
        score(rows.shortcut, aggA, b.shares, code);
      }
    } else if (kept === bWards.size && aWards.size === bWards.size) {
      councils.unchanged.push(council);
      const lsoaToOld = sets[yA].lsoaToWard;
      const oldShares = new Map([...aWards].map(([c, b]) => [c, b.shares]));
      for (const [code, b] of bWards) {
        score(rows.same_ward, aWards.get(code).shares, b.shares, code);
        const n = notionalShares(sets[yB].wards.get(code).lsoas, lsoaToOld, oldShares);
        if (n.shares) score(rows.sanity_unchanged_rebuilt, n.shares, b.shares, code);
      }
    } else councils.mixed_or_skipped.push(council);
  }
  return {
    pair: `${yA} to ${yB}`,
    unjoined_ballots: { [yA]: A.unjoined, [yB]: B.unjoined },
    councils_redrawn: councils.redrawn.sort(),
    councils_unchanged: councils.unchanged.length,
    councils_partly_changed_left_out: councils.mixed_or_skipped.length,
    notional_on_redrawn_wards: summarise(rows.notional),
    council_shortcut_on_redrawn_wards: summarise(rows.shortcut),
    same_ward_on_unchanged_wards: summarise(rows.same_ward),
    sanity_unchanged_wards_rebuilt_from_lsoas: summarise(rows.sanity_unchanged_rebuilt),
  };
}

export function validateNotional(inputs = loadInputs()) {
  return {
    method: "Scored on real boundary changes: the earlier year's results carried to the later year's new wards by shared 2021 LSOAs, against the new wards' actual results. MAE is the mean absolute error over six pooled groups (Reform UK, Labour, Conservative, Liberal Democrats, Green Party, Others), in share points from 0 to 1. Swing-adjusted adds the council's actual change between the two years first.",
    lsoa_to_wd26_check: inputs.sets[2026].check.agreement_with_ons_wd25_on_unchanged_wards,
    pairs: [scorePair(inputs, 2023, 2024), scorePair(inputs, 2024, 2026)],
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const v = validateNotional();
  const pct = (x) => (x == null ? "" : (x * 100).toFixed(1));
  for (const p of v.pairs) {
    console.log(`\n${p.pair}: ${p.councils_redrawn.length} redrawn councils, ${p.councils_unchanged} unchanged, ${p.councils_partly_changed_left_out} partly changed (left out); unjoined ballots ${JSON.stringify(p.unjoined_ballots)}`);
    console.log("method                         wards  MAE raw  MAE adj  leader raw  leader adj");
    for (const k of ["notional_on_redrawn_wards", "council_shortcut_on_redrawn_wards", "same_ward_on_unchanged_wards", "sanity_unchanged_wards_rebuilt_from_lsoas"]) {
      const s = p[k];
      console.log(`${k.padEnd(42).slice(0, 30)} ${String(s.wards).padStart(5)}  ${pct(s.mae_raw).padStart(7)}  ${pct(s.mae_swing_adjusted).padStart(7)}  ${pct(s.leader_right_raw).padStart(10)}  ${pct(s.leader_right_swing_adjusted).padStart(10)}`);
    }
    console.log("redrawn:", p.councils_redrawn.join(", "));
  }
}
