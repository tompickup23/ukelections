import { describe, expect, it } from "vitest";
import { importOfficialHistoryRecords } from "../scripts/lib/official-history-importer.mjs";
import { validateHistoryBundle } from "../scripts/lib/history-quality.mjs";

describe("official history importer", () => {
  it("imports manual official ward results against known boundaries", () => {
    const boundaries = [{
      boundary_version_id: "boundary-1",
      area_type: "ward",
      area_code: "E05000001",
      area_name: "Example Ward",
      valid_from: "2015-01-01",
      valid_to: null,
      source_snapshot_id: "source-1",
      source_url: "https://ukelections.co.uk/sources",
      review_status: "reviewed"
    }];
    const history = importOfficialHistoryRecords({
      officialHistoryData: {
        source_name: "Example Council official results",
        records: [{
          area_code: "E05000001",
          area_name: "Example Ward",
          election_date: "2019-05-02",
          election_type: "borough",
          voting_system: "fptp",
          source_url: "https://example.com/result",
          electorate: 1000,
          turnout: 0.4,
          seats_contested: 1,
          result_rows: [
            { candidate_or_party_name: "Winner", party_name: "A", votes: 300, elected: true },
            { candidate_or_party_name: "Runner Up", party_name: "B", votes: 100, elected: false }
          ]
        }]
      },
      sourceSnapshot: { snapshot_id: "official-source-1", source_url: "https://example.com/result" },
      boundaries
    });

    expect(validateHistoryBundle({ boundaries, history }).ok).toBe(true);
    expect(history[0].turnout_votes).toBe(400);
    expect(history[0].review_status).toBe("reviewed");
    expect(history[0].source_url).toBe("https://example.com/result");
    expect(history[0].upstream.official_result).toBe(true);
  });

  it("can replace quarantined existing history for the same area and date", () => {
    const boundaries = [{
      boundary_version_id: "boundary-1",
      area_type: "ward",
      area_code: "E05000001",
      area_name: "Example Ward",
      valid_from: "2015-01-01",
      valid_to: null,
      source_snapshot_id: "source-1",
      source_url: "https://ukelections.co.uk/sources",
      review_status: "reviewed"
    }];
    const history = importOfficialHistoryRecords({
      officialHistoryData: {
        source_name: "Example Council official results",
        records: [{
          area_code: "E05000001",
          area_name: "Example Ward",
          election_date: "2019-05-02",
          election_type: "borough",
          voting_system: "fptp",
          source_url: "https://example.com/result",
          result_rows: [
            { candidate_or_party_name: "Winner", party_name: "A", votes: 300, elected: true },
            { candidate_or_party_name: "Runner Up", party_name: "B", votes: 100, elected: false }
          ]
        }]
      },
      sourceSnapshot: { snapshot_id: "official-source-1", source_url: "https://example.com/result" },
      boundaries,
      existingHistory: [{
        area_code: "E05000001",
        election_date: "2019-05-02",
        review_status: "quarantined"
      }]
    });

    expect(history).toHaveLength(1);
  });
});
