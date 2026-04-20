import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { importDcleapilSupplementalHistory } from "../scripts/lib/dcleapil-supplemental-history.mjs";
import { validateHistoryBundle } from "../scripts/lib/history-quality.mjs";

const sourceSnapshot = {
  snapshot_id: "dcleapil-source-1",
  source_url: "https://ukelections.co.uk/sources"
};

describe("DCLEAPIL supplemental history importer", () => {
  it("imports exact-GSS contests without duplicating existing area/date history", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ukelections-dcleapil-"));
    const csvPath = path.join(dir, "dcleapil.csv");
    writeFileSync(csvPath, [
      "person_name,merge_ballot_paper,year,council,ward,party_name,votes_cast,elected,seats_contested_calc,electorate,turnout_percentage,GSS,LEAP_post_label",
      "Alice Example,ribble.example.2022-05-05,2022,Ribble Valley,Example,Labour Party,120,t,1,500,50,E05000001,\"Example, Ward\"",
      "Bob Example,ribble.example.2022-05-05,2022,Ribble Valley,Example,Conservative and Unionist Party,100,f,1,500,50,E05000001,\"Example, Ward\"",
      "Old Existing,ribble.example.2023-05-04,2023,Ribble Valley,Example,Labour Party,140,t,1,510,52,E05000001,\"Example, Ward\"",
      "Wrong Area,ribble.other.2022-05-05,2022,Ribble Valley,Other,Labour Party,999,t,1,500,50,E05099999,Other"
    ].join("\n"), "utf8");

    const boundaries = [{
      boundary_version_id: "boundary-1",
      area_type: "ward",
      area_code: "E05000001",
      area_name: "Example Ward",
      valid_from: "2020-01-01",
      valid_to: null,
      source_snapshot_id: "source-1",
      source_url: "https://ukelections.co.uk/sources",
      review_status: "reviewed"
    }];
    const existingHistory = [{ area_code: "E05000001", election_date: "2023-05-04" }];

    const history = await importDcleapilSupplementalHistory({
      dcleapilPath: csvPath,
      sourceSnapshot,
      boundaries,
      existingHistory
    });

    const validation = validateHistoryBundle({ boundaries, history });
    expect(validation.ok).toBe(true);
    expect(history).toHaveLength(1);
    expect(history[0].area_code).toBe("E05000001");
    expect(history[0].election_date).toBe("2022-05-05");
    expect(history[0].turnout_votes).toBe(220);
    expect(history[0].review_status).toBe("reviewed_with_warnings");
    expect(history[0].result_rows[0].party_name).toBe("Labour");
    expect(history[0].upstream.exact_gss_match).toBe(true);
  });

  it("drops supplemental contests with no candidate votes", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ukelections-dcleapil-zero-"));
    const csvPath = path.join(dir, "dcleapil.csv");
    writeFileSync(csvPath, [
      "person_name,merge_ballot_paper,year,council,ward,party_name,votes_cast,elected,seats_contested_calc,electorate,turnout_percentage,GSS,LEAP_post_label",
      "Alice Example,ribble.example.2022-05-05,2022,Ribble Valley,Example,Labour Party,0,t,1,500,0,E05000001,\"Example, Ward\"",
      "Bob Example,ribble.example.2022-05-05,2022,Ribble Valley,Example,Conservative and Unionist Party,0,f,1,500,0,E05000001,\"Example, Ward\""
    ].join("\n"), "utf8");

    const history = await importDcleapilSupplementalHistory({
      dcleapilPath: csvPath,
      sourceSnapshot,
      boundaries: [{
        boundary_version_id: "boundary-1",
        area_type: "ward",
        area_code: "E05000001",
        area_name: "Example Ward",
        valid_from: "2020-01-01",
        valid_to: null,
        source_snapshot_id: "source-1",
        source_url: "https://ukelections.co.uk/sources",
        review_status: "reviewed"
      }],
      existingHistory: []
    });

    expect(history).toHaveLength(0);
  });
});
