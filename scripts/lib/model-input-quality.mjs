const REVIEW_STATUSES = new Set(["unreviewed", "reviewed", "reviewed_with_warnings", "quarantined"]);
const MODEL_FAMILIES = new Set([
  "westminster_fptp",
  "local_fptp_borough",
  "local_fptp_county",
  "local_fptp_unitary",
  "local_stv",
  "senedd_closed_list_pr",
  "scottish_ams"
]);
const POPULATION_METHODS = new Set([
  "census_2021_rebased_component",
  "newethpop_2011_validation",
  "ons_snpp_constrained",
  "census_static",
  "area_proxy",
  "manual_context"
]);
const POPULATION_QUALITY_LEVELS = new Set([
  "full_cohort_component",
  "rebased_partial",
  "ons_total_only",
  "census_baseline_only",
  "proxy",
  "unknown"
]);
const POPULATION_SOURCE_DEPTHS = new Set([
  "age_sex_ethnicity_migration",
  "age_sex_ethnicity",
  "ethnicity_total_only",
  "total_population_only",
  "proxy_context"
]);
const POPULATION_GEOGRAPHY_FIT = new Set([
  "exact_area",
  "lsoa_weighted",
  "ward_weighted",
  "local_authority_proxy",
  "constituency_proxy",
  "manual_proxy"
]);
const POPULATION_CONFIDENCE = new Set(["high", "medium", "low", "none"]);

