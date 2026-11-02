import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { assemble, loadHistory, buildPriorIndex, loadPagePriors, corpusPriorFinder, restoreHistoryCandidates } from "./build-local-byelections.mjs";
import { buildSwingCorpus, backtest, canonParty, fieldFromCandidates, gradeAgainst } from "./lib/local-byelection-model.mjs";

const read = (file) => JSON.parse(readFileSync(file, "utf8"));
const write = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

// This repair reads held files only. It never fetches or revises a forecast.
export function applyCouncilResults(day) {
  if (!/^\d{4}\x2d\d{2}\x2d\d{2}$/.test(day)) throw new Error("Supply an ISO polling date");
  const directory = "data/contests/local-byelections";
  const rows = new Map(read("data/history/byelection-appends.json").results.map((row) => [row.ballot_paper_id, row]));
  const declarations = read("data/results/local-byelection-declarations.json").declarations;
  const published = read("data/cards/published-byelection-forecasts.json").forecasts;
  const holders = read("data/contests/local-byelection-holders.json").holders;
  let changed = 0;
  for (const file of readdirSync(directory).filter((name) => name.endsWith(`${day}.json`))) {
    const destination = `${directory}/${file}`;
    const doc = read(destination);
    const id = doc.contest.ballot_paper_id;
    const row = rows.get(id);
    const declaration = declarations[id];
    if (doc.contest.voting_system === "STV") {
      if (declaration?.review_status !== "hand_verified_declaration") throw new Error(`No council declaration for ${id}`);
      doc.declaration = declaration;
      doc.result = null;
      doc.status = "polls_closed";
      doc.field.candidates = doc.field.candidates.map((candidate) => {
        const source = declaration.candidates.find((entry) => entry.name === candidate.name);
        if (!source) throw new Error(`No first preference row for ${candidate.name}`);
        return { ...candidate, ...source, party: canonParty(source.party_name), votes: null };
      });
    } else {
      if (row?.review_status !== "hand_verified_declaration") throw new Error(`No council counts for ${id}`);
      const candidates = restoreHistoryCandidates(doc.field.candidates, row);
      if (!candidates) throw new Error(`Incomplete council counts for ${id}`);
      const field = fieldFromCandidates(candidates);
      const assembled = assemble({
        ballot: { election_id: id, organisation: { common_name: doc.contest.council_name } },
        ids: { date: day, slug: doc.slug, council_slug: doc.contest.council_slug, ward_slug: doc.contest.ward_slug },
        division: { name: doc.contest.ward_name }, gss: doc.contest.ward_gss,
        setStart: doc.contest.boundary_set_start, votingSystem: doc.contest.voting_system,
        dc: {}, candidates, field, prior: null, boundaryChanged: doc.contest.boundary_changed_since_prior,
        fieldUnavailable: false, resultSource: row.source,
        resultReview: { checked_at: row.reviewed_at, accessed_at: row.accessed_at, review_status: row.review_status, note: row.verification_note },
      }, [], { wards: {}, medians: {} }, holders);
      doc.field.candidates = candidates;
      doc.result = assembled.result;
      doc.result.grading = doc.forecast ? gradeAgainst(published[doc.slug], doc.forecast, doc.result.shares, field, doc.result.winner_party) : null;
      doc.status = "concluded";
    }
    const source = doc.result || doc.declaration;
    doc.sources = doc.sources.filter((entry) => entry.label !== "Returning officer declaration (verified)");
    doc.sources.unshift({ label: "Returning officer declaration (verified)", url: source.source, accessed_at: source.accessed_at });
    doc.results_updated_at = source.accessed_at;
    write(destination, doc);
    changed += 1;
  }
  if (!changed) throw new Error("No contests for that date");
  const priors = buildPriorIndex(loadHistory());
  const corpus = buildSwingCorpus(priors.byelectionRows, corpusPriorFinder(priors, loadPagePriors()));
  const bt = backtest(corpus);
  const pooled = backtest(corpus, { stratify: false });
  const metaFile = `${directory}/_meta.json`;
  const meta = read(metaFile);
  meta.corpus_size = corpus.length;
  meta.corpus_newest = corpus.at(-1)?.date ?? null;
  meta.corpus_oldest = corpus[0]?.date ?? null;
  for (const key of Object.keys(meta.backtest)) meta.backtest[key] = bt[key];
  meta.calibration_table = bt.calibration;
  meta.method_comparison.stratified = bt.recent;
  meta.method_comparison.pooled = pooled.recent;
  meta.party_accuracy = bt.party_accuracy;
  meta.results_updated_at = new Date().toISOString();
  write(metaFile, meta);
  console.log(`Applied council declarations to ${changed} contests. Forecasts and their generation dates are preserved.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) applyCouncilResults(process.argv[2]);
