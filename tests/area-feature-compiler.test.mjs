import { describe, expect, it } from "vitest";
import { compileAreaFeatureSnapshot } from "../scripts/lib/area-feature-compiler.mjs";

describe("area feature compiler", () => {
  it("compiles electoral history, poll, asylum, and population context", () => {
    const snapshot = compileAreaFeatureSnapshot({
      area: { area_code: "E05000000", area_name: "Example Ward" },
      modelFamily: "local_fptp_borough",
      boundaryVersion: { boundary_version_id: "ward-1" },
      asOf: "2026-04-18",
      historyRecords: [
        {
          area_code: "E05000000",
          election_date: "2026-05-07",
          result_rows: [
            { party_name: "A", rank: 1 },
            { party_name: "B", rank: 2 }
          ]
        }
      ],
      pollAggregate: { poll_aggregate_id: "polls-1", geography: "GB", method: "weighted_poll_average", half_life_days: 21 },
      asylumContext: { unit: "quarter_end_stock", route_scope: "asylum_support", precision: "local_authority_context" },
      populationProjection: {
        base_year: 2021,
        projection_year: 2026,
        method: "census_static",
        quality_level: "census_baseline_only",
        source_depth: "ethnicity_total_only",
        geography_fit: "exact_area",
        confidence: "low",
        limitations: ["test"]
      },
      provenance: [{ field: "features", source_snapshot_id: "source-1", source_url: "https://example.com", notes: "test" }]
    });

    expect(snapshot.feature_snapshot_id).toMatch(/^features-/);
    expect(snapshot.features.electoral_history.baseline_party).toBe("A");
    expect(snapshot.features.poll_context.poll_aggregate_id).toBe("polls-1");
    expect(snapshot.review_status).toBe("unreviewed");
  });
});
