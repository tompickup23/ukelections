#!/usr/bin/env node
// Reconcile hand-checked October counts with the published contest files.
// Forecasts and their pre-poll snapshots are deliberately left intact.
// Usage: node scripts/finalise-october-byelection-results.mjs [polling dates]
// (default 2026-10-08). Patches only those contests, so it is safe to run
// without the full rebuild's API cache.
import { readFileSync, writeFileSync } from "node:fs";
import { canonParty, sharesFromCandidates, gradeAgainst } from "./lib/local-byelection-model.mjs";

const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const write = (p, d) => writeFileSync(p, JSON.stringify(d, null, 2) + "\n");
const published = read("data/cards/published-byelection-forecasts.json").forecasts;
const history = read("data/history/byelection-appends.json").results;
const holders = read("data/contests/local-byelection-holders.json").holders;
const dates = new Set(process.argv.length > 2 ? process.argv.slice(2) : ["2026-10-08"]);
const SOURCE_LABELS = {
  hand_verified_declaration: "Returning officer declaration (verified)",
  hand_verified_two_sources: "Report of the declaration (verified against a second source)",
};
for (const row of history.filter((r) => dates.has(r.election_date) && SOURCE_LABELS[r.review_status])) {
  const slug = `${row.council_slug}-${row.ward_slug}-${row.election_date}`;
  const file = `data/contests/local-byelections/${slug}.json`;
  const d = read(file);
  if (d.contest.voting_system !== "FPTP") throw new Error("Do not grade STV first preferences as FPTP");
  if (row.candidates.some((c) => !Number.isInteger(c.votes) || c.votes < 0)) throw new Error(`Incomplete result: ${slug}`);
  const ordered = [...row.candidates].sort((a, b) => b.votes - a.votes);
  if (!ordered[0].elected || ordered.filter((c) => c.elected).length !== 1) throw new Error(`Winner disagreement: ${slug}`);
  const shares = sharesFromCandidates(row.candidates);
  const winner = canonParty(ordered[0].party_name);
  d.field.candidates = row.candidates.map((c) => ({ ...c, party: canonParty(c.party_name) }));
  d.field.candidate_count = row.candidates.length;
  d.field.parties = [...new Set(d.field.candidates.map((c) => c.party))].sort();
  d.status = "concluded";
  const holder = holders[row.ballot_paper_id];
  if (holder) d.previous_holder = { ...holder, established: true };
  d.result = {
    declared: true, shares, winner_party: winner, winner_candidate: ordered[0].name,
    runner_up_party: canonParty(ordered[1].party_name),
    majority_votes: ordered[0].votes - ordered[1].votes,
    total_votes: ordered.reduce((n, c) => n + c.votes, 0),
    source: row.source,
    outcome: holder ? (winner === holder.party ? `${winner} hold` : `${winner} gain from ${holder.party}`) : null,
    grading: gradeAgainst(published[slug], d.forecast, shares, new Set(d.field.parties), winner),
    review_status: row.review_status, checked_at: row.reviewed_at, note: row.verification_note,
  };
  d.declaration = null;
  d.result_updated_at = row.reviewed_at;
  if (!d.sources.some((s) => s.url === row.source)) d.sources.unshift({ label: SOURCE_LABELS[row.review_status], url: row.source });
  write(file, d);
}
if (!dates.has("2026-10-08")) process.exit(0);
const declarations = read("data/results/local-byelection-declarations.json").declarations;
for (const [id, declaration] of Object.entries(declarations)) {
  const slug = id.replace(/^local\./, "").replace(/\.by\./, "-").replaceAll(".", "-");
  const file = `data/contests/local-byelections/${slug}.json`;
  const d = read(file);
  d.status = "polls_closed";
  d.result = null;
  d.declaration = declaration;
  if (holders[id]) d.previous_holder = { ...holders[id], established: true };
  d.result_updated_at = declaration.checked_at;
  if (!d.sources.some((s) => s.url === declaration.source)) d.sources.unshift({ label: "Returning officer declaration (verified)", url: declaration.source });
  write(file, d);
}
