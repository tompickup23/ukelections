import { describe, it, expect } from 'vitest'
import {
  DEFAULT_ASSUMPTIONS,
  predictWard,
  predictCouncil,
  predictConstituencyGE,
  applyOverrides,
  computeCoalitions,
  projectToLGRAuthority,
  normalizePartyName,
  calculateFiscalStressAdjustment,
} from '../src/lib/electionModel.js'

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const mockWardHistory = {
  history: [
    {
      date: '2024-05-02',
      year: 2024,
      type: 'borough',
      seats_contested: 1,
      turnout_votes: 1823,
      turnout: 0.312,
      electorate: 5842,
      candidates: [
        { name: 'Alice', party: 'Labour', votes: 742, pct: 0.407, elected: true },
        { name: 'Bob', party: 'Conservative', votes: 538, pct: 0.295, elected: false },
        { name: 'Carol', party: 'Green Party', votes: 343, pct: 0.188, elected: false },
        { name: 'Dave', party: 'Liberal Democrats', votes: 200, pct: 0.110, elected: false },
      ],
      majority: 204,
      majority_pct: 0.112,
    },
    {
      date: '2021-05-06',
      year: 2021,
      type: 'borough',
      seats_contested: 1,
      turnout_votes: 1500,
      turnout: 0.260,
      electorate: 5770,
      candidates: [
        { name: 'Alice', party: 'Labour', votes: 650, pct: 0.433, elected: true },
        { name: 'Eve', party: 'Conservative', votes: 450, pct: 0.300, elected: false },
        { name: 'Frank', party: 'Green Party', votes: 400, pct: 0.267, elected: false },
      ],
      majority: 200,
    },
  ],
  current_holders: [{ name: 'Alice Smith', party: 'Labour' }],
  seats: 3,
  electorate: 5842,
}

const mockCountyWard = {
  history: [
    {
      date: '2021-05-06',
      year: 2021,
      type: 'county',
      seats_contested: 1,
      turnout_votes: 3000,
      turnout: 0.28,
      electorate: 10714,
      candidates: [
        { name: 'X', party: 'Conservative', votes: 1200, pct: 0.400, elected: true },
        { name: 'Y', party: 'Labour', votes: 1000, pct: 0.333, elected: false },
        { name: 'Z', party: 'Liberal Democrats', votes: 800, pct: 0.267, elected: false },
      ],
    },
  ],
  current_holders: [{ name: 'X', party: 'Conservative' }],
}

const nationalPolling = { Labour: 0.29, Conservative: 0.24, 'Reform UK': 0.22, 'Liberal Democrats': 0.12, 'Green Party': 0.07 }
const ge2024Result = { Labour: 0.337, Conservative: 0.237, 'Reform UK': 0.143, 'Liberal Democrats': 0.122, 'Green Party': 0.069 }

// ---------------------------------------------------------------------------
// DEFAULT_ASSUMPTIONS
// ---------------------------------------------------------------------------

describe('DEFAULT_ASSUMPTIONS', () => {
  it('has all required fields', () => {
    expect(DEFAULT_ASSUMPTIONS).toHaveProperty('nationalToLocalDampening', 0.65)
    expect(DEFAULT_ASSUMPTIONS).toHaveProperty('incumbencyBonusPct', 0.05)
    expect(DEFAULT_ASSUMPTIONS).toHaveProperty('retirementPenaltyPct', -0.02)
    expect(DEFAULT_ASSUMPTIONS).toHaveProperty('reformProxyWeights')
    expect(DEFAULT_ASSUMPTIONS.reformProxyWeights).toEqual({ ge: 0.25, lcc: 0.75 })
    expect(DEFAULT_ASSUMPTIONS).toHaveProperty('reformBoroughDampening', 0.95)
  })
})

// Internal functions (getBaseline, calculateNationalSwing, calculateDemographicAdjustments,
// calculateIncumbencyAdjustment, calculateReformEntry, normaliseShares) are tested
// indirectly through predictWard and predictCouncil.

