// Locks the T14 snippet fixes from the SEO audit of 2 November 2026:
// placeholder or self-contradicting text in titles, descriptions and the
// visible page. Each assertion names the defect it stops coming back.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadMay7Headline } from "../src/lib/siteData";
import { historyRowAsWardResult, summariseWardResult, seatsWonLabel } from "../src/lib/may7WardResult";

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");

describe("past-results coverage", () => {
  it("is a fraction, so the description cannot print 9770.0%", () => {
    const share = loadMay7Headline().declared_coverage_share;
    expect(share).toBeGreaterThan(0);
    expect(share).toBeLessThanOrEqual(1);
    const snapshot = JSON.parse(read("data/transparency/may-2026-postaudit-2026-05-10.json")).snapshot;
    expect((share * 100).toFixed(1)).toBe(snapshot.coverage_pct.toFixed(1));
  });
});

describe("council page next-election clause", () => {
  const src = read("src/components/CouncilDetail.astro");
  it("never writes the unverified label into the description or a status card", () => {
    expect(src).not.toMatch(/Next: \$\{nextElection\.label\}\.`;/);
    // The description moved into councilDescription() with the quality reset;
    // tests/ward-quality-reset.test.ts covers its clause rules.
    expect(src).toMatch(/nextLabel: nextKnown \? nextElection\.label : null/);
    expect(src).toMatch(/\{nextKnown && \(<article class="status-card">/);
  });
});

describe("ward page titles", () => {
  const src = read("src/pages/seats/[council]/[ward]/index.astro");
  it("no longer sell a 2026 forecast for a vote that has been held", () => {
    expect(src).not.toContain("Election results and 2026 forecast");
  });
  it("do not show the post-vote rerun beside a declared result", () => {
    expect(src).toContain("{wp?.prediction && !result && (");
    expect(src).not.toContain("published here unedited");
  });
});

describe("historyRowAsWardResult", () => {
  const ballot = "local.test.ward.2026-05-07";
  const historyRow = {
    ballot_paper_id: ballot,
    election_date: "2026-05-07",
    tier: "local",
    council_slug: "test",
    ward_slug: "ward",
    is_by_election: false,
    turnout_votes: null,
    turnout_pct: 0.3,
    spoilt_ballots: 10,
    electorate: null,
    source: "https://example.gov.uk/results",
    candidates: [
      { person_id: 1, name: "A", party_name: "Conservative and Unionist Party", votes: 1700, elected: true },
      { person_id: 2, name: "B", party_name: "Conservative and Unionist Party", votes: 1500, elected: true },
      { person_id: 3, name: "C", party_name: "Labour Party", votes: 1400, elected: false },
    ],
  };

  it("renders the archive declaration with the scored file's party names", () => {
    const raw = historyRowAsWardResult(historyRow, ballot, 2)!;
    const summary = summariseWardResult(raw, 3)!;
    expect(seatsWonLabel(summary, (p) => p)).toBe("2 Conservative");
    expect(summary.provider).toBe("dc-history");
    expect(summary.totalValidVotes).toBeNull();
    expect(summary.majority).toBe(100);
  });

  it("refuses a row for a different ballot or with no votes", () => {
    expect(historyRowAsWardResult(historyRow, "local.test.other.2026-05-07", 2)).toBeNull();
    expect(historyRowAsWardResult({ ...historyRow, candidates: [] }, ballot, 2)).toBeNull();
    expect(historyRowAsWardResult(undefined, ballot, 2)).toBeNull();
  });
});