function isValidDate(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function shareSum(shares = {}) {
  return Object.values(shares).reduce((sum, value) => sum + Number(value || 0), 0);
}

function validateShares(shares, label) {
  const errors = [];
  if (!shares || typeof shares !== "object" || Array.isArray(shares)) {
    return [`${label} must be an object`];
  }
  for (const [party, value] of Object.entries(shares)) {
    if (typeof value !== "number" || value < 0 || value > 1) {
      errors.push(`${label}.${party} must be a number from 0 to 1`);
    }
  }
  const total = shareSum(shares);
  if (total < 0.98 || total > 1.02) {
    errors.push(`${label} must sum to approximately 1`);
  }
  return errors;
}

export function validatePollAggregate(aggregate) {
  const errors = [];
  for (const field of [
    "poll_aggregate_id",
    "generated_at",
    "geography",
    "population",
    "method",
    "poll_count",
    "aggregate_party_shares",
    "polls",
    "review_status"
  ]) {
    if (aggregate[field] === undefined || aggregate[field] === null || aggregate[field] === "") {
      errors.push(`${field} is required`);
    }
  }

  if (aggregate.generated_at && !isValidDate(aggregate.generated_at)) {
    errors.push("generated_at must be an ISO-compatible date-time");
  }

  if (!Number.isInteger(aggregate.poll_count) || aggregate.poll_count < 0) {
    errors.push("poll_count must be a non-negative integer");
  }

  if (!Array.isArray(aggregate.polls)) {
    errors.push("polls must be an array");
  } else if (aggregate.poll_count !== aggregate.polls.length) {
    errors.push("poll_count must match polls.length");
  }

  errors.push(...validateShares(aggregate.aggregate_party_shares, "aggregate_party_shares"));

  if (aggregate.review_status && !REVIEW_STATUSES.has(aggregate.review_status)) {
    errors.push("review_status is invalid");
  }

  if (Array.isArray(aggregate.polls)) {
    aggregate.polls.forEach((poll, index) => {
      for (const field of ["poll_id", "pollster", "fieldwork_start", "fieldwork_end", "sample_size", "source_url", "party_shares"]) {
        if (poll[field] === undefined || poll[field] === null || poll[field] === "") {
          errors.push(`polls[${index}].${field} is required`);
        }
      }
      if (!isValidDate(poll.fieldwork_start) || !isValidDate(poll.fieldwork_end)) {
        errors.push(`polls[${index}] fieldwork dates must be ISO-compatible dates`);
      } else if (Date.parse(poll.fieldwork_end) < Date.parse(poll.fieldwork_start)) {
        errors.push(`polls[${index}].fieldwork_end cannot be before fieldwork_start`);
      }
      if (!Number.isInteger(poll.sample_size) || poll.sample_size < 1) {
        errors.push(`polls[${index}].sample_size must be a positive integer`);
      }
      if (poll.source_url && !/^https?:\/\//.test(poll.source_url)) {
        errors.push(`polls[${index}].source_url must be an absolute http(s) URL`);
      }
      errors.push(...validateShares(poll.party_shares, `polls[${index}].party_shares`));
    });
  }

  return { ok: errors.length === 0, errors };
}

export function validateModelFeatureSnapshot(snapshot) {
  const errors = [];
  for (const field of [
    "feature_snapshot_id",
    "area_code",
    "area_name",
    "boundary_version_id",
    "model_family",
    "as_of",
    "features",
    "provenance",
    "review_status"
  ]) {
    if (snapshot[field] === undefined || snapshot[field] === null || snapshot[field] === "") {
      errors.push(`${field} is required`);
    }
  }

  if (snapshot.model_family && !MODEL_FAMILIES.has(snapshot.model_family)) {
    errors.push("model_family is invalid");
  }

  if (snapshot.as_of && !isValidDate(snapshot.as_of)) {
    errors.push("as_of must be an ISO-compatible date");
  }

  if (snapshot.review_status && !REVIEW_STATUSES.has(snapshot.review_status)) {
    errors.push("review_status is invalid");
  }

  if (!Array.isArray(snapshot.provenance) || snapshot.provenance.length === 0) {
    errors.push("provenance must contain at least one row");
  } else {
    snapshot.provenance.forEach((row, index) => {
      for (const field of ["field", "source_snapshot_id", "source_url", "notes"]) {
        if (row[field] === undefined || row[field] === null || row[field] === "") {
          errors.push(`provenance[${index}].${field} is required`);
        }
      }
      if (row.source_url && !/^https?:\/\//.test(row.source_url)) {
        errors.push(`provenance[${index}].source_url must be an absolute http(s) URL`);
      }
    });
  }

  const asylum = snapshot.features?.asylum_context;
  if (asylum) {
    if (asylum.unit !== "quarter_end_stock") {
      errors.push("asylum_context.unit must be quarter_end_stock");
    }
    if (!["asylum_support", "hotel_accommodation", "route_specific"].includes(asylum.route_scope)) {
      errors.push("asylum_context.route_scope must stay route-specific");
    }
    if (!["local_authority_context", "constituency_context", "ward_estimate"].includes(asylum.precision)) {
      errors.push("asylum_context.precision is invalid");
    }
  }

  const population = snapshot.features?.population_projection;
  if (population) {
    if (!Number.isInteger(population.base_year) || !Number.isInteger(population.projection_year)) {
      errors.push("population_projection base_year and projection_year must be integers");
    }
    if (population.projection_year < population.base_year) {
      errors.push("population_projection projection_year cannot be before base_year");
    }
    if (!POPULATION_METHODS.has(population.method)) {
      errors.push("population_projection.method must identify the area-specific method used");
    }
    if (!POPULATION_QUALITY_LEVELS.has(population.quality_level)) {
      errors.push("population_projection.quality_level is invalid");
    }
    if (!POPULATION_SOURCE_DEPTHS.has(population.source_depth)) {
      errors.push("population_projection.source_depth is invalid");
    }
    if (!POPULATION_GEOGRAPHY_FIT.has(population.geography_fit)) {
      errors.push("population_projection.geography_fit is invalid");
    }
    if (!POPULATION_CONFIDENCE.has(population.confidence)) {
      errors.push("population_projection.confidence is invalid");
    }
    if (["proxy", "unknown"].includes(population.quality_level) && population.confidence !== "low" && population.confidence !== "none") {
      errors.push("proxy or unknown population projections cannot have medium/high confidence");
    }
    if (population.geography_fit?.endsWith("_proxy") && population.confidence === "high") {
      errors.push("proxy geography population projections cannot have high confidence");
    }
    if (!Array.isArray(population.limitations) || population.limitations.length === 0) {
      errors.push("population_projection.limitations must list area-specific caveats");
    }
  }

  return { ok: errors.length === 0, errors };
}

export function validateModelInputs({ pollAggregates, featureSnapshots }) {
  if (!Array.isArray(pollAggregates) || !Array.isArray(featureSnapshots)) {
    return {
      ok: false,
      pollResults: [],
      featureResults: [],
      errors: ["pollAggregates and featureSnapshots must both be arrays"]
    };
  }

  const pollIds = new Set();
  const pollResults = pollAggregates.map((aggregate, index) => {
    const result = validatePollAggregate(aggregate);
    if (pollIds.has(aggregate.poll_aggregate_id)) {
      result.ok = false;
      result.errors.push("poll_aggregate_id must be unique");
    }
    if (aggregate.poll_aggregate_id) pollIds.add(aggregate.poll_aggregate_id);
    return { index, poll_aggregate_id: aggregate.poll_aggregate_id, ...result };
  });

  const featureIds = new Set();
  const featureResults = featureSnapshots.map((snapshot, index) => {
    const result = validateModelFeatureSnapshot(snapshot);
    if (featureIds.has(snapshot.feature_snapshot_id)) {
      result.ok = false;
      result.errors.push("feature_snapshot_id must be unique");
    }
    if (snapshot.feature_snapshot_id) featureIds.add(snapshot.feature_snapshot_id);
    return { index, feature_snapshot_id: snapshot.feature_snapshot_id, ...result };
  });

  const failures = [...pollResults, ...featureResults].filter((result) => !result.ok);
  return {
    ok: failures.length === 0,
    pollResults,
    featureResults,
    errors: failures.flatMap((failure) => failure.errors)
  };
}
