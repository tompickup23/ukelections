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

function compactPublishableQualityArea(row) {
  const metrics = row.methodology?.backtest_metrics || {};
  return {
    area_code: row.area_code,
    area_name: row.area_name,
    model_family: row.model_family,
    backtest_pass_reason: row.methodology?.backtest_pass_reason,
    history_records: row.coverage?.history_records,
    contests: metrics.contests,
    mean_absolute_error: metrics.mean_absolute_error,
    elected_party_hit_rate: metrics.elected_party_hit_rate
  };
}

function buildAreaSourceContext(records = [], sourceSnapshotById = new Map()) {
  const reviewedRecords = records.filter((record) => ["reviewed", "reviewed_with_warnings"].includes(record.review_status));
  return {
    council_ids: [...new Set(records.map((record) => record.upstream?.council_id || record.upstream?.council).filter(Boolean))],
    council_names: [...new Set(records.map((record) => record.upstream?.council_name || record.upstream?.council).filter(Boolean))],
    source_area_codes: [...new Set(records.map((record) => record.upstream?.source_area_code || record.upstream?.upstream_area_code).filter(Boolean))],
    area_code_methods: [...new Set(records.map((record) => record.upstream?.area_code_method).filter(Boolean))],
    source_families: [...new Set(records.map((record) => sourceFamily(sourceSnapshotById.get(record.source_snapshot_id))).filter(Boolean))],
    reviewed_history_records: reviewedRecords.length,
    latest_reviewed_election_date: reviewedRecords.map((record) => record.election_date).filter(Boolean).sort().at(-1) || null,
    latest_raw_election_date: records.map((record) => record.election_date).filter(Boolean).sort().at(-1) || null
  };
}

