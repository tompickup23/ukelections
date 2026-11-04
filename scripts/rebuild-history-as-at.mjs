#!/usr/bin/env node
/**
 * rebuild-history-as-at.mjs: filter data/history/dc-historic-results.json to
 * results with a polling date on or before a given date, so a hold-out run can
 * see the history as it stood then (docs/local-engine-holdout-2026-11.md,
 * Phase 2 of the 2027 work).
 *
 * Rows dated after the cut-off are dropped from `results` and from every
 * index. Rows kept but missing from the indexes (the by-election appends) are
 * added to `by_ballot` and to the council and ward indexes under the same
 * "tier::council" and "tier::council::ward" keys the bulk fetch uses.
 * `by_year` is recounted from the kept, indexed rows. The output is a new
 * file; the input is never written.
 *
 * The filter is by polling date, which is what the hold-out rules name. It
 * cannot undo a correction made after the cut-off to a row dated before it;
 * the snapshot records the input's own retrieval time so that limit is visible.
 *
 * Usage:
 *   node scripts/rebuild-history-as-at.mjs --as-at=2026-04-25
 *     [--in=data/history/dc-historic-results.json]
 *     [--out=data/history/dc-historic-results.as-at-2026-04-25.json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

export function historyAsAt(history, asAt) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asAt)) throw new Error(`--as-at must be YYYY-MM-DD, got ${asAt}`);
  const results = (history.results || []).filter((r) => r.election_date && r.election_date <= asAt);
  const kept = new Set(results.map((r) => r.ballot_paper_id));
  const filterIndex = (index) => Object.fromEntries(
    Object.entries(index || {}).map(([k, ids]) => [k, ids.filter((id) => kept.has(id))]).filter(([, ids]) => ids.length),
  );
  const byBallot = Object.fromEntries(Object.entries(history.by_ballot || {}).filter(([id]) => kept.has(id)));
  const byCouncil = filterIndex(history.by_council);
  const byWard = filterIndex(history.by_ward_slug);
  const added = [];
  for (const r of results) {
    if (byBallot[r.ballot_paper_id]) continue;
    byBallot[r.ballot_paper_id] = r;
    added.push(r.ballot_paper_id);
    if (r.council_slug) {
      const ck = `${r.tier}::${r.council_slug}`;
      (byCouncil[ck] ||= []).push(r.ballot_paper_id);
      if (r.ward_slug) (byWard[`${ck}::${r.ward_slug}`] ||= []).push(r.ballot_paper_id);
    }
  }
  const byYear = {};
  for (const r of Object.values(byBallot)) byYear[String(r.year)] = (byYear[String(r.year)] || 0) + 1;
  const dropped = (history.results || []).length - results.length;
  return {
    ...history,
    snapshot: {
      ...history.snapshot,
      as_at: asAt,
      as_at_rule: "results with election_date on or before as_at; built by scripts/rebuild-history-as-at.mjs",
      as_at_input_retrieved_at: history.snapshot?.retrieved_at ?? null,
      as_at_dropped_results: dropped,
      as_at_added_to_indexes: added.length,
    },
    results,
    by_ballot: byBallot,
    by_council: byCouncil,
    by_ward_slug: byWard,
    by_year: Object.fromEntries(Object.entries(byYear).sort()),
  };
}

function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true]; }));
  if (!args["as-at"]) throw new Error("--as-at=YYYY-MM-DD is required");
  const input = path.resolve(ROOT, args.in || "data/history/dc-historic-results.json");
  const out = path.resolve(ROOT, args.out || `data/history/dc-historic-results.as-at-${args["as-at"]}.json`);
  if (out === input) throw new Error("refusing to overwrite the input history file");
  const buf = readFileSync(input);
  const rebuilt = historyAsAt(JSON.parse(buf.toString("utf8")), args["as-at"]);
  rebuilt.snapshot.as_at_input_sha256 = createHash("sha256").update(buf).digest("hex");
  writeFileSync(out, JSON.stringify(rebuilt) + "\n");
  const late = rebuilt.results.filter((r) => r.election_date > args["as-at"]).length;
  console.log(`kept ${rebuilt.results.length}, dropped ${rebuilt.snapshot.as_at_dropped_results}, added to indexes ${rebuilt.snapshot.as_at_added_to_indexes}, rows after the date ${late}`);
  console.log(`wrote ${path.relative(ROOT, out)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
