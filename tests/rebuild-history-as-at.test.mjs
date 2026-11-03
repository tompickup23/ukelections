import { describe, expect, it } from "vitest";
import { historyAsAt } from "../scripts/rebuild-history-as-at.mjs";

const row = (id, date, extra = {}) => ({ ballot_paper_id: id, election_date: date, year: Number(date.slice(0, 4)), tier: "local", council_slug: "burnley", ward_slug: id.split(".")[2], is_by_election: id.includes(".by."), candidates: [], ...extra });

const fixture = () => {
  const a = row("local.burnley.gannow.2024-05-02", "2024-05-02");
  const b = row("local.burnley.gannow.by.2026-04-23", "2026-04-23");
  const c = row("local.burnley.bank-hall.by.2026-04-30", "2026-04-30");
  const appendedEarly = row("local.burnley.rosegrove.by.2026-03-12", "2026-03-12");
  return {
    snapshot: { retrieved_at: "2026-04-25T16:09:17.456Z" },
    results: [a, b, c, appendedEarly],
    by_ballot: { [a.ballot_paper_id]: a, [b.ballot_paper_id]: b, [c.ballot_paper_id]: c },
    by_council: { "local::burnley": [a.ballot_paper_id, b.ballot_paper_id, c.ballot_paper_id] },
    by_ward_slug: {
      "local::burnley::gannow": [b.ballot_paper_id, a.ballot_paper_id],
      "local::burnley::bank-hall": [c.ballot_paper_id],
    },
    by_year: { 2024: 1, 2026: 2 },
  };
};

describe("history as at a date", () => {
  it("drops every row polled after the date, from results and every index", () => {
    const h = historyAsAt(fixture(), "2026-04-25");
    expect(h.results.map((r) => r.ballot_paper_id)).not.toContain("local.burnley.bank-hall.by.2026-04-30");
    expect(h.by_ballot["local.burnley.bank-hall.by.2026-04-30"]).toBeUndefined();
    expect(h.by_ward_slug["local::burnley::bank-hall"]).toBeUndefined();
    expect(h.by_council["local::burnley"]).not.toContain("local.burnley.bank-hall.by.2026-04-30");
    expect(h.snapshot.as_at_dropped_results).toBe(1);
  });

  it("keeps a row polled on the date itself", () => {
    const h = historyAsAt(fixture(), "2026-04-23");
    expect(h.by_ballot["local.burnley.gannow.by.2026-04-23"]).toBeDefined();
  });

  it("indexes a kept row that only the results list held", () => {
    const h = historyAsAt(fixture(), "2026-04-25");
    expect(h.by_ballot["local.burnley.rosegrove.by.2026-03-12"]).toBeDefined();
    expect(h.by_ward_slug["local::burnley::rosegrove"]).toEqual(["local.burnley.rosegrove.by.2026-03-12"]);
    expect(h.snapshot.as_at_added_to_indexes).toBe(1);
  });

  it("recounts by_year and records the rule and the input's retrieval time", () => {
    const h = historyAsAt(fixture(), "2026-04-25");
    expect(h.by_year).toEqual({ 2024: 1, 2026: 2 });
    expect(h.snapshot.as_at).toBe("2026-04-25");
    expect(h.snapshot.as_at_input_retrieved_at).toBe("2026-04-25T16:09:17.456Z");
  });

  it("does not change the input", () => {
    const f = fixture();
    historyAsAt(f, "2025-01-01");
    expect(f.results).toHaveLength(4);
  });

  it("refuses a malformed date", () => {
    expect(() => historyAsAt(fixture(), "25 April 2026")).toThrow();
  });
});
