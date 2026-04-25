/**
 * backtestModel.js — Walk-forward backtesting engine for election predictions.
 *
 * Tests the model against historical results with strict temporal boundaries:
 * only data available at prediction time is used.
 *
 * Metrics: RMSE (seats), ward winner accuracy, vote share MAE, Brier score,
 * party seat bias. Target: RMSE < 3.58 (PollCheck benchmark).
 */

import { predictWard, DEFAULT_ASSUMPTIONS, normalizePartyName } from './electionModel.js'

// Historical national polling (spring averages, pre-election)
const HISTORICAL_POLLING = {
  2019: { Labour: 0.27, Conservative: 0.35, 'Liberal Democrats': 0.18, 'Green Party': 0.08, 'Reform UK': 0.12 },
  2021: { Labour: 0.31, Conservative: 0.42, 'Liberal Democrats': 0.08, 'Green Party': 0.05, 'Reform UK': 0.04 },
  2022: { Labour: 0.38, Conservative: 0.33, 'Liberal Democrats': 0.11, 'Green Party': 0.06, 'Reform UK': 0.05 },
  2023: { Labour: 0.44, Conservative: 0.26, 'Liberal Democrats': 0.10, 'Green Party': 0.06, 'Reform UK': 0.07 },
  2024: { Labour: 0.40, Conservative: 0.22, 'Liberal Democrats': 0.11, 'Green Party': 0.07, 'Reform UK': 0.15 },
}

// GE results used as baselines for the polling swing (what polling moves relative to)
const HISTORICAL_GE_BASELINES = {
  // Pre-2024: compare polling to GE2019
  2019: { Labour: 0.322, Conservative: 0.435, 'Liberal Democrats': 0.116, 'Green Party': 0.027, 'Reform UK': 0.020 },
  2021: { Labour: 0.322, Conservative: 0.435, 'Liberal Democrats': 0.116, 'Green Party': 0.027, 'Reform UK': 0.020 },
  2022: { Labour: 0.322, Conservative: 0.435, 'Liberal Democrats': 0.116, 'Green Party': 0.027, 'Reform UK': 0.020 },
  2023: { Labour: 0.322, Conservative: 0.435, 'Liberal Democrats': 0.116, 'Green Party': 0.027, 'Reform UK': 0.020 },
  // 2024+: compare to GE2024
  2024: { Labour: 0.337, Conservative: 0.237, 'Reform UK': 0.143, 'Liberal Democrats': 0.122, 'Green Party': 0.069 },
}

/**
 * Filter ward history to only include elections strictly before the prediction year.
 */
function filterHistoryBefore(wardData, year) {
  if (!wardData?.history) return wardData
  return {
    ...wardData,
    history: wardData.history.filter(e => {
      const eYear = e.year || parseInt(e.date?.substring(0, 4)) || 0
      return eYear < year
    }),
  }
}

/**
 * Get actual vote shares from an election result.
 */
function getActualShares(election) {
  if (!election?.candidates) return {}
  const shares = {}
  for (const c of election.candidates) {
    const party = normalizePartyName(c.party)
    if (!shares[party] || c.pct > shares[party]) {
      shares[party] = c.pct
    }
  }
  return shares
}

/**
 * Find wards that were actually contested in a given year.
 */
function getContestedWards(electionsData, year) {
  const result = []
  for (const [wardName, ward] of Object.entries(electionsData.wards || {})) {
    const elections = ward.history?.filter(e => {
      const eYear = e.year || parseInt(e.date?.substring(0, 4)) || 0
      return eYear === year && e.type !== 'county' && e.candidates?.length > 0
    })
    if (elections?.length > 0) {
      result.push({
        name: wardName,
        data: ward,
        actual: elections[0], // Most recent election in that year
      })
    }
  }
  return result
}

/**
 * Run a walk-forward backtest across multiple years and councils.
 *
 * @param {Object} councilElections - { councilId: electionsData }
 * @param {Object} demographicsMaps - { councilId: { wardName: demographics } }
 * @param {Object} deprivationMaps - { councilId: { wardName: deprivation } }
 * @param {number[]} backtestYears - e.g. [2019, 2021, 2022, 2023, 2024]
 * @param {Object} assumptions - Model assumptions (default if null)
 * @param {Object} lcc2025 - LCC 2025 reference (only used for year >= 2026)
 * @returns {Object} Backtest results with metrics
 */
