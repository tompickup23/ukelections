import { describe, expect, it } from "vitest";
import { validateModelReadinessArea, validateModelReadinessAreas } from "../scripts/lib/model-readiness-quality.mjs";
import { buildModelReadinessAreas } from "../scripts/lib/model-readiness-builder.mjs";

const baseArea = {
  model_area_id: "example",
  area_code: "E05000000",
  area_name: "Example Ward",
  geography_type: "ward",
  jurisdiction: "england",
  model_family: "local_fptp_borough",
  election_type: "borough",
  voting_system: "fptp",
  next_election_date: "2026-05-07",
  publication_status: "internal",
  review_status: "quarantined",
  source_gates: {
    boundary_versions: { status: "imported_quarantined", source_snapshot_ids: ["s1"], notes: "test" },
    election_history: { status: "imported_quarantined", source_snapshot_ids: ["s1"], notes: "test" },
    candidate_rosters: { status: "imported_quarantined", source_snapshot_ids: ["s1"], notes: "test" },
    poll_context: { status: "reviewed", source_snapshot_ids: ["s2"], notes: "test" },
    population_method: { status: "proxy", source_snapshot_ids: ["s3"], notes: "test" },
    asylum_context: { status: "proxy", source_snapshot_ids: ["s4"], notes: "test" },
    backtest: { status: "missing", source_snapshot_ids: [], notes: "test" }
  },
  methodology: {
    baseline_method: "ward_history",
    allocation_method: "fptp",
    uncertainty_method: "not_yet_calibrated",
    backtest_status: "missing",
    minimum_history_contests: 3
  },
  coverage: {
    boundary_versions: 1,
    history_records: 3,
    candidate_rosters: 1,
    feature_snapshots: 1,
    poll_aggregates: 1
  },
  blockers: ["Backtest metrics have not passed"]
};

describe("model readiness quality", () => {
  it("accepts internal quarantined readiness records", () => {
    expect(validateModelReadinessArea(baseArea).ok).toBe(true);
  });

  it("blocks publishable records without reviewed gates and passed backtests", () => {
    const result = validateModelReadinessArea({ ...baseArea, publication_status: "publishable", blockers: [] });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("publishable areas need reviewed or accepted boundary_versions");
    expect(result.errors).toContain("publishable areas need passed backtests");
  });

  it("builds readiness from imported manifests and keeps it internal while gates are quarantined", () => {
    const areas = buildModelReadinessAreas({
      boundaries: [{
        boundary_version_id: "b1",
        area_type: "ward",
        area_code: "E05000000",
        area_name: "Example Ward",
        source_snapshot_id: "s1",
        review_status: "quarantined"
      }],
      history: [
        { area_code: "E05000000", source_snapshot_id: "s1" },
        { area_code: "E05000000", source_snapshot_id: "s1" },
        { area_code: "E05000000", source_snapshot_id: "s1" }
      ],
      candidateRosters: [{
        area_code: "E05000000",
        election_date: "2026-05-07",
        source_snapshot_id: "s1",
        source_basis: "statement_of_persons_nominated"
      }],
      featureSnapshots: [{
        area_code: "E05000000",
        area_name: "Example Ward",
        boundary_version_id: "b1",
        model_family: "local_fptp_borough",
        as_of: "2026-04-19",
        provenance: [{ source_snapshot_id: "s1" }],
        features: {
          poll_context: { poll_aggregate_id: "p1" },
          population_projection: {
            method: "census_2021_rebased_component",
            quality_level: "rebased_partial",
            geography_fit: "exact_area",
            confidence: "medium"
          },
          asylum_context: {
            precision: "constituency_context",
            route_scope: "asylum_support"
          }
        }
      }],
      pollAggregates: [{
        poll_aggregate_id: "p1",
        provenance: { source_snapshot_id: "s2" }
      }],
      boundaryMappings: [{
        mapping_id: "lineage-1",
        source_area_id: "b1",
        source_area_code: "E05000000",
        target_area_id: "b1",
        target_area_code: "E05000000",
        weight: 1,
        weight_basis: "manual",
        source_snapshot_id: "s1",
        source_url: "https://ukelections.co.uk/sources",
        review_status: "reviewed"
      }],
      backtests: [{
        area_code: "E05000000",
        model_family: "local_fptp_borough",
        backtest_id: "bt1",
        status: "passed",
        method: "previous_contest_party_share_persistence",
        source_history_ids: ["s1"],
        metrics: { winner_accuracy: 1, mean_absolute_error: 0.1 }
      }],
      sourceSnapshots: [{
        snapshot_id: "s1",
        source_name: "AI DOGE Example election history",
        upstream_data_sources: ["DCLEAPIL v1.0", "Democracy Club", "Andrew Teale LEAP"]
      }]
    });
    const validation = validateModelReadinessAreas(areas);

    expect(validation.ok).toBe(true);
    expect(areas[0].publication_status).toBe("internal");
    expect(areas[0].source_gates.election_history.status).toBe("reviewed");
    expect(areas[0].source_gates.boundary_versions.historical_lineage_status).toBe("generated_identity");
    expect(areas[0].source_gates.population_method.status).toBe("reviewed");
    expect(areas[0].source_gates.candidate_rosters.source_basis).toEqual(["statement_of_persons_nominated"]);
    expect(areas[0].source_gates.backtest.status).toBe("reviewed");
  });
});
