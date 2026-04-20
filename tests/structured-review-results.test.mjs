import { describe, expect, it } from "vitest";
import {
  buildStructuredReviewDraft,
  parseStructuredReviewResult
} from "../scripts/lib/structured-review-results.mjs";

describe("structured review results", () => {
  it("parses Blackburn ward result tables with a separate elected column", () => {
    const html = `
      <h2 id="darwen-east-ward">Darwen East ward</h2>
      <div class="table-responsive"><table>
        <thead><tr><th>Candidate</th><th>Party</th><th>Votes</th><th>Elected</th></tr></thead>
        <tbody>
          <tr><td>BROWNE, Paul</td><td>Independent</td><td>331</td><td>&nbsp;</td></tr>
          <tr><td>FIELDING, Katrina Louise</td><td>Labour Party</td><td>773</td><td>Elected</td></tr>
          <tr><td>SLATER, Ryan</td><td>Conservative Party</td><td>214</td><td>&nbsp;</td></tr>
        </tbody>
      </table></div>
      <ul><li>Spoilt: 17</li><li>Total votes cast: 1335</li><li>Turnout: 20.72%</li></ul>
    `;

    const result = parseStructuredReviewResult({
      html,
      areaName: "Darwen East",
      areaCode: "E05011514",
      electionDate: "2024-05-02",
      sourceUrl: "https://blackburn.gov.uk/results",
      sourceSnapshotId: "blackburn-snapshot"
    });

    expect(result.ok).toBe(true);
    expect(result.record.turnout_votes).toBe(1318);
    expect(result.record.turnout).toBe(0.2072);
    expect(result.record.result_rows).toContainEqual({
      candidate_or_party_name: "FIELDING, Katrina Louise",
      party_name: "Labour Party",
      votes: 773,
      elected: true
    });
    expect(result.record.draft_review).toMatchObject({
      declared_total_votes_cast: 1335,
      spoilt_ballots: 17,
      declared_total_matches_candidate_votes_plus_spoilt: true
    });
  });

  it("parses Pendle result tables with elected text embedded in the votes cell", () => {
    const html = `
      <h2>Fence and Higham Ward</h2>
      <p>Number of Councillors to be elected - one</p>
      <table>
        <tbody>
          <tr><td><h4>Name of Candidate</h4></td><td><h4>Description</h4></td><td><h4>Number of Votes</h4></td></tr>
          <tr><td>HARTLEY, Howard</td><td>The Conservative Party Candidate</td><td>378</td></tr>
          <tr><td>NEWMAN, Brian</td><td>Liberal Democrat</td><td>442 <strong>ELECTED</strong></td></tr>
        </tbody>
      </table>
      <p>Rejected ballot papers: 2<br />Voter turnout: 41.68%</p>
    `;

    const result = parseStructuredReviewResult({
      html,
      areaName: "Fence and Higham",
      areaCode: "E05013207",
      electionDate: "2024-05-02",
      sourceUrl: "https://www.pendle.gov.uk/results",
      sourceSnapshotId: "pendle-snapshot"
    });

    expect(result.ok).toBe(true);
    expect(result.record.turnout_votes).toBe(820);
    expect(result.record.turnout).toBe(0.4168);
    expect(result.record.result_rows).toContainEqual({
      candidate_or_party_name: "NEWMAN, Brian",
      party_name: "Liberal Democrat",
      votes: 442,
      elected: true
    });
    expect(result.record.draft_review.declared_total_matches_candidate_votes_plus_spoilt).toBeUndefined();
  });

  it("drafts only structured HTML review records from the manifest", () => {
    const files = new Map([
      ["/tmp/pendle.html", `
        <h2>Waterside and Horsfield</h2>
        <table>
          <tr><td>Name of Candidate</td><td>Description</td><td>Number of Votes</td></tr>
          <tr><td>EDWARDS, Craig Anthony</td><td>Liberal Democrat</td><td>332</td></tr>
          <tr><td>PENNEY, David Richard John</td><td>The Green Party</td><td>109</td></tr>
          <tr><td>ROACH, Graham</td><td>Labour Party</td><td>424</td></tr>
          <tr><td>SUTCLIFFE, Ash</td><td>The Conservative Party Candidate</td><td>581 ELECTED</td></tr>
        </table>
        <p>Rejected ballot papers: 14<br />Voter turnout: 25.65%</p>
      `],
      ["/tmp/other.html", "<h2>Other</h2>"]
    ]);

    const draft = buildStructuredReviewDraft({
      manifest: {
        areas: [
          {
            area_code: "E05013210",
            area_name: "Waterside and Horsfield",
            import_status: "ready_for_row_transformation",
            primary_import_route: "structured_html_table_transcription",
            primary_source: {
              raw_file_path: "/tmp/pendle.html",
              source_url: "https://www.pendle.gov.uk/results",
              snapshot_id: "pendle-snapshot"
            }
          },
          {
            area_code: "E05000001",
            area_name: "Other",
            import_status: "ready_for_row_transformation",
            primary_import_route: "council_html_transcription",
            primary_source: { raw_file_path: "/tmp/other.html" }
          }
        ]
      },
      generatedAt: "2026-04-20T00:00:00Z",
      sourceReader: (filePath) => files.get(filePath)
    });

    expect(draft.total_areas).toBe(1);
    expect(draft.drafted_records).toBe(1);
    expect(draft.records[0].area_code).toBe("E05013210");
    expect(draft.records[0].result_rows.find((row) => row.elected)).toMatchObject({
      candidate_or_party_name: "SUTCLIFFE, Ash",
      votes: 581
    });
  });
});
