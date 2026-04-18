import { describe, expect, it } from "vitest";
import {
  validatePollAggregate,
  validateModelFeatureSnapshot,
  validateModelInputs
} from "../scripts/lib/model-input-quality.mjs";

const pollAggregate = {
  poll_aggregate_id: "polls-1",
  generated_at: "2026-04-18T00:00:00Z",
  geography: "GB",
  population: "adults",
  method: "weighted_poll_average",
  poll_count: 1,
  aggregate_party_shares: { A: 0.6, B: 0.4 },
  polls: [
    {
      poll_id: "poll-1",
      pollster: "Pollster",
      fieldwork_start: "2026-04-10",
      fieldwork_end: "2026-04-12",
      sample_size: 1000,
      source_url: "https://www.britishpollingcouncil.org/",
      party_shares: { A: 0.6, B: 0.4 }
    }
  ],
  review_status: "reviewed"
};

const featureSnapshot = {
  feature_snapshot_id: "features-1",
  area_code: "E05000000",
  area_name: "Example Ward",
  boundary_version_id: "ward-2024",
  model_family: "local_fptp_borough",
  as_of: "2026-04-18",
  review_status: "reviewed",
  features: {
    asylum_context: {
      supported_asylum_stock: 100,
      rate_per_10000_population: 10,
      unit: "quarter_end_stock",
      route_scope: "asylum_support",
      precision: "local_authority_context"
    },
    population_projection: {
      base_year: 2021,
      projection_year: 2026,
      scenario: "central",
      method: "census_2021_rebased_component",
      quality_level: "full_cohort_component",
      source_depth: "age_sex_ethnicity_migration",
      geography_fit: "exact_area",
      confidence: "medium",
      limitations: ["Test fixture"]
    }
  },
  provenance: [
    {
      field: "features.asylum_context",
      source_snapshot_id: "home-office",
      source_url: "https://www.gov.uk/government/statistical-data-sets/immigration-system-statistics-regional-and-local-authority-data",
      notes: "Quarter-end stock."
    }
  ]
};

describe("model input quality", () => {
  it("accepts reviewed poll aggregates and model features", () => {
    expect(validatePollAggregate(pollAggregate).ok).toBe(true);
    expect(validateModelFeatureSnapshot(featureSnapshot).ok).toBe(true);
    expect(validateModelInputs({ pollAggregates: [pollAggregate], featureSnapshots: [featureSnapshot] }).ok).toBe(true);
  });

  it("rejects poll shares that do not sum to one", () => {
    const result = validatePollAggregate({
      ...pollAggregate,
      aggregate_party_shares: { A: 0.4, B: 0.4 }
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("aggregate_party_shares must sum to approximately 1");
  });

  it("rejects asylum context that is not route-specific stock", () => {
    const result = validateModelFeatureSnapshot({
      ...featureSnapshot,
      features: {
        ...featureSnapshot.features,
        asylum_context: {
          ...featureSnapshot.features.asylum_context,
          unit: "arrivals_flow",
          route_scope: "migrant_total"
        }
      }
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("asylum_context.unit must be quarter_end_stock");
    expect(result.errors).toContain("asylum_context.route_scope must stay route-specific");
  });

  it("rejects population projections before their base year", () => {
    const result = validateModelFeatureSnapshot({
      ...featureSnapshot,
      features: {
        ...featureSnapshot.features,
        population_projection: {
          ...featureSnapshot.features.population_projection,
          projection_year: 2020
        }
      }
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("population_projection projection_year cannot be before base_year");
  });

  it("rejects population projections without area-specific method metadata", () => {
    const result = validateModelFeatureSnapshot({
      ...featureSnapshot,
      features: {
        ...featureSnapshot.features,
        population_projection: {
          base_year: 2021,
          projection_year: 2026,
          scenario: "central"
        }
      }
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("population_projection.method must identify the area-specific method used");
    expect(result.errors).toContain("population_projection.limitations must list area-specific caveats");
  });

  it("rejects overconfident proxy population projections", () => {
    const result = validateModelFeatureSnapshot({
      ...featureSnapshot,
      features: {
        ...featureSnapshot.features,
        population_projection: {
          ...featureSnapshot.features.population_projection,
          quality_level: "proxy",
          geography_fit: "local_authority_proxy",
          confidence: "high"
        }
      }
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("proxy or unknown population projections cannot have medium/high confidence");
    expect(result.errors).toContain("proxy geography population projections cannot have high confidence");
  });
});
