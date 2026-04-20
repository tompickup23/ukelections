import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  areaNameVariants,
  buildReviewEvidenceVerification,
  extractTextFromRawFile,
  normaliseForEvidenceSearch,
  stripHtml
} from "../scripts/lib/review-evidence-verifier.mjs";

describe("review evidence verifier", () => {
  it("normalises punctuation, entities, and ward suffixes for area evidence matching", () => {
    expect(normaliseForEvidenceSearch("Burscough Bridge &amp; Rufford Ward")).toBe("burscough bridge and rufford ward");
    expect(areaNameVariants("Halton-with-Aughton and Kellet Ward")).toContain("halton with aughton and kellet");
  });

  it("extracts searchable text from HTML source files", () => {
    const dir = path.join(os.tmpdir(), `ukelections-evidence-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const sourcePath = path.join(dir, "source.html");
    writeFileSync(sourcePath, "<html><body><h1>Burscough Bridge &amp; Rufford</h1><script>ignore()</script></body></html>", "utf8");

    const extracted = extractTextFromRawFile(sourcePath);

    expect(extracted.ok).toBe(true);
    expect(extracted.method).toBe("html_text");
    expect(stripHtml(extracted.text)).not.toContain("ignore()");
  });

  it("confirms area names from fetched and linked source text without promoting areas", () => {
    const verification = buildReviewEvidenceVerification({
      workflows: {
        areas: [{
          area_code: "E05000000",
          area_name: "Burscough Bridge & Rufford",
          model_family: "local_fptp_borough",
          priority: "P2",
          workflow_code: "extend_temporal_validation",
          action_code: "limited_temporal_validation",
          source_targets: ["west-lancashire-election-results-archive"],
          source_context: { council_names: ["West Lancashire"] },
          promotion_gate: "Temporal validation must exceed the limited one-validation state before publication."
        }]
      },
      execution: {
        source_snapshots: []
      },
      extraSourceRecords: [{
        target_id: "west-lancashire-election-results-archive",
        snapshot_id: "linked-1",
        source_name: "West Lancashire detailed ward results",
        source_url: "https://example.test/results",
        raw_file_path: "/tmp/results.html",
        source_classes: ["official_current_boundary_results"],
        searchable_text: normaliseForEvidenceSearch("Detailed results for Burscough Bridge & Rufford"),
        text_length: 48,
        extraction_method: "html_text",
        linked_source: true
      }],
      generatedAt: "2026-04-20T00:00:00Z"
    });

    expect(verification.area_name_confirmed).toBe(1);
    expect(verification.areas[0].source_evidence_status).toBe("area_name_confirmed");
    expect(verification.areas[0].promotion_status).toBe("not_ready");
    expect(verification.areas[0].promotion_blockers[0]).toMatch(/not yet been transformed/);
  });
});
