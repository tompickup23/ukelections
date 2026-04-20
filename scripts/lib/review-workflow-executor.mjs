export function buildReviewWorkflowExecution({
  workflows = {},
  sourceSnapshots = [],
  fetchResults = [],
  generatedAt = new Date().toISOString()
} = {}) {
  const snapshotByTarget = new Map(sourceSnapshots.map((snapshot) => [snapshot.target_id, snapshot]));
  const fetchResultByTarget = new Map(fetchResults.map((result) => [result.target_id, result]));
  const areas = (workflows.areas || []).map((area) => {
    const targetStatuses = (area.source_targets || []).map((targetId) => {
      const snapshot = snapshotByTarget.get(targetId);
      const fetchResult = fetchResultByTarget.get(targetId);
      return {
        target_id: targetId,
        fetched: Boolean(snapshot),
        snapshot_id: snapshot?.snapshot_id || null,
        raw_file_path: snapshot?.raw_file_path || null,
        error: fetchResult?.error || null
      };
    });
    const fetchedTargets = targetStatuses.filter((target) => target.fetched).length;
    return {
      area_code: area.area_code,
      area_name: area.area_name,
      model_family: area.model_family,
      priority: area.priority,
      workflow_code: area.workflow_code,
      action_code: area.action_code,
      source_targets: targetStatuses,
      fetched_source_targets: fetchedTargets,
      source_target_count: targetStatuses.length,
      source_evidence_status: targetStatuses.length > 0 && fetchedTargets === targetStatuses.length
        ? "all_targets_fetched"
        : fetchedTargets > 0
          ? "partial_targets_fetched"
          : "no_targets_fetched",
      promotion_status: "not_ready",
      promotion_blockers: [
        "Fetched source evidence still needs parsing into reviewed official history, boundary lineage, candidate, or notional rows.",
        area.promotion_gate
      ].filter(Boolean)
    };
  });

  const fetchedTargets = sourceSnapshots.length;
  const failedTargets = fetchResults.filter((result) => !result.ok).length;
  return {
    generated_at: generatedAt,
    total_areas: areas.length,
    total_source_targets: workflows.source_targets?.length || 0,
    fetched_source_targets: fetchedTargets,
    failed_source_targets: failedTargets,
    by_area_source_evidence_status: areas.reduce((counts, area) => {
      counts[area.source_evidence_status] = (counts[area.source_evidence_status] || 0) + 1;
      return counts;
    }, {}),
    source_snapshots: sourceSnapshots,
    fetch_results: fetchResults,
    areas
  };
}