export function runBacktest(
  councilElections,
  demographicsMaps = {},
  deprivationMaps = {},
  backtestYears = [2019, 2021, 2022, 2023, 2024],
  assumptions = null,
  lcc2025 = null,
) {
  const params = assumptions || DEFAULT_ASSUMPTIONS
  const wardResults = []
  const councilResults = []

  for (const year of backtestYears) {
    const polling = HISTORICAL_POLLING[year]
    const geBaseline = HISTORICAL_GE_BASELINES[year]
    if (!polling) continue

    // Temporal data availability
    const useLcc = year >= 2026 ? lcc2025 : null

    for (const [councilId, electionsData] of Object.entries(councilElections)) {
      const contested = getContestedWards(electionsData, year)
      if (!contested.length) continue

      const predictedSeats = {}
      const actualSeats = {}
      const demoMap = demographicsMaps[councilId] || {}
      const depMap = deprivationMaps[councilId] || {}

      for (const ward of contested) {
        // Filter history to only pre-year data
        const filteredWard = filterHistoryBefore(ward.data, year)

        // Run prediction with temporal constraints
        const prediction = predictWard(
          filteredWard,
          { ...params, reformStandsInAllWards: year >= 2023 }, // Reform barely stood pre-2023
          polling,
          geBaseline,
          demoMap[ward.name] || null,
          depMap[ward.name] || null,
          null, // no constituency map for backtest
          useLcc,
          null, // no model params override
          null, // no fiscal data
          null, // no candidate filter for backtest (use actual candidates retroactively)
          null, // no ethnic projections for backtest
        )

        if (!prediction?.prediction) continue

        // Get actual result
        const actualShares = getActualShares(ward.actual)
        const actualWinner = ward.actual.candidates
          ?.sort((a, b) => (b.votes || 0) - (a.votes || 0))[0]
        const actualWinnerParty = actualWinner ? normalizePartyName(actualWinner.party) : null

        // Record
        wardResults.push({
          year,
          councilId,
          ward: ward.name,
          predictedWinner: prediction.winner,
          actualWinner: actualWinnerParty,
          correct: prediction.winner === actualWinnerParty,
          predictedShares: Object.fromEntries(
            Object.entries(prediction.prediction).map(([p, d]) => [p, d.pct])
          ),
          actualShares,
          confidence: prediction.confidence,
        })

        // Tally seats
        if (prediction.winner) predictedSeats[prediction.winner] = (predictedSeats[prediction.winner] || 0) + 1
        if (actualWinnerParty) actualSeats[actualWinnerParty] = (actualSeats[actualWinnerParty] || 0) + 1
      }

      if (Object.keys(actualSeats).length > 0) {
        councilResults.push({ year, councilId, predictedSeats, actualSeats })
      }
    }
  }

  return {
    wardResults,
    councilResults,
    metrics: computeMetrics(wardResults, councilResults),
  }
}

/**
 * Compute all backtest metrics.
 */
function computeMetrics(wardResults, councilResults) {
  if (!wardResults.length) return { error: 'No ward results to evaluate' }

  // 1. Ward winner accuracy
  const correct = wardResults.filter(w => w.correct).length
  const accuracy = correct / wardResults.length

  // 2. Vote share MAE per party
  const partyErrors = {}
  for (const w of wardResults) {
    const allParties = new Set([
      ...Object.keys(w.predictedShares || {}),
      ...Object.keys(w.actualShares || {}),
    ])
    for (const party of allParties) {
      const predicted = w.predictedShares?.[party] || 0
      const actual = w.actualShares?.[party] || 0
      if (!partyErrors[party]) partyErrors[party] = []
      partyErrors[party].push(Math.abs(predicted - actual))
    }
  }
  const voteShareMAE = {}
  for (const [party, errors] of Object.entries(partyErrors)) {
    voteShareMAE[party] = {
      mae: errors.reduce((a, b) => a + b, 0) / errors.length,
      n: errors.length,
    }
  }

  // 3. RMSE of seats per party per council
  const seatErrors = []
  for (const c of councilResults) {
    const allParties = new Set([
      ...Object.keys(c.predictedSeats),
      ...Object.keys(c.actualSeats),
    ])
    for (const party of allParties) {
      const diff = (c.predictedSeats[party] || 0) - (c.actualSeats[party] || 0)
      seatErrors.push(diff * diff)
    }
  }
  const seatRMSE = seatErrors.length > 0
    ? Math.sqrt(seatErrors.reduce((a, b) => a + b, 0) / seatErrors.length)
    : null

  // 4. Brier score (binary: did predicted winner actually win?)
  let brierSum = 0
  for (const w of wardResults) {
    const topPct = Math.max(...Object.values(w.predictedShares || { _: 0.5 }))
    const outcome = w.correct ? 1 : 0
    brierSum += (topPct - outcome) ** 2
  }
  const brierScore = brierSum / wardResults.length

  // 5. Party seat bias (predicted - actual, across all councils)
  const partyBias = {}
  for (const c of councilResults) {
    const allParties = new Set([...Object.keys(c.predictedSeats), ...Object.keys(c.actualSeats)])
    for (const party of allParties) {
      partyBias[party] = (partyBias[party] || 0) +
        (c.predictedSeats[party] || 0) - (c.actualSeats[party] || 0)
    }
  }

  // 6. Per-year breakdown
  const yearBreakdown = {}
  const years = [...new Set(wardResults.map(w => w.year))].sort()
  for (const year of years) {
    const yearWards = wardResults.filter(w => w.year === year)
    const yearCorrect = yearWards.filter(w => w.correct).length
    yearBreakdown[year] = {
      wards: yearWards.length,
      accuracy: yearWards.length > 0 ? yearCorrect / yearWards.length : 0,
    }
  }

  return {
    totalWards: wardResults.length,
    accuracy: Math.round(accuracy * 1000) / 1000,
    seatRMSE: seatRMSE ? Math.round(seatRMSE * 100) / 100 : null,
    brierScore: Math.round(brierScore * 1000) / 1000,
    voteShareMAE,
    partyBias,
    yearBreakdown,
    benchmark: { pollcheck_rmse: 3.58, pollcheck_accuracy: 0.72 },
  }
}
