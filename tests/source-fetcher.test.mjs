import { describe, expect, it } from "vitest";
import { buildSourceSnapshot, inferRowCount } from "../scripts/lib/source-fetcher.mjs";

describe("source fetcher helpers", () => {
  it("infers row counts from JSON arrays and CSV", () => {
    expect(inferRowCount("[1,2,3]", "application/json", "data.json")).toBe(3);
    expect(inferRowCount("{\"areas\":{\"E1\":{},\"E2\":{}}}", "application/json", "data.json")).toBe(2);
    expect(inferRowCount("a,b\n1,2\n3,4\n", "text/csv", "data.csv")).toBe(2);
  });

  it("builds quarantined source snapshots with hashes", () => {
    const snapshot = buildSourceSnapshot({
      sourceName: "Example Source",
      sourceUrl: "https://example.com/data.csv",
      licence: "Example licence",
      rawFilePath: "data/raw/example.csv",
      content: "a\n1\n",
      contentType: "text/csv",
      retrievedAt: "2026-04-18T00:00:00Z"
    });
    expect(snapshot.snapshot_id).toMatch(/^example-source-/);
    expect(snapshot.sha256).toHaveLength(64);
    expect(snapshot.row_count).toBe(1);
    expect(snapshot.quality_status).toBe("quarantined");
  });
});
