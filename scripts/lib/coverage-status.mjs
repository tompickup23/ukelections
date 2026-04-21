function countBy(rows, keyFn) {
  return rows.reduce((counts, row) => {
    const key = keyFn(row) || "unknown";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function isCompleteArea(area) {
  return ["publishable", "published"].includes(area.publication_status);
}

function isConstituencyArea(area) {
  const geographyType = String(area.geography_type || "");
  return geographyType.includes("constituency") ||
    ["westminster_fptp", "senedd_closed_list_pr", "scottish_ams"].includes(area.model_family);
}

function councilNameForArea(area, boundaryByCode) {
  const boundary = boundaryByCode.get(area.area_code);
  return boundary?.upstream?.council_name || boundary?.upstream?.council_id || "unknown";
}

function summariseDraftArtifacts(drafts = {}) {
  const rows = Object.entries(drafts)
    .filter(([, draft]) => draft)
    .map(([route, draft]) => ({
      route,
      total_areas: draft.total_areas || 0,
      drafted_records: draft.drafted_records || 0,
      failed_records: draft.failed_records || 0,
      draft_import_gate: draft.draft_import_gate || "manual_review_required_before_model_import"
    }));
  return {
    routes: rows,
    total_areas_attempted: rows.reduce((sum, row) => sum + row.total_areas, 0),
    total_drafted_records: rows.reduce((sum, row) => sum + row.drafted_records, 0),
    total_failed_records: rows.reduce((sum, row) => sum + row.failed_records, 0)
  };
}

function summariseGateStatuses(readiness = []) {
  const gates = {};
  for (const area of readiness) {
    for (const [gateName, gate] of Object.entries(area.source_gates || {})) {
      if (!gates[gateName]) gates[gateName] = {};
      const status = gate?.status || "unknown";
      gates[gateName][status] = (gates[gateName][status] || 0) + 1;
    }
  }
  return gates;
}

export function buildCoverageStatus({
  readiness = [],
  boundaries = [],
  drafts = {},
  generatedAt = new Date().toISOString()
} = {}) {
  const boundaryByCode = new Map(boundaries.map((boundary) => [boundary.area_code, boundary]));
  const localAreas = readiness.filter((area) => area.model_family?.startsWith("local_fptp_"));
  const constituencyAreas = readiness.filter(isConstituencyArea);
  const councilMap = new Map();

  for (const area of localAreas) {
    const council = councilNameForArea(area, boundaryByCode);
    const row = councilMap.get(council) || {
      council_name: council,
      total_model_areas: 0,
      completed_model_areas: 0,
      remaining_model_areas: 0,
      by_model_family: {},
      by_publication_status: {}
    };
    row.total_model_areas += 1;
    if (isCompleteArea(area)) row.completed_model_areas += 1;
    else row.remaining_model_areas += 1;
    row.by_model_family[area.model_family] = (row.by_model_family[area.model_family] || 0) + 1;
    row.by_publication_status[area.publication_status] = (row.by_publication_status[area.publication_status] || 0) + 1;
    councilMap.set(council, row);
  }

  const councils = [...councilMap.values()]
    .map((row) => ({
      ...row,
      completed: row.remaining_model_areas === 0
    }))
    .sort((left, right) => left.council_name.localeCompare(right.council_name));

  const completedConstituencyAreas = constituencyAreas.filter(isCompleteArea).length;

  return {
    generated_at: generatedAt,
    completion_definition: {
      completed_model_area: "publication_status is publishable or published after readiness validation",
      completed_council: "every imported ward/division model area for that council is completed",
      draft_rows: "draft transcription artifacts are not counted as completed until manually reviewed and imported"
    },
    model_area_coverage: {
      total_model_areas: readiness.length,
      completed_model_areas: readiness.filter(isCompleteArea).length,
      remaining_model_areas: readiness.filter((area) => !isCompleteArea(area)).length,
      by_publication_status: countBy(readiness, (area) => area.publication_status),
      by_model_family: countBy(readiness, (area) => area.model_family)
    },
    council_coverage: {
      total_councils: councils.length,
      completed_councils: councils.filter((council) => council.completed).length,
      remaining_councils: councils.filter((council) => !council.completed).length,
      councils
    },
    constituency_coverage: {
      total_constituency_model_areas_loaded: constituencyAreas.length,
      completed_constituency_model_areas: completedConstituencyAreas,
      remaining_constituency_model_areas_loaded: constituencyAreas.length - completedConstituencyAreas,
      note: constituencyAreas.length === 0
        ? "No constituency model-readiness records are loaded in the current backend artifacts."
        : undefined
    },
    readiness_gate_statuses: summariseGateStatuses(readiness),
    draft_review_transcriptions: summariseDraftArtifacts(drafts)
  };
}
