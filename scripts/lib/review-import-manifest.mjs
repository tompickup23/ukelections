function countBy(rows, keyFn) {
  return rows.reduce((counts, row) => {
    const key = keyFn(row) || "unknown";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function sourceHost(source) {
  try {
    return new URL(source.source_url).hostname;
  } catch {
    return "unknown";
  }
}

function routeForSource(source = {}) {
  const url = source.source_url || "";
  const host = sourceHost(source);
  const method = source.extraction_method || "";
  if (method === "pdf_binary_fallback") return "ocr_required";
  if (method === "pdftotext") return "pdf_text_transcription";
  if (/committeeadmin|democracy\./i.test(host) || /mgElection/i.test(url)) return "modern_gov_html_transcription";
  if (/blackburn\.gov\.uk|pendle\.gov\.uk/i.test(host)) return "structured_html_table_transcription";
  if (/rossendale\.gov\.uk|ribblevalley\.gov\.uk|fylde\.gov\.uk|westlancs\.gov\.uk/i.test(host)) return "council_html_transcription";
  if (method.includes("html")) return "html_text_transcription";
  return "manual_source_transcription";
}

function routePriority(route) {
  return {
    structured_html_table_transcription: 1,
    modern_gov_html_transcription: 2,
    council_html_transcription: 3,
    pdf_text_transcription: 4,
    html_text_transcription: 5,
    manual_source_transcription: 6,
    ocr_required: 7
  }[route] || 9;
}

function workflowArtifacts(area) {
  const common = [
    "reviewed_official_history_rows",
    "source_snapshot_linkage",
    "area_code_boundary_check"
  ];
  const byWorkflow = {
    investigate_vote_share_failure: [
      "candidate_party_label_review",
      "local_campaign_context_note",
      "rerun_backtest_with_error_explanation"
    ],
    repair_winner_signal: [
      "elected_flag_review",
      "candidate_roster_or_incumbency_features",
      "rerun_backtest_winner_signal"
    ],
    build_boundary_notional_history: [
      "predecessor_boundary_mapping",
      "official_or_documented_notional_baseline",
      "boundary_lineage_review_note"
    ],
    wait_or_add_second_contest: [
      "second_current_boundary_contest_or_notional_comparator",
      "next_contest_candidate_roster_if_pending"
    ],
    extend_temporal_validation: [
      "additional_historical_contest_or_notional_row",
      "duplicate_same_date_contest_review"
    ]
  };
  return unique([...common, ...(byWorkflow[area.workflow_code] || [])]);
}

function acceptanceChecks(area) {
  const checks = [
    "candidate vote totals equal declared turnout votes where turnout votes are published",
    "elected flags and ranks match the official declaration",
    "party labels are normalised without losing the official text",
    "area_code and boundary_version_id match the election-date boundary",
    "source_url and source_snapshot_id are present on every imported record",
    "rerun local audit and keep the area in review unless the promotion gate is genuinely met"
  ];
  if (area.workflow_code === "build_boundary_notional_history") {
    checks.push("predecessor-to-current weights are documented before any older rows are reinstated");
  }
  if (area.workflow_code === "wait_or_add_second_contest") {
    checks.push("do not count a single current-boundary contest as a publishable temporal backtest");
  }
  return checks;
}

function blockersForArea(area, routes) {
  const blockers = [];
  if (area.source_evidence_status !== "area_name_confirmed") {
    blockers.push("area_name_source_evidence_missing");
  }
  if (routes.includes("ocr_required")) {
    blockers.push("source_ocr_required");
  }
  if (area.boundary_evidence_status === "boundary_source_context_not_confirmed") {
    blockers.push("boundary_source_context_missing");
  }
  blockers.push("official_rows_not_transformed");
  if (area.workflow_code === "build_boundary_notional_history") blockers.push("notional_or_lineage_required");
  if (area.workflow_code === "wait_or_add_second_contest") blockers.push("second_contest_or_notional_required");
  if (area.workflow_code === "repair_winner_signal") blockers.push("winner_signal_review_required");
  if (area.workflow_code === "extend_temporal_validation") blockers.push("temporal_validation_extension_required");
  if (area.workflow_code === "investigate_vote_share_failure") blockers.push("vote_share_failure_investigation_required");
  return unique(blockers);
}

function statusForArea(blockers) {
  if (blockers.includes("area_name_source_evidence_missing")) return "needs_source_acquisition";
  if (blockers.includes("source_ocr_required")) return "needs_ocr_before_transcription";
  return "ready_for_row_transformation";
}

function selectPrimarySource(matchedSources = []) {
  return [...matchedSources]
    .sort((left, right) => routePriority(routeForSource(left)) - routePriority(routeForSource(right)) || Number(left.linked_source) - Number(right.linked_source))[0] || null;
}

export function buildReviewImportManifest({ evidence = {}, generatedAt = new Date().toISOString() } = {}) {
  const areas = (evidence.areas || []).map((area) => {
    const matchedSources = area.matched_sources || [];
    const routes = unique(matchedSources.map(routeForSource));
    const primarySource = selectPrimarySource(matchedSources);
    const blockers = blockersForArea(area, routes);
    return {
      area_code: area.area_code,
      area_name: area.area_name,
      council_names: area.council_names || [],
      priority: area.priority,
      workflow_code: area.workflow_code,
      action_code: area.action_code,
      source_evidence_status: area.source_evidence_status,
      boundary_evidence_status: area.boundary_evidence_status,
      import_status: statusForArea(blockers),
      primary_import_route: primarySource ? routeForSource(primarySource) : null,
      import_routes: routes,
      primary_source: primarySource,
      matched_source_count: matchedSources.length,
      expected_artifacts: workflowArtifacts(area),
      acceptance_checks: acceptanceChecks(area),
      remaining_blockers: blockers,
      promotion_status: "not_ready"
    };
  });
  const readyAreas = areas.filter((area) => area.import_status === "ready_for_row_transformation");
  const ocrAreas = areas.filter((area) => area.import_status === "needs_ocr_before_transcription");
  return {
    generated_at: generatedAt,
    total_areas: areas.length,
    ready_for_row_transformation: readyAreas.length,
    needs_ocr_before_transcription: ocrAreas.length,
    needs_source_acquisition: areas.filter((area) => area.import_status === "needs_source_acquisition").length,
    by_import_status: countBy(areas, (area) => area.import_status),
    by_primary_import_route: countBy(areas, (area) => area.primary_import_route),
    by_workflow_code: countBy(areas, (area) => area.workflow_code),
    by_council: countBy(areas.flatMap((area) =>
      area.council_names.length ? area.council_names.map((councilName) => ({ councilName })) : [{ councilName: "unknown" }]
    ), (row) => row.councilName),
    rows_required_before_promotion: areas.length,
    areas
  };
}
