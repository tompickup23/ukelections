function countBy(values, keyFn) {
  const counts = {};
  for (const value of values || []) {
    const key = keyFn(value) || "unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function sourceFamily(snapshot) {
  const text = [
    snapshot?.source_name,
    snapshot?.raw_file_path,
    ...(snapshot?.upstream_data_sources || [])
  ].join(" ");
  if (/DCLEAPIL|Democracy Club|Andrew Teale|LEAP/i.test(text)) return "dcleapil_leap_democracy_club";
  if (/AI DOGE/i.test(text)) return "ai_doge";
  if (/UKD|asylumstats/i.test(text)) return "ukd_asylumstats";
  if (/Official|statement|persons nominated|council/i.test(text)) return "official_council";
  return "other";
}

function canonicalPartyName(partyName) {
  if (/^Labour( & Co-operative| and Co-operative)?$/i.test(String(partyName || ""))) return "Labour";
  return String(partyName || "Unknown").trim() || "Unknown";
}

function uniqueRows(rows, keyFn) {
  const seen = new Set();
  const output = [];
  for (const row of rows) {
    const key = keyFn(row);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(row);
  }
  return output;
}

function groupBy(rows, keyFn) {
  const groups = new Map();
  for (const row of rows || []) {
    const key = keyFn(row);
    const list = groups.get(key) || [];
    list.push(row);
    groups.set(key, list);
  }
  return groups;
}

function issue(code, severity, message, rows = []) {
  return {
    code,
    severity,
    count: rows.length,
    message,
    rows
  };
}

function compactHistoryRow(record) {
  return {
    history_id: record.history_id,
    contest_id: record.contest_id,
    area_code: record.area_code,
    area_name: record.area_name,
    election_date: record.election_date,
    source_snapshot_id: record.source_snapshot_id,
    review_status: record.review_status,
    source_area_code: record.upstream?.source_area_code,
    area_code_method: record.upstream?.area_code_method
  };
}

function compactSourceSnapshot(snapshot) {
  return {
    snapshot_id: snapshot.snapshot_id,
    source_name: snapshot.source_name,
    source_family: sourceFamily(snapshot),
    quality_status: snapshot.quality_status,
    raw_file_path: snapshot.raw_file_path,
    row_count: snapshot.row_count
  };
}

function compactBacktest(row) {
  return {
    backtest_id: row.backtest_id,
    area_code: row.area_code,
    area_name: row.area_name,
    model_family: row.model_family,
    status: row.status,
    history_records: row.history_records,
    required_history_records: row.required_history_records,
    pass_reason: row.pass_reason,
    evidence_tier: row.evidence_tier,
    publication_gate: row.publication_gate,
    metrics: row.metrics
  };
}

function compactReadiness(row) {
  return {
    model_area_id: row.model_area_id,
    area_code: row.area_code,
    area_name: row.area_name,
    model_family: row.model_family,
    publication_status: row.publication_status,
    review_status: row.review_status,
    readiness_tasks: row.readiness_tasks || [],
    blockers: row.blockers || [],
    backtest_pass_reason: row.methodology?.backtest_pass_reason,
    backtest_evidence_tier: row.methodology?.backtest_evidence_tier
  };
}

export function auditLocalDataBundle({
  boundaries = [],
  history = [],
  sourceSnapshots = [],
  featureSnapshots = [],
  backtests = [],
  readiness = [],
  candidateRosters = [],
  boundaryMappings = [],
  generatedAt = new Date().toISOString()
} = {}) {
  const sourceSnapshotById = new Map(sourceSnapshots.map((snapshot) => [snapshot.snapshot_id, snapshot]));
  const historyByContest = groupBy(history, (record) => record.contest_id || `${record.area_code}:${record.election_date}`);
  const historyByAreaDate = groupBy(history, (record) => `${record.area_code || "unknown"}:${record.election_date || "unknown"}`);
  const boundaryMappingByTarget = groupBy(boundaryMappings, (mapping) => mapping.target_area_code);
  const readinessByAreaFamily = new Map(readiness.map((row) => [`${row.area_code}:${row.model_family}`, row]));

  const quarantinedSourceSnapshots = sourceSnapshots
    .filter((snapshot) => snapshot.quality_status === "quarantined")
    .map(compactSourceSnapshot);
  const quarantinedHistory = history
    .filter((record) => !["reviewed", "reviewed_with_warnings"].includes(record.review_status))
    .map(compactHistoryRow);
  const sourceAreaMismatches = history
    .filter((record) => record.upstream?.source_area_code && record.upstream.source_area_code !== record.area_code)
    .map(compactHistoryRow);
  const zeroTurnout = history
    .filter((record) => (record.turnout_votes || 0) === 0 || (record.result_rows || []).reduce((sum, row) => sum + (row.votes || 0), 0) === 0)
    .map(compactHistoryRow);
  const singlePartyContests = history
    .filter((record) => new Set((record.result_rows || []).map((row) => canonicalPartyName(row.party_name))).size <= 1)
    .map(compactHistoryRow);
  const emptyResultRows = history
    .filter((record) => !Array.isArray(record.result_rows) || record.result_rows.length === 0)
    .map(compactHistoryRow);
  const duplicateContestGroups = [...historyByContest.entries()]
    .filter(([, records]) => records.length > 1)
    .map(([contest_id, records]) => ({
      contest_id,
      records: records.map(compactHistoryRow)
    }));
  const sameAreaDateGroups = [...historyByAreaDate.entries()]
    .filter(([, records]) => records.length > 1)
    .map(([area_date, records]) => ({
      area_date,
      records: records.map(compactHistoryRow)
    }));

  const weakPassedBacktests = backtests
    .filter((row) => row.status === "passed" && row.publication_gate === "review_required")
    .map(compactBacktest);
  const marginalPublishableBacktests = backtests
    .filter((row) =>
      row.status === "passed" &&
      row.publication_gate === "publishable" &&
      (row.metrics?.elected_party_hit_rate ?? 0) <= 0.6
    )
    .map(compactBacktest);
  const passedWithoutWinnerValidation = backtests
    .filter((row) => row.status === "passed" && (row.metrics?.elected_party_hit_rate ?? 0) < 0.5)
    .map(compactBacktest);
  const coldStartBacktests = backtests
    .filter((row) => row.history_records === 1)
    .map(compactBacktest);
  const failedOrMissingBacktests = backtests
    .filter((row) => row.status !== "passed")
    .map(compactBacktest);

  const limitedReadiness = readiness
    .filter((row) => row.source_gates?.backtest?.publication_gate === "review_required")
    .map(compactReadiness);
  const readinessWithTasks = readiness
    .filter((row) => (row.readiness_tasks || []).length > 0 || (row.blockers || []).length > 0)
    .map(compactReadiness);

  const officialHistoryRecords = history.filter((record) => sourceFamily(sourceSnapshotById.get(record.source_snapshot_id)) === "official_council");
  const dcleapilHistoryRecords = history.filter((record) => sourceFamily(sourceSnapshotById.get(record.source_snapshot_id)) === "dcleapil_leap_democracy_club");
  const aiDogeHistoryRecords = history.filter((record) => sourceFamily(sourceSnapshotById.get(record.source_snapshot_id)) === "ai_doge");

  const populationRows = featureSnapshots.map((row) => row.features?.population_projection).filter(Boolean);
  const asylumRows = featureSnapshots.map((row) => row.features?.asylum_context).filter(Boolean);
  const activeContestFeatures = featureSnapshots.filter((row) => row.features?.election_context?.contested_at_next_election);
  const activeAreasWithRoster = new Set(candidateRosters.map((row) => row.area_code));
  const activeWithoutRoster = activeContestFeatures
    .filter((row) => !activeAreasWithRoster.has(row.area_code))
    .map((row) => ({
      area_code: row.area_code,
      area_name: row.area_name,
      model_family: row.model_family,
      next_election_date: row.features?.election_context?.next_election_date
    }));

  const currentFormatBoundaries = boundaries.filter((row) => /^[EWSN]\d{8}$/.test(String(row.area_code || "")));
  const identityMappings = boundaryMappings.filter((mapping) =>
    mapping.source_area_code === mapping.target_area_code &&
    mapping.source_area_id === mapping.target_area_id &&
    mapping.weight === 1
  );
  const missingIdentityLineage = currentFormatBoundaries
    .filter((boundary) => (boundaryMappingByTarget.get(boundary.area_code) || []).length === 0)
    .map((boundary) => ({
      boundary_version_id: boundary.boundary_version_id,
      area_code: boundary.area_code,
      area_name: boundary.area_name,
      source_snapshot_id: boundary.source_snapshot_id,
      review_status: boundary.review_status
    }));

  const readinessMissingFromBacktests = backtests
    .filter((row) => !readinessByAreaFamily.has(`${row.area_code}:${row.model_family}`))
    .map(compactBacktest);

  const auditIssues = [
    issue(
      "source_snapshots_quarantined",
      "medium",
      "Source snapshots are structurally valid but still marked quarantined; promote only after licence, row semantics, and transformation review.",
      quarantinedSourceSnapshots
    ),
    issue(
      "history_rows_quarantined",
      "high",
      "Historical rows remain quarantined at row level even where readiness infers reviewed evidence from upstream metadata.",
      quarantinedHistory
    ),
    issue(
      "history_source_area_code_mismatch",
      "high",
      "Historical row was imported onto a current area_code that differs from the upstream/source area code; needs boundary-change evidence before public historical claims.",
      sourceAreaMismatches
    ),
    issue(
      "history_zero_turnout_or_votes",
      "high",
      "Historical contest has zero turnout or zero candidate votes; this can distort backtests and should be quarantined or corrected.",
      zeroTurnout
    ),
    issue(
      "history_empty_result_rows",
      "high",
      "Historical contest has no result rows.",
      emptyResultRows
    ),
    issue(
      "history_single_party_or_unopposed",
      "medium",
      "Historical contest has one canonical party only; useful as evidence but weak for vote-share calibration.",
      singlePartyContests
    ),
    issue(
      "history_duplicate_contest_id",
      "medium",
      "Multiple imported records share a contest_id and are merged for backtests; verify whether they are multi-seat candidate rows or duplicate contests.",
      duplicateContestGroups
    ),
    issue(
      "history_same_area_date_multiple_records",
      "medium",
      "Multiple rows share area_code and election_date; verify multi-seat contests, by-elections, and duplicate imports.",
      sameAreaDateGroups
    ),
    issue(
      "backtest_review_required_pass",
      "high",
      "Backtest is marked passed but only through a limited/weak path, so it should not be treated as publication-ready without manual review.",
      weakPassedBacktests
    ),
    issue(
      "backtest_marginal_publishable_pass",
      "medium",
      "Backtest is publication-gated but has elected-party hit rate at or below 0.6; keep confidence bands wide and prioritise manual review.",
      marginalPublishableBacktests
    ),
    issue(
      "backtest_passed_without_elected_party_validation",
      "high",
      "Backtest passed despite elected-party hit rate below 0.5; this is vote-share calibration, not a reliable winner signal.",
      passedWithoutWinnerValidation
    ),
    issue(
      "backtest_cold_start",
      "medium",
      "Backtest has only one local historical contest and relies on same-date comparator areas.",
      coldStartBacktests
    ),
    issue(
      "backtest_failed_or_missing",
      "high",
      "Backtest failed or is missing for a model area.",
      failedOrMissingBacktests
    ),
    issue(
      "readiness_limited_backtest",
      "high",
      "Readiness area has a limited backtest gate and should remain in review.",
      limitedReadiness
    ),
    issue(
      "readiness_tasks_or_blockers",
      "high",
      "Readiness area still has blockers or tasks.",
      readinessWithTasks
    ),
    issue(
      "active_contest_without_roster",
      "high",
      "Feature snapshot says the next contest is active but no candidate roster was imported.",
      activeWithoutRoster
    ),
    issue(
      "current_boundary_without_identity_lineage",
      "medium",
      "Current-format boundary has no generated identity lineage mapping in the bundle.",
      missingIdentityLineage
    ),
    issue(
      "backtest_without_readiness_area",
      "medium",
      "A backtest row has no matching readiness area.",
      readinessMissingFromBacktests
    )
  ];

  return {
    generated_at: generatedAt,
    summary: {
      boundaries: boundaries.length,
      boundary_mappings: boundaryMappings.length,
      source_snapshots: sourceSnapshots.length,
      history_records: history.length,
      candidate_rosters: candidateRosters.length,
      feature_snapshots: featureSnapshots.length,
      backtests: backtests.length,
      readiness_areas: readiness.length,
      high_severity_issue_rows: auditIssues
        .filter((row) => row.severity === "high")
        .reduce((sum, row) => sum + row.count, 0),
      medium_severity_issue_rows: auditIssues
        .filter((row) => row.severity === "medium")
        .reduce((sum, row) => sum + row.count, 0)
    },
    sources: {
      by_quality_status: countBy(sourceSnapshots, (row) => row.quality_status),
      by_family: countBy(sourceSnapshots, sourceFamily),
      history_records_by_family: countBy(history, (row) => sourceFamily(sourceSnapshotById.get(row.source_snapshot_id))),
      official_history_records: officialHistoryRecords.length,
      dcleapil_history_records: dcleapilHistoryRecords.length,
      ai_doge_history_records: aiDogeHistoryRecords.length
    },
    history: {
      by_review_status: countBy(history, (row) => row.review_status),
      by_election_type: countBy(history, (row) => row.election_type),
      by_area_code_method: countBy(history, (row) => row.upstream?.area_code_method),
      unique_areas: new Set(history.map((row) => row.area_code)).size,
      unique_contests: historyByContest.size
    },
    features: {
      population_by_quality_level: countBy(populationRows, (row) => row.quality_level),
      population_by_geography_fit: countBy(populationRows, (row) => row.geography_fit),
      population_by_confidence: countBy(populationRows, (row) => row.confidence),
      population_by_source_depth: countBy(populationRows, (row) => row.source_depth),
      asylum_by_precision: countBy(asylumRows, (row) => row.precision),
      asylum_by_route_scope: countBy(asylumRows, (row) => row.route_scope)
    },
    boundaries: {
      by_review_status: countBy(boundaries, (row) => row.review_status),
      current_format_boundaries: currentFormatBoundaries.length,
      identity_lineage_mappings: identityMappings.length,
      missing_identity_lineage: missingIdentityLineage.length
    },
    backtests: {
      by_status: countBy(backtests, (row) => row.status),
      by_pass_reason: countBy(backtests, (row) => row.pass_reason),
      by_evidence_tier: countBy(backtests, (row) => row.evidence_tier),
      by_publication_gate: countBy(backtests, (row) => row.publication_gate),
      review_required_passes: weakPassedBacktests.length,
      passed_without_elected_party_validation: passedWithoutWinnerValidation.length,
      cold_start_backtests: coldStartBacktests.length
    },
    readiness: {
      by_publication_status: countBy(readiness, (row) => row.publication_status),
      by_review_status: countBy(readiness, (row) => row.review_status),
      by_model_family: countBy(readiness, (row) => row.model_family),
      readiness_task_counts: countBy(readiness.flatMap((row) => row.readiness_tasks || []), (row) => row),
      blocker_counts: countBy(readiness.flatMap((row) => row.blockers || []), (row) => row),
      limited_backtest_areas: limitedReadiness.length
    },
    issues: auditIssues.filter((row) => row.count > 0).map((row) => ({
      ...row,
      rows: uniqueRows(row.rows, (entry) => JSON.stringify(entry))
    }))
  };
}
