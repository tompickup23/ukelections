import { describe, expect, it } from "vitest";
import {
  buildModernGovReviewDraft,
  parseModernGovReviewResult
} from "../scripts/lib/moderngov-review-results.mjs";

const resultHtml = `
  <html>
    <head><meta name="DC.date" content="2024-05-02" /></head>
    <body>
      <h1 class="mgMainTitleTxt">Election results for Burscough Bridge &#38; Rufford</h1>
      <table class="mgStatsTable">
        <caption class="mgSectionTitle">Burscough Bridge &#38; Rufford - results</caption>
        <tr>
          <th>Election Candidate</th><th>Party</th><th>Votes</th><th>%</th><th>Outcome</th>
        </tr>
        <tr>
          <td><span><img /></span> Paul David Hesketh</td>
          <td>Our West Lancashire</td>
          <td>766</td>
          <td>36&#37;</td>
          <td>Elected</td>
        </tr>
        <tr>
          <td><span><img /></span> Jayne Louise Rear</td>
          <td>The Conservative Party</td>
          <td>636</td>
          <td>30&#37;</td>
          <td>Not elected</td>
        </tr>
      </table>
      <table class="mgStatsTable">
        <caption class="mgSectionTitle">Voting Summary</caption>
        <tr><th>Details</th><th>Number</th></tr>
        <tr><td>Seats</td><td>1</td></tr>
        <tr><td>Total votes</td><td>1402</td></tr>
        <tr><td>Electorate</td><td>5722</td></tr>
        <tr><td>Number of ballot papers issued</td><td>1409</td></tr>
        <tr><td>Number of ballot papers rejected</td><td>7</td></tr>
        <tr><td>Turnout</td><td>37&#37;</td></tr>
      </table>
    </body>
  </html>
`;

describe("ModernGov review results", () => {
  it("parses linked ModernGov result pages", () => {
    const result = parseModernGovReviewResult({
      html: resultHtml,
      areaName: "Burscough Bridge & Rufford",
      areaCode: "E05014930",
      sourceUrl: "https://democracy.westlancs.gov.uk/mgElectionAreaResults.aspx?ID=62",
      sourceSnapshotId: "west-lancs-index",
      linkedRawFilePath: "/tmp/linked.aspx"
    });

    expect(result.ok).toBe(true);
    expect(result.record.election_date).toBe("2024-05-02");
    expect(result.record.turnout_votes).toBe(1402);
    expect(result.record.electorate).toBe(5722);
    expect(result.record.turnout).toBe(0.37);
    expect(result.record.result_rows).toContainEqual({
      candidate_or_party_name: "Paul David Hesketh",
      party_name: "Our West Lancashire",
      votes: 766,
      elected: true
    });
    expect(result.record.result_rows).toContainEqual({
      candidate_or_party_name: "Jayne Louise Rear",
      party_name: "The Conservative Party",
      votes: 636,
      elected: false
    });
    expect(result.record.draft_review).toMatchObject({
      declared_total_votes: 1402,
      ballot_papers_issued: 1409,
      rejected_ballots: 7,
      declared_total_matches_candidate_votes: true
    });
  });

  it("drafts cached linked pages and reports missing linked pages", () => {
    const draft = buildModernGovReviewDraft({
      manifest: {
        areas: [
          {
            area_code: "E05014930",
            area_name: "Burscough Bridge & Rufford",
            import_status: "ready_for_row_transformation",
            primary_import_route: "modern_gov_html_transcription",
            primary_source: {
              raw_file_path: "/tmp/west-lancs-index.aspx",
              source_url: "https://democracy.westlancs.gov.uk/mgElectionElectionAreaResults.aspx?EID=8",
              snapshot_id: "west-lancs-index"
            }
          },
          {
            area_code: "E05014887",
            area_name: "Bowerham Ward",
            import_status: "ready_for_row_transformation",
            primary_import_route: "modern_gov_html_transcription",
            primary_source: {
              raw_file_path: "/tmp/lancaster-index.aspx",
              source_url: "https://committeeadmin.lancaster.gov.uk/mgElectionElectionAreaResults.aspx?EID=101",
              snapshot_id: "lancaster-index"
            }
          }
        ]
      },
      generatedAt: "2026-04-20T00:00:00Z",
      sourceReader: (filePath) => filePath.includes("west-lancs")
        ? `<a href="mgElectionAreaResults.aspx?XXR=0&ID=62" title="Link to election area results for Burscough Bridge &#38; Rufford">Burscough Bridge &#38; Rufford</a>`
        : `<a href="mgElectionAreaResults.aspx?XXR=0&ID=382" title="Link to election area results for Bowerham Ward">Bowerham Ward</a>`,
      linkedSources: [{
        file_path: "/tmp/west-lancs-linked.aspx",
        html: resultHtml
      }]
    });

    expect(draft.total_areas).toBe(2);
    expect(draft.drafted_records).toBe(1);
    expect(draft.failed_records).toBe(1);
    expect(draft.records[0].source_url).toBe("https://democracy.westlancs.gov.uk/mgElectionAreaResults.aspx?XXR=0&ID=62");
    expect(draft.failures[0]).toMatchObject({
      area_name: "Bowerham Ward",
      error: "linked_result_page_not_found",
      source_url: "https://committeeadmin.lancaster.gov.uk/mgElectionAreaResults.aspx?XXR=0&ID=382"
    });
  });
});
