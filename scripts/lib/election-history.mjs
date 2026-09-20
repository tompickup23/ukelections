const REVIEW_PRIORITY = Object.freeze({
  provisional_single_source: 1,
  auto_ingested_dc: 2,
  hand_verified_two_sources: 3,
  hand_verified_declaration: 4,
});

function reviewPriority(row) {
  return REVIEW_PRIORITY[row?.review_status] ?? 0;
}

/**
 * Merge duplicate ballot records without allowing an unreviewed archive row to
 * shadow the tracked sidecar. Equal-ranked later rows win so a tracked
 * correction can replace an older copy from the regenerated history file.
 */
export function mergeHistoryRows(...groups) {
  const byId = new Map();
  const withoutId = [];

  for (const rows of groups) {
    for (const row of rows || []) {
      const id = row?.ballot_paper_id;
      if (!id) {
        withoutId.push(row);
        continue;
      }
      const current = byId.get(id);
      if (!current || reviewPriority(row) >= reviewPriority(current)) byId.set(id, row);
    }
  }

  return [...byId.values(), ...withoutId];
}

/** The history contract stores turnout as a fraction, never percentage points. */
export function assertFractionalTurnout(rows) {
  const invalid = (rows || []).filter(
    (row) => typeof row?.turnout_pct === "number" && (row.turnout_pct < 0 || row.turnout_pct > 1),
  );
  if (!invalid.length) return;

  const detail = invalid
    .map((row) => `${row.ballot_paper_id || "unknown ballot"}=${row.turnout_pct}`)
    .join(", ");
  throw new Error(`turnout_pct must be a 0-1 fraction: ${detail}`);
}
