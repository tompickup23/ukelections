const REVIEW_STATUSES = new Set(["unreviewed", "reviewed", "reviewed_with_warnings", "quarantined"]);
const PUBLICATION_STATUSES = new Set(["internal", "blocked", "review", "publishable", "published"]);
const MODEL_FAMILIES = new Set([
  "westminster_fptp",
  "local_fptp_borough",
  "local_fptp_county",
  "local_fptp_unitary",
  "local_stv",
  "senedd_closed_list_pr",
  "scottish_ams"
]);
const GEOGRAPHY_TYPES = new Set([
  "ward",
  "county_division",
  "unitary_ward",
  "westminster_constituency",
  "senedd_constituency",
  "scottish_parliament_constituency",
  "scottish_parliament_region",
  "scottish_stv_ward"
]);
const JURISDICTIONS = new Set(["england", "scotland", "wales", "great_britain", "united_kingdom"]);
const ELECTION_TYPES = new Set(["borough", "county", "unitary", "westminster", "senedd", "scottish_parliament", "scottish_local"]);
const VOTING_SYSTEMS = new Set(["fptp", "stv", "closed_list_pr", "ams"]);
const GATE_STATUSES = new Set(["missing", "proxy", "imported_quarantined", "reviewed", "accepted", "not_applicable"]);
const BACKTEST_STATUSES = new Set(["missing", "not_applicable", "running", "failed", "passed"]);

const REQUIRED_GATES = [
  "boundary_versions",
  "election_history",
  "candidate_rosters",
  "poll_context",
  "population_method",
  "asylum_context",
  "backtest"
];

const FAMILY_RULES = {
  westminster_fptp: { votingSystem: "fptp", electionType: "westminster", minHistory: 2 },
  local_fptp_borough: { votingSystem: "fptp", electionType: "borough", minHistory: 3 },
  local_fptp_county: { votingSystem: "fptp", electionType: "county", minHistory: 2 },
  local_fptp_unitary: { votingSystem: "fptp", electionType: "unitary", minHistory: 2 },
  local_stv: { votingSystem: "stv", electionType: "scottish_local", minHistory: 2 },
  senedd_closed_list_pr: { votingSystem: "closed_list_pr", electionType: "senedd", minHistory: 1 },
  scottish_ams: { votingSystem: "ams", electionType: "scottish_parliament", minHistory: 2 }
};

