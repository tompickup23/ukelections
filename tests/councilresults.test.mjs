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

  it("keeps the hand-verified Hartlebury count when the feed still has Reform UK on 248", () => {
    const hartlebury = read("data/history/byelection-appends.json").results.find(
      (entry) => entry.ballot_paper_id === "local.wychavon.hartlebury.by.2026-10-22",
    );
    // Wychavon's declaration (row.source) gives Reform UK 238, and only 238
    // reconciles: 315 + 238 + 78 = 631 valid plus 2 rejected is 633 papers.
    // Democracy Club still has 248.
    expect(hartlebury.review_status).toBe("hand_verified_declaration");
    const ours = hartlebury.candidates.reduce((total, candidate) => total + candidate.votes, 0);
    expect(ours + hartlebury.spoilt_ballots).toBe(hartlebury.turnout_votes);
    const feed = hartlebury.candidates.map((candidate) => ({
      ...candidate,
      votes: candidate.party_name === "Reform UK" ? 248 : candidate.votes,
    }));
    // The row was hand_verified_two_sources until the declaration was read, and
    // that tier lost to the feed on every nightly. Both tiers must now hold.
    for (const review_status of ["hand_verified_declaration", "hand_verified_two_sources"]) {
      const restored = restoreHistoryCandidates(feed, { ...hartlebury, review_status });
      expect(restored.find((candidate) => candidate.party_name === "Reform UK").votes).toBe(238);
      expect(restored.every((candidate) => candidate.source === hartlebury.source)).toBe(true);
    }
    // A lower tier still never overrides a feed count it disagrees with.
    expect(restoreHistoryCandidates(feed, { ...hartlebury, review_status: "provisional_single_source" })).toBeNull();
    // And the committed contest file is the verified one.
    const doc = read(`${directory}/wychavon-hartlebury-2026-10-22.json`);
    expect(doc.field.candidates.find((candidate) => candidate.party_name === "Reform UK").votes).toBe(238);
    expect(doc.result.total_votes).toBe(631);
  });

  it("does not invent the missing Dudley electorate or reconcile contradictory Bassetlaw turnout", () => {
    expect(rows.find((row) => row.council_slug === "dudley").electorate).toBeNull();
    const bassetlaw = rows.find((row) => row.council_slug === "bassetlaw");
    expect(bassetlaw.turnout_votes).toBeNull();
    expect(bassetlaw.turnout_pct).toBeNull();
  });
});
