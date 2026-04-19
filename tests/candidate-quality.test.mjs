import { describe, expect, it } from "vitest";
import { validateCandidateRoster } from "../scripts/lib/candidate-quality.mjs";

const roster = {
  roster_id: "roster-1",
  contest_id: "contest-1",
  area_code: "E05000000",
  election_date: "2026-05-07",
  source_snapshot_id: "source-1",
  statement_of_persons_nominated_url: "https://www.example.gov.uk/nominations",
  review_status: "reviewed",
  candidates: [
    { candidate_id: "a", person_name: "A", party_name: "Party A", party_id: "a", incumbent: false, defending_seat: false, status: "standing" },
    { candidate_id: "b", person_name: "B", party_name: "Party B", party_id: "b", incumbent: true, defending_seat: true, status: "standing" }
  ]
};

describe("candidate roster validation", () => {
  it("accepts a sourced contested roster", () => {
    expect(validateCandidateRoster(roster).ok).toBe(true);
  });

  it("rejects uncontested or single-party rosters", () => {
    const result = validateCandidateRoster({
      ...roster,
      candidates: [roster.candidates[0]]
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("at least two standing parties/candidates are required for a contested forecast");
  });

  it("rejects duplicate candidate ids", () => {
    const result = validateCandidateRoster({
      ...roster,
      candidates: [roster.candidates[0], { ...roster.candidates[1], candidate_id: "a" }]
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("candidate_id a is duplicated");
  });
});
