import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ACCURACY_GATES, HISTORY_SCOPES } from "../src/lib/electoralHistory";

function readSchema(path: string) {
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("electoral history coverage", () => {
  it("covers local, Westminster, Senedd, Scottish, and STV history", () => {
    const ids = new Set(HISTORY_SCOPES.map((scope) => scope.id));

    expect(ids.has("borough_history")).toBe(true);
    expect(ids.has("county_history")).toBe(true);
    expect(ids.has("unitary_history")).toBe(true);
    expect(ids.has("westminster_history")).toBe(true);
    expect(ids.has("senedd_history")).toBe(true);
    expect(ids.has("scottish_history")).toBe(true);
    expect(ids.has("local_stv_history")).toBe(true);
  });

  it("requires source, geography, mapping, candidate, and audit gates", () => {
    const ids = new Set(ACCURACY_GATES.map((gate) => gate.id));

    expect(ids).toEqual(new Set(["source", "geography", "mapping", "candidate", "audit"]));
  });

  it("requires source coverage for every history scope", () => {
    for (const scope of HISTORY_SCOPES) {
      expect(scope.requiredSources.length).toBeGreaterThanOrEqual(2);
      expect(scope.geography).toMatch(/boundar|geography/i);
      expect(scope.historyUnit.length).toBeGreaterThan(12);
    }
  });
});

describe("history schemas", () => {
  it("requires boundary versions on election history records", () => {
    const schema = readSchema("schemas/election_history_record.schema.json");

    expect(schema.required).toContain("boundary_version_id");
    expect(schema.required).toContain("source_snapshot_id");
    expect(schema.required).toContain("review_status");
    expect(schema.properties.election_type.enum).toContain("borough");
    expect(schema.properties.election_type.enum).toContain("senedd_closed_list");
    expect(schema.properties.election_type.enum).toContain("scottish_parliament_regional_list");
  });

  it("tracks predecessor and successor boundary versions", () => {
    const schema = readSchema("schemas/boundary_version.schema.json");

    expect(schema.required).toContain("boundary_version_id");
    expect(schema.required).toContain("source_snapshot_id");
    expect(schema.properties).toHaveProperty("predecessor_boundary_version_ids");
    expect(schema.properties).toHaveProperty("successor_boundary_version_ids");
    expect(schema.properties.area_type.enum).toContain("ward");
    expect(schema.properties.area_type.enum).toContain("county_division");
  });
});
