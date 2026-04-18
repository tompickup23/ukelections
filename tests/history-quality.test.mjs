import { describe, expect, it } from "vitest";
import {
  validateBoundaryVersion,
  validateElectionHistoryRecord,
  validateHistoryBundle
} from "../scripts/lib/history-quality.mjs";

const boundary = {
  boundary_version_id: "ward-2024",
  area_type: "ward",
  area_code: "E05000000",
  area_name: "Example Ward",
  valid_from: "2024-04-01",
  valid_to: null,
  source_snapshot_id: "boundary-source",
  source_url: "https://geoportal.statistics.gov.uk/",
  review_status: "reviewed"
};

const history = {
  history_id: "history-2026",
  contest_id: "contest-2026",
  area_id: "ward-2024",
  area_code: "E05000000",
  area_name: "Example Ward",
  boundary_version_id: "ward-2024",
  election_date: "2026-05-07",
  election_type: "borough",
  voting_system: "fptp",
  source_snapshot_id: "result-source",
  source_url: "https://www.example.gov.uk/results",
  electorate: 1000,
  turnout_votes: 500,
  turnout: 0.5,
  review_status: "reviewed",
  result_rows: [
    { candidate_or_party_name: "A", party_name: "Party A", votes: 300, rank: 1, elected: true },
    { candidate_or_party_name: "B", party_name: "Party B", votes: 200, rank: 2, elected: false }
  ]
};

describe("history quality validation", () => {
  it("accepts matching boundaries and election history", () => {
    const result = validateHistoryBundle({ boundaries: [boundary], history: [history] });
    expect(result.ok).toBe(true);
  });

  it("rejects history outside the boundary validity window", () => {
    const result = validateElectionHistoryRecord(
      { ...history, election_date: "2020-05-07" },
      new Map([[boundary.boundary_version_id, boundary]])
    );

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("election_date must fall within the linked boundary version dates");
  });

  it("rejects mismatched turnout vote totals", () => {
    const result = validateElectionHistoryRecord(
      { ...history, turnout_votes: 501 },
      new Map([[boundary.boundary_version_id, boundary]])
    );

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("sum of result row votes must equal turnout_votes");
  });

  it("rejects duplicate ranks", () => {
    const result = validateElectionHistoryRecord(
      {
        ...history,
        result_rows: [
          history.result_rows[0],
          { ...history.result_rows[1], rank: 1 }
        ]
      },
      new Map([[boundary.boundary_version_id, boundary]])
    );

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("rank 1 is duplicated");
  });

  it("validates boundary dates and source URLs", () => {
    const result = validateBoundaryVersion({
      ...boundary,
      valid_to: "2020-01-01",
      source_url: "geoportal.statistics.gov.uk"
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("valid_to cannot be earlier than valid_from");
    expect(result.errors).toContain("source_url must be an absolute http(s) URL");
  });
});
