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
CREATE TABLE constituency_area_overlaps (id INTEGER PRIMARY KEY, from_constituency_area_id INTEGER, to_constituency_area_id INTEGER, from_constituency_population FLOAT, to_constituency_population FLOAT, formed_from_whole_of INTEGER, forms_whole_of INTEGER);

INSERT INTO general_elections VALUES (1, '2010-05-06', 0), (2, '2015-05-07', 0), (3, '2017-06-08', 0), (5, '2019-12-12', 1), (6, '2024-07-04', 0);
INSERT INTO boundary_sets VALUES (1, '2024-05-30', '2024 Parliamentary constituencies');
INSERT INTO constituency_areas VALUES (1, 'Example Seat', 'E14000001', 1);
INSERT INTO constituency_areas VALUES (2, 'Old Example Seat', 'E14000999', 1);
INSERT INTO constituency_groups VALUES (1, 'Example Seat', 1), (2, 'Old Example Seat', 2);
INSERT INTO constituency_area_overlaps VALUES (1, 2, 1, 1.0, 1.0, 1, 1);
INSERT INTO electorates VALUES (1, 70000), (2, 71000), (3, 68000), (4, 69000), (5, 69500);
INSERT INTO elections VALUES (7, '2010-05-06', 0, 28000, 120, 500, 2, 1, 3, 1);
INSERT INTO elections VALUES (8, '2015-05-07', 0, 28500, 110, 600, 2, 2, 4, 1);
INSERT INTO elections VALUES (9, '2017-06-08', 0, 29000, 100, 800, 2, 3, 5, 1);
INSERT INTO elections VALUES (10, '2019-12-12', 1, 30000, 100, 1000, 1, 5, 1, 1);
INSERT INTO elections VALUES (11, '2024-07-04', 0, 31000, 90, 2000, 1, 6, 2, 1);
INSERT INTO political_parties VALUES (1, 'Labour', 'Lab'), (2, 'Conservative', 'Con'), (3, 'Co-operative Party', 'Co-op');
INSERT INTO candidacies VALUES (94, 'Alice', 'Example', 0, 0, 1, 1, 15000, 0.535714, 7);
INSERT INTO candidacies VALUES (95, 'Bob', 'Example', 0, 0, 2, 0, 13000, 0.464286, 7);
INSERT INTO candidacies VALUES (96, 'Alice', 'Example', 0, 0, 1, 1, 15200, 0.533333, 8);
INSERT INTO candidacies VALUES (97, 'Bob', 'Example', 0, 0, 2, 0, 13300, 0.466667, 8);
INSERT INTO candidacies VALUES (98, 'Alice', 'Example', 0, 0, 1, 1, 15400, 0.531034, 9);
INSERT INTO candidacies VALUES (99, 'Bob', 'Example', 0, 0, 2, 0, 13600, 0.468966, 9);
INSERT INTO candidacies VALUES (100, 'Alice', 'Example', 0, 1, 1, 1, 16000, 0.533333, 10);
INSERT INTO candidacies VALUES (101, 'Bob', 'Example', 0, 1, 2, 0, 14000, 0.466667, 10);
INSERT INTO candidacies VALUES (102, 'Alice', 'Example', 0, 0, 1, 1, 16500, 0.532258, 11);
INSERT INTO candidacies VALUES (103, 'Bob', 'Example', 0, 0, 2, 0, 14500, 0.467742, 11);
INSERT INTO certifications VALUES
(1, 100, 1), (2, 100, 3), (3, 101, 2), (4, 102, 1), (5, 102, 3), (6, 103, 2),
(7, 94, 1), (8, 94, 3), (9, 95, 2), (10, 96, 1), (11, 96, 3), (12, 97, 2),
(13, 98, 1), (14, 98, 3), (15, 99, 2);
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
    expect(imported.history).toHaveLength(5);
    expect(imported.history.map((row) => row.review_status).sort()).toEqual([
      "reviewed",
      "reviewed_with_warnings",
      "reviewed_with_warnings",
      "reviewed_with_warnings",
      "reviewed_with_warnings"
    ]);
    expect(imported.history[0].result_rows[0]).toMatchObject({
      party_name: "Labour (Co-op)",
      elected: true
    });
    expect(imported.history[0]).toMatchObject({
      election_date: "2010-05-06",
      upstream: {
        synthetic_current_boundary_history: true,
        overlap_method: "from_constituency_population_weighted_party_votes"
      }
    });
    expect(imported.featureSnapshots[0]).toMatchObject({
      area_code: "E14000001",
      model_family: "westminster_fptp",
      features: {
        electoral_history: {
          previous_contests: 5,
          baseline_party: "Labour (Co-op)"
        },
        asylum_context: {
          precision: "constituency_context"
        }
      }
    });
  });
});
