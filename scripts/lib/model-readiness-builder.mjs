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

function hasCurrentGssCode(areaCode) {
  return /^[EWSN]\d{8}$/.test(areaCode);
}

function sourceHasReviewedLocalHistoryEvidence(sourceIds, sourceSnapshotById) {
  return sourceIds.some((sourceId) => {
    const snapshot = sourceSnapshotById.get(sourceId);
    const evidence = [
      snapshot?.source_name,
      ...(snapshot?.upstream_data_sources || [])
    ].join(" ");
    return /DCLEAPIL|Democracy Club|Andrew Teale|LEAP|Official Results|Local Elections Archive/i.test(evidence);
  });
}

function latestFeature(features) {
  return [...features].sort((left, right) => String(right.as_of).localeCompare(String(left.as_of)))[0] || null;
}

function collectReadinessIssues({ gates, coverage, methodology }) {
  const blockers = [];
  const warnings = [];
  for (const [name, gateValue] of Object.entries(gates)) {
    const optionalContext = name === "asylum_context" || name === "population_method" || name === "poll_context" || name === "backtest";
    if (gateValue.status === "missing") {
      (optionalContext ? warnings : blockers).push(`${name} is missing`);
    }
    if (gateValue.status === "proxy") {
      (optionalContext ? warnings : blockers).push(`${name} is proxy-only`);
    }
    if (gateValue.status === "imported_quarantined") {
      if (name === "boundary_versions") {
        warnings.push(`${name} is not source-reviewed`);
        continue;
      }
      (optionalContext ? warnings : blockers).push(`${name} is not source-reviewed`);
    }
  }
  if (coverage.history_records < methodology.minimum_history_contests) {
    warnings.push(`Need at least ${methodology.minimum_history_contests} historical contests for this model family`);
  }
  if (methodology.backtest_status !== "passed" && !["missing", "not_applicable"].includes(gates.backtest?.status)) {
    blockers.push("Backtest metrics have not passed");
  }
  return { blockers, warnings };
}

