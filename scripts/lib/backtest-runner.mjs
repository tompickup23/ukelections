function winnerFromHistory(record) {
  return [...(record.result_rows || [])].sort((a, b) => a.rank - b.rank)[0]?.party_name || null;
}

function sharesFromHistory(record) {
  const total = record.turnout_votes || (record.result_rows || []).reduce((sum, row) => sum + (row.votes || 0), 0);
  return Object.fromEntries((record.result_rows || []).map((row) => [row.party_name, total > 0 ? row.votes / total : 0]));
}

export function runBacktest(predictions, historyRecords, options = {}) {
  const historyByContest = new Map(historyRecords.map((record) => [record.contest_id, record]));
  const predictionsByContest = new Map();

  for (const prediction of predictions) {
    if (!predictionsByContest.has(prediction.contest_id)) predictionsByContest.set(prediction.contest_id, []);
    predictionsByContest.get(prediction.contest_id).push(prediction);
  }

  const rows = [];
  for (const [contestId, contestPredictions] of predictionsByContest.entries()) {
    const history = historyByContest.get(contestId);
    if (!history) continue;
    const actualShares = sharesFromHistory(history);
    const actualParty = winnerFromHistory(history);
    const predictedWinner = [...contestPredictions].sort((a, b) => b.win_probability - a.win_probability)[0]?.party_name || null;

    for (const prediction of contestPredictions) {
      const actual = actualShares[prediction.party_name] ?? 0;
      rows.push({
        backtest_id: `${options.modelVersion || prediction.model_version}.${contestId}.${prediction.party_name}`,
        model_version: options.modelVersion || prediction.model_version,
        contest_id: contestId,
        prediction_id: prediction.prediction_id,
        actual_party: actualParty,
        predicted_party: predictedWinner,
        party_name: prediction.party_name,
        actual_vote_share: actual,
        predicted_vote_share_p50: prediction.p50,
        absolute_error: Math.abs(actual - prediction.p50),
        winner_correct: actualParty === predictedWinner
      });
    }
  }

  const mae = rows.length ? rows.reduce((sum, row) => sum + row.absolute_error, 0) / rows.length : null;
  const contests = new Set(rows.map((row) => row.contest_id));
  const correctContests = new Set(rows.filter((row) => row.winner_correct).map((row) => row.contest_id));

  return {
    generated_at: options.generatedAt || new Date().toISOString(),
    model_version: options.modelVersion || predictions[0]?.model_version || "unknown",
    contests: contests.size,
    rows,
    metrics: {
      mean_absolute_error: mae,
      winner_accuracy: contests.size ? correctContests.size / contests.size : null
    }
  };
}
