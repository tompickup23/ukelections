function winner(record) {
  return [...(record.result_rows || [])].sort((left, right) => left.rank - right.rank)[0]?.party_name || null;
}

function shares(record) {
  const total = record.turnout_votes || (record.result_rows || []).reduce((sum, row) => sum + (row.votes || 0), 0);
  return Object.fromEntries((record.result_rows || []).map((row) => [row.party_name, total > 0 ? row.votes / total : 0]));
}

function rollingAverageShares(records, windowSize = 2) {
  const window = records.slice(-windowSize);
  const parties = new Set(window.flatMap((record) => Object.keys(shares(record))));
  return Object.fromEntries([...parties].map((party) => [
    party,
    window.reduce((sum, record) => sum + (shares(record)[party] || 0), 0) / window.length
  ]));
}

function minHistory(modelFamily) {
  return {
    westminster_fptp: 2,
    local_fptp_borough: 3,
    local_fptp_county: 2,
    local_fptp_unitary: 2,
    local_stv: 2,
    senedd_closed_list_pr: 1,
    scottish_ams: 2
  }[modelFamily] || 2;
}

function uniqueAreaFamilies(featureSnapshots) {
  const seen = new Set();
  return featureSnapshots
    .map((feature) => ({ area_code: feature.area_code, area_name: feature.area_name, model_family: feature.model_family }))
    .filter((feature) => {
      const key = `${feature.area_code}::${feature.model_family}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function evaluate(records) {
  const rows = [];
  for (let index = 1; index < records.length; index += 1) {
    const trainingRecords = records.slice(0, index);
    const actual = records[index];
    const predictedShares = rollingAverageShares(trainingRecords, 2);
    const actualShares = shares(actual);
    const parties = new Set([...Object.keys(predictedShares), ...Object.keys(actualShares)]);
    const predictedWinner = Object.entries(predictedShares).sort((left, right) => right[1] - left[1])[0]?.[0] || null;
    const actualWinner = winner(actual);
    for (const party of parties) {
      rows.push({
        contest_id: actual.contest_id,
        party_name: party,
        predicted_vote_share: predictedShares[party] || 0,
        actual_vote_share: actualShares[party] || 0,
        absolute_error: Math.abs((predictedShares[party] || 0) - (actualShares[party] || 0)),
        predicted_winner: predictedWinner,
        actual_winner: actualWinner,
        winner_correct: predictedWinner === actualWinner
      });
    }
  }

  const contests = new Set(rows.map((row) => row.contest_id));
  const correctContests = new Set(rows.filter((row) => row.winner_correct).map((row) => row.contest_id));
  return {
    contests: contests.size,
    rows: rows.length,
    mean_absolute_error: rows.length ? rows.reduce((sum, row) => sum + row.absolute_error, 0) / rows.length : null,
    winner_accuracy: contests.size ? correctContests.size / contests.size : null
  };
}

function passes(metrics) {
  return metrics.contests >= 1 && metrics.mean_absolute_error <= 0.22 && metrics.winner_accuracy >= 0.5;
}

export function buildBaselineBacktests({ history = [], featureSnapshots = [], generatedAt }) {
  const historyByArea = new Map();
  for (const record of history) {
    const list = historyByArea.get(record.area_code) || [];
    list.push(record);
    historyByArea.set(record.area_code, list);
  }

  return uniqueAreaFamilies(featureSnapshots).map((area) => {
    const records = (historyByArea.get(area.area_code) || [])
      .filter((record) => record.election_date && (record.result_rows || []).length > 1)
      .sort((left, right) => left.election_date.localeCompare(right.election_date));
    const required = minHistory(area.model_family);
    const metrics = records.length >= 2 ? evaluate(records) : {
      contests: 0,
      rows: 0,
      mean_absolute_error: null,
      winner_accuracy: null
    };
    const enoughHistory = records.length >= required;
    const status = enoughHistory && passes(metrics) ? "passed" : enoughHistory ? "failed" : "missing";
    return {
      backtest_id: `baseline-history-${area.model_family}-${area.area_code}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      area_code: area.area_code,
      area_name: area.area_name,
      model_family: area.model_family,
      generated_at: generatedAt || new Date().toISOString(),
      method: "rolling_two_contest_party_share_average",
      status,
      required_history_records: required,
      history_records: records.length,
      source_history_ids: records.map((record) => record.history_id).filter(Boolean),
      metrics,
      thresholds: {
        mean_absolute_error_max: 0.22,
        winner_accuracy_min: 0.5
      }
    };
  });
}
