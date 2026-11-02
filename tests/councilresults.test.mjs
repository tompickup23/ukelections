import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { restoreHistoryCandidates } from "../scripts/build-local-byelections.mjs";

const read = (file) => JSON.parse(readFileSync(file, "utf8"));
const day = "2026\x2d10\x2d29";
const rows = read("data/history/byelection-appends.json").results.filter((row) => row.election_date === day);
const directory = "data/contests/local-byelections";
const contests = readdirSync(directory).filter((file) => file.endsWith(`${day}.json`)).map((file) => read(`${directory}/${file}`));

describe("council declarations from the October polling round", () => {
  it("records a council URL and access date on every candidate row", () => {
    expect(contests).toHaveLength(6);
    for (const doc of contests) {
      expect(doc.status).not.toBe("upcoming");
      const record = doc.result || doc.declaration;
      expect(record.review_status).toBe("hand_verified_declaration");
      expect(new URL(record.source).hostname.endsWith(".gov.uk")).toBe(true);
      expect(record.accessed_at).toBe("2026\x2d11\x2d02");
      for (const candidate of doc.field.candidates) {
        expect(candidate.source).toBe(record.source);
        expect(candidate.accessed_at).toBe(record.accessed_at);
      }
      expect(doc.sources.some((source) => source.url === record.source)).toBe(true);
      if (doc.contest.voting_system === "STV") {
        expect(doc.result).toBeNull();
        expect(doc.forecast).toBeNull();
        expect(doc.declaration.candidates.reduce((total, candidate) => total + candidate.first_preference_votes, 0)).toBe(doc.declaration.first_preference_votes);
      } else {
        const row = rows.find((entry) => entry.ballot_paper_id === doc.contest.ballot_paper_id);
        expect(doc.result.total_votes).toBe(row.candidates.reduce((total, candidate) => total + candidate.votes, 0));
        if (row.turnout_votes !== null) expect(doc.result.total_votes + row.spoilt_ballots).toBe(row.turnout_votes);
        expect(doc.result.grading?.graded_against).toBe("forecast_as_published");
      }
    }
  });

  it("retains the Halton council correction when a feed still has the old count", () => {
    const row = rows.find((entry) => entry.council_slug === "halton");
    // Halton Borough Council declaration, linked by row.source, gives Clarke 19.
    expect(row.candidates.find((candidate) => candidate.name === "Dan Clarke").votes).toBe(19);
    const feed = row.candidates.map((candidate) => ({ ...candidate, votes: candidate.name === "Dan Clarke" ? 90 : candidate.votes }));
    const restored = restoreHistoryCandidates(feed, row);
    expect(restored.find((candidate) => candidate.name === "Dan Clarke").votes).toBe(19);
    expect(restoreHistoryCandidates(feed, { ...row, review_status: "auto_ingested_dc" })).toBeNull();
    expect(restoreHistoryCandidates(feed.slice(1), row)).toBeNull();
  });

  it("does not invent the missing Dudley electorate or reconcile contradictory Bassetlaw turnout", () => {
    expect(rows.find((row) => row.council_slug === "dudley").electorate).toBeNull();
    const bassetlaw = rows.find((row) => row.council_slug === "bassetlaw");
    expect(bassetlaw.turnout_votes).toBeNull();
    expect(bassetlaw.turnout_pct).toBeNull();
  });
});
