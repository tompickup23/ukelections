#!/usr/bin/env node
/**
 * Writes data/transparency/byelection-barometer.json: the monthly by-election
 * barometer shown at /by-elections/barometer/.
 *
 * Descriptive only. It reads the swing corpus the local by-election model
 * already builds and summarises it by month under the rules written at the top
 * of scripts/lib/byelection-barometer.mjs. No forecast reads this file.
 *
 * Needs data/history/dc-historic-results.json (gitignored; present on vps-main
 * and on the maintainer's machine). The output is committed, so the site build
 * and CI never need the history file.
 *
 *   node scripts/build-byelection-barometer.mjs
 */
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildSwingCorpus } from "./lib/local-byelection-model.mjs";
import { loadHistory, buildPriorIndex, loadPagePriors, corpusPriorFinder } from "./build-local-byelections.mjs";
import { buildBarometer, fieldOf, MIN_CONTESTS, PRESENT, STARTING_SHARE, WINDOW_FROM } from "./lib/byelection-barometer.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.join(ROOT, "data/transparency/byelection-barometer.json");

function main() {
  if (!existsSync(path.join(ROOT, "data/history/dc-historic-results.json"))) {
    console.error("data/history/dc-historic-results.json is not present; the barometer needs the full corpus. Nothing written.");
    process.exit(1);
  }
  const priors = buildPriorIndex(loadHistory());
  const corpus = buildSwingCorpus(priors.byelectionRows, corpusPriorFinder(priors, loadPagePriors()));
  const meta = new Map(priors.byelectionRows.map((r) => [r.ballot_paper_id, { review_status: r.review_status ?? null, field: fieldOf(r) }]));
  const barometer = buildBarometer(corpus, meta);

  const out = {
    generated_by: "scripts/build-byelection-barometer.mjs",
    generated_at: new Date().toISOString().slice(0, 10),
    corpus_source:
      "Council by-election results from Democracy Club candidate and result records, with results checked against the council's own declaration where the review status says so (data/history/byelection-appends.json); each paired with the ward's previous ordinary result by scripts/lib/local-byelection-model.mjs (buildSwingCorpus).",
    rules: {
      contests:
        "A council by-election for which the corpus holds the same ward's previous ordinary result. Scottish STV contests are excluded, as in the model.",
      stood_before: `A party counts in a contest only if it had ${PRESENT * 100}% or more of the vote both in the previous ordinary result and in the by-election.`,
      measure:
        "Median, over the month's counted contests, of the change in the log-odds of the party's share between the previous ordinary result and the by-election.",
      points: `The same median shown as the percentage point change for a party starting on ${STARTING_SHARE * 100}%.`,
      minimum: `A party's month is blank when fewer than ${MIN_CONTESTS} contests count for it. Blank months are not interpolated. ${MIN_CONTESTS} is the model's own minimum for giving a party a swing of its own (MIN_PARTY_N).`,
      window: `Months from ${WINDOW_FROM.slice(0, 7)}, the month of the July 2024 general election, one of the model's two party-system boundaries.`,
      lanes: "Independent and Other are pools of unrelated candidates, so they have no line.",
      entrants: `A party is new to the corpus when its first appearance (as a by-election candidate or in a previous ordinary result) is on or after ${WINDOW_FROM}. It qualifies when it has stood in at least ${MIN_CONTESTS} by-elections. Every other party on the barometer is compared in by-elections with and without it on the ballot, from its first appearance onwards; a side with fewer than ${MIN_CONTESTS} contests is blank.`,
      hand_verified_declaration: "Contests whose result was checked against the returning officer's own declaration.",
    },
    starting_share: STARTING_SHARE,
    min_contests: MIN_CONTESTS,
    ...barometer,
  };
  writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`barometer: ${out.contests_in_window} contests ${out.window_from} to ${out.latest_contest_date}; lines for ${out.parties_shown.join(", ")}`);
  for (const p of out.parties_not_shown) console.log(`  no line: ${p.party} (${p.reason})`);
  for (const e of out.entrants) console.log(`  entrant ${e.party}: first ${e.first_seen}, stood ${e.by_elections_stood}, qualifies ${e.qualifies}`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main();