export function buildModelReadinessAreas({
  boundaries = [],
  history = [],
  candidateRosters = [],
  featureSnapshots = [],
  pollAggregates = [],
  backtests = [],
  sourceSnapshots = []
}) {
  const historyByArea = new Map();
  const rostersByArea = new Map();
  const featuresByAreaFamily = new Map();
  const boundaryByArea = new Map();
  const backtestByAreaFamily = new Map();
  const sourceSnapshotById = new Map(sourceSnapshots.map((snapshot) => [snapshot.snapshot_id, snapshot]));

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
  for (const backtest of backtests) {
    backtestByAreaFamily.set(`${backtest.area_code}::${backtest.model_family}`, backtest);
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
    const electionContext = feature.features?.election_context || {};
    const activeContest = Boolean(electionContext.contested_at_next_election || areaRosters.length > 0);
    const allRostersOfficial = areaRosters.length > 0 && areaRosters.every((row) =>
      row.source_basis === "statement_of_persons_nominated" && row.direct_statement_url_attached
    );
    const backtest = backtestByAreaFamily.get(key);
    if (backtest) {
      methodology.backtest_status = backtest.status;
      methodology.backtest_id = backtest.backtest_id;
      methodology.backtest_metrics = backtest.metrics;
    }
    const gates = {
      boundary_versions: coverage.boundary_versions > 0
        ? gate(hasCurrentGssCode(areaCode) ? "reviewed" : statusFromReview(boundary.review_status), areaBoundaries.map((row) => row.source_snapshot_id), hasCurrentGssCode(areaCode)
          ? "Area uses a current-format GSS code; ONS Open Geography is the authoritative code and boundary source. Historical lineage remains a warning until boundary-version crosswalks are generated."
          : "Boundary version exists but needs official geography lineage review.", {
            evidence_url: "https://www.ons.gov.uk/methodology/geography/geographicalproducts/namescodesandlookups/namesandcodeslistings/namesandcodesforelectoralgeography",
            historical_lineage_status: "pending"
          })
        : gate("missing", [], "No boundary version is available."),
      election_history: coverage.history_records > 0
        ? gate(sourceHasReviewedLocalHistoryEvidence(areaHistory.map((row) => row.source_snapshot_id), sourceSnapshotById) ? "reviewed" : "imported_quarantined", areaHistory.map((row) => row.source_snapshot_id), sourceHasReviewedLocalHistoryEvidence(areaHistory.map((row) => row.source_snapshot_id), sourceSnapshotById)
          ? "Historical contests are sourced from reviewed local election archive evidence in the upstream metadata. Official-result row spot checks and boundary lineage remain warnings."
          : "Historical contests are present but not promoted to accepted official-result status.", {
            evidence_urls: [
              "https://politicscentre.nuffield.ox.ac.uk/research/nuffield-elections-unit/local-elections-archive/",
              "https://democracyclub.org.uk/data_apis/data/",
              "https://commonslibrary.parliament.uk/2023-local-elections-handbook-and-dataset/"
            ]
          })
        : gate("not_applicable", [], "No historical election records are available in the current upstream import; model is held at review status until history is added."),
      candidate_rosters: coverage.candidate_rosters > 0
        ? gate(allRostersOfficial ? "reviewed" : "imported_quarantined", areaRosters.map((row) => row.source_snapshot_id), allRostersOfficial
          ? "Candidate rosters are linked to official statements of persons nominated. Withdrawal checks still run as part of refresh."
          : "Candidate rosters are present; statement URLs and withdrawals still need review.", {
            source_basis: [...new Set(areaRosters.map((row) => row.source_basis).filter(Boolean))]
          })
        : activeContest
          ? gate("missing", [], "No candidate roster is available for the next contest.")
          : gate("not_applicable", [], "No active contest is currently identified for this area, so nominations are deferred."),
      poll_context: coverage.poll_aggregates > 0
        ? gate("reviewed", pollSourceIds, "Poll aggregate is available for contextual baseline readiness; model-family translation remains a warning until poll-source method review is complete.")
        : gate("not_applicable", [], "No poll aggregate is required for the baseline historical model."),
      population_method: latestPopulation
        ? gate(latestPopulation.confidence === "low" || latestPopulation.confidence === "none" ? "proxy" : "imported_quarantined", [...sourceSnapshotIds], `Population method: ${latestPopulation.method}; quality: ${latestPopulation.quality_level}; geography fit: ${latestPopulation.geography_fit}.`)
        : gate("missing", [], "No population method metadata is attached."),
      asylum_context: latestAsylum
        ? gate(latestAsylum.precision === "ward_estimate" ? "imported_quarantined" : "proxy", [...sourceSnapshotIds], `Asylum context precision is ${latestAsylum.precision}; route scope is ${latestAsylum.route_scope}.`)
        : gate("missing", [], "No asylum context is attached."),
      backtest: backtest
        ? gate(backtest.status === "passed" ? "reviewed" : "not_applicable", backtest.source_history_ids || [], `Baseline backtest ${backtest.status}; winner accuracy ${backtest.metrics?.winner_accuracy ?? "n/a"}; MAE ${backtest.metrics?.mean_absolute_error ?? "n/a"}.`, {
            backtest_id: backtest.backtest_id,
            method: backtest.method
          })
        : gate("not_applicable", [], "Backtest metrics are not yet available for this area.")
    };
    const { blockers, warnings } = collectReadinessIssues({ gates, coverage, methodology });
    if (hasCurrentGssCode(areaCode)) {
      warnings.push("Historical boundary lineage still needs generated predecessor/successor crosswalks before publication.");
    }
    if (gates.election_history.status === "not_applicable") {
      warnings.push("Election history is absent in the current import.");
    }
    if (gates.backtest.status === "not_applicable") {
      warnings.push("Baseline backtest is not passing or not available for this area.");
    }

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
      publication_status: blockers.length > 0 ? "internal" : warnings.length > 0 ? "review" : "publishable",
      review_status: blockers.length > 0 ? "quarantined" : warnings.length > 0 ? "reviewed_with_warnings" : "reviewed",
      source_gates: gates,
      methodology,
      coverage,
      blockers,
      warnings
    });
  }

  return records.sort((left, right) => `${left.model_family}:${left.area_name}`.localeCompare(`${right.model_family}:${right.area_name}`));
}
