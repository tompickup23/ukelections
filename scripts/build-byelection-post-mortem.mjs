#!/usr/bin/env node
/**
 * build-byelection-post-mortem.mjs: the monthly post-mortem of our council
 * by-election forecasts, for /by-elections/post-mortem/.
 *
 * Two records, kept apart:
 *   as published  the forecast the live page showed before the result
 *                 (data/cards/published-byelection-forecasts.json), graded
 *                 against the result in data/history/byelection-appends.json.
 *                 This is the record. It is never regenerated.
 *   re-scored     the same September and October contests projected again by
 *                 today's model (after PR 115, 4 October 2026) through the
 *                 leave-one-out harness, which only sees contests polled before
 *                 each one. This shows whether the model changes helped; it is
 *                 not what we published.
 *
 * Mean absolute error is over the parties in the published projection, in
 * percentage points. A contest counts as called when the party the page named
 * as most likely to win came first on votes.
 *
 * Needs data/history/dc-historic-results.json for the re-score (gitignored);
 * without it the re-score is left out and says so.
 *
 *   node scripts/build-byelection-post-mortem.mjs
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { backtest, buildSwingCorpus, canonParty } from "./lib/local-byelection-model.mjs";
import { loadHistory, buildPriorIndex } from "./build-local-byelections.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const p = (rel) => path.join(ROOT, rel);
const OUT = "data/transparency/byelection-post-mortem.json";
const RESCORE_FROM = "2026-09-01";
const RESCORE_TO = "2026-10-31";

// Dated changes to the council by-election model, from the git history of
// scripts/lib/local-byelection-model.mjs and the pages it feeds.
export const MODEL_CHANGES = [
  { date: "2026-08-23", ref: "fa29b02", change: "A page for every council by-election, with a projection measured against past by-elections." },
  { date: "2026-08-23", ref: "e397c2e", change: "Swing applied on log-odds rather than as a flat share; an open nomination no longer reads as an empty ballot." },
  { date: "2026-08-23", ref: "33dad92", change: "The named favourite became the party that wins most often across 4,000 simulated contests, not the largest central share." },
  { date: "2026-08-28", ref: "b44604b", change: "Results graded against the forecast as published, not against the nightly rebuild." },
  { date: "2026-09-27", ref: "PR 109", change: "Pages say when a projection rests on an entry prior for a party that did not stand last time." },
  { date: "2026-10-04", ref: "PR 115", change: "Independent slates scored by their best candidate in the ward baseline, ending a double count of independent votes." },
];

const contestKey = (r) => `${r.council_slug}-${r.ward_slug}-${r.election_date}`;

export function resultShares(result) {
  const total = (result.candidates || []).reduce((a, c) => a + (c.votes || 0), 0);
  if (!total) return null;
  const shares = {};
  for (const c of result.candidates) {
    const k = canonParty(c.party_name);
    shares[k] = (shares[k] || 0) + (100 * (c.votes || 0)) / total;
  }
  return shares;
}

export function topOf(shares) {
  return Object.entries(shares).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export function gradePublished(forecasts, results) {
  const byKey = new Map(results.map((r) => [contestKey(r), r]));
  const graded = [];
  const pending = [];
  for (const [slug, f] of Object.entries(forecasts)) {
    const r = byKey.get(slug);
    const shares = r ? resultShares(r) : null;
    if (!shares) { pending.push(slug); continue; }
    const parties = Object.keys(f.central_pct);
    const mae = parties.reduce((a, party) => a + Math.abs(f.central_pct[party] - (shares[party] || 0)), 0) / parties.length;
    const winner = topOf(shares);
    const contestFile = p(`data/contests/local-byelections/${slug}.json`);
    const contest = existsSync(contestFile) ? JSON.parse(readFileSync(contestFile, "utf8")).contest : null;
    graded.push({
      slug,
      council_name: contest?.council_name ?? null,
      ward_name: contest?.ward_name ?? null,
      date: r.election_date,
      council_slug: r.council_slug,
      page: f.page,
      projected_winner: f.projected_winner,
      leader_probability_pct: f.leader_probability_pct,
      too_close_to_call: Boolean(f.too_close_to_call),
      actual_winner: winner,
      called: winner === f.projected_winner,
      mae_pp: Number(mae.toFixed(2)),
      result_status: r.review_status,
      result_source: r.source,
    });
  }
  graded.sort((a, b) => a.date.localeCompare(b.date) || a.slug.localeCompare(b.slug));
  return { graded, pending };
}

export function summarise(rows) {
  const n = rows.length;
  const called = rows.filter((r) => r.called).length;
  const named = rows.filter((r) => !r.too_close_to_call);
  return {
    contests: n,
    winners_called: called,
    mean_absolute_error_pp: n ? Number((rows.reduce((a, r) => a + r.mae_pp, 0) / n).toFixed(2)) : null,
    named_favourite: { contests: named.length, called: named.filter((r) => r.called).length },
    too_close_to_call: { contests: n - named.length, called: rows.filter((r) => r.too_close_to_call && r.called).length },
  };
}

export function byMonth(rows) {
  const months = {};
  for (const r of rows) (months[r.date.slice(0, 7)] ||= []).push(r);
  return Object.entries(months).map(([month, rs]) => ({ month, ...summarise(rs), misses: rs.filter((r) => !r.called).map((r) => ({ slug: r.slug, date: r.date, projected_winner: r.projected_winner, actual_winner: r.actual_winner, too_close_to_call: r.too_close_to_call })) }));
}

function rescore(graded) {
  if (!existsSync(p("data/history/dc-historic-results.json"))) return { available: false, note: "data/history/dc-historic-results.json is not present, so the re-score was not run." };
  const priors = buildPriorIndex(loadHistory());
  const corpus = buildSwingCorpus(priors.byelectionRows, (row) =>
    priors.find({ council_slug: row.council_slug, ward_slug: row.ward_slug, gss: null, before: row.election_date }),
  );
  const rows = backtest(corpus).rows;
  const byId = new Map(rows.map((r) => [r.ballot_paper_id.replace(/^local\./, "").replace(/\.by\./, "."), r]));
  const pairs = [];
  const notScored = [];
  for (const g of graded) {
    if (g.date < RESCORE_FROM || g.date > RESCORE_TO) continue;
    const id = `${g.council_slug}.${g.slug.slice(g.council_slug.length + 1, -11)}.${g.date}`;
    const r = byId.get(id);
    // Not in the harness corpus: it matches a ward to its previous result by
    // name only (gss: null), so contests whose name lookup fails drop out even
    // where the live page had a prior.
    if (!r) { notScored.push(g.slug); continue; }
    pairs.push({
      slug: g.slug,
      date: g.date,
      published: { projected_winner: g.projected_winner, called: g.called, mae_pp: g.mae_pp },
      rescored: { projected_winner: r.projected_winner, called: r.projected_winner === r.actual_winner, mae_pp: Number(r.mae_pp.toFixed(2)) },
    });
  }
  const sum = (key) => ({
    contests: pairs.length,
    winners_called: pairs.filter((x) => x[key].called).length,
    mean_absolute_error_pp: pairs.length ? Number((pairs.reduce((a, x) => a + x[key].mae_pp, 0) / pairs.length).toFixed(2)) : null,
  });
  return {
    available: true,
    window: `${RESCORE_FROM} to ${RESCORE_TO}`,
    method: "Leave-one-out harness (scripts/lib/local-byelection-model.mjs, backtest), which projects each contest from by-elections polled before it. The harness's error is over every party on the ballot, so its MAE is not on exactly the same basis as the published one.",
    published: sum("published"),
    rescored: sum("rescored"),
    changed_call: pairs.filter((x) => x.published.projected_winner !== x.rescored.projected_winner).map((x) => ({ slug: x.slug, date: x.date, published: x.published.projected_winner, rescored: x.rescored.projected_winner, now_called: x.rescored.called })),
    not_scored: notScored,
    contests: pairs,
  };
}

function main() {
  const forecasts = JSON.parse(readFileSync(p("data/cards/published-byelection-forecasts.json"), "utf8")).forecasts;
  const results = JSON.parse(readFileSync(p("data/history/byelection-appends.json"), "utf8")).results;
  const { graded, pending } = gradePublished(forecasts, results);
  const out = {
    generated_by: "scripts/build-byelection-post-mortem.mjs",
    forecasts_source: "data/cards/published-byelection-forecasts.json (the live page before the result)",
    results_source: "data/history/byelection-appends.json (each row carries its declaration URL and review status)",
    definitions: {
      called: "The party the page named as most likely to win came first on votes.",
      mean_absolute_error_pp: "Mean over the parties in the published projection of |projected share minus actual share|, in percentage points.",
    },
    overall: summarise(graded),
    months: byMonth(graded),
    model_changes: MODEL_CHANGES,
    rescore_post_115: rescore(graded),
    pending_results: pending,
    contests: graded,
  };
  writeFileSync(p(OUT), JSON.stringify(out, null, 2) + "\n");
  console.log(`graded ${graded.length}, pending ${pending.length}; overall ${out.overall.winners_called}/${out.overall.contests} called, MAE ${out.overall.mean_absolute_error_pp}pp`);
  for (const m of out.months) console.log(`  ${m.month}: ${m.winners_called}/${m.contests}, MAE ${m.mean_absolute_error_pp}pp`);
  const r = out.rescore_post_115;
  if (r.available) console.log(`re-score ${r.window}: published ${r.published.winners_called}/${r.published.contests} MAE ${r.published.mean_absolute_error_pp}; post-115 ${r.rescored.winners_called}/${r.rescored.contests} MAE ${r.rescored.mean_absolute_error_pp}; not scored ${r.not_scored.length}`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main();
