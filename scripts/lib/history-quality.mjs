const REVIEW_STATUSES = new Set(["unreviewed", "reviewed", "reviewed_with_warnings", "quarantined"]);

function isValidDate(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

export function validateBoundaryVersion(boundary) {
  const errors = [];

  for (const field of [
    "boundary_version_id",
    "area_type",
    "area_code",
    "area_name",
    "valid_from",
    "source_snapshot_id",
    "source_url",
    "review_status"
  ]) {
    if (boundary[field] === undefined || boundary[field] === null || boundary[field] === "") {
      errors.push(`${field} is required`);
    }
  }

  if (boundary.valid_from && !isValidDate(boundary.valid_from)) {
    errors.push("valid_from must be an ISO-compatible date");
  }

  if (boundary.valid_to !== null && boundary.valid_to !== undefined && !isValidDate(boundary.valid_to)) {
    errors.push("valid_to must be null or an ISO-compatible date");
  }

  if (boundary.valid_to && Date.parse(boundary.valid_to) < Date.parse(boundary.valid_from)) {
    errors.push("valid_to cannot be earlier than valid_from");
  }

  if (boundary.source_url && !/^https?:\/\//.test(boundary.source_url)) {
    errors.push("source_url must be an absolute http(s) URL");
  }

  if (boundary.review_status && !REVIEW_STATUSES.has(boundary.review_status)) {
    errors.push("review_status is invalid");
  }

  return { ok: errors.length === 0, errors };
}

export function validateElectionHistoryRecord(record, boundaryById = new Map()) {
  const errors = [];

  for (const field of [
    "history_id",
    "contest_id",
    "area_id",
    "area_code",
    "area_name",
    "boundary_version_id",
    "election_date",
    "election_type",
    "voting_system",
    "source_snapshot_id",
    "review_status"
  ]) {
    if (record[field] === undefined || record[field] === null || record[field] === "") {
      errors.push(`${field} is required`);
    }
  }

  if (!Array.isArray(record.result_rows) || record.result_rows.length === 0) {
    errors.push("result_rows must contain at least one row");
  }

  if (record.election_date && !isValidDate(record.election_date)) {
    errors.push("election_date must be an ISO-compatible date");
  }

  if (record.source_url && !/^https?:\/\//.test(record.source_url)) {
    errors.push("source_url must be an absolute http(s) URL");
  }

  if (record.review_status && !REVIEW_STATUSES.has(record.review_status)) {
    errors.push("review_status is invalid");
  }

  if (record.electorate !== undefined && !isNonNegativeInteger(record.electorate)) {
    errors.push("electorate must be a non-negative integer");
  }

  if (record.turnout_votes !== undefined && !isNonNegativeInteger(record.turnout_votes)) {
    errors.push("turnout_votes must be a non-negative integer");
  }

  if (record.turnout !== undefined && (typeof record.turnout !== "number" || record.turnout < 0 || record.turnout > 1)) {
    errors.push("turnout must be a number from 0 to 1");
  }

  const boundary = boundaryById.get(record.boundary_version_id);
  if (!boundary) {
    errors.push("boundary_version_id must match a known boundary version");
  } else if (record.election_date) {
    const electionTime = Date.parse(record.election_date);
    const fromTime = Date.parse(boundary.valid_from);
    const toTime = boundary.valid_to ? Date.parse(boundary.valid_to) : Infinity;
    if (electionTime < fromTime || electionTime > toTime) {
      errors.push("election_date must fall within the linked boundary version dates");
    }
    if (boundary.area_code !== record.area_code) {
      errors.push("area_code must match the linked boundary version");
    }
  }

  if (Array.isArray(record.result_rows)) {
    const ranks = new Set();
    let voteTotal = 0;
    let electedCount = 0;

    record.result_rows.forEach((row, index) => {
      for (const field of ["candidate_or_party_name", "party_name", "votes", "rank", "elected"]) {
        if (row[field] === undefined || row[field] === null || row[field] === "") {
          errors.push(`result_rows[${index}].${field} is required`);
        }
      }

      if (!isNonNegativeInteger(row.votes)) {
        errors.push(`result_rows[${index}].votes must be a non-negative integer`);
      } else {
        voteTotal += row.votes;
      }

      if (!Number.isInteger(row.rank) || row.rank < 1) {
        errors.push(`result_rows[${index}].rank must be a positive integer`);
      } else if (ranks.has(row.rank)) {
        errors.push(`rank ${row.rank} is duplicated`);
      } else {
        ranks.add(row.rank);
      }

      if (typeof row.elected !== "boolean") {
        errors.push(`result_rows[${index}].elected must be boolean`);
      } else if (row.elected) {
        electedCount += 1;
      }
    });

    if (record.turnout_votes !== undefined && voteTotal !== record.turnout_votes) {
      errors.push("sum of result row votes must equal turnout_votes");
    }

    if (electedCount === 0) {
      errors.push("at least one result row must be elected");
    }
  }

  return { ok: errors.length === 0, errors };
}

export function validateHistoryBundle({ boundaries, history }) {
  if (!Array.isArray(boundaries) || !Array.isArray(history)) {
    return {
      ok: false,
      boundaryResults: [],
      historyResults: [],
      errors: ["boundaries and history must both be arrays"]
    };
  }

  const boundaryById = new Map();
  const boundaryResults = boundaries.map((boundary, index) => {
    const result = validateBoundaryVersion(boundary);
    if (boundaryById.has(boundary.boundary_version_id)) {
      result.ok = false;
      result.errors.push("boundary_version_id must be unique");
    }
    if (boundary.boundary_version_id) {
      boundaryById.set(boundary.boundary_version_id, boundary);
    }
    return { index, boundary_version_id: boundary.boundary_version_id, ...result };
  });

  const historyIds = new Set();
  const historyResults = history.map((record, index) => {
    const result = validateElectionHistoryRecord(record, boundaryById);
    if (historyIds.has(record.history_id)) {
      result.ok = false;
      result.errors.push("history_id must be unique");
    }
    if (record.history_id) {
      historyIds.add(record.history_id);
    }
    return { index, history_id: record.history_id, ...result };
  });

  const failures = [...boundaryResults, ...historyResults].filter((result) => !result.ok);

  return {
    ok: failures.length === 0,
    boundaryResults,
    historyResults,
    errors: failures.flatMap((failure) => failure.errors)
  };
}
