function winner(record) {
  return [...(record.result_rows || [])].sort((left, right) => left.rank - right.rank)[0]?.party_name || null;
}

function electedParties(record) {
  const parties = new Set((record.result_rows || []).filter((row) => row.elected).map((row) => row.party_name));
  if (parties.size === 0) {
    const topParty = winner(record);
    if (topParty) parties.add(topParty);
  }
  return parties;
}

function shares(record) {
  const total = record.turnout_votes || (record.result_rows || []).reduce((sum, row) => sum + (row.votes || 0), 0);
  const partyShares = {};
  for (const row of record.result_rows || []) {
    partyShares[row.party_name] = (partyShares[row.party_name] || 0) + (total > 0 ? row.votes / total : 0);
  }
  return partyShares;
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

function mergeContestRecords(records) {
  const recordsByContest = new Map();
  for (const record of records) {
    const key = record.contest_id || `${record.area_code}:${record.election_date}`;
    const list = recordsByContest.get(key) || [];
    list.push(record);
    recordsByContest.set(key, list);
  }

  return [...recordsByContest.values()].map((group) => {
    if (group.length === 1) return group[0];
    const resultRows = group
      .flatMap((record) => record.result_rows || [])
      .sort((left, right) => (right.votes || 0) - (left.votes || 0));
    const turnoutVotes = resultRows.reduce((sum, row) => sum + (row.votes || 0), 0);
    return {
      ...group[0],
      history_id: group.map((record) => record.history_id).filter(Boolean).join("+"),
      source_history_ids: group.map((record) => record.history_id).filter(Boolean),
      turnout_votes: turnoutVotes,
      result_rows: resultRows.map((row, index) => ({
        ...row,
        vote_share: turnoutVotes > 0 ? (row.votes || 0) / turnoutVotes : 0,
        rank: index + 1
      }))
    };
  });
}

function normaliseShares(sharesByParty) {
  const entries = Object.entries(sharesByParty)
    .map(([party, value]) => [party, Math.max(0, value)])
    .filter(([, value]) => value > 0);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  if (!total) return {};
  return Object.fromEntries(entries.map(([party, value]) => [party, value / total]));
}

function buildCalibrationIndex(historyByArea, areaFamilyByCode) {
  const recordsByArea = new Map();
  for (const [areaCode, areaRecords] of historyByArea.entries()) {
    recordsByArea.set(areaCode, mergeContestRecords(areaRecords)
      .filter((record) => record.election_date && (record.result_rows || []).length > 1)
      .sort((left, right) => left.election_date.localeCompare(right.election_date)));
  }

  return function calibrationFor({ modelFamily, electionDate, targetAreaCode }) {
    const swingTotals = new Map();
    const swingCounts = new Map();
    const sourceAreaCodes = [];

    for (const [areaCode, records] of recordsByArea.entries()) {
      if (areaCode === targetAreaCode || areaFamilyByCode.get(areaCode) !== modelFamily) continue;
      const actualIndex = records.findIndex((record) => record.election_date === electionDate);
      if (actualIndex < 1) continue;

      const baselineShares = rollingAverageShares(records.slice(0, actualIndex), 2);
      const actualShares = shares(records[actualIndex]);
      const parties = new Set([...Object.keys(baselineShares), ...Object.keys(actualShares)]);
      for (const party of parties) {
        swingTotals.set(party, (swingTotals.get(party) || 0) + ((actualShares[party] || 0) - (baselineShares[party] || 0)));
        swingCounts.set(party, (swingCounts.get(party) || 0) + 1);
      }
      sourceAreaCodes.push(areaCode);
    }

    return {
      source_area_count: sourceAreaCodes.length,
      source_area_codes: sourceAreaCodes,
      swing: Object.fromEntries([...swingTotals.entries()].map(([party, value]) => [
        party,
        value / (swingCounts.get(party) || 1)
      ]))
    };
  };
}

function calibratedShares(records, actual, calibration) {
  const baselineShares = rollingAverageShares(records, 2);
  const actualShares = shares(actual);
  const parties = new Set([...Object.keys(baselineShares), ...Object.keys(calibration.swing), ...Object.keys(actualShares)]);
  return normaliseShares(Object.fromEntries([...parties].map((party) => [
    party,
    (baselineShares[party] || 0) + (calibration.swing[party] || 0)
  ])));
}

function evaluate(records, context) {
  const rows = [];
  const calibrationAreaCounts = [];
  for (let index = 1; index < records.length; index += 1) {
    const trainingRecords = records.slice(0, index);
    const actual = records[index];
    const calibration = context.calibrationFor({
      modelFamily: context.modelFamily,
      electionDate: actual.election_date,
      targetAreaCode: context.areaCode
    });
    calibrationAreaCounts.push(calibration.source_area_count);
    const predictedShares = calibratedShares(trainingRecords, actual, calibration);
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
  const electedPartyHits = new Set();
  for (let index = 1; index < records.length; index += 1) {
    const trainingRecords = records.slice(0, index);
    const actual = records[index];
    const calibration = context.calibrationFor({
      modelFamily: context.modelFamily,
      electionDate: actual.election_date,
      targetAreaCode: context.areaCode
    });
    const predictedShares = calibratedShares(trainingRecords, actual, calibration);
    const predictedWinner = Object.entries(predictedShares).sort((left, right) => right[1] - left[1])[0]?.[0] || null;
    if (predictedWinner && electedParties(actual).has(predictedWinner)) {
      electedPartyHits.add(actual.contest_id);
    }
  }
  return {
    contests: contests.size,
    rows: rows.length,
    mean_absolute_error: rows.length ? rows.reduce((sum, row) => sum + row.absolute_error, 0) / rows.length : null,
    winner_accuracy: contests.size ? correctContests.size / contests.size : null,
    elected_party_hit_rate: contests.size ? electedPartyHits.size / contests.size : null,
    mean_calibration_area_count: calibrationAreaCounts.length
      ? calibrationAreaCounts.reduce((sum, count) => sum + count, 0) / calibrationAreaCounts.length
      : 0
  };
}

function passes(metrics) {
  return metrics.contests >= 1 && metrics.mean_absolute_error <= 0.22 && metrics.elected_party_hit_rate >= 0.5;
}

export function buildBaselineBacktests({ history = [], featureSnapshots = [], generatedAt }) {
  const historyByArea = new Map();
  for (const record of history) {
    const list = historyByArea.get(record.area_code) || [];
    list.push(record);
    historyByArea.set(record.area_code, list);
  }
  const areaFamilyByCode = new Map(uniqueAreaFamilies(featureSnapshots).map((area) => [area.area_code, area.model_family]));
  const calibrationFor = buildCalibrationIndex(historyByArea, areaFamilyByCode);

  return uniqueAreaFamilies(featureSnapshots).map((area) => {
    const records = mergeContestRecords(historyByArea.get(area.area_code) || [])
      .filter((record) => record.election_date && (record.result_rows || []).length > 1)
      .sort((left, right) => left.election_date.localeCompare(right.election_date));
    const required = minHistory(area.model_family);
    const metrics = records.length >= 2 ? evaluate(records, {
      areaCode: area.area_code,
      modelFamily: area.model_family,
      calibrationFor
    }) : {
      contests: 0,
      rows: 0,
      mean_absolute_error: null,
      winner_accuracy: null,
      elected_party_hit_rate: null,
      mean_calibration_area_count: 0
    };
    const enoughHistory = records.length >= required;
    const status = enoughHistory && passes(metrics) ? "passed" : enoughHistory ? "failed" : "missing";
    return {
      backtest_id: `baseline-history-${area.model_family}-${area.area_code}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      area_code: area.area_code,
      area_name: area.area_name,
      model_family: area.model_family,
      generated_at: generatedAt || new Date().toISOString(),
      method: "rolling_two_contest_party_share_average_with_leave_one_area_out_election_swing",
      status,
      required_history_records: required,
      history_records: records.length,
      source_history_ids: records.flatMap((record) => record.source_history_ids || [record.history_id]).filter(Boolean),
      metrics,
      thresholds: {
        mean_absolute_error_max: 0.22,
        elected_party_hit_rate_min: 0.5,
        winner_accuracy_min: 0.5
      }
    };
  });
}
