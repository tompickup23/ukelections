import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  summariseWardResult,
  deriveElected,
  deriveMajority,
  seatsWonLabel,
  type RawWardResult,
} from "../src/lib/may7WardResult";

const shortLabel = (p: string) => (p === "Liberal Democrats" ? "Lib Dem" : p);

function row(overrides: Partial<RawWardResult> = {}): RawWardResult {
  return {
    ballot_paper_id: "local.test.ward.2026-05-07",
    election_date: "2026-05-07",
    tier: "local",
    council_slug: "test",
    ward_slug: "ward",
    is_by_election: false,
    winner_count: 1,
    electorate: 1000,
    turnout_votes: 500,
    turnout_pct: 0.5,
    spoilt_ballots: 3,
    total_valid_votes: 500,
    candidates: [],
    vote_shares: null,
    winner_party_canonical: null,
    winners: null,
    source: null,
    ...overrides,
  };
}

const cand = (name: string | null, party: string, votes: number, extra: Record<string, unknown> = {}) => ({
  person_id: null,
  name,
  party_name: party,
  party_canonical: party,
  votes,
  ...extra,
});

describe("deriveElected", () => {
  it("trusts explicit elected flags when present", () => {
    const r = row({
      candidates: [
        cand("A", "Reform UK", 1342, { elected: true }),
        cand("B", "Labour", 900, { elected: false }),
      ],
    });
    expect(deriveElected(r).map((c) => c.name)).toEqual(["A"]);
  });

  it("does not mark every candidate elected when names are all null", () => {
    // council-pdf-declaration rows parse party + votes only. Matching the
    // winners list on a normalised name would collapse every null to the
    // same empty string and elect the whole field.
    const r = row({
      candidates: [
        cand(null, "Reform UK", 1342, { elected: true }),
        cand(null, "Green Party", 653, { elected: false }),
        cand(null, "Labour", 183, { elected: false }),
      ],
      winners: [{ name: null, party_canonical: "Reform UK", person_id: null, votes: 1342 }],
    });
    const elected = deriveElected(r);
    expect(elected).toHaveLength(1);
    expect(elected[0].party_canonical).toBe("Reform UK");
  });

  it("falls back to name matching when no candidate carries an elected flag", () => {
    // 41 Wikipedia rows have person_id null and no elected flags at all.
    const r = row({
      winner_count: 2,
      candidates: [
        cand("JORY Alan James", "Conservative", 704),
        cand("SMITH Jane", "Conservative", 690),
        cand("ATKINSON Alfie", "Green Party", 564),
      ],
      winners: [
        { name: "JORY Alan James", party_canonical: "Conservative", person_id: null, votes: 704 },
        { name: "SMITH Jane", party_canonical: "Conservative", person_id: null, votes: 690 },
      ],
    });
    expect(deriveElected(r).map((c) => c.name)).toEqual(["JORY Alan James", "SMITH Jane"]);
  });

  it("falls back to top N by votes when nothing else resolves", () => {
    const r = row({
      winner_count: 2,
      candidates: [cand("A", "Labour", 10), cand("B", "Reform UK", 30), cand("C", "Green Party", 20)],
    });
    expect(deriveElected(r).map((c) => c.name)).toEqual(["B", "C"]);
  });
});

describe("deriveMajority", () => {
  it("is the last elected candidate over the best-placed loser", () => {
    const elected = [cand("A", "Lab", 500), cand("B", "Lab", 450)];
    const losers = [cand("C", "Con", 400), cand("D", "Grn", 100)];
    expect(deriveMajority(elected, losers, false)).toEqual({ majority: 50, overParty: "Con" });
  });

  it("is withheld on an incomplete candidate field", () => {
    const elected = [cand("A", "Grn", 1442)];
    expect(deriveMajority(elected, [cand("B", "Lab", 10)], true).majority).toBeNull();
  });

  it("is withheld when there is no losing candidate", () => {
    expect(deriveMajority([cand("A", "Lab", 100)], [], false).majority).toBeNull();
  });

  it("is withheld rather than reported negative when the elected set sits below a loser", () => {
    // Two Wikipedia rows order this way. A negative majority presented as a
    // win would be worse than saying nothing.
    const elected = [cand("A", "Lab", 300)];
    const losers = [cand("B", "Con", 400)];
    expect(deriveMajority(elected, losers, false).majority).toBeNull();
  });
});

