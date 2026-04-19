import { describe, expect, it } from "vitest";
import { validateBoundaryMappings } from "../scripts/lib/boundary-mapping-quality.mjs";
import { buildBoundaryLineageMappings } from "../scripts/lib/boundary-lineage-builder.mjs";

const mapping = {
  mapping_id: "mapping-1",
  source_area_id: "ward-1",
  source_area_code: "E05000001",
  target_area_id: "seat-1",
  target_area_code: "E14000001",
  weight: 1,
  weight_basis: "population",
  source_snapshot_id: "source-1",
  source_url: "https://geoportal.statistics.gov.uk/",
  review_status: "reviewed"
};

describe("boundary mapping validation", () => {
  it("accepts weights that sum to one per target", () => {
    expect(validateBoundaryMappings([mapping]).ok).toBe(true);
  });

  it("rejects target weights that do not sum to one", () => {
    const result = validateBoundaryMappings([{ ...mapping, weight: 0.5 }]);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("weights for target_area_id seat-1 must sum to approximately 1");
  });

  it("generates exact identity lineage only for current-format GSS areas", () => {
    const mappings = buildBoundaryLineageMappings([
      {
        boundary_version_id: "ward-1-2026",
        area_code: "E05000001",
        source_snapshot_id: "source-1",
        source_url: "https://ukelections.co.uk/sources",
        valid_from: "2026-05-07",
        valid_to: null
      },
      {
        boundary_version_id: "local-placeholder",
        area_code: "local:test:ward",
        source_snapshot_id: "source-1",
        source_url: "https://ukelections.co.uk/sources",
        valid_from: "2026-05-07",
        valid_to: null
      }
    ]);

    expect(mappings).toHaveLength(1);
    expect(mappings[0]).toMatchObject({
      source_area_code: "E05000001",
      target_area_code: "E05000001",
      weight: 1,
      weight_basis: "manual",
      review_status: "reviewed",
      lineage_method: "same_gss_boundary_version_identity"
    });
    expect(validateBoundaryMappings(mappings).ok).toBe(true);
  });
});
