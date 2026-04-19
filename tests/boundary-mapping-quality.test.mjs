import { describe, expect, it } from "vitest";
import { validateBoundaryMappings } from "../scripts/lib/boundary-mapping-quality.mjs";

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
});
