#!/usr/bin/env node
//
// audit-probability-calibration.mjs
//
// Reliability of the local by-election win probabilities across the WHOLE
// range, not just the band the published table covers.
//
// Why this exists
// -----------------------------------------------------------------------------
// /by-elections/local/ publishes a three-row calibration table. Every row of it
// is built from `leader_probability`, the chance given to the single party the
// page names as favourite. That table is honest about what it measures and it
// is the right table for the headline record, but it has a blind spot that no
// input can close: a lane the page puts at 3% is never the leader, so no result
// anywhere can put a 3% lane into it. The table's lowest band starts at 30%.
//
// A published number nothing can contradict is decoration. Seven in ten of the
// probabilities on these pages sit below 30% (2,374 of 3,362 lanes) and none of
// them had ever appeared in a reliability table.
//
// This script builds the missing tables:
//
//   1. Lane level, binned by claimed probability. One row per party on the
//      ballot. This is the reliability diagram proper and it answers "when we
//      say 5%, does it happen 5% of the time".
//   2. Contest level, binned by claimed probability, in deciles rather than the
//      three published bands. Reproduces the published record as a check.
//   3. Lane level, binned by projected SHARE. This answers a different reader
//      question, "you have this party on 7% of the vote, what chance do you give
//      it", and it is the cut in which a systematic tail problem would show as a
//      mean claim far from the mean outcome.
//
// Denominators. Four counts appear here and mixing any two is the likeliest way
// this analysis goes wrong, so all four are printed:
//   contests in the swing corpus, contests back-tested, lanes, lanes in window.
//
// Offline by design. It reads the committed archives and never touches the
// network, so it reproduces on the Mac and on vps-main from the same inputs.
//
//   node scripts/audit-probability-calibration.mjs
//   node scripts/audit-probability-calibration.mjs --json     machine output only
//
// Writes data/calibration/byelection-reliability.json.
// Exits non-zero if a structural bound is violated.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  backtest,
  buildSwingCorpus,
  toLanes,
  reliability,
  probabilityViolations,
  wilsonInterval,
  RELIABILITY_BANDS,
  SHARE_BANDS,
  PUBLISHED_BANDS,
  RECENT_SINCE,
} from "./lib/local-byelection-model.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const p = (rel) => path.join(ROOT, rel);
const readJson = (rel) => JSON.parse(readFileSync(p(rel), "utf8"));
const JSON_ONLY = process.argv.includes("--json");
const say = (...a) => { if (!JSON_ONLY) console.log(...a); };

// ---------------------------------------------------------------------------
// Corpus, rebuilt from the committed archives
// ---------------------------------------------------------------------------
//
// Same assembly as build-local-byelections.mjs, minus the network sweep: that
// script folds in results declared since the archive was last rebuilt, which it
// can only learn from Democracy Club. The corpus here is therefore the archive
// as committed, which is what makes the run reproducible.

function loadHistory() {
  const rows = [];
  if (existsSync(p("data/history/dc-historic-results.json"))) {
    rows.push(...readJson("data/history/dc-historic-results.json").results);
  } else {
    console.warn("  note: dc-historic-results.json absent, corpus will be sidecar-only");
  }
  const seen = new Set(rows.map((r) => r.ballot_paper_id));
  for (const r of readJson("data/history/byelection-appends.json").results) {
    if (!seen.has(r.ballot_paper_id)) rows.push(r);
  }
  return rows;
}