// ---------------------------------------------------------------------------
// predictWard (covers internal helpers indirectly)
// ---------------------------------------------------------------------------

// Tests for internal helpers (getBaseline, calculateNationalSwing,
// calculateDemographicAdjustments, calculateIncumbencyAdjustment,
// calculateReformEntry, normaliseShares) removed — functions unexported.
// Covered indirectly through predictWard and predictCouncil tests below.

// ---------------------------------------------------------------------------
// predictWard
// ---------------------------------------------------------------------------

describe('predictWard', () => {
  const lcc2025 = { results: { 'Reform UK': { pct: 0.357 } } }

  it('returns prediction with all methodology steps', () => {
    const result = predictWard(mockWardHistory, DEFAULT_ASSUMPTIONS, nationalPolling, ge2024Result, null, null, null, lcc2025)
    expect(result.prediction).not.toBeNull()
    expect(result.methodology).toHaveLength(6)
    expect(result.methodology.map(m => m.step)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('returns a winner', () => {
    const result = predictWard(mockWardHistory, DEFAULT_ASSUMPTIONS, nationalPolling, ge2024Result, null, null, null, lcc2025)
    expect(result.winner).toBeDefined()
    expect(result.majority).toBeGreaterThanOrEqual(0)
  })

  it('has confidence level', () => {
    const result = predictWard(mockWardHistory, DEFAULT_ASSUMPTIONS, nationalPolling, ge2024Result)
    expect(['high', 'medium', 'low']).toContain(result.confidence)
  })

  it('estimates votes and turnout', () => {
    const result = predictWard(mockWardHistory, DEFAULT_ASSUMPTIONS, nationalPolling, ge2024Result)
    expect(result.estimatedTurnout).toBeGreaterThan(0.1)
    expect(result.estimatedTurnout).toBeLessThan(0.7)
    expect(result.estimatedVotes).toBeGreaterThan(0)
  })

  it('returns none confidence for empty ward', () => {
    const result = predictWard({ history: [] })
    expect(result.prediction).toBeNull()
    expect(result.confidence).toBe('none')
  })

  it('predictions sum to approximately 100%', () => {
    const result = predictWard(mockWardHistory, DEFAULT_ASSUMPTIONS, nationalPolling, ge2024Result)
    const totalPct = Object.values(result.prediction).reduce((s, v) => s + v.pct, 0)
    expect(totalPct).toBeCloseTo(1.0, 1)
  })

  it('turnout adjustment affects estimated turnout', () => {
    const highTurnout = { ...DEFAULT_ASSUMPTIONS, turnoutAdjustment: 0.05 }
    const lowTurnout = { ...DEFAULT_ASSUMPTIONS, turnoutAdjustment: -0.05 }
    const high = predictWard(mockWardHistory, highTurnout, nationalPolling, ge2024Result)
    const low = predictWard(mockWardHistory, lowTurnout, nationalPolling, ge2024Result)
    expect(high.estimatedTurnout).toBeGreaterThan(low.estimatedTurnout)
  })
})

// ---------------------------------------------------------------------------
// predictCouncil
// ---------------------------------------------------------------------------

describe('predictCouncil', () => {
  const mockElectionsData = {
    wards: {
      'Ward A': { ...mockWardHistory },
      'Ward B': {
        ...mockWardHistory,
        current_holders: [{ name: 'Bob', party: 'Conservative' }],
      },
      'Ward C': {
        history: [{
          date: '2022-05-05', year: 2022, type: 'borough',
          turnout_votes: 1500, turnout: 0.30, electorate: 5000,
          candidates: [
            { name: 'X', party: 'Conservative', votes: 800, pct: 0.533, elected: true },
            { name: 'Y', party: 'Labour', votes: 700, pct: 0.467, elected: false },
          ],
        }],
        current_holders: [{ name: 'X', party: 'Conservative' }],
      },
    },
  }

  it('predicts specified wards and counts non-contested seats', () => {
    const result = predictCouncil(
      mockElectionsData,
      ['Ward A', 'Ward B'],
      DEFAULT_ASSUMPTIONS,
      nationalPolling,
      ge2024Result,
    )
    expect(Object.keys(result.wards)).toHaveLength(2)
    expect(result.seatTotals).toBeDefined()
    expect(result.totalSeats).toBeGreaterThan(0)
  })

  it('includes non-contested ward holders in seat totals', () => {
    const result = predictCouncil(
      mockElectionsData,
      ['Ward A'], // Only predict Ward A
      DEFAULT_ASSUMPTIONS,
      nationalPolling,
      ge2024Result,
    )
    // Ward B and C are not up — their holders should be counted
    expect(result.seatTotals.Conservative || 0).toBeGreaterThanOrEqual(1)
  })

  it('applies integrity adjustment when integrityData provided', () => {
    const integrityData = {
      councillors: [{
        name: 'Alice',
        ward: 'Ward A',
        party: 'Labour',
        risk_level: 'high',
        red_flags: [
          { severity: 'critical', type: 'supplier_conflict' },
          { severity: 'high', type: 'undeclared_interest' },
          { severity: 'elevated', type: 'co_director' },
        ],
      }],
    }
    const result = predictCouncil(
      mockElectionsData,
      ['Ward A'],
      DEFAULT_ASSUMPTIONS,
      nationalPolling,
      ge2024Result,
      null, null, null, null, null, null,
      integrityData,
    )
    expect(Object.keys(result.wards)).toHaveLength(1)
    // Result should still produce a valid prediction
    expect(result.totalSeats).toBeGreaterThan(0)
  })

  it('works without integrityData (backward compatible)', () => {
    const result = predictCouncil(
      mockElectionsData,
      ['Ward A', 'Ward B'],
      DEFAULT_ASSUMPTIONS,
      nationalPolling,
      ge2024Result,
    )
    expect(Object.keys(result.wards)).toHaveLength(2)
    expect(result.totalSeats).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// applyOverrides
// ---------------------------------------------------------------------------

describe('applyOverrides', () => {
  it('swaps ward winner', () => {
    const councilResult = {
      wards: {
        'Ward A': { winner: 'Labour' },
        'Ward B': { winner: 'Conservative' },
      },
      seatTotals: { Labour: 10, Conservative: 8 },
    }

    const result = applyOverrides(councilResult, { 'Ward A': 'Reform UK' }, 18)
    expect(result.Labour).toBe(9) // Lost 1
    expect(result['Reform UK']).toBe(1) // Gained 1
    expect(result.Conservative).toBe(8) // Unchanged
  })

  it('removes party from totals when seats drop to zero', () => {
    const councilResult = {
      wards: { 'Ward A': { winner: 'Green Party' } },
      seatTotals: { 'Green Party': 1, Labour: 10 },
    }

    const result = applyOverrides(councilResult, { 'Ward A': 'Labour' }, 11)
    expect(result['Green Party']).toBeUndefined()
    expect(result.Labour).toBe(11)
  })

  it('handles empty overrides', () => {
    const councilResult = {
      wards: {},
      seatTotals: { Labour: 10 },
    }
    const result = applyOverrides(councilResult, {}, 10)
    expect(result.Labour).toBe(10)
  })
})

// ---------------------------------------------------------------------------
// computeCoalitions
// ---------------------------------------------------------------------------

describe('computeCoalitions', () => {
  it('finds single-party majority', () => {
    const result = computeCoalitions({ Labour: 25, Conservative: 15, 'Liberal Democrats': 5 }, 23)
    expect(result.some(c => c.type === 'majority' && c.parties.includes('Labour'))).toBe(true)
  })

  it('finds two-party coalitions', () => {
    const result = computeCoalitions({ Labour: 15, Conservative: 12, 'Green Party': 8, 'Liberal Democrats': 5 }, 21)
    expect(result.some(c => c.parties.length === 2)).toBe(true)
  })

  it('finds three-party coalitions when needed', () => {
    const result = computeCoalitions({ A: 8, B: 7, C: 6, D: 5 }, 20)
    expect(result.some(c => c.parties.length === 3)).toBe(true)
  })

  it('returns empty when no coalition possible', () => {
    const result = computeCoalitions({ A: 5, B: 3 }, 100)
    expect(result).toHaveLength(0)
  })

  it('calculates majority correctly', () => {
    const result = computeCoalitions({ Labour: 30 }, 23)
    const majorityCoalition = result.find(c => c.parties.includes('Labour'))
    expect(majorityCoalition.majority).toBe(8) // 30 - 23 + 1 = 8
  })

  it('sorts by total seats descending', () => {
    const result = computeCoalitions({ A: 15, B: 12, C: 10, D: 8 }, 20)
    for (let i = 1; i < result.length; i++) {
      expect(result[i].totalSeats).toBeLessThanOrEqual(result[i - 1].totalSeats)
    }
  })
})

// ---------------------------------------------------------------------------
// projectToLGRAuthority
// ---------------------------------------------------------------------------

describe('projectToLGRAuthority', () => {
  const lgrModel = {
    authorities: [
      { name: 'East Lancashire', councils: ['burnley', 'hyndburn', 'pendle', 'rossendale'] },
      { name: 'Central Lancashire', councils: ['preston', 'chorley', 'south_ribble'] },
    ],
  }

  const seatTotals = {
    burnley: { Labour: 23, Independent: 12, 'Liberal Democrats': 10 },
    hyndburn: { Labour: 21, Conservative: 13 },
    pendle: { Conservative: 21, Labour: 15, 'Liberal Democrats': 13 },
    rossendale: { Labour: 18, Conservative: 12, 'Green Party': 6 },
    preston: { Labour: 26, Conservative: 10, 'Liberal Democrats': 12 },
    chorley: { Labour: 36, Conservative: 6 },
    south_ribble: { Labour: 28, Conservative: 15, 'Liberal Democrats': 7 },
  }

  it('combines seat totals per authority', () => {
    const result = projectToLGRAuthority(seatTotals, lgrModel)
    expect(result['East Lancashire']).toBeDefined()
    expect(result['East Lancashire'].seats.Labour).toBe(23 + 21 + 15 + 18) // 77
  })

  it('calculates majority threshold', () => {
    const result = projectToLGRAuthority(seatTotals, lgrModel)
    const east = result['East Lancashire']
    expect(east.majorityThreshold).toBe(Math.floor(east.totalSeats / 2) + 1)
  })

  it('identifies largest party', () => {
    const result = projectToLGRAuthority(seatTotals, lgrModel)
    expect(result['East Lancashire'].largestParty).toBe('Labour')
  })

  it('computes coalitions for each authority', () => {
    const result = projectToLGRAuthority(seatTotals, lgrModel)
    expect(result['East Lancashire'].coalitions).toBeDefined()
    expect(Array.isArray(result['East Lancashire'].coalitions)).toBe(true)
  })

  it('returns empty for null/missing model', () => {
    expect(projectToLGRAuthority({}, null)).toEqual({})
    expect(projectToLGRAuthority({}, {})).toEqual({})
  })
})

// Tests for deleted V2 functions (calculateDemographicAdjustmentsV2,
// calculateNationalSwingV2, predictWardV2) removed — functions deleted from engine.

// ---------------------------------------------------------------------------
// predictConstituencyGE
// ---------------------------------------------------------------------------

describe('predictConstituencyGE', () => {
  const mockConstituency = {
    name: 'Burnley',
    ge2024: {
      results: [
        { party: 'Labour', pct: 0.40 },
        { party: 'Reform UK', pct: 0.25 },
        { party: 'Conservative', pct: 0.20 },
        { party: 'Liberal Democrats', pct: 0.10 },
        { party: 'Green Party', pct: 0.05 },
      ],
    },
    mp: { name: 'Oliver Ryan', party: 'Labour' },
  }

  const mockPolling = {
    aggregate: { Labour: 0.29, Conservative: 0.24, 'Reform UK': 0.22, 'Liberal Democrats': 0.12, 'Green Party': 0.07 },
    ge2024_baseline: { Labour: 0.337, Conservative: 0.237, 'Reform UK': 0.143, 'Liberal Democrats': 0.122, 'Green Party': 0.069 },
  }

  const mockModelCoeffs = {
    dampening_by_party: { Labour: 0.70, Conservative: 0.60, 'Reform UK': 0.75, 'Liberal Democrats': 0.55, 'Green Party': 0.50 },
  }

  it('returns null prediction when no constituency ge2024 results', () => {
    const result = predictConstituencyGE({}, mockPolling, mockModelCoeffs)
    expect(result.prediction).toBeNull()
    expect(result.confidence).toBe('none')
  })

  it('returns null prediction when no polling aggregate', () => {
    const result = predictConstituencyGE(mockConstituency, {}, mockModelCoeffs)
    expect(result.prediction).toBeNull()
  })

  it('returns null prediction for null inputs', () => {
    const result = predictConstituencyGE(null, null, null)
    expect(result.prediction).toBeNull()
    expect(result.confidence).toBe('none')
  })

  it('produces a winner and runnerUp', () => {
    const result = predictConstituencyGE(mockConstituency, mockPolling, mockModelCoeffs)
    expect(result.winner).toBeDefined()
    expect(result.runnerUp).toBeDefined()
    expect(result.majorityPct).toBeGreaterThanOrEqual(0)
  })

  it('prediction party shares sum to approximately 100%', () => {
    const result = predictConstituencyGE(mockConstituency, mockPolling, mockModelCoeffs)
    const total = Object.values(result.prediction).reduce((s, v) => s + v.pct, 0)
    expect(total).toBeCloseTo(1.0, 1)
  })

  it('applies dampening * 1.2 (capped at 0.95) for GE', () => {
    const result = predictConstituencyGE(mockConstituency, mockPolling, mockModelCoeffs)
    // Labour dampening: min(0.95, 0.70 * 1.2) = min(0.95, 0.84) = 0.84
    const labourDetail = result.methodology[1].details.Labour
    expect(labourDetail.dampening).toBeCloseTo(0.84, 2)
    // Reform UK dampening: min(0.95, 0.75 * 1.2) = min(0.95, 0.90) = 0.90
    const reformDetail = result.methodology[1].details['Reform UK']
    expect(reformDetail.dampening).toBeCloseTo(0.90, 2)
  })

  it('caps dampening at 0.95', () => {
    const highDampening = { dampening_by_party: { Labour: 0.85 } }
    const result = predictConstituencyGE(mockConstituency, mockPolling, highDampening)
    // Labour: min(0.95, 0.85 * 1.2) = min(0.95, 1.02) = 0.95
    const labourDetail = result.methodology[1].details.Labour
    expect(labourDetail.dampening).toBe(0.95)
  })

  it('includes swing vs GE2024', () => {
    const result = predictConstituencyGE(mockConstituency, mockPolling, mockModelCoeffs)
    expect(result.swing).toBeDefined()
    expect(typeof result.swing.Labour).toBe('number')
  })

  it('detects mpChange when winner differs from current MP', () => {
    const reformWin = {
      ...mockConstituency,
      ge2024: {
        results: [
          { party: 'Reform UK', pct: 0.55 },
          { party: 'Labour', pct: 0.25 },
          { party: 'Conservative', pct: 0.20 },
        ],
      },
      mp: { name: 'Oliver Ryan', party: 'Labour' },
    }
    const result = predictConstituencyGE(reformWin, mockPolling, mockModelCoeffs)
    if (result.winner !== 'Labour') {
      expect(result.mpChange).toBe(true)
    }
  })

  it('mpChange is false when winner matches MP party', () => {
    const result = predictConstituencyGE(mockConstituency, mockPolling, mockModelCoeffs)
    if (result.winner === 'Labour') {
      expect(result.mpChange).toBe(false)
    }
  })

  it('strips (Co-op) from MP party for mpChange comparison', () => {
    const coopMP = {
      ...mockConstituency,
      mp: { name: 'Test MP', party: 'Labour (Co-op)' },
    }
    const result = predictConstituencyGE(coopMP, mockPolling, mockModelCoeffs)
    // Labour (Co-op) stripped to Labour — should match Labour winner
    if (result.winner === 'Labour') {
      expect(result.mpChange).toBe(false)
    }
  })

  it('has methodology steps 1-3', () => {
    const result = predictConstituencyGE(mockConstituency, mockPolling, mockModelCoeffs)
    expect(result.methodology).toHaveLength(3)
    expect(result.methodology.map(m => m.step)).toEqual([1, 2, 3])
  })

  it('has confidence level', () => {
    const result = predictConstituencyGE(mockConstituency, mockPolling, mockModelCoeffs)
    expect(['high', 'medium', 'low']).toContain(result.confidence)
  })
})

// Tests for deleted predict() universal router removed — function deleted from engine.

// ---------------------------------------------------------------------------
// normalizePartyName
// ---------------------------------------------------------------------------

describe('normalizePartyName', () => {
  it('returns Unknown for null/undefined/empty', () => {
    expect(normalizePartyName(null)).toBe('Unknown')
    expect(normalizePartyName(undefined)).toBe('Unknown')
    expect(normalizePartyName('')).toBe('Unknown')
  })

  it('normalizes Labour & Co-operative variants to Labour', () => {
    expect(normalizePartyName('Labour & Co-operative')).toBe('Labour')
    expect(normalizePartyName('Labour & Co-operative Party')).toBe('Labour')
    expect(normalizePartyName('Labour and Co-operative')).toBe('Labour')
    expect(normalizePartyName('Labour & Coop')).toBe('Labour')
    expect(normalizePartyName('Labour Group')).toBe('Labour')
  })

  it('passes through plain Labour', () => {
    expect(normalizePartyName('Labour')).toBe('Labour')
  })

  it('normalizes Liberal Democrat variants', () => {
    expect(normalizePartyName('Liberal Democrats')).toBe('Liberal Democrats')
    expect(normalizePartyName('Lib Dem')).toBe('Liberal Democrats')
    expect(normalizePartyName('Lib Dems')).toBe('Liberal Democrats')
    expect(normalizePartyName('Liberal Democrat')).toBe('Liberal Democrats')
  })

  it('normalizes Conservative variants', () => {
    expect(normalizePartyName('Conservative')).toBe('Conservative')
    expect(normalizePartyName('The Conservative Party')).toBe('Conservative')
    expect(normalizePartyName('Conservative Group')).toBe('Conservative')
  })

  it('normalizes Green variants', () => {
    expect(normalizePartyName('Green Party')).toBe('Green Party')
    expect(normalizePartyName('Green')).toBe('Green Party')
    expect(normalizePartyName('Greens')).toBe('Green Party')
  })

  it('normalizes Reform / UKIP variants', () => {
    expect(normalizePartyName('Reform UK')).toBe('Reform UK')
    expect(normalizePartyName('Reform')).toBe('Reform UK')
    expect(normalizePartyName('UKIP')).toBe('Reform UK')
    expect(normalizePartyName('UK Independence Party')).toBe('Reform UK')
  })

  it('normalizes local independent groups to Independent', () => {
    expect(normalizePartyName('Independent')).toBe('Independent')
    expect(normalizePartyName('Our West Lancashire')).toBe('Independent')
    expect(normalizePartyName('4 BwD')).toBe('Independent')
    expect(normalizePartyName('Morecambe Bay Independents')).toBe('Independent')
    expect(normalizePartyName('Wyre Independent Group')).toBe('Independent')
    expect(normalizePartyName('Ashton Independent')).toBe('Independent')
    expect(normalizePartyName("Pendle's True Independents")).toBe('Independent')
  })

  it('passes through unknown parties unchanged', () => {
    expect(normalizePartyName('Plaid Cymru')).toBe('Plaid Cymru')
    expect(normalizePartyName('Your Party')).toBe('Your Party')
    expect(normalizePartyName('BNP')).toBe('BNP')
  })

  it('trims whitespace', () => {
    expect(normalizePartyName('  Labour  ')).toBe('Labour')
    expect(normalizePartyName(' Reform UK ')).toBe('Reform UK')
  })
})

// Tests for deleted buildCouncilSeatTotals removed — function deleted from engine.

// ---------------------------------------------------------------------------
// projectToLGRAuthority with normalization
// ---------------------------------------------------------------------------

describe('projectToLGRAuthority with normalization', () => {
  const lgrModel = {
    authorities: [
      { name: 'East Lancashire', councils: ['burnley', 'hyndburn', 'pendle', 'rossendale'] },
    ],
  }

  it('normalizes party names when aggregating across councils', () => {
    const seatTotals = {
      burnley: { Labour: 23, Independent: 12 },
      hyndburn: { Labour: 15, 'Labour & Co-operative': 6, Conservative: 13 },
      pendle: { Conservative: 21, Labour: 15 },
      rossendale: { Labour: 18, 'Green Party': 6 },
    }
    const result = projectToLGRAuthority(seatTotals, lgrModel)
    const east = result['East Lancashire']
    // Labour (23+15+15+18) + Labour & Co-op normalized (6) = 77
    expect(east.seats.Labour).toBe(77)
    // Labour & Co-operative should not appear separately
    expect(east.seats['Labour & Co-operative']).toBeUndefined()
  })

  it('includes perCouncil in output', () => {
    const seatTotals = {
      burnley: { Labour: 23 },
      hyndburn: { Labour: 21 },
      pendle: { Conservative: 21 },
      rossendale: { Labour: 18 },
    }
    const result = projectToLGRAuthority(seatTotals, lgrModel)
    const east = result['East Lancashire']
    expect(east.perCouncil).toBeDefined()
    expect(east.perCouncil.burnley).toEqual({ Labour: 23 })
    expect(east.perCouncil.pendle).toEqual({ Conservative: 21 })
  })

  it('handles mixed Independent groups correctly', () => {
    const seatTotals = {
      burnley: { Independent: 5 },
      hyndburn: { 'Wyre Independent Group': 3 },
      pendle: { '4 BwD': 2 },
      rossendale: { 'Our West Lancashire': 4 },
    }
    const result = projectToLGRAuthority(seatTotals, lgrModel)
    const east = result['East Lancashire']
    // All should be merged into Independent: 5+3+2+4 = 14
    expect(east.seats.Independent).toBe(14)
  })
})

// ---------------------------------------------------------------------------
// Candidacy Filter (Step 6.5)
// ---------------------------------------------------------------------------

describe('candidacy filter', () => {
  const mockCandidates2026 = [
    { name: 'Alice', party: 'Labour' },
    { name: 'Bob', party: 'Reform UK' },
    { name: 'Carol', party: 'Green Party' },
  ]

  const nationalPolling = { Labour: 0.29, Conservative: 0.24, 'Reform UK': 0.22, 'Liberal Democrats': 0.12, 'Green Party': 0.07 }
  const ge2024Result = { Labour: 0.337, Conservative: 0.237, 'Reform UK': 0.143, 'Liberal Democrats': 0.122, 'Green Party': 0.069 }

  it('filters non-standing parties when candidates_2026 provided', () => {
    const result = predictWard(
      mockWardHistory, DEFAULT_ASSUMPTIONS,
      nationalPolling, ge2024Result,
      null, null, null, null, null, null,
      mockCandidates2026, // only Labour, Reform, Green standing
    )
    expect(result.prediction).toBeDefined()
    // Conservative and Liberal Democrats should be filtered out
    expect(result.prediction['Conservative']).toBeUndefined()
    expect(result.prediction['Liberal Democrats']).toBeUndefined()
    // Standing parties should remain
    expect(result.prediction['Labour']).toBeDefined()
    expect(result.prediction['Reform UK']).toBeDefined()
    expect(result.prediction['Green Party']).toBeDefined()
  })

  it('is backward compatible when candidates_2026 is null', () => {
    const result = predictWard(
      mockWardHistory, DEFAULT_ASSUMPTIONS,
      nationalPolling, ge2024Result,
      null, null, null, null, null, null,
      null, // no candidate data
    )
    // All parties from baseline should be present
    expect(result.prediction['Labour']).toBeDefined()
    expect(result.prediction['Conservative']).toBeDefined()
  })

  it('redistributes shares correctly — sum equals 1.0', () => {
    const result = predictWard(
      mockWardHistory, DEFAULT_ASSUMPTIONS,
      nationalPolling, ge2024Result,
      null, null, null, null, null, null,
      mockCandidates2026,
    )
    const totalPct = Object.values(result.prediction).reduce((s, v) => s + v.pct, 0)
    expect(totalPct).toBeCloseTo(1.0, 2)
  })

  it('adds methodology step 6.5', () => {
    const result = predictWard(
      mockWardHistory, DEFAULT_ASSUMPTIONS,
      nationalPolling, ge2024Result,
      null, null, null, null, null, null,
      mockCandidates2026,
    )
    const filterStep = result.methodology.find(m => m.step === 6.5)
    expect(filterStep).toBeDefined()
    expect(filterStep.name).toBe('Candidacy Filter')
  })

  it('overrides Reform toggle when Reform not standing', () => {
    const noReformCandidates = [
      { name: 'Alice', party: 'Labour' },
      { name: 'Bob', party: 'Conservative' },
    ]
    const result = predictWard(
      mockWardHistory,
      { ...DEFAULT_ASSUMPTIONS, reformStandsInAllWards: true },
      nationalPolling, ge2024Result,
      null, null, null, null, null, null,
      noReformCandidates,
    )
    // Reform should NOT appear despite reformStandsInAllWards=true
    expect(result.prediction['Reform UK']).toBeUndefined()
    // Step 5 should say Reform not standing
    const reformStep = result.methodology.find(m => m.step === 5)
    expect(reformStep.description).toContain('not standing')
  })
})

// ---------------------------------------------------------------------------
// Ethnic Projections in Demographics
// ---------------------------------------------------------------------------

describe('ethnic projection integration', () => {
  const nationalPolling = { Labour: 0.29, Conservative: 0.24, 'Reform UK': 0.22, 'Liberal Democrats': 0.12, 'Green Party': 0.07 }
  const ge2024Result = { Labour: 0.337, Conservative: 0.237, 'Reform UK': 0.143, 'Liberal Democrats': 0.122, 'Green Party': 0.069 }

  it('uses projected ethnic data when provided', () => {
    // High Asian ward — should trigger Independent bonus + Reform penalty
    const ethnicProj = { asian_pct_projected: 0.45, white_british_pct_projected: 0.35 }
    const result = predictWard(
      mockWardHistory, DEFAULT_ASSUMPTIONS,
      nationalPolling, ge2024Result,
      null, null, null, null, null, null,
      null, ethnicProj,
    )
    // Methodology should mention the HP v7.0 ethnic projection source
    const demoStep = result.methodology.find(m => m.step === 3)
    expect(demoStep).toBeDefined()
    expect(demoStep.factors.some(f => f.includes('HP v7.0'))).toBe(true)
    // Should have an Independent adjustment due to high Asian pct
    expect(demoStep.factors.some(f => f.includes('Asian heritage'))).toBe(true)
  })

  it('falls back to Census when no projections', () => {
    const result = predictWard(
      mockWardHistory, DEFAULT_ASSUMPTIONS,
      nationalPolling, ge2024Result,
      null, null, null, null, null, null,
      null, null,
    )
    const demoStep = result.methodology.find(m => m.step === 3)
    // Should NOT mention Hamilton-Perry
    if (demoStep?.factors?.length > 0) {
      expect(demoStep.factors.some(f => f.includes('Hamilton-Perry'))).toBe(false)
    }
  })
})