describe("summariseWardResult", () => {
  it("returns null for a ward with no declaration", () => {
    expect(summariseWardResult(null, 5)).toBeNull();
    expect(summariseWardResult(row({ candidates: [] }), 5)).toBeNull();
  });

  it("suppresses vote shares when fewer candidates were recorded than nominated", () => {
    // local.birmingham.stirchley.2026-05-07 records 1 of 5 nominated
    // candidates, which would otherwise publish "Green Party 100.0%".
    const r = row({
      candidates: [cand("Kamel Hawwash", "Green Party", 1442, { elected: true })],
      total_valid_votes: 1442,
      vote_shares: { "Green Party": 1 },
    });
    const s = summariseWardResult(r, 5)!;
    expect(s.incomplete).toBe(true);
    expect(s.recordedCandidates).toBe(1);
    expect(s.nominatedCandidates).toBe(5);
    expect(s.candidates.every((c) => c.share === null)).toBe(true);
    expect(s.majority).toBeNull();
  });

  it("computes shares when the candidate field is complete", () => {
    const r = row({
      candidates: [cand("A", "Labour", 600, { elected: true }), cand("B", "Reform UK", 400)],
      total_valid_votes: 1000,
    });
    const s = summariseWardResult(r, 2)!;
    expect(s.incomplete).toBe(false);
    expect(s.candidates[0].share).toBeCloseTo(0.6);
    expect(s.majority).toBe(200);
    expect(s.majorityOverParty).toBe("Reform UK");
  });

  it("treats a missing nomination count as complete rather than guessing", () => {
    const r = row({ candidates: [cand("A", "Labour", 600, { elected: true }), cand("B", "Con", 400)] });
    expect(summariseWardResult(r, null)!.incomplete).toBe(false);
  });

  it("reports a split multi-member ward by party, not a single winner", () => {
    const r = row({
      winner_count: 3,
      candidates: [
        cand("A", "Labour", 900, { elected: true }),
        cand("B", "Labour", 880, { elected: true }),
        cand("C", "Reform UK", 870, { elected: true }),
        cand("D", "Reform UK", 800),
      ],
    });
    const s = summariseWardResult(r, 4)!;
    expect(s.split).toBe(true);
    expect(s.seatsByParty).toEqual([
      { party: "Labour", seats: 2 },
      { party: "Reform UK", seats: 1 },
    ]);
    expect(seatsWonLabel(s, shortLabel)).toBe("2 Labour, 1 Reform UK");
    expect(s.majority).toBe(70);
  });

  it("names a single-seat winner without plural seat counts", () => {
    const r = row({ candidates: [cand("A", "Liberal Democrats", 600, { elected: true }), cand("B", "Con", 400)] });
    const s = summariseWardResult(r, 2)!;
    expect(s.split).toBe(false);
    expect(seatsWonLabel(s, shortLabel)).toBe("Lib Dem");
  });

  it("sorts candidates by votes descending", () => {
    const r = row({
      winner_count: 1,
      candidates: [cand("Low", "Grn", 100), cand("High", "Lab", 900, { elected: true }), cand("Mid", "Con", 500)],
    });
    expect(summariseWardResult(r, 3)!.candidates.map((c) => c.name)).toEqual(["High", "Mid", "Low"]);
  });

  it("carries provenance through so the page can caveat a Wikipedia row", () => {
    const r = row({
      candidates: [cand("A", "Labour", 600, { elected: true }), cand("B", "Con", 400)],
      source_provider: "wikipedia",
      source_article: "https://en.wikipedia.org/wiki/2026_Birmingham_City_Council_election",
      quality_caveat: "Community-maintained Wikipedia mirror; reconcile against council declaration if available.",
    });
    const s = summariseWardResult(r, 2)!;
    expect(s.provider).toBe("wikipedia");
    expect(s.qualityCaveat).toContain("Wikipedia");
  });

  it("tolerates a null turnout without breaking the summary", () => {
    const r = row({
      turnout_pct: null,
      electorate: null,
      spoilt_ballots: null,
      candidates: [cand("A", "Labour", 600, { elected: true }), cand("B", "Con", 400)],
    });
    const s = summariseWardResult(r, 2)!;
    expect(s.turnoutPct).toBeNull();
    expect(s.totalValidVotes).toBe(500);
  });
});

// Guards against the real corpus, so a bad data refresh fails here rather
// than publishing a wrong number across thousands of ward pages.
describe("the committed 7 May 2026 corpus", () => {
  const ROOT = process.cwd();
  const results = JSON.parse(
    readFileSync(path.join(ROOT, "data/results/may-2026/local-and-mayor.merged.json"), "utf8")
  );
  const identity = JSON.parse(readFileSync(path.join(ROOT, "data/identity/wards-may-2026.json"), "utf8"));
  const nominated = new Map<string, number>(
    identity.wards.map((w: any) => [w.ballot_paper_id, w.candidate_count])
  );
  const rows: RawWardResult[] = Object.values(results.by_ballot as Record<string, RawWardResult>).filter(
    (r) => r.tier === "local" || r.tier === "mayor"
  );

  it("summarises every declared ward without throwing", () => {
    expect(rows.length).toBeGreaterThan(2800);
    for (const r of rows) {
      expect(() => summariseWardResult(r, nominated.get(r.ballot_paper_id) ?? null)).not.toThrow();
    }
  });

  it("elects exactly the number of seats contested in every ward", () => {
    const wrong = rows.filter((r) => {
      const s = summariseWardResult(r, nominated.get(r.ballot_paper_id) ?? null);
      return s && s.elected.length !== s.seats;
    });
    expect(wrong.map((r) => r.ballot_paper_id)).toEqual([]);
  });

  it("never publishes a 100% vote share off a partial candidate field", () => {
    const bogus = rows
      .map((r) => summariseWardResult(r, nominated.get(r.ballot_paper_id) ?? null))
      .filter((s) => s && s.candidates.some((c) => c.share != null && c.share >= 0.999));
    expect(bogus.map((s) => s!.ballotPaperId)).toEqual([]);
  });

  it("never reports a negative majority", () => {
    const negative = rows
      .map((r) => summariseWardResult(r, nominated.get(r.ballot_paper_id) ?? null))
      .filter((s) => s && s.majority != null && s.majority < 0);
    expect(negative.map((s) => s!.ballotPaperId)).toEqual([]);
  });

  it("flags the known partial declarations rather than rendering them as complete", () => {
    const incomplete = rows
      .map((r) => summariseWardResult(r, nominated.get(r.ballot_paper_id) ?? null))
      .filter((s) => s?.incomplete);
    // 40 rows at the 20 Aug 2026 snapshot. Kept as a floor-and-ceiling so a
    // refresh that silently drops candidates trips the test.
    expect(incomplete.length).toBeGreaterThan(0);
    expect(incomplete.length).toBeLessThan(rows.length * 0.05);
  });
});
