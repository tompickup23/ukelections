import { createHash } from "node:crypto";

function stableId(prefix, parts) {
  return `${prefix}-${createHash("sha1").update(JSON.stringify(parts)).digest("hex").slice(0, 12)}`;
}

function gate(status, sourceSnapshotIds, notes, extra = {}) {
  return {
    status,
    source_snapshot_ids: [...new Set((sourceSnapshotIds || []).filter(Boolean))],
    notes,
    ...extra
  };
}

function familyToElectionType(modelFamily) {
  return {
    westminster_fptp: "westminster",
    local_fptp_borough: "borough",
    local_fptp_county: "county",
    local_fptp_unitary: "unitary",
    local_stv: "scottish_local",
    senedd_closed_list_pr: "senedd",
    scottish_ams: "scottish_parliament"
  }[modelFamily] || "borough";
}

function familyToVotingSystem(modelFamily) {
  return {
    westminster_fptp: "fptp",
    local_fptp_borough: "fptp",
    local_fptp_county: "fptp",
    local_fptp_unitary: "fptp",
    local_stv: "stv",
    senedd_closed_list_pr: "closed_list_pr",
    scottish_ams: "ams"
  }[modelFamily] || "fptp";
}

function familyToMinimumHistory(modelFamily) {
  return {
    westminster_fptp: 2,
    local_fptp_borough: 3,
    local_fptp_county: 2,
    local_fptp_unitary: 2,
    local_stv: 2,
    senedd_closed_list_pr: 1,
    scottish_ams: 2
  }[modelFamily] || 2;
}

function familyToMethodology(modelFamily) {
  const votingSystem = familyToVotingSystem(modelFamily);
  if (modelFamily === "senedd_closed_list_pr") {
    return {
      baseline_method: "party_list_vote_share_with_welsh_polling_and_new_constituencies",
      allocation_method: "d_hondt_closed_list",
      uncertainty_method: "not_yet_calibrated",
      backtest_status: "missing",
      minimum_history_contests: familyToMinimumHistory(modelFamily)
    };
  }
  if (modelFamily === "scottish_ams") {
    return {
      baseline_method: "constituency_and_regional_list_vote_models",
      allocation_method: "ams_regional_list_top_up",
      uncertainty_method: "not_yet_calibrated",
      backtest_status: "missing",
      minimum_history_contests: familyToMinimumHistory(modelFamily)
    };
  }
  if (votingSystem === "stv") {
    return {
      baseline_method: "first_preference_history_with_transfer_assumptions",
      allocation_method: "stv_count_simulation",
      uncertainty_method: "not_yet_calibrated",
      backtest_status: "missing",
      minimum_history_contests: familyToMinimumHistory(modelFamily)
    };
  }
  return {
    baseline_method: "area_history_with_poll_swing_and_candidate_context",
    allocation_method: "fptp_ranked_candidate_vote_share",
    uncertainty_method: "not_yet_calibrated",
    backtest_status: "missing",
    minimum_history_contests: familyToMinimumHistory(modelFamily)
  };
}

function inferGeographyType(boundary, modelFamily) {
  if (modelFamily === "westminster_fptp") return "westminster_constituency";
  if (modelFamily === "senedd_closed_list_pr") return "senedd_constituency";
  if (modelFamily === "scottish_ams") return "scottish_parliament_constituency";
  if (modelFamily === "local_stv") return "scottish_stv_ward";
  if (boundary?.area_type === "county_division") return "county_division";
  if (modelFamily === "local_fptp_unitary") return "unitary_ward";
  return "ward";
}

function inferJurisdiction(modelFamily) {
  if (modelFamily === "senedd_closed_list_pr") return "wales";
  if (modelFamily === "scottish_ams" || modelFamily === "local_stv") return "scotland";
  if (modelFamily === "westminster_fptp") return "united_kingdom";
  return "england";
}

function statusFromReview(reviewStatus) {
  if (reviewStatus === "reviewed") return "reviewed";
  if (reviewStatus === "reviewed_with_warnings") return "reviewed";
  return "imported_quarantined";
}

function latestFeature(features) {
  return [...features].sort((left, right) => String(right.as_of).localeCompare(String(left.as_of)))[0] || null;
}

function collectBlockers({ gates, coverage, methodology }) {
  const blockers = [];
  for (const [name, gateValue] of Object.entries(gates)) {
    if (gateValue.status === "missing") blockers.push(`${name} is missing`);
    if (gateValue.status === "proxy") blockers.push(`${name} is proxy-only`);
    if (gateValue.status === "imported_quarantined") blockers.push(`${name} is not source-reviewed`);
  }
  if (coverage.history_records < methodology.minimum_history_contests) {
    blockers.push(`Need at least ${methodology.minimum_history_contests} historical contests for this model family`);
  }
  if (methodology.backtest_status !== "passed" && gates.backtest?.status !== "missing") {
    blockers.push("Backtest metrics have not passed");
  }
  return blockers;
}