function isValidDate(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function gateIsPublishable(gate) {
  return gate?.status === "reviewed" || gate?.status === "accepted";
}

export function validateModelReadinessArea(area) {
  const errors = [];
  for (const field of [
    "model_area_id",
    "area_code",
    "area_name",
    "geography_type",
    "jurisdiction",
    "model_family",
    "election_type",
    "voting_system",
    "publication_status",
    "review_status",
    "source_gates",
    "methodology",
    "coverage",
    "blockers"
  ]) {
    if (area[field] === undefined || area[field] === null || area[field] === "") {
      errors.push(`${field} is required`);
    }
  }

  if (area.geography_type && !GEOGRAPHY_TYPES.has(area.geography_type)) errors.push("geography_type is invalid");
  if (area.jurisdiction && !JURISDICTIONS.has(area.jurisdiction)) errors.push("jurisdiction is invalid");
  if (area.model_family && !MODEL_FAMILIES.has(area.model_family)) errors.push("model_family is invalid");
  if (area.election_type && !ELECTION_TYPES.has(area.election_type)) errors.push("election_type is invalid");
  if (area.voting_system && !VOTING_SYSTEMS.has(area.voting_system)) errors.push("voting_system is invalid");
  if (area.publication_status && !PUBLICATION_STATUSES.has(area.publication_status)) errors.push("publication_status is invalid");
  if (area.review_status && !REVIEW_STATUSES.has(area.review_status)) errors.push("review_status is invalid");
  if (area.next_election_date !== null && area.next_election_date !== undefined && !isValidDate(area.next_election_date)) {
    errors.push("next_election_date must be null or an ISO-compatible date");
  }
  if (!Array.isArray(area.blockers)) errors.push("blockers must be an array");

  const familyRule = FAMILY_RULES[area.model_family];
  if (familyRule) {
    if (area.voting_system !== familyRule.votingSystem) {
      errors.push(`${area.model_family} must use ${familyRule.votingSystem}`);
    }
    if (area.election_type !== familyRule.electionType) {
      errors.push(`${area.model_family} must use ${familyRule.electionType} election_type`);
    }
  }

  if (!area.source_gates || typeof area.source_gates !== "object" || Array.isArray(area.source_gates)) {
    errors.push("source_gates must be an object");
  } else {
    for (const gateName of REQUIRED_GATES) {
      const gate = area.source_gates[gateName];
      if (!gate) {
        errors.push(`source_gates.${gateName} is required`);
        continue;
      }
      if (!GATE_STATUSES.has(gate.status)) {
        errors.push(`source_gates.${gateName}.status is invalid`);
      }
      if (!Array.isArray(gate.source_snapshot_ids)) {
        errors.push(`source_gates.${gateName}.source_snapshot_ids must be an array`);
      }
      if (!gate.notes) {
        errors.push(`source_gates.${gateName}.notes is required`);
      }
      if (["reviewed", "accepted", "imported_quarantined", "proxy"].includes(gate.status) && gateName !== "backtest" && gate.source_snapshot_ids?.length === 0) {
        errors.push(`source_gates.${gateName} needs at least one source_snapshot_id when not missing`);
      }
    }
  }

  const methodology = area.methodology || {};
  for (const field of ["baseline_method", "allocation_method", "uncertainty_method", "backtest_status", "minimum_history_contests"]) {
    if (methodology[field] === undefined || methodology[field] === null || methodology[field] === "") {
      errors.push(`methodology.${field} is required`);
    }
  }
  if (methodology.backtest_status && !BACKTEST_STATUSES.has(methodology.backtest_status)) {
    errors.push("methodology.backtest_status is invalid");
  }
  if (!Number.isInteger(methodology.minimum_history_contests) || methodology.minimum_history_contests < 0) {
    errors.push("methodology.minimum_history_contests must be a non-negative integer");
  }

  const coverage = area.coverage || {};
  for (const field of ["boundary_versions", "history_records", "candidate_rosters", "feature_snapshots", "poll_aggregates"]) {
    if (!Number.isInteger(coverage[field]) || coverage[field] < 0) {
      errors.push(`coverage.${field} must be a non-negative integer`);
    }
  }

  if (["publishable", "published"].includes(area.publication_status)) {
    const gates = area.source_gates || {};
    for (const gateName of ["boundary_versions", "election_history", "candidate_rosters", "poll_context", "population_method", "backtest"]) {
      if (!gateIsPublishable(gates[gateName])) {
        errors.push(`${area.publication_status} areas need reviewed or accepted ${gateName}`);
      }
    }
    if (methodology.backtest_status !== "passed") {
      errors.push(`${area.publication_status} areas need passed backtests`);
    }
    if ((area.blockers || []).length > 0) {
      errors.push(`${area.publication_status} areas cannot have blockers`);
    }
    if (coverage.history_records < (methodology.minimum_history_contests || familyRule?.minHistory || 0)) {
      errors.push(`${area.publication_status} areas need enough historical contests for the model family`);
    }
  }

  return { ok: errors.length === 0, errors };
}

export function validateModelReadinessAreas(areas) {
  if (!Array.isArray(areas)) {
    return { ok: false, results: [], errors: ["model readiness manifest must be an array"] };
  }

  const ids = new Set();
  const results = areas.map((area, index) => {
    const result = validateModelReadinessArea(area);
    if (ids.has(area.model_area_id)) {
      result.ok = false;
      result.errors.push("model_area_id must be unique");
    }
    if (area.model_area_id) ids.add(area.model_area_id);
    return { index, model_area_id: area.model_area_id, ...result };
  });
  const failures = results.filter((result) => !result.ok);
  return { ok: failures.length === 0, results, errors: failures.flatMap((failure) => failure.errors) };
}

export function summariseModelReadiness(areas) {
  const byStatus = {};
  const byFamily = {};
  for (const area of areas) {
    byStatus[area.publication_status] = (byStatus[area.publication_status] || 0) + 1;
    byFamily[area.model_family] = (byFamily[area.model_family] || 0) + 1;
  }
  return {
    total: areas.length,
    byStatus,
    byFamily,
    publishable: byStatus.publishable || 0,
    published: byStatus.published || 0,
    blocked: (byStatus.blocked || 0) + (byStatus.internal || 0) + (byStatus.review || 0)
  };
}
