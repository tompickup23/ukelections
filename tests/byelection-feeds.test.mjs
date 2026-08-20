import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Guards the two by-election feeds that a silent failure hid for four months:
// the sidecar the weekly sweep writes (models read it) and the hand-curated
// display scorecard. On 20 Aug 2026 the sweep's rows were being overwritten by
// the nightly ingest, and the scorecard had been frozen since 23 July while the
// page still described the window as current.
const read = (rel) => JSON.parse(readFileSync(path.join(process.cwd(), rel), "utf8"));

describe("by-election sidecar", () => {
  const doc = read("data/history/byelection-appends.json");

  it("holds one row per ballot, with a date and a full vote count", () => {
    expect(doc.results.length).toBeGreaterThan(0);
    const ids = doc.results.map((r) => r.ballot_paper_id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of doc.results) {
      expect(r.ballot_paper_id).toMatch(/^local\..+\.by\.\d{4}-\d{2}-\d{2}$/);
      expect(r.election_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.is_by_election).toBe(true);
      expect(r.candidates.length).toBeGreaterThan(0);
      for (const c of r.candidates) expect(typeof c.votes).toBe("number");
    }
  });

  it("carries results newer than the DC results endpoint, which is what it exists for", () => {
    // The bulk results endpoint stalled at 2026-04-23. If the sidecar's newest
    // row is no newer than that, the sweep is not reaching the ballots API.
    const newest = doc.results.map((r) => r.election_date).sort().at(-1);
    expect(newest > "2026-04-23").toBe(true);
  });
});

describe("local by-election scorecard", () => {
  const doc = read("data/results/local-byelections.json");

  it("declares a window that contains every round it holds, ending on the last one", () => {
    const dates = doc.dates.map((d) => d.date).sort();
    expect(dates.at(0) >= doc.window.from).toBe(true);
    // The published window must not claim to run past the last result in it,
    // and must not stop short of one either.
    expect(dates.at(-1)).toBe(doc.window.to);
    expect([...new Set(dates)].length).toBe(dates.length);
  });

  it("gives every contest a winner, a previous holder and a source", () => {
    for (const round of doc.dates) {
      expect(round.sources.length).toBeGreaterThan(0);
      expect(round.contests.length).toBeGreaterThan(0);
      for (const c of round.contests) {
        expect(c.ward).toBeTruthy();
        expect(c.council).toBeTruthy();
        expect(c.winner).toBeTruthy();
        expect(c.previous).toBeTruthy();
        if (c.share_pct != null) {
          expect(c.share_pct).toBeGreaterThan(0);
          expect(c.share_pct).toBeLessThanOrEqual(100);
        }
      }
    }
  });
});
