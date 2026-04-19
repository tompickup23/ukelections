const REVIEW_STATUSES = new Set(["unreviewed", "reviewed", "reviewed_with_warnings", "quarantined"]);
const CANDIDATE_STATUSES = new Set(["standing", "withdrawn", "replaced", "unknown"]);

function isValidDate(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

export function validateCandidateRoster(roster) {
  const errors = [];
  for (const field of [
    "roster_id",
    "contest_id",
    "area_code",
    "election_date",
    "source_snapshot_id",
    "statement_of_persons_nominated_url",
    "candidates",
    "review_status"
  ]) {
    if (roster[field] === undefined || roster[field] === null || roster[field] === "") {
      errors.push(`${field} is required`);
    }
  }

  if (roster.election_date && !isValidDate(roster.election_date)) {
    errors.push("election_date must be an ISO-compatible date");
  }
  if (roster.statement_of_persons_nominated_url && !/^https?:\/\//.test(roster.statement_of_persons_nominated_url)) {
    errors.push("statement_of_persons_nominated_url must be an absolute http(s) URL");
  }
  if (roster.review_status && !REVIEW_STATUSES.has(roster.review_status)) {
    errors.push("review_status is invalid");
  }
  if (!Array.isArray(roster.candidates) || roster.candidates.length === 0) {
    errors.push("candidates must contain at least one row");
  }

  const candidateIds = new Set();
  const standingParties = new Set();
  let defendingSeats = 0;

  if (Array.isArray(roster.candidates)) {
    roster.candidates.forEach((candidate, index) => {
      for (const field of ["candidate_id", "person_name", "party_name", "party_id", "incumbent", "defending_seat", "status"]) {
        if (candidate[field] === undefined || candidate[field] === null || candidate[field] === "") {
          errors.push(`candidates[${index}].${field} is required`);
        }
      }
      if (candidateIds.has(candidate.candidate_id)) {
        errors.push(`candidate_id ${candidate.candidate_id} is duplicated`);
      }
      if (candidate.candidate_id) candidateIds.add(candidate.candidate_id);
      if (typeof candidate.incumbent !== "boolean") {
        errors.push(`candidates[${index}].incumbent must be boolean`);
      }
      if (typeof candidate.defending_seat !== "boolean") {
        errors.push(`candidates[${index}].defending_seat must be boolean`);
      } else if (candidate.defending_seat) {
        defendingSeats += 1;
      }
      if (candidate.status && !CANDIDATE_STATUSES.has(candidate.status)) {
        errors.push(`candidates[${index}].status is invalid`);
      }
      if (candidate.status === "standing") {
        standingParties.add(candidate.party_id || candidate.party_name);
      }
    });
  }

  if (standingParties.size < 2) {
    errors.push("at least two standing parties/candidates are required for a contested forecast");
  }
  if (defendingSeats > 1) {
    errors.push("only one candidate can be marked as defending_seat in a single-seat contest");
  }

  return { ok: errors.length === 0, errors };
}

export function validateCandidateRosters(rosters) {
  if (!Array.isArray(rosters)) {
    return { ok: false, results: [], errors: ["candidate rosters manifest must be an array"] };
  }

  const rosterIds = new Set();
  const results = rosters.map((roster, index) => {
    const result = validateCandidateRoster(roster);
    if (rosterIds.has(roster.roster_id)) {
      result.ok = false;
      result.errors.push("roster_id must be unique");
    }
    if (roster.roster_id) rosterIds.add(roster.roster_id);
    return { index, roster_id: roster.roster_id, ...result };
  });
  const failures = results.filter((result) => !result.ok);
  return { ok: failures.length === 0, results, errors: failures.flatMap((failure) => failure.errors) };
}
