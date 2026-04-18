import { describe, expect, it } from "vitest";
import {
  validateSourceSnapshot,
  validateSourceSnapshots,
  summariseSourceQuality
} from "../scripts/lib/source-quality.mjs";

const validSnapshot = {
  snapshot_id: "democracy-club-2026-04-18",
  source_name: "Democracy Club",
  source_url: "https://developers.democracyclub.org.uk/api/v1/",
  retrieved_at: "2026-04-18T12:00:00Z",
  licence: "Confirmed source licence",
  raw_file_path: "data/raw/democracy-club/candidates.json",
  sha256: "a".repeat(64),
  row_count: 12,
  quality_status: "accepted",
  review_notes: "Reviewed against source page."
};

describe("validateSourceSnapshot", () => {
  it("accepts a complete reviewed snapshot", () => {
    expect(validateSourceSnapshot(validSnapshot)).toEqual({ ok: true, errors: [] });
  });

  it("rejects accepted snapshots with unconfirmed licences", () => {
    const result = validateSourceSnapshot({
      ...validSnapshot,
      licence: "To be confirmed"
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("accepted snapshots need a confirmed licence");
  });

  it("rejects invalid hashes and URLs", () => {
    const result = validateSourceSnapshot({
      ...validSnapshot,
      source_url: "developers.democracyclub.org.uk",
      sha256: "not-a-hash"
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("source_url must be an absolute http(s) URL");
    expect(result.errors).toContain("sha256 must be a 64-character hex digest");
  });
});

describe("validateSourceSnapshots", () => {
  it("detects duplicate snapshot ids", () => {
    const results = validateSourceSnapshots([validSnapshot, validSnapshot]);
    expect(results[1].ok).toBe(false);
    expect(results[1].errors).toContain("snapshot_id must be unique");
  });

  it("summarises failed manifests", () => {
    const results = validateSourceSnapshots([
      validSnapshot,
      { ...validSnapshot, snapshot_id: "bad", row_count: -1 }
    ]);
    const summary = summariseSourceQuality(results);

    expect(summary.total).toBe(2);
    expect(summary.passed).toBe(1);
    expect(summary.failed).toBe(1);
  });
});