function workflowForAction(actionCode) {
  const workflows = {
    failed_vote_share_calibration: {
      workflow_code: "investigate_vote_share_failure",
      priority: "P0",
      target_source_classes: [
        "official_current_boundary_results",
        "official_or_academic_notional_results",
        "candidate_and_incumbency_history",
        "local_party_change_context"
      ],
      workflow_steps: [
        "Re-check every current-boundary result row against official council declarations.",
        "Acquire notional or predecessor-boundary evidence before using older same-name ward rows.",
        "Review candidate, incumbency, party label, and local campaign discontinuities.",
        "Do not promote until MAE and elected-party validation improve under a rerun backtest."
      ],
      promotion_gate: "Backtest must pass through elected_party_hit_rate with strong evidence and publication_gate publishable."
    },
    failed_winner_signal: {
      workflow_code: "repair_winner_signal",
      priority: "P1",
      target_source_classes: [
        "official_result_declarations",
        "candidate_rosters",
        "incumbency_and_defending_party",
        "local_party_change_context"
      ],
      workflow_steps: [
        "Verify elected candidates, party labels, and multi-seat ordering against official declarations.",
        "Check whether local independents, retirements, defections, or new candidate slates explain the miss.",
        "Add candidate and incumbency features, then rerun the backtest.",
        "Do not promote until the winner/elected-party signal clears the publishable gate."
      ],
      promotion_gate: "Elected-party hit rate must clear the strong publishable pass after candidate and incumbency review."
    },
    vote_share_only_limited: {
      workflow_code: "repair_winner_signal",
      priority: "P1",
      target_source_classes: [
        "official_result_declarations",
        "candidate_rosters",
        "incumbency_and_defending_party",
        "additional_current_boundary_contests"
      ],
      workflow_steps: [
        "Verify elected flags, multi-seat ordering, party labels, and candidate rows against official declarations.",
        "Add candidate and incumbency features before relying on vote-share fit.",
        "Acquire another current-boundary contest or a reviewed notional baseline.",
        "Keep in review until the elected-party signal clears the publishable gate."
      ],
      promotion_gate: "Elected-party hit rate must clear the strong publishable pass, not only competitive-party or vote-share calibration."
    },
    post_boundary_single_contest: {
      workflow_code: "build_boundary_notional_history",
      priority: "P1",
      target_source_classes: [
        "lgbce_final_recommendations",
        "ons_boundary_codes",
        "official_notional_results",
        "predecessor_boundary_result_rows"
      ],
      workflow_steps: [
        "Attach the boundary review source and effective-date evidence.",
        "Map predecessor wards/divisions to the current area using explicit weights.",
        "Import only official or documented notional current-boundary history.",
        "Rerun backtests and require more than a one-contest cold start before publication."
      ],
      promotion_gate: "Current-boundary history must have at least two usable validations or a reviewed notional baseline."
    },
    single_current_contest: {
      workflow_code: "wait_or_add_second_contest",
      priority: "P2",
      target_source_classes: [
        "official_next_contest_result",
        "democracy_club_candidates",
        "official_statement_of_persons_nominated"
      ],
      workflow_steps: [
        "Verify the single current contest against an official declaration.",
        "Attach candidate roster and statement-of-persons-nominated evidence for the next active contest.",
        "Add the next result as soon as declared, then rerun leave-one-out validation.",
        "Do not promote on one current-boundary contest alone."
      ],
      promotion_gate: "At least two current-boundary contests or a reviewed notional comparator must be available."
    },
    limited_temporal_validation: {
      workflow_code: "extend_temporal_validation",
      priority: "P2",
      target_source_classes: [
        "official_historical_result_declarations",
        "local_elections_archive_rows",
        "commons_library_local_handbooks",
        "official_notional_results"
      ],
      workflow_steps: [
        "Verify the two usable records and any same-date duplicate rows.",
        "Acquire another contest or official notional history to increase temporal validation.",
        "Check whether quarantined rows can be reinstated through boundary lineage evidence.",
        "Rerun the baseline and promote only if the stronger elected-party gate passes."
      ],
      promotion_gate: "Temporal validation must exceed the limited one-validation state before publication."
    },
    failed_backtest_other: {
      workflow_code: "manual_backtest_failure_review",
      priority: "P1",
      target_source_classes: [
        "official_results",
        "boundary_lineage",
        "candidate_rosters"
      ],
      workflow_steps: [
        "Inspect source, boundary, and candidate evidence manually.",
        "Classify the failure into vote-share, winner-signal, temporal, or boundary-history work.",
        "Rerun the audit after source correction."
      ],
      promotion_gate: "Manual review must produce a named pass reason and strong publishable backtest gate."
    },
    source_review_required: {
      workflow_code: "verify_history_source_provenance",
      priority: "P1",
      target_source_classes: [
        "official_result_declarations",
        "official_constituency_result_files",
        "boundary_lineage",
        "upstream_transform_notes"
      ],
      workflow_steps: [
        "Trace every imported result row back to the official declaration or official national result file.",
        "Attach the boundary source, boundary year, and any predecessor or notional-history evidence.",
        "Promote the history source only after vote totals, party labels, elected flags, and electorate/turnout fields reconcile.",
        "Rerun readiness and backtests after source promotion; do not publish from unverified upstream profile rows."
      ],
      promotion_gate: "Election history source gate must be reviewed and the area must clear the model-family history and backtest gates."
    },
    manual_review_required: {
      workflow_code: "manual_review_triage",
      priority: "P2",
      target_source_classes: [
        "official_results",
        "boundary_evidence",
        "candidate_rosters"
      ],
      workflow_steps: [
        "Inspect source, boundary, and methodology fields.",
        "Assign a narrower automated action code.",
        "Rerun the audit."
      ],
      promotion_gate: "Area must leave manual triage and pass a named publishable gate."
    }
  };
  return workflows[actionCode] || workflows.manual_review_required;
}

function decorateReviewAction(row) {
  const workflow = workflowForAction(row.action_code);
  return {
    ...row,
    ...workflow
  };
}

function sourceContextForReadiness(row, context) {
  if (context?.council_names?.length) return context;
  if (row.model_family === "westminster_fptp") {
    return {
      ...context,
      council_names: ["Westminster constituencies"],
      source_area_codes: [row.area_code].filter(Boolean)
    };
  }
  if (row.model_family === "senedd_closed_list_pr") {
    return {
      ...context,
      council_names: ["Senedd constituencies"],
      source_area_codes: [row.area_code].filter(Boolean)
    };
  }
  if (row.model_family === "scottish_ams") {
    return {
      ...context,
      council_names: ["Scottish Parliament constituencies"],
      source_area_codes: [row.area_code].filter(Boolean)
    };
  }
  return context || buildAreaSourceContext([]);
}

