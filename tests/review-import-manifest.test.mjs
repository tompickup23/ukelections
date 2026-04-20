import { describe, expect, it } from "vitest";
import { buildReviewImportManifest } from "../scripts/lib/review-import-manifest.mjs";

describe("review import manifest", () => {
  it("turns confirmed evidence into row-level transformation work", () => {
    const manifest = buildReviewImportManifest({
      evidence: {
        areas: [{
          area_code: "E05000000",
          area_name: "Darwen East",
          council_names: ["Blackburn with Darwen"],
          priority: "P1",
          workflow_code: "repair_winner_signal",
          action_code: "vote_share_only_limited",
          source_evidence_status: "area_name_confirmed",
          boundary_evidence_status: "not_required_for_workflow",
          matched_sources: [{
            source_name: "Official result",
            source_url: "https://blackburn.gov.uk/elections/results",
            extraction_method: "html_text",
            linked_source: false
          }]
        }]
      },
      generatedAt: "2026-04-20T00:00:00Z"
    });

    expect(manifest.total_areas).toBe(1);
    expect(manifest.ready_for_row_transformation).toBe(1);
    expect(manifest.areas[0].primary_import_route).toBe("structured_html_table_transcription");
    expect(manifest.areas[0].expected_artifacts).toContain("elected_flag_review");
    expect(manifest.areas[0].remaining_blockers).toContain("official_rows_not_transformed");
    expect(manifest.areas[0].promotion_status).toBe("not_ready");
  });

  it("keeps OCR-only sources out of the ready queue", () => {
    const manifest = buildReviewImportManifest({
      evidence: {
        areas: [{
          area_code: "E05000001",
          area_name: "Example Ward",
          council_names: ["Example Council"],
          priority: "P2",
          workflow_code: "extend_temporal_validation",
          action_code: "limited_temporal_validation",
          source_evidence_status: "area_name_confirmed",
          boundary_evidence_status: "boundary_source_context_confirmed",
          matched_sources: [{
            source_name: "Scanned result",
            source_url: "https://example.gov.uk/result.pdf",
            extraction_method: "pdf_binary_fallback",
            linked_source: false
          }]
        }]
      }
    });

    expect(manifest.needs_ocr_before_transcription).toBe(1);
    expect(manifest.areas[0].import_status).toBe("needs_ocr_before_transcription");
    expect(manifest.areas[0].remaining_blockers).toContain("source_ocr_required");
  });
});
