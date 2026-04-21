import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { importCommonsLibraryWestminsterResults } from "../scripts/lib/commons-library-results-importer.mjs";
import { validateHistoryBundle } from "../scripts/lib/history-quality.mjs";
import { validateModelInputs } from "../scripts/lib/model-input-quality.mjs";

const sourceSnapshot = {
  snapshot_id: "commons-library-db-123",
  source_url: "https://electionresults.parliament.uk/"
};

function createDb() {
  const dir = mkdtempSync(path.join(tmpdir(), "commons-results-"));
  const dbPath = path.join(dir, "psephology.db");
  const sql = `
CREATE TABLE general_elections (id INTEGER PRIMARY KEY, polling_on TEXT, is_notional INTEGER);
CREATE TABLE elections (id INTEGER PRIMARY KEY, polling_on TEXT, is_notional INTEGER, valid_vote_count INTEGER, invalid_vote_count INTEGER, majority INTEGER, constituency_group_id INTEGER, general_election_id INTEGER, electorate_id INTEGER, is_verified INTEGER);
CREATE TABLE constituency_groups (id INTEGER PRIMARY KEY, name TEXT, constituency_area_id INTEGER);
CREATE TABLE constituency_areas (id INTEGER PRIMARY KEY, name TEXT, geographic_code TEXT, boundary_set_id INTEGER);
CREATE TABLE boundary_sets (id INTEGER PRIMARY KEY, start_on TEXT, description TEXT);
CREATE TABLE electorates (id INTEGER PRIMARY KEY, population_count INTEGER);
CREATE TABLE candidacies (id INTEGER PRIMARY KEY, candidate_given_name TEXT, candidate_family_name TEXT, is_standing_as_independent INTEGER, is_notional INTEGER, result_position INTEGER, is_winning_candidacy INTEGER, vote_count INTEGER, vote_share FLOAT, election_id INTEGER);
CREATE TABLE certifications (id INTEGER PRIMARY KEY, candidacy_id INTEGER, political_party_id INTEGER);
CREATE TABLE political_parties (id INTEGER PRIMARY KEY, name TEXT, abbreviation TEXT);

INSERT INTO general_elections VALUES (5, '2019-12-12', 1), (6, '2024-07-04', 0);
INSERT INTO boundary_sets VALUES (1, '2024-05-30', '2024 Parliamentary constituencies');
INSERT INTO constituency_areas VALUES (1, 'Example Seat', 'E14000001', 1);
INSERT INTO constituency_groups VALUES (1, 'Example Seat', 1);
INSERT INTO electorates VALUES (1, 70000), (2, 71000);
INSERT INTO elections VALUES (10, '2019-12-12', 1, 30000, 100, 1000, 1, 5, 1, 1);
INSERT INTO elections VALUES (11, '2024-07-04', 0, 31000, 90, 2000, 1, 6, 2, 1);
INSERT INTO political_parties VALUES (1, 'Labour', 'Lab'), (2, 'Conservative', 'Con'), (3, 'Co-operative Party', 'Co-op');
INSERT INTO candidacies VALUES (100, 'Alice', 'Example', 0, 1, 1, 1, 16000, 0.533333, 10);
INSERT INTO candidacies VALUES (101, 'Bob', 'Example', 0, 1, 2, 0, 14000, 0.466667, 10);
INSERT INTO candidacies VALUES (102, 'Alice', 'Example', 0, 0, 1, 1, 16500, 0.532258, 11);
INSERT INTO candidacies VALUES (103, 'Bob', 'Example', 0, 0, 2, 0, 14500, 0.467742, 11);
INSERT INTO certifications VALUES (1, 100, 1), (2, 100, 3), (3, 101, 2), (4, 102, 1), (5, 102, 3), (6, 103, 2);
`;
  execFileSync("sqlite3", [dbPath], { input: sql });
  return dbPath;
}

describe("Commons Library Westminster results importer", () => {
  it("imports 2024 and 2019-notional constituency history from the psephology database", () => {
    const imported = importCommonsLibraryWestminsterResults({
      dbPath: createDb(),
      sourceSnapshot,
      constituencyAsylum: {
        constituencies: {
          "Example Seat": {
            area_name: "Example Seat",
            asylum_seekers: 10,
            asylum_rate_per_10k: 1.4,
            population: 72000
          }
        }
      },
      constituencyAsylumSnapshot: sourceSnapshot,
      asOf: "2026-04-21"
    });
    const historyValidation = validateHistoryBundle({
      boundaries: imported.boundaries,
      history: imported.history
    });
    const modelValidation = validateModelInputs({
      pollAggregates: [],
      featureSnapshots: imported.featureSnapshots
    });

    expect(historyValidation.ok).toBe(true);
    expect(modelValidation.ok).toBe(true);
    expect(imported.boundaries).toHaveLength(1);
    expect(imported.history).toHaveLength(2);
    expect(imported.history.map((row) => row.review_status).sort()).toEqual(["reviewed", "reviewed_with_warnings"]);
    expect(imported.history[0].result_rows[0]).toMatchObject({
      party_name: "Labour (Co-op)",
      elected: true
    });
    expect(imported.featureSnapshots[0]).toMatchObject({
      area_code: "E14000001",
      model_family: "westminster_fptp",
      features: {
        electoral_history: {
          previous_contests: 2,
          baseline_party: "Labour (Co-op)"
        },
        asylum_context: {
          precision: "constituency_context"
        }
      }
    });
  });
});
