import { describe, expect, it } from "vitest";
import {
  buildCouncilHtmlReviewDraft,
  parseRibbleValleyReviewResult
} from "../scripts/lib/council-html-review-results.mjs";

const ribbleValleyHtml = `
  <html>
    <head>
      <meta property="og:url" content="https://www.ribblevalley.gov.uk/borough-elections/borough-elections-2023-results/2">
    </head>
    <body>
      <div class="editor">
        <p>An Election was held on 4&nbsp;May 2023 for Brockhall and Dinckley Ward of Ribble Valley Borough Council.</p>
        <h3>Verified Ballot Papers</h3>
        <ul><li>Turnout: 31.71%</li></ul>
        <h3>The result is set out below:</h3>
        <table>
          <tr><td><strong>Name</strong></td><td><strong>Party</strong></td><td><strong>Votes cast</strong></td><td><strong>&nbsp;</strong></td></tr>
          <tr><td>ATKINSON, Stephen Alexis</td><td>Conservative Party</td><td>315</td><td><strong>ELECTED</strong></td></tr>
          <tr><td>METCALFE, Ian James</td><td>Labour Party</td><td>92</td><td><strong>&nbsp;</strong></td></tr>
        </table>
        <p>Stephen Alexis ATKINSON was duly elected Councillor for the Brockhall and Dinckley Ward of Ribble Valley Borough Council.</p>
      </div>
    </body>
  </html>
`;

describe("council HTML review results", () => {
  it("parses Ribble Valley linked borough ward result pages", () => {
    const result = parseRibbleValleyReviewResult({
      html: ribbleValleyHtml,
      areaName: "Brockhall and Dinckley",
      areaCode: "E05012003",
      fallbackSourceUrl: "https://www.ribblevalley.gov.uk/borough-elections/borough-elections-2023-results",
      sourceSnapshotId: "ribble-index",
      linkedRawFilePath: "/tmp/ribble.html"
    });

    expect(result.ok).toBe(true);
    expect(result.record.election_date).toBe("2023-05-04");
    expect(result.record.turnout).toBe(0.3171);
    expect(result.record.turnout_votes).toBe(407);
    expect(result.record.result_rows).toContainEqual({
      candidate_or_party_name: "ATKINSON, Stephen Alexis",
      party_name: "Conservative Party",
      votes: 315,
      elected: true
    });
    expect(result.record.result_rows).toContainEqual({
      candidate_or_party_name: "METCALFE, Ian James",
      party_name: "Labour Party",
      votes: 92,
      elected: false
    });
  });

  it("drafts supported Ribble Valley areas and reports missing linked pages", () => {
    const draft = buildCouncilHtmlReviewDraft({
      manifest: {
        areas: [
          {
            area_code: "E05012003",
            area_name: "Brockhall and Dinckley",
            council_names: ["Ribble Valley"],
            import_status: "ready_for_row_transformation",
            primary_import_route: "council_html_transcription",
            primary_source: {
              target_id: "ribble-valley-2023-borough-results",
              source_url: "https://www.ribblevalley.gov.uk/borough-elections/borough-elections-2023-results",
              snapshot_id: "ribble-index"
            }
          },
          {
            area_code: "E05012006",
            area_name: "Clayton-Le-Dale and Salesbury",
            council_names: ["Ribble Valley"],
            import_status: "ready_for_row_transformation",
            primary_import_route: "council_html_transcription",
            primary_source: {
              target_id: "ribble-valley-2019-borough-results",
              source_url: "https://www.ribblevalley.gov.uk/borough-elections/borough-elections-2019-results",
              snapshot_id: "ribble-2019-index"
            }
          },
          {
            area_code: "E05000000",
            area_name: "Other",
            council_names: ["Other"],
            import_status: "ready_for_row_transformation",
            primary_import_route: "council_html_transcription",
            primary_source: { target_id: "other" }
          }
        ]
      },
      generatedAt: "2026-04-21T00:00:00Z",
      linkedSources: [{
        file_path: "/tmp/ribble.html",
        html: ribbleValleyHtml
      }]
    });

    expect(draft.total_areas).toBe(2);
    expect(draft.drafted_records).toBe(1);
    expect(draft.failed_records).toBe(1);
    expect(draft.records[0].area_code).toBe("E05012003");
    expect(draft.failures[0]).toMatchObject({
      area_code: "E05012006",
      error: "linked_result_page_not_found",
      source_target_id: "ribble-valley-2019-borough-results"
    });
  });
});