function classifyReviewArea(row) {
  const metrics = row.methodology?.backtest_metrics || {};
  const backtestGate = row.source_gates?.backtest || {};
  const historyRecords = row.coverage?.history_records ?? 0;
  const rawHistoryRecords = row.coverage?.raw_history_records ?? historyRecords;
  const quarantinedHistoryRecords = row.coverage?.quarantined_history_records ?? Math.max(0, rawHistoryRecords - historyRecords);
  const passReason = row.methodology?.backtest_pass_reason || backtestGate.pass_reason;
  const backtestStatus = row.methodology?.backtest_status;
  const electedHitRate = metrics.elected_party_hit_rate ?? null;
  const competitiveHitRate = metrics.competitive_party_hit_rate ?? null;
  const mae = metrics.mean_absolute_error ?? null;

  const base = {
    area_code: row.area_code,
    area_name: row.area_name,
    model_family: row.model_family,
    publication_status: row.publication_status,
    history_records: historyRecords,
    raw_history_records: rawHistoryRecords,
    quarantined_history_records: quarantinedHistoryRecords,
    pass_reason: passReason,
    evidence_tier: row.methodology?.backtest_evidence_tier || backtestGate.evidence_tier,
    backtest_status: backtestStatus,
    metrics: {
      mean_absolute_error: mae,
      elected_party_hit_rate: electedHitRate,
      competitive_party_hit_rate: competitiveHitRate,
      calibration_scope_counts: metrics.calibration_scope_counts
    }
  };

  if (row.source_gates?.election_history?.status === "imported_quarantined") {
    return {
      ...base,
      action_code: "source_review_required",
      action: "Keep out of publication until the imported election-history rows are reconciled to official result evidence.",
      rationale: "Election history exists, but the source gate has not been promoted to reviewed evidence."
    };
  }

  if (backtestStatus && backtestStatus !== "passed") {
    if (electedHitRate !== null && electedHitRate < 0.5 && competitiveHitRate !== null && competitiveHitRate >= 0.5 && mae !== null && mae <= 0.26) {
      return {
        ...base,
        action_code: "failed_winner_signal",
        action: "Keep in review until the local seat/winner signal is improved or another current-boundary contest validates it.",
        rationale: "Vote-share or competitive-party calibration is acceptable, but the elected-party signal fails the gate."
      };
    }
    if (mae !== null && mae > 0.26) {
      return {
        ...base,
        action_code: "failed_vote_share_calibration",
        action: "Keep in review and investigate local swing, boundary continuity, and candidate/party composition before publishing.",
        rationale: "Mean absolute error is above the calibrated local-election threshold."
      };
    }
    return {
      ...base,
      action_code: "failed_backtest_other",
      action: "Keep in review until the backtest has enough validated contests and clears the winner/vote-share gates.",
      rationale: "Backtest status is not passed and does not fit a narrower failure class."
    };
  }

  if (backtestGate.publication_gate === "review_required") {
    if (passReason === "single_contest_elected_party_hit" && historyRecords === 1 && quarantinedHistoryRecords > 0) {
      return {
        ...base,
        action_code: "post_boundary_single_contest",
        action: "Keep in review until an official notional current-boundary history estimate or another post-boundary contest is available.",
        rationale: "Only one usable current-boundary contest exists; older same-name or stale-GSS rows are quarantined."
      };
    }
    if (passReason === "single_contest_elected_party_hit" && historyRecords === 1) {
      return {
        ...base,
        action_code: "single_current_contest",
        action: "Keep in review until a second contest or official current-boundary comparator is available.",
        rationale: "The backtest hits the elected party, but it is a one-contest cold start."
      };
    }
    if (passReason === "single_contest_elected_party_hit") {
      return {
        ...base,
        action_code: "limited_temporal_validation",
        action: "Keep in review until the area has at least two leave-one-out validations or a reviewed notional baseline.",
        rationale: "The historical record is usable, but the backtest currently has only one temporal validation."
      };
    }
    if (["competitive_party_hit_rate", "local_competitive_party_hit_rate", "local_vote_share_only", "high_calibration_vote_share_only", "cold_start_vote_share_only"].includes(passReason)) {
      return {
        ...base,
        action_code: "vote_share_only_limited",
        action: "Keep in review until winner/elected-party calibration is improved; do not promote on vote-share fit alone.",
        rationale: "The backtest passes a limited vote-share or competitive-party gate, not a reliable elected-party gate."
      };
    }
  }

  return {
    ...base,
    action_code: "manual_review_required",
    action: "Keep in review pending source, boundary, or methodology inspection.",
    rationale: "The review reason did not match a narrower automated class."
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
  const historyByArea = groupBy(history, (record) => record.area_code || "unknown");
  const boundaryMappingByTarget = groupBy(boundaryMappings, (mapping) => mapping.target_area_code);
  const readinessByAreaFamily = new Map(readiness.map((row) => [`${row.area_code}:${row.model_family}`, row]));
  const areaSourceContextByCode = new Map([...historyByArea.entries()].map(([areaCode, records]) => [
    areaCode,
    buildAreaSourceContext(records, sourceSnapshotById)
  ]));

  const quarantinedSourceSnapshots = sourceSnapshots
    .filter((snapshot) => snapshot.quality_status === "quarantined")
    .map(compactSourceSnapshot);
  const quarantinedHistory = history
    .filter((record) => !["reviewed", "reviewed_with_warnings"].includes(record.review_status))
    .map(compactHistoryRow);
  const sourceAreaMismatches = history
    .filter((record) => record.upstream?.source_area_code && record.upstream.source_area_code !== record.area_code)
    .map(compactHistoryRow);
  const onlyQuarantinedHistoryAreas = [...historyByArea.entries()]
    .filter(([, records]) => records.length > 0 && records.every((record) => record.review_status === "quarantined"))
    .map(([areaCode, records]) => ({
      area_code: areaCode,
      area_name: records[0]?.area_name,
      quarantined_history_records: records.length,
      source_area_codes: [...new Set(records.map((record) => record.upstream?.source_area_code).filter(Boolean))],
      area_code_methods: [...new Set(records.map((record) => record.upstream?.area_code_method).filter(Boolean))]
    }));
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
    .filter((row) => row.status === "passed" && row.publication_gate === "publishable" && (row.metrics?.elected_party_hit_rate ?? 0) < 0.5)
    .map(compactBacktest);
  const reviewPassedWithoutWinnerValidation = backtests
    .filter((row) => row.status === "passed" && row.publication_gate === "review_required" && (row.metrics?.elected_party_hit_rate ?? 0) < 0.5)
    .map(compactBacktest);
  const coldStartBacktests = backtests
    .filter((row) => row.history_records === 1)
    .map(compactBacktest);
  const failedOrMissingBacktests = backtests
    .filter((row) => row.status !== "passed")
    .map(compactBacktest);
  const publishableReadiness = readiness
    .filter((row) => ["publishable", "published"].includes(row.publication_status))
    .map(compactReadiness);
  const publishableGateMismatches = readiness
    .filter((row) => ["publishable", "published"].includes(row.publication_status))
    .filter((row) =>
      row.methodology?.backtest_status !== "passed" ||
      row.methodology?.backtest_evidence_tier !== "strong" ||
      row.source_gates?.backtest?.publication_gate !== "publishable" ||
      (row.blockers || []).length > 0 ||
      (row.readiness_tasks || []).length > 0
    )
    .map(compactReadiness);
  const publishableBacktestMetrics = readiness
    .filter((row) => ["publishable", "published"].includes(row.publication_status))
    .map((row) => row.methodology?.backtest_metrics)
    .filter(Boolean);
  const marginalPublishableAreas = readiness
    .filter((row) => ["publishable", "published"].includes(row.publication_status))
    .filter((row) => (row.methodology?.backtest_metrics?.elected_party_hit_rate ?? 0) <= 0.6)
    .map(compactPublishableQualityArea);

  const limitedReadiness = readiness
    .filter((row) => row.source_gates?.backtest?.publication_gate === "review_required")
    .map(compactReadiness);
  const readinessWithTasks = readiness
    .filter((row) => (row.readiness_tasks || []).length > 0 || (row.blockers || []).length > 0)
    .map(compactReadiness);
  const reviewAreaActions = readiness
    .filter((row) => !["publishable", "published"].includes(row.publication_status))
    .map((row) => ({
      ...classifyReviewArea(row),
      source_context: sourceContextForReadiness(row, areaSourceContextByCode.get(row.area_code) || buildAreaSourceContext([], sourceSnapshotById))
    }))
    .map(decorateReviewAction);

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
      "medium",
      "Historical rows remain quarantined at row level and are excluded from model backtests until source or boundary review is complete.",
      quarantinedHistory
    ),
    issue(
      "history_source_area_code_mismatch",
      "medium",
      "Historical row was imported onto a current area_code that differs from the upstream/source area code; it is excluded from model backtests until boundary-change evidence is added.",
      sourceAreaMismatches
    ),
    issue(
      "area_only_quarantined_history",
      "high",
      "Area has historical rows, but every row is quarantined and excluded from model backtests.",
      onlyQuarantinedHistoryAreas
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
      "Backtest is publication-gated despite elected-party hit rate below 0.5; this is vote-share calibration, not a reliable winner signal.",
      passedWithoutWinnerValidation
    ),
    issue(
      "review_backtest_without_elected_party_validation",
      "medium",
      "Backtest is explicitly review-gated because it lacks elected-party validation; do not treat as a publishable winner signal.",
      reviewPassedWithoutWinnerValidation
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
      "publishable_area_gate_mismatch",
      "high",
      "Area is marked publishable or published but lacks a strong passed publishable backtest gate, or still has blockers/tasks.",
      publishableGateMismatches
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
      review_passed_without_elected_party_validation: reviewPassedWithoutWinnerValidation.length,
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
    publishable_quality: {
      total: publishableReadiness.length,
      by_model_family: countBy(publishableReadiness, (row) => row.model_family),
      by_backtest_pass_reason: countBy(publishableReadiness, (row) => row.backtest_pass_reason),
      by_backtest_evidence_tier: countBy(publishableReadiness, (row) => row.backtest_evidence_tier),
      gate_mismatches: publishableGateMismatches.length,
      minimum_elected_party_hit_rate: publishableBacktestMetrics.length
        ? Math.min(...publishableBacktestMetrics.map((metrics) => metrics.elected_party_hit_rate ?? 0))
        : null,
      maximum_mean_absolute_error: publishableBacktestMetrics.length
        ? Math.max(...publishableBacktestMetrics.map((metrics) => metrics.mean_absolute_error ?? 0))
        : null,
      marginal_elected_party_hit_rate_areas: marginalPublishableAreas.length,
      marginal_areas: marginalPublishableAreas
    },
    review_actions: {
      total: reviewAreaActions.length,
      by_action_code: countBy(reviewAreaActions, (row) => row.action_code),
      areas: reviewAreaActions
    },
    review_workflows: {
      total: reviewAreaActions.length,
      by_workflow_code: countBy(reviewAreaActions, (row) => row.workflow_code),
      by_priority: countBy(reviewAreaActions, (row) => row.priority),
      by_council: countBy(
        reviewAreaActions.flatMap((row) =>
          row.source_context?.council_names?.length
            ? row.source_context.council_names.map((councilName) => ({ council_name: councilName }))
            : [{ council_name: "unknown" }]
        ),
        (row) => row.council_name
      ),
      areas: reviewAreaActions
    },
    issues: auditIssues.filter((row) => row.count > 0).map((row) => ({
      ...row,
      rows: uniqueRows(row.rows, (entry) => JSON.stringify(entry))
    }))
  };
}