export function buildModelReadinessAreas({
  boundaries = [],
  history = [],
  candidateRosters = [],
  featureSnapshots = [],
  pollAggregates = []
}) {
  const historyByArea = new Map();
  const rostersByArea = new Map();
  const featuresByAreaFamily = new Map();
  const boundaryByArea = new Map();

  for (const boundary of boundaries) {
    const list = boundaryByArea.get(boundary.area_code) || [];
    list.push(boundary);
    boundaryByArea.set(boundary.area_code, list);
  }
  for (const record of history) {
    const list = historyByArea.get(record.area_code) || [];
    list.push(record);
    historyByArea.set(record.area_code, list);
  }
  for (const roster of candidateRosters) {
    const list = rostersByArea.get(roster.area_code) || [];
    list.push(roster);
    rostersByArea.set(roster.area_code, list);
  }
  for (const feature of featureSnapshots) {
    const key = `${feature.area_code}::${feature.model_family}`;
    const list = featuresByAreaFamily.get(key) || [];
    list.push(feature);
    featuresByAreaFamily.set(key, list);
  }

  const records = [];
  for (const [key, features] of featuresByAreaFamily.entries()) {
    const [areaCode, modelFamily] = key.split("::");
    const feature = latestFeature(features);
    const areaBoundaries = boundaryByArea.get(areaCode) || [];
    const areaHistory = historyByArea.get(areaCode) || [];
    const areaRosters = rostersByArea.get(areaCode) || [];
    const boundary = areaBoundaries.find((candidate) => candidate.boundary_version_id === feature.boundary_version_id) || areaBoundaries[0];
    const methodology = familyToMethodology(modelFamily);
    const sourceSnapshotIds = new Set([
      ...areaBoundaries.map((row) => row.source_snapshot_id),
      ...areaHistory.map((row) => row.source_snapshot_id),
      ...areaRosters.map((row) => row.source_snapshot_id),
      ...features.flatMap((row) => row.provenance?.map((provenance) => provenance.source_snapshot_id) || [])
    ].filter(Boolean));
    const pollIds = new Set(features.map((row) => row.features?.poll_context?.poll_aggregate_id).filter(Boolean));
    const pollSourceIds = pollAggregates
      .filter((poll) => pollIds.has(poll.poll_aggregate_id))
      .map((poll) => poll.provenance?.source_snapshot_id)
      .filter(Boolean);

    const coverage = {
      boundary_versions: areaBoundaries.length,
      history_records: areaHistory.length,
      candidate_rosters: areaRosters.length,
      feature_snapshots: features.length,
      poll_aggregates: pollIds.size
    };
    const latestPopulation = feature.features?.population_projection;
    const latestAsylum = feature.features?.asylum_context;
    const gates = {
      boundary_versions: coverage.boundary_versions > 0
        ? gate(statusFromReview(boundary.review_status), areaBoundaries.map((row) => row.source_snapshot_id), "Boundary version exists but needs official geography lineage review.")
        : gate("missing", [], "No boundary version is available."),
      election_history: coverage.history_records > 0
        ? gate("imported_quarantined", areaHistory.map((row) => row.source_snapshot_id), "Historical contests are present but not promoted to accepted official-result status.")
        : gate("missing", [], "No historical election records are available."),
      candidate_rosters: coverage.candidate_rosters > 0
        ? gate("imported_quarantined", areaRosters.map((row) => row.source_snapshot_id), "Candidate rosters are present; statement URLs and withdrawals still need review.", {
            source_basis: [...new Set(areaRosters.map((row) => row.source_basis).filter(Boolean))]
          })
        : gate("missing", [], "No candidate roster is available for the next contest."),
      poll_context: coverage.poll_aggregates > 0
        ? gate("imported_quarantined", pollSourceIds, "Poll aggregate is present but model-family translation is not backtested.")
        : gate("missing", [], "No poll aggregate is attached."),
      population_method: latestPopulation
        ? gate(latestPopulation.confidence === "low" || latestPopulation.confidence === "none" ? "proxy" : "imported_quarantined", [...sourceSnapshotIds], `Population method: ${latestPopulation.method}; quality: ${latestPopulation.quality_level}; geography fit: ${latestPopulation.geography_fit}.`)
        : gate("missing", [], "No population method metadata is attached."),
      asylum_context: latestAsylum
        ? gate(latestAsylum.precision === "ward_estimate" ? "imported_quarantined" : "proxy", [...sourceSnapshotIds], `Asylum context precision is ${latestAsylum.precision}; route scope is ${latestAsylum.route_scope}.`)
        : gate("missing", [], "No asylum context is attached."),
      backtest: gate("missing", [], "Backtest metrics are required before publication.")
    };
    const blockers = collectBlockers({ gates, coverage, methodology });

    records.push({
      model_area_id: stableId("readiness", [areaCode, modelFamily, feature.boundary_version_id]),
      area_code: areaCode,
      area_name: feature.area_name,
      geography_type: inferGeographyType(boundary, modelFamily),
      jurisdiction: inferJurisdiction(modelFamily),
      model_family: modelFamily,
      election_type: familyToElectionType(modelFamily),
      voting_system: familyToVotingSystem(modelFamily),
      next_election_date: areaRosters[0]?.election_date || null,
      publication_status: blockers.length > 0 ? "internal" : "publishable",
      review_status: blockers.length > 0 ? "quarantined" : "reviewed",
      source_gates: gates,
      methodology,
      coverage,
      blockers
    });
  }

  return records.sort((left, right) => `${left.model_family}:${left.area_name}`.localeCompare(`${right.model_family}:${right.area_name}`));
}
