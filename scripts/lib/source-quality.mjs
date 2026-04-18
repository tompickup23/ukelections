const REQUIRED_FIELDS = [
  "snapshot_id",
  "source_name",
  "source_url",
  "retrieved_at",
  "licence",
  "raw_file_path",
  "sha256",
  "row_count",
  "quality_status",
  "review_notes"
];

const QUALITY_STATUSES = new Set(["accepted", "accepted_with_warnings", "quarantined"]);

export function validateSourceSnapshot(snapshot) {
  const errors = [];

  for (const field of REQUIRED_FIELDS) {
    if (snapshot[field] === undefined || snapshot[field] === null || snapshot[field] === "") {
      errors.push(`${field} is required`);
    }
  }

  if (snapshot.source_url && !/^https?:\/\//.test(snapshot.source_url)) {
    errors.push("source_url must be an absolute http(s) URL");
  }

  if (snapshot.retrieved_at && Number.isNaN(Date.parse(snapshot.retrieved_at))) {
    errors.push("retrieved_at must be an ISO-compatible date");
  }

  if (snapshot.sha256 && !/^[a-f0-9]{64}$/i.test(snapshot.sha256)) {
    errors.push("sha256 must be a 64-character hex digest");
  }

  if (!Number.isInteger(snapshot.row_count) || snapshot.row_count < 0) {
    errors.push("row_count must be a non-negative integer");
  }

  if (snapshot.quality_status && !QUALITY_STATUSES.has(snapshot.quality_status)) {
    errors.push(`quality_status must be one of: ${[...QUALITY_STATUSES].join(", ")}`);
  }

  if (snapshot.quality_status === "accepted" && /to be confirmed|unknown|tbd/i.test(snapshot.licence)) {
    errors.push("accepted snapshots need a confirmed licence");
  }

  if (snapshot.quality_status === "accepted" && snapshot.row_count === 0) {
    errors.push("accepted snapshots must contain at least one row");
  }

  return {
    ok: errors.length === 0,
    errors
  };
}

export function validateSourceSnapshots(snapshots) {
  if (!Array.isArray(snapshots)) {
    return [{ index: -1, ok: false, errors: ["manifest must be an array"] }];
  }

  const seen = new Set();

  return snapshots.map((snapshot, index) => {
    const result = validateSourceSnapshot(snapshot);

    if (seen.has(snapshot.snapshot_id)) {
      result.ok = false;
      result.errors.push("snapshot_id must be unique");
    }

    if (snapshot.snapshot_id) {
      seen.add(snapshot.snapshot_id);
    }

    return { index, snapshot_id: snapshot.snapshot_id, ...result };
  });
}

export function summariseSourceQuality(results) {
  const failed = results.filter((result) => !result.ok);

  return {
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    failures: failed
  };
}
