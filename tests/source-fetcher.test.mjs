import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildSourceSnapshot, fetchSourceSnapshot, inferRowCount } from "../scripts/lib/source-fetcher.mjs";

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

  it("infers one row for non-empty binary sources", () => {
    expect(inferRowCount(Buffer.from("%PDF-1.7"), "application/pdf", "result.pdf")).toBe(1);
    expect(inferRowCount(Buffer.alloc(0), "application/pdf", "result.pdf")).toBe(0);
  });

  it("falls back to an existing raw file when a source is temporarily unavailable", async () => {
    const dir = path.join(os.tmpdir(), `ukelections-source-cache-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const outputPath = path.join(dir, "source.html");
    writeFileSync(outputPath, "<h1>Cached official result</h1>", "utf8");

    const snapshot = await fetchSourceSnapshot({
      sourceName: "Cached Source",
      sourceUrl: "http://127.0.0.1:9/unavailable",
      licence: "test",
      outputPath
    });

    expect(snapshot.snapshot_id).toMatch(/^cached-source-/);
    expect(snapshot.row_count).toBe(1);
    expect(snapshot.raw_file_path).toBe(outputPath);
    expect(snapshot.review_notes).toMatch(/reused an existing raw snapshot/);
  });
});
