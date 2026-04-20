import { createHash } from "node:crypto";

function stableId(prefix, parts) {
  return `${prefix}-${createHash("sha1").update(JSON.stringify(parts)).digest("hex").slice(0, 12)}`;
}

function integerOrUndefined(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : undefined;
}

function normalisedResultRows(rows = []) {
  return rows
    .map((row) => ({
      candidate_or_party_name: row.candidate_or_party_name,
      party_name: row.party_name,
      votes: Math.max(0, Math.round(Number(row.votes))),
      elected: Boolean(row.elected)
    }))
    .sort((left, right) => right.votes - left.votes)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

export function importOfficialHistoryRecords({
  officialHistoryData = {},
  sourceSnapshot,
  boundaries = [],
  existingHistory = []
}) {
  if (!sourceSnapshot) return [];
  const boundaryByCode = new Map(boundaries.map((boundary) => [boundary.area_code, boundary]));
  const existingContestKeys = new Set(existingHistory
    .filter((record) => record.review_status !== "quarantined")
    .map((record) => `${record.area_code}::${record.election_date}`));
  return (officialHistoryData.records || [])
    .filter((record) => boundaryByCode.has(record.area_code))
    .filter((record) => !existingContestKeys.has(`${record.area_code}::${record.election_date}`))
    .map((record) => {
      const boundary = boundaryByCode.get(record.area_code);
      const resultRows = normalisedResultRows(record.result_rows);
      return {
        history_id: stableId("official-history", [record.area_code, record.election_date, record.source_url]),
        contest_id: `official.${record.area_code.toLowerCase()}.${record.election_date}`,
        area_id: boundary.boundary_version_id,
        area_code: record.area_code,
        area_name: boundary.area_name,
        boundary_version_id: boundary.boundary_version_id,
        election_date: record.election_date,
        election_type: record.election_type,
        voting_system: record.voting_system,
        source_snapshot_id: sourceSnapshot.snapshot_id,
        source_url: record.source_url || sourceSnapshot.source_url,
        electorate: integerOrUndefined(record.electorate),
        turnout_votes: resultRows.reduce((sum, row) => sum + row.votes, 0),
        turnout: record.turnout,
        seats_contested: integerOrUndefined(record.seats_contested),
        review_status: "reviewed",
        upstream: {
          system: officialHistoryData.source_name || "Official election results",
          official_result: true,
          manual_transcription: true
        },
        result_rows: resultRows
      };
    })
    .filter((record) => record.result_rows.length > 0 && record.turnout_votes > 0);
}
