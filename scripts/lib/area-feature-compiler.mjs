import { createHash } from "node:crypto";

function latestHistoryForArea(historyRecords, areaCode) {
  return [...historyRecords]
    .filter((record) => record.area_code === areaCode)
    .sort((left, right) => right.election_date.localeCompare(left.election_date))[0] || null;
}

function winnerFromHistory(record) {
  return [...(record?.result_rows || [])].sort((a, b) => a.rank - b.rank)[0] || null;
}

function countHistory(historyRecords, areaCode) {
  return historyRecords.filter((record) => record.area_code === areaCode).length;
}

export function compileAreaFeatureSnapshot({
  area,
  modelFamily,
  boundaryVersion,
  historyRecords = [],
  pollAggregate = null,
  asylumContext = null,
  populationProjection = null,
  provenance = [],
  asOf
}) {
  const latest = latestHistoryForArea(historyRecords, area.area_code);
  const winner = winnerFromHistory(latest);
  const features = {
    electoral_history: {
      previous_contests: countHistory(historyRecords, area.area_code),
      latest_contest_date: latest?.election_date || null,
      baseline_party: winner?.party_name || null
    }
  };

  if (pollAggregate) {
    features.poll_context = {
      poll_aggregate_id: pollAggregate.poll_aggregate_id,
      geography: pollAggregate.geography,
      method: pollAggregate.method,
      half_life_days: pollAggregate.half_life_days
    };
  }
  if (asylumContext) features.asylum_context = asylumContext;
  if (populationProjection) features.population_projection = populationProjection;

  const seed = JSON.stringify({ area, modelFamily, boundaryVersionId: boundaryVersion.boundary_version_id, asOf, features });
  return {
    feature_snapshot_id: `features-${createHash("sha1").update(seed).digest("hex").slice(0, 12)}`,
    area_code: area.area_code,
    area_name: area.area_name,
    boundary_version_id: boundaryVersion.boundary_version_id,
    model_family: modelFamily,
    as_of: asOf,
    review_status: "unreviewed",
    features,
    provenance
  };
}
