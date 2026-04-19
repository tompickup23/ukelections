const REVIEW_STATUSES = new Set(["unreviewed", "reviewed", "reviewed_with_warnings", "quarantined"]);
const PUBLICATION_STATUSES = new Set(["internal", "review", "published", "withdrawn"]);

function isValidDate(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

export function validateModelRun(run) {
  const errors = [];
  for (const field of [
    "model_run_id",
    "model_family",
    "model_version",
    "generated_at",
    "code_revision",
    "source_snapshot_ids",
    "poll_aggregate_ids",
    "feature_snapshot_ids",
    "candidate_roster_ids",
    "boundary_version_ids",
    "assumptions",
    "review_status",
    "publication_status"
  ]) {
    if (run[field] === undefined || run[field] === null || run[field] === "") {
      errors.push(`${field} is required`);
    }
  }
  if (run.generated_at && !isValidDate(run.generated_at)) {
    errors.push("generated_at must be an ISO-compatible date-time");
  }
  for (const field of ["source_snapshot_ids", "poll_aggregate_ids", "feature_snapshot_ids", "candidate_roster_ids", "boundary_version_ids"]) {
    if (!Array.isArray(run[field])) {
      errors.push(`${field} must be an array`);
    }
  }
  if (run.review_status && !REVIEW_STATUSES.has(run.review_status)) {
    errors.push("review_status is invalid");
  }
  if (run.publication_status && !PUBLICATION_STATUSES.has(run.publication_status)) {
    errors.push("publication_status is invalid");
  }
  if (run.publication_status === "published" && run.review_status !== "reviewed") {
    errors.push("published model runs must be reviewed");
  }
  if (run.publication_status === "published" && (!run.boundary_version_ids || run.boundary_version_ids.length === 0)) {
    errors.push("published model runs must include boundary_version_ids");
  }
  return { ok: errors.length === 0, errors };
}

export function validateModelRuns(runs) {
  if (!Array.isArray(runs)) {
    return { ok: false, results: [], errors: ["model runs manifest must be an array"] };
  }
  const ids = new Set();
  const results = runs.map((run, index) => {
    const result = validateModelRun(run);
    if (ids.has(run.model_run_id)) {
      result.ok = false;
      result.errors.push("model_run_id must be unique");
    }
    if (run.model_run_id) ids.add(run.model_run_id);
    return { index, model_run_id: run.model_run_id, ...result };
  });
  const failures = results.filter((result) => !result.ok);
  return { ok: failures.length === 0, results, errors: failures.flatMap((failure) => failure.errors) };
}