function buildPriorIndex(history) {
  const ordinaryBySlug = new Map();
  const byelectionRows = [];
  for (const r of history) {
    if (r.tier !== "local" && r.tier !== undefined) continue;
    if (r.is_by_election) { byelectionRows.push(r); continue; }
    const key = `${r.council_slug}/${r.ward_slug}`;
    if (!ordinaryBySlug.has(key)) ordinaryBySlug.set(key, []);
    ordinaryBySlug.get(key).push(r);
  }
  for (const list of ordinaryBySlug.values()) {
    list.sort((a, b) => a.election_date.localeCompare(b.election_date));
  }
  const leap = existsSync(p("data/history/leap-history.json"))
    ? readJson("data/history/leap-history.json").by_gss
    : {};

  function find({ council_slug, ward_slug, gss, before }) {
    const slugRows = (ordinaryBySlug.get(`${council_slug}/${ward_slug}`) || [])
      .filter((r) => r.election_date < before);
    const leapRows = (leap[gss] || [])
      .filter((r) => r.date < before)
      .map((r) => ({
        election_date: r.date,
        seats_contested: r.seats_contested ?? null,
        candidates: (r.candidates || []).map((c) => ({
          name: c.name || null, party_name: c.party, votes: c.votes,
        })),
      }));
    const all = [...slugRows, ...leapRows].sort((a, b) => a.election_date.localeCompare(b.election_date));
    return all.at(-1) ?? null;
  }
  return { find, byelectionRows };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const pct = (x, d = 1) => (x === null || x === undefined ? "." : `${(x * 100).toFixed(d)}%`);

function render(title, table, unit) {
  const total = table.reduce((a, r) => a + r.n, 0);
  say(`\n${title}   (${total} ${unit})`);
  say("  band        |     n | claimed | observed | 95% CI on observed  | verdict");
  say("  ------------|------:|--------:|---------:|---------------------|--------");
  for (const r of table) {
    const band = `${(r.from * 100).toFixed(0)} to ${(r.to * 100).toFixed(0)}%`;
    const ci = `${pct(r.ci_low)} to ${pct(r.ci_high)}`;
    say(
      `  ${band.padEnd(12)}|${String(r.n).padStart(6)} |${pct(r.mean_claimed).padStart(8)} |` +
      `${pct(r.observed).padStart(9)} | ${ci.padEnd(20)}| ${r.honest ? "ok" : "OUTSIDE"}`,
    );
  }
}

function renderShare(title, table) {
  const total = table.reduce((a, r) => a + r.n, 0);
  say(`\n${title}   (${total} lanes)`);
  say("  projected share |     n | mean claim | actually won | 95% CI on won       | verdict");
  say("  ----------------|------:|-----------:|-------------:|---------------------|--------");
  for (const r of table) {
    const band = `${r.from.toFixed(0)} to ${r.to.toFixed(0)}pp`;
    const ci = `${pct(r.ci_low)} to ${pct(r.ci_high)}`;
    say(
      `  ${band.padEnd(16)}|${String(r.n).padStart(6)} |${pct(r.mean_claimed).padStart(11)} |` +
      `${pct(r.observed).padStart(13)} | ${ci.padEnd(20)}| ${r.honest ? "ok" : "OUTSIDE"}`,
    );
  }
}

// ---------------------------------------------------------------------------

function main() {
  const history = loadHistory();
  const priors = buildPriorIndex(history);
  const corpus = buildSwingCorpus(priors.byelectionRows, (row) =>
    priors.find({
      council_slug: row.council_slug,
      ward_slug: row.ward_slug,
      gss: row.gss ?? null,
      before: row.election_date,
    }),
  );

  say(`corpus: ${corpus.length} by-elections paired with a prior ward result, ` +
      `${corpus[0]?.date} to ${corpus.at(-1)?.date}`);

  const bt = backtest(corpus);
  const rows = bt.rows;
  const recentRows = rows.filter((r) => r.date >= RECENT_SINCE);
  const lanes = toLanes(rows);
  const recentLanes = lanes.filter((r) => r.date >= RECENT_SINCE);

  // -------------------------------------------------------------------------
  // Structural bounds first. Nothing below is worth reading if these fail.
  // -------------------------------------------------------------------------
  const violations = probabilityViolations(rows);
  const byKind = {};
  for (const v of violations) byKind[v.kind] = (byKind[v.kind] || 0) + 1;

  say("\n" + "=".repeat(74));
  say("STRUCTURAL BOUNDS");
  say("=".repeat(74));
  if (!violations.length) {
    say("  no violations");
  } else {
    for (const [kind, n] of Object.entries(byKind)) say(`  ${kind}: ${n}`);
    for (const v of violations.slice(0, 10)) {
      say(`    ${v.ballot_paper_id}  ${v.party ?? ""} ${v.value ?? ""}`);
    }
  }

  // -------------------------------------------------------------------------
  // Denominators, printed so no reader has to guess which one a rate is over.
  // -------------------------------------------------------------------------
  say("\n" + "=".repeat(74));
  say("DENOMINATORS. Four different counts. A rate against the wrong one is out");
  say("by a factor of four.");
  say("=".repeat(74));
  say(`  contests in the swing corpus          ${corpus.length}`);
  say(`  contests back-tested                  ${rows.length}`);
  say(`  contests back-tested since ${RECENT_SINCE}  ${recentRows.length}`);
  say(`  lanes (party-contests)                ${lanes.length}`);
  say(`  lanes since ${RECENT_SINCE}               ${recentLanes.length}`);
  say(`  mean lanes per contest                ${(lanes.length / Math.max(1, rows.length)).toFixed(2)}`);

  // -------------------------------------------------------------------------
  // The tables
  // -------------------------------------------------------------------------
  const laneAll = reliability(lanes, { bands: RELIABILITY_BANDS });
  const laneRecent = reliability(recentLanes, { bands: RELIABILITY_BANDS });
  const leaderHit = (r) => r.projected_winner === r.actual_winner;
  const contestAll = reliability(rows, {
    bands: RELIABILITY_BANDS, binKey: "leader_probability", hit: leaderHit,
  });
  const contestRecent = reliability(recentRows, {
    bands: RELIABILITY_BANDS, binKey: "leader_probability", hit: leaderHit,
  });
  const publishedRecent = reliability(recentRows, {
    bands: PUBLISHED_BANDS, binKey: "leader_probability", hit: leaderHit,
  });
  // Grouped by projected share, but the claim under test is the win
  // probability. Binning and claiming on the same field here would compare a
  // share against a win rate.
  const shareOpts = { bands: SHARE_BANDS, binKey: "central_pp", claimKey: "claimed", clampTo: 100 };
  const shareAll = reliability(lanes, shareOpts);
  const shareRecent = reliability(recentLanes, shareOpts);

  say("\n" + "=".repeat(74));
  say("1. LANE LEVEL, binned by claimed probability. One row per party on the");
  say("   ballot. This is the table the published one cannot produce.");
  say("=".repeat(74));
  render("All time", laneAll, "lanes");
  render(`Since ${RECENT_SINCE}`, laneRecent, "lanes");

  say("\n" + "=".repeat(74));
  say("2. CONTEST LEVEL, the named favourite only, in deciles. The published");
  say("   table pools these into three bands.");
  say("=".repeat(74));
  render("All time", contestAll, "contests");
  render(`Since ${RECENT_SINCE}`, contestRecent, "contests");
  say("\n  As published, three bands, since " + RECENT_SINCE + ":");
  for (const r of publishedRecent) {
    say(`    ${(r.from * 100).toFixed(0)} to ${(r.to * 100).toFixed(0)}%: n=${r.n}, ` +
        `claimed ${pct(r.mean_claimed, 0)}, right ${pct(r.observed, 0)} ` +
        `(CI ${pct(r.ci_low, 0)} to ${pct(r.ci_high, 0)})`);
  }
  const top = recentRows.filter((r) => r.leader_probability >= 0.7);
  const topRight = top.filter(leaderHit).length;
  const [tl, th] = wilsonInterval(topRight, top.length);
  say(`\n  The live page's own claim, "where we said 70% or better we were right`);
  say(`  about 78% of the time": ${topRight} of ${top.length} = ${pct(topRight / top.length)} ` +
      `(CI ${pct(tl)} to ${pct(th)})`);
  const called = recentRows.filter(leaderHit).length;
  say(`  The live page's headline record: winner called ${called} of ${recentRows.length} = ` +
      `${pct(called / recentRows.length, 0)}`);

  say("\n" + "=".repeat(74));
  say("3. LANE LEVEL, binned by PROJECTED SHARE. What chance do we give a party");
  say("   we have put on a given share, and how often does it actually win.");
  say("=".repeat(74));
  renderShare("All time", shareAll);
  renderShare(`Since ${RECENT_SINCE}`, shareRecent);

  const out = {
    generated_at: new Date().toISOString(),
    method_note:
      "Leave-one-out back-test of the local by-election model, every lane retained. " +
      "Lanes are party-contests and contests are by-elections; the two denominators " +
      "are never mixed. Intervals are Wilson score at 95%.",
    corpus: {
      contests: corpus.length,
      oldest: corpus[0]?.date ?? null,
      newest: corpus.at(-1)?.date ?? null,
    },
    denominators: {
      contests_backtested: rows.length,
      contests_backtested_recent: recentRows.length,
      lanes: lanes.length,
      lanes_recent: recentLanes.length,
      recent_since: RECENT_SINCE,
    },
    structural_violations: violations,
    lane_reliability: { all_time: laneAll, recent: laneRecent },
    contest_reliability: { all_time: contestAll, recent: contestRecent, as_published: publishedRecent },
    share_binned: { all_time: shareAll, recent: shareRecent },
    headline: {
      winner_called: called,
      winner_called_of: recentRows.length,
      at_or_above_70: { right: topRight, of: top.length },
    },
  };
  mkdirSync(p("data/calibration"), { recursive: true });
  writeFileSync(p("data/calibration/byelection-reliability.json"), JSON.stringify(out, null, 2) + "\n");
  say("\nwrote data/calibration/byelection-reliability.json");
  if (JSON_ONLY) console.log(JSON.stringify(out, null, 2));

  if (violations.length) {
    console.error(`\nFAIL: ${violations.length} structural violation(s). See the list above.`);
    process.exitCode = 1;
  }
}

main();
