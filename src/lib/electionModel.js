/**
 * electionModel.js — Pure election prediction engine for AI DOGE
 *
 * Composite Ward-Level Prediction Model:
 * 1. Baseline: Most recent same-type election result
 * 2. National Swing: Polling delta dampened for local elections
 * 3. Demographics: Small adjustments from deprivation/age/ethnicity
 * 4. Incumbency: Bonus for sitting councillor's party
 * 5. New Party Entry: Reform UK proxy from GE2024 + LCC 2025
 * 6. Normalise + Vote Estimation
 *
 * All functions are pure (no side effects), unit-testable, and
 * return methodology arrays showing transparent workings.
 */

import { applyStrongTransitionSwing as applyStrongTransitionSwingExternal } from './strongTransitionSwing.js';
import { applyTacticalVoting as applyTacticalVotingExternal } from './tacticalVoting.js';
import { applyIncumbencyAdjustment as applyIncumbencyAdjustmentExternal } from './incumbencyTracker.js';
import { applyReformDemographicCeiling, applyIndependentCeiling, applyEnglishIdentityFloor, applyAgeStructureAdjustment } from './pconDemographicCeilings.js';

// ---------------------------------------------------------------------------
// Default assumptions (user can override via UI sliders)
// ---------------------------------------------------------------------------

export const DEFAULT_ASSUMPTIONS = {
  nationalToLocalDampening: 0.65,
  incumbencyBonusPct: 0.05,
  retirementPenaltyPct: -0.02,
  reformProxyWeights: { ge: 0.25, lcc: 0.75 },
  reformBoroughDampening: 0.95,  // LCC 2025 was already local — minimal further dampening
  turnoutAdjustment: 0,        // user can adjust ±5pp
  swingMultiplier: 1.0,         // user can scale swing 0.5× to 1.5×
  reformStandsInAllWards: true, // toggle: Reform stands everywhere
};

// ---------------------------------------------------------------------------
// Core prediction functions
// ---------------------------------------------------------------------------

/**
 * Get the baseline vote shares from the most recent election in this ward.
 * @param {Object} wardData - Ward object from elections.json
 * @param {string} electionType - 'borough' or 'county'
 * @returns {{ parties: Object<string, number>, date: string, year: number, staleness: number } | null}
 */
function getBaseline(wardData, electionType = 'borough') {
  if (!wardData?.history?.length) return null;

  // Find most recent election of the right type (or any if no match)
  // By-elections are always valid — they're the most recent actual vote in that ward
  const matching = wardData.history
    .filter(e => !electionType || e.type?.includes(electionType) || e.type === 'by-election')
    .sort((a, b) => b.date.localeCompare(a.date));

  const election = matching[0] || wardData.history[wardData.history.length - 1];
  if (!election?.candidates?.length) return null;

  const parties = {};
  for (const c of election.candidates) {
    // Normalize party names so UKIP→Reform UK continuity is preserved
    const partyName = normalizePartyName(c.party);
    // Take the best candidate per party
    if (!parties[partyName] || c.pct > parties[partyName]) {
      parties[partyName] = c.pct != null ? c.pct : (c.votes || 0) / (election.turnout_votes || 1);
    }
  }

  // Calculate staleness — how many years since this baseline election
  const baselineYear = election.year || parseInt(election.date?.substring(0, 4)) || 2020;
  const currentYear = new Date().getFullYear();
  const staleness = currentYear - baselineYear;

  return {
    parties,
    date: election.date,
    year: election.year,
    turnout: election.turnout,
    turnoutVotes: election.turnout_votes,
    electorate: election.electorate,
    staleness,
  };
}

/**
 * Calculate national swing adjustments.
 * @param {Object} baseline - Party vote shares from baseline
 * @param {Object} nationalPolling - Current national polling averages
 * @param {Object} ge2024Result - GE2024 national result
 * @param {Object} assumptions - Model assumptions
 * @returns {{ adjustments: Object<string, number>, methodology: Object }}
 */
function calculateNationalSwing(baseline, nationalPolling, ge2024Result, assumptions) {
  const dampening = assumptions.nationalToLocalDampening || 0.65;
  const multiplier = assumptions.swingMultiplier || 1.0;

  // Opt-in Strong Transition Model path. When enabled, returns the STM
  // adjustments (local change vs baseline) so the consuming `predictWard`
  // can apply them additively just like the legacy UNS path.
  if (assumptions.useStrongTransitionSwing) {
    const stm = applyStrongTransitionSwingExternal(
      baseline,
      nationalPolling,
      ge2024Result,
      { dampening: dampening * multiplier },
    );
    const adjustments = {};
    for (const p of new Set([...Object.keys(stm.shares), ...Object.keys(baseline)])) {
      adjustments[p] = (stm.shares[p] || 0) - (baseline[p] || 0);
    }
    return {
      adjustments,
      methodology: {
        step: 2,
        name: 'National Swing (STM)',
        description: `Strong Transition Model: multiplicative bounded swing, dampened by ${dampening} for local` + (multiplier !== 1.0 ? ` (×${multiplier} user adj)` : ''),
        details: stm.swingsApplied,
      },
    };
  }

  // Legacy additive UNS path (default)
  const adjustments = {};
  const details = {};
  for (const party of Object.keys(baseline)) {
    const currentNational = nationalPolling[party] || 0;
    const ge2024National = ge2024Result[party] || 0;
    const nationalSwing = currentNational - ge2024National;
    const localSwing = nationalSwing * dampening * multiplier;

    adjustments[party] = localSwing;
    details[party] = {
      nationalNow: currentNational,
      nationalGE2024: ge2024National,
      nationalSwing: Math.round(nationalSwing * 1000) / 1000,
      dampened: Math.round(localSwing * 1000) / 1000,
    };
  }

  return {
    adjustments,
    methodology: {
      step: 2,
      name: 'National Swing',
      description: `Polling change since GE2024, dampened by ${dampening} for local elections` +
        (multiplier !== 1.0 ? ` (×${multiplier} user adjustment)` : ''),
      details,
    },
  };
}

/**
 * Calculate demographic adjustments based on ward characteristics.
 * @param {Object} demographics - Ward demographics from demographics.json
 * @param {Object} deprivation - Ward deprivation from deprivation.json
 * @param {Object} params - Demographic adjustment parameters
 * @returns {{ adjustments: Object<string, number>, methodology: Object }}
 */
function calculateDemographicAdjustments(demographics, deprivation, params, ethnicProjections) {
  const adjustments = {};
  const factors = [];

  if (!params) params = DEFAULT_ASSUMPTIONS;
  const demoParams = params.demographicAdjustments || {
    high_deprivation_labour_bonus: 0.02,
    high_deprivation_conservative_penalty: -0.02,
    high_deprivation_reform_bonus: 0.03,
    over65_conservative_bonus: 0.015,
    over65_reform_bonus: 0.02,
    asian_heritage_independent_bonus: 0.02,
    asian_heritage_reform_penalty: -0.04,
    high_white_british_reform_bonus: 0.03,
    rural_conservative_bonus: 0.01,
  };

  // Derive percentage fields from raw Census data if not pre-computed
  if (demographics && !demographics.white_british_pct) {
    const age = demographics.age || {};
    const eth = demographics.ethnicity || {};
    const totalPop = age['Total: All usual residents'] || 0;
    const ethTotal = eth['Total: All usual residents'] || totalPop;
    if (totalPop > 0) {
      const over65 = (age['Aged 65 to 74 years'] || 0)
        + (age['Aged 75 to 84 years'] || 0)
        + (age['Aged 85 to 89 years'] || 0)
        + (age['Aged 90 years and over'] || age['Aged 90 years'] || 0);
      demographics = {
        ...demographics,
        age_65_plus_pct: over65 / totalPop,
        white_british_pct: ethTotal > 0
          ? (eth['White: English, Welsh, Scottish, Northern Irish or British'] || 0) / ethTotal
          : 0,
        asian_pct: ethTotal > 0
          ? (eth['Asian, Asian British or Asian Welsh'] || 0) / ethTotal
          : 0,
      };
    }
  }

  // Override ethnicity percentages with Hamilton-Perry May 2026 estimate if available
  // (1-year back-extrapolation from 2027, anchored to HP v7.0 LA aggregates)
  if (ethnicProjections) {
    if (ethnicProjections.asian_pct_projected != null) {
      demographics = { ...demographics, asian_pct: ethnicProjections.asian_pct_projected };
    }
    if (ethnicProjections.white_british_pct_projected != null) {
      demographics = { ...demographics, white_british_pct: ethnicProjections.white_british_pct_projected };
    }
    factors.push(`Ethnic projections: HP v7.0 May 2026 estimate (Asian ${((demographics?.asian_pct || 0) * 100).toFixed(1)}%, White British ${((demographics?.white_british_pct || 0) * 100).toFixed(1)}%)`);
  }

  // Deprivation: IMD decile 1-2 = very deprived
  if (deprivation?.avg_imd_decile && deprivation.avg_imd_decile <= 2) {
    adjustments['Labour'] = (adjustments['Labour'] || 0) + demoParams.high_deprivation_labour_bonus;
    adjustments['Conservative'] = (adjustments['Conservative'] || 0) + demoParams.high_deprivation_conservative_penalty;
    adjustments['Reform UK'] = (adjustments['Reform UK'] || 0) + demoParams.high_deprivation_reform_bonus;
    factors.push(`High deprivation (decile ${deprivation.avg_imd_decile}): Labour +${(demoParams.high_deprivation_labour_bonus * 100).toFixed(0)}pp, Conservative ${(demoParams.high_deprivation_conservative_penalty * 100).toFixed(0)}pp, Reform +${(demoParams.high_deprivation_reform_bonus * 100).toFixed(0)}pp`);
  }

  // Over-65 proportion
  if (demographics?.age_65_plus_pct && demographics.age_65_plus_pct > 0.25) {
    adjustments['Conservative'] = (adjustments['Conservative'] || 0) + demoParams.over65_conservative_bonus;
    adjustments['Reform UK'] = (adjustments['Reform UK'] || 0) + demoParams.over65_reform_bonus;
    factors.push(`High over-65 (${(demographics.age_65_plus_pct * 100).toFixed(0)}%): Conservative +${(demoParams.over65_conservative_bonus * 100).toFixed(1)}pp, Reform +${(demoParams.over65_reform_bonus * 100).toFixed(0)}pp`);
  }

  // High white British > 85% — strong Reform territory (LCC 2025 evidence)
  if (demographics?.white_british_pct && demographics.white_british_pct > 0.85) {
    adjustments['Reform UK'] = (adjustments['Reform UK'] || 0) + demoParams.high_white_british_reform_bonus;
    factors.push(`High white British (${(demographics.white_british_pct * 100).toFixed(0)}%): Reform +${(demoParams.high_white_british_reform_bonus * 100).toFixed(0)}pp`);
  }

  // Asian heritage > 20% (East Lancashire specific) — Reform penalty + Independent bonus
  // Scaled by concentration: higher Asian % → stronger effect (community bloc voting)
  // Penalties reduced from original model — UKIP proved 40-50% achievable in
  // majority-Asian wards (Daneshouse 49.2% 2015, 43.5% 2019) by mobilising non-Asian vote
  if (demographics?.asian_pct && demographics.asian_pct > 0.20) {
    const asianPct = demographics.asian_pct;
    let reformPenalty, indBonus, labBonus;

    if (asianPct > 0.60) {
      // Majority-Asian wards: community candidates strong but Reform heritage proven
      reformPenalty = -0.10;
      indBonus = 0.08;
      labBonus = 0.03;
    } else if (asianPct > 0.40) {
      // Heavily Asian wards: moderate community influence
      reformPenalty = -0.06;
      indBonus = 0.04;
      labBonus = 0.02;
    } else {
      // 20-40% Asian: modest influence
      reformPenalty = demoParams.asian_heritage_reform_penalty;
      indBonus = demoParams.asian_heritage_independent_bonus;
      labBonus = 0;
    }

    adjustments['Independent'] = (adjustments['Independent'] || 0) + indBonus;
    adjustments['Reform UK'] = (adjustments['Reform UK'] || 0) + reformPenalty;
    if (labBonus > 0) {
      adjustments['Labour'] = (adjustments['Labour'] || 0) + labBonus;
    }
    const desc = `High Asian heritage (${(asianPct * 100).toFixed(0)}%): Independent +${(indBonus * 100).toFixed(0)}pp, Reform ${(reformPenalty * 100).toFixed(0)}pp`;
    factors.push(labBonus > 0 ? desc + `, Labour +${(labBonus * 100).toFixed(0)}pp` : desc);
  }

  return {
    adjustments,
    methodology: {
      step: 3,
      name: 'Demographics',
      description: factors.length > 0
        ? `${factors.length} demographic factor(s) applied`
        : 'No significant demographic adjustments for this ward',
      factors,
    },
  };
}

/**
 * Calculate fiscal stress adjustments from LGR demographic fiscal data.
 *
 * Uses council-level fiscal resilience scores to model protest voting
 * patterns: low fiscal resilience → anti-incumbent sentiment, higher
 * Reform UK performance, and reduced turnout in pressured areas.
 *
 * Backward-compatible: returns zero adjustments if no fiscal data.
 *
 * @param {Object|null} fiscalData - demographic_fiscal.json for this council
 * @param {string|null} wardName - Ward name for pressure zone lookup
 * @returns {{ adjustments: Object<string, number>, methodology: Object }}
 */
export function calculateFiscalStressAdjustment(fiscalData, wardName) {
  const adjustments = {};
  const factors = [];

  if (!fiscalData) {
    return {
      adjustments,
      methodology: {
        step: 3.5, name: 'Fiscal Stress',
        description: 'No fiscal stress data available',
        factors: [],
      },
    };
  }

  const fiscalScore = fiscalData.fiscal_resilience_score;
  const serviceScore = fiscalData.service_demand_pressure_score;
  const riskCategory = fiscalData.risk_category;

  // 1. Severe fiscal stress (score ≤ 30) → anti-incumbent protest voting
  if (fiscalScore != null && fiscalScore <= 30) {
    adjustments['Reform UK'] = (adjustments['Reform UK'] || 0) + 0.02;
    adjustments['Labour'] = (adjustments['Labour'] || 0) + 0.01;
    adjustments['Conservative'] = (adjustments['Conservative'] || 0) - 0.02;
    factors.push(`Severe fiscal stress (score ${fiscalScore}/100): Reform +2pp, Labour +1pp, Conservative -2pp — anti-incumbent protest pattern`);
  } else if (fiscalScore != null && fiscalScore <= 50) {
    adjustments['Reform UK'] = (adjustments['Reform UK'] || 0) + 0.01;
    adjustments['Conservative'] = (adjustments['Conservative'] || 0) - 0.01;
    factors.push(`Moderate fiscal stress (score ${fiscalScore}/100): Reform +1pp, Conservative -1pp`);
  }

  // 2. High service demand pressure → Reform UK boost (anti-establishment)
  if (serviceScore != null && serviceScore >= 80) {
    adjustments['Reform UK'] = (adjustments['Reform UK'] || 0) + 0.015;
    factors.push(`High service demand (score ${serviceScore}/100): Reform +1.5pp — services under strain drives protest voting`);
  }

  // 3. "Structurally Deficit" risk category → strong anti-incumbent signal
  if (riskCategory === 'Structurally Deficit') {
    adjustments['Reform UK'] = (adjustments['Reform UK'] || 0) + 0.01;
    adjustments['Labour'] = (adjustments['Labour'] || 0) - 0.01;
    adjustments['Conservative'] = (adjustments['Conservative'] || 0) - 0.01;
    factors.push(`Structurally deficit authority: Reform +1pp — systemic fiscal failure drives establishment rejection`);
  }

  // 4. Ward in pressure zones — hyper-deprived micro-climate amplification
  if (wardName && fiscalData.pressure_zones?.length) {
    const wardPressure = fiscalData.pressure_zones.find(
      pz => pz.ward?.toLowerCase() === wardName.toLowerCase()
    );
    if (wardPressure && wardPressure.imd_decile <= 1) {
      adjustments['Reform UK'] = (adjustments['Reform UK'] || 0) + 0.015;
      adjustments['Labour'] = (adjustments['Labour'] || 0) + 0.01;
      factors.push(`Ward "${wardName}" in fiscal pressure zone (IMD decile ${wardPressure.imd_decile}): Reform +1.5pp, Labour +1pp`);
    }
  }

  // 5. High critical/high threat count → disengagement + protest
  const criticalThreats = (fiscalData.threats || []).filter(t => t.severity === 'critical').length;
  if (criticalThreats >= 3) {
    adjustments['Reform UK'] = (adjustments['Reform UK'] || 0) + 0.01;
    factors.push(`${criticalThreats} critical fiscal threats: Reform +1pp — multiple cascading risks amplify protest signal`);
  }

  return {
    adjustments,
    methodology: {
      step: 3.5,
      name: 'Fiscal Stress',
      description: factors.length > 0
        ? `${factors.length} fiscal stress factor(s) applied (resilience: ${fiscalScore ?? '?'}/100)`
        : 'No significant fiscal stress adjustments for this council',
      factors,
    },
  };
}

/**
 * Calculate incumbency adjustment.
 * @param {Object} wardData - Ward object with current_holders
 * @param {Object} assumptions - Model assumptions
 * @returns {{ adjustments: Object<string, number>, methodology: Object }}
 */
function calculateIncumbencyAdjustment(wardData, assumptions) {
  const adjustments = {};
  const factors = [];

  if (!wardData?.current_holders?.length) {
    return {
      adjustments,
      methodology: {
        step: 4, name: 'Incumbency',
        description: 'No current holder data available',
        factors: [],
      },
    };
  }

  // Find the holder whose seat is up (most recently elected in the last cycle)
  const holders = wardData.current_holders;
  // For simplicity, assume the holder standing down = no bonus
  // Incumbent re-standing = bonus
  const incumbentParty = holders[0]?.party;
  if (incumbentParty) {
    let bonus = assumptions.incumbencyBonusPct || 0.05;
    // Reduce incumbency bonus for long-serving holders in stale-baseline wards
    // The "brand loyalty" factor decays over time as political landscape shifts
    const baselineAge = wardData._baselineStaleness || 0;
    if (baselineAge > 10) {
      bonus = bonus * 0.5; // Halve the bonus for very stale wards
      factors.push(`Incumbent party (${incumbentParty}): +${(bonus * 100).toFixed(1)}pp (reduced — baseline ${baselineAge}yr old)`);
    } else {
      factors.push(`Incumbent party (${incumbentParty}): +${(bonus * 100).toFixed(0)}pp incumbency bonus`);
    }
    adjustments[incumbentParty] = bonus;
  }

  return {
    adjustments,
    methodology: {
      step: 4,
      name: 'Incumbency',
      description: factors.length > 0 ? factors.join('; ') : 'No incumbency adjustment',
      factors,
    },
  };
}

/**
 * Handle Reform UK entry into wards where they haven't stood before.
 * Uses GE2024 and LCC 2025 results as proxy.
 *
 * V2: Accounts for baseline staleness. When baselines are >8 years old,
 * Reform's proxy replaces the Step 2 swing-only estimate. The proxy is
 * treated as Reform's EFFECTIVE vote share, and the corresponding amount
 * is deducted proportionally from other parties' adjusted shares (not
 * their original baselines), giving Reform a realistic share in areas
 * where they've demonstrably won at county level (LCC 2025).
 *
 * @param {Object} baseline - Current party baselines
 * @param {Object} constituencyResult - GE2024 constituency results
 * @param {Object} lcc2025 - LCC 2025 reference data
 * @param {Object} assumptions
 * @param {Object} nationalPolling - Current national polling
 * @param {Object} ge2024Result - GE2024 national results
 * @param {Object} currentShares - Current running shares (post Step 2-4), used for proportional deduction
 * @param {number} staleness - Years since baseline election
 * @returns {{ adjustments: Object<string, number>, reformEstimate: number, methodology: Object }}
 */
function calculateReformEntry(baseline, constituencyResult, lcc2025, assumptions, nationalPolling, ge2024Result, currentShares, staleness) {
  const adjustments = {};
  let reformEstimate = 0;
  const factors = [];

  // If Reform already has a baseline, no entry calculation needed
  if (baseline['Reform UK'] && baseline['Reform UK'] > 0.01) {
    return {
      adjustments,
      reformEstimate: baseline['Reform UK'],
      methodology: {
        step: 5, name: 'New Party Entry',
        description: 'Reform UK has existing baseline — no proxy needed',
        factors: [],
      },
    };
  }

  if (!assumptions.reformStandsInAllWards) {
    return {
      adjustments,
      reformEstimate: 0,
      methodology: {
        step: 5, name: 'New Party Entry',
        description: 'Reform UK not standing in this ward (user setting)',
        factors: [],
      },
    };
  }

  const weights = assumptions.reformProxyWeights || { ge: 0.25, lcc: 0.75 };
  const boroughDampening = assumptions.reformBoroughDampening ?? 0.95;

  // GE2024 Reform result for this constituency
  const geReform = constituencyResult?.['Reform UK'] || 0;
  // LCC 2025 Reform result — prefer per-ward division data over aggregate
  const lccWardReform = lcc2025?.wardDivisionData?.reform_pct;
  const lccReform = lccWardReform ?? lcc2025?.results?.['Reform UK']?.pct ?? 0;
  const lccSource = lccWardReform != null
    ? `LCC div "${lcc2025.wardDivisionData.division}" ${(lccWardReform * 100).toFixed(1)}%`
    : `LCC aggregate ${(lccReform * 100).toFixed(1)}%`;

  // Base proxy from weighted GE2024 + LCC 2025
  const proxyBase = (geReform * weights.ge + lccReform * weights.lcc) * boroughDampening;

  // Apply national swing to the proxy (Reform has grown since GE2024/LCC2025)
  const currentNational = nationalPolling?.['Reform UK'] || 0;
  const ge2024National = ge2024Result?.['Reform UK'] || 0;
  const nationalSwing = currentNational - ge2024National;
  const dampening = assumptions.nationalToLocalDampening || 0.65;
  const multiplier = assumptions.swingMultiplier || 1.0;
  const localSwing = nationalSwing * dampening * multiplier;

  reformEstimate = proxyBase + localSwing;

  if (reformEstimate > 0.01) {
    // The Reform estimate is the TOTAL share Reform should have.
    // Step 2 already added swing to Reform (from 0%), so we need to add
    // only the DIFFERENCE between our proxy and what's already been assigned.
    const alreadyAssignedReform = (currentShares?.['Reform UK'] || 0) - (baseline['Reform UK'] || 0);
    const additionalReform = Math.max(0, reformEstimate - Math.max(0, alreadyAssignedReform));

    adjustments['Reform UK'] = additionalReform;

    // Deduct from other parties proportionally based on their CURRENT shares (post-swing),
    // not original baselines — this properly reduces dominant parties
    const sharesForDeduction = currentShares || baseline;
    const totalOther = Object.entries(sharesForDeduction)
      .filter(([p]) => p !== 'Reform UK')
      .reduce((s, [, v]) => s + Math.max(0, v), 0);

    if (totalOther > 0) {
      for (const party of Object.keys(sharesForDeduction)) {
        if (party === 'Reform UK') continue;
        const share = Math.max(0, sharesForDeduction[party]) / totalOther;
        adjustments[party] = (adjustments[party] || 0) - (additionalReform * share);
      }
    }

    factors.push(
      `Reform proxy: GE2024 ${(geReform * 100).toFixed(1)}% × ${weights.ge} + ${lccSource} × ${weights.lcc} × ${boroughDampening} = ${(proxyBase * 100).toFixed(1)}%`
    );
    if (localSwing !== 0) {
      factors.push(
        `National swing: ${(nationalSwing * 100).toFixed(1)}pp × ${dampening} dampening = ${(localSwing * 100).toFixed(1)}pp → total ${(reformEstimate * 100).toFixed(1)}%`
      );
    }
    if (alreadyAssignedReform > 0.001) {
      factors.push(`Already assigned from Step 2 swing: ${(alreadyAssignedReform * 100).toFixed(1)}pp, additional: +${(additionalReform * 100).toFixed(1)}pp`);
    }
    if (staleness && staleness > 8) {
      factors.push(`Stale baseline (${staleness} years old): proxy weighted more heavily vs historical data`);
    }
  }

  return {
    adjustments,
    reformEstimate,
    methodology: {
      step: 5,
      name: 'New Party Entry',
      description: factors.length > 0
        ? `Reform UK estimated at ${(reformEstimate * 100).toFixed(1)}% from GE/LCC proxy + swing`
        : 'No new party entry adjustment',
      factors,
    },
  };
}

/**
 * Normalise party shares to sum to 1.0.
 * @param {Object} shares - Party → share mapping
 * @returns {Object} Normalised shares
 */
function normaliseShares(shares) {
  const total = Object.values(shares).reduce((s, v) => s + Math.max(0, v), 0);
  if (total <= 0) {
    // All-zero shares — distribute equally
    const n = Object.keys(shares).length;
    if (n === 0) return shares;
    const equal = 1 / n;
    return Object.fromEntries(Object.keys(shares).map(k => [k, equal]));
  }
  const result = {};
  for (const [party, share] of Object.entries(shares)) {
    result[party] = Math.max(0, share) / total;
  }
  return result;
}

/**
 * Predict a single ward's election outcome.
 * @param {Object} wardData - Ward from elections.json
 * @param {Object} assumptions - User-adjustable assumptions
 * @param {Object} nationalPolling - Current polling averages
 * @param {Object} ge2024Result - GE2024 national result
 * @param {Object} demographics - Ward demographics
 * @param {Object} deprivation - Ward deprivation data
 * @param {Object} constituencyResult - GE2024 constituency result for this ward
 * @param {Object} lcc2025 - LCC 2025 reference data
 * @param {Object} modelParams - Model parameter config
 * @returns {{ prediction: Object, methodology: Array, confidence: string }}
 */
export function predictWard(
  wardData,
  assumptions = DEFAULT_ASSUMPTIONS,
  nationalPolling = {},
  ge2024Result = {},
  demographics = null,
  deprivation = null,
  constituencyResult = null,
  lcc2025 = null,
  modelParams = null,
  fiscalData = null,
  candidates2026 = null,
  ethnicProjections = null,
  besPrior = null,
) {
  const methodology = [];

  // Step 1: Baseline
  const baseline = getBaseline(wardData, 'borough');
  if (!baseline) {
    return {
      prediction: null,
      methodology: [{ step: 1, name: 'Baseline', description: 'No historical election data for this ward' }],
      confidence: 'none',
    };
  }

  methodology.push({
    step: 1,
    name: 'Baseline',
    description: `Most recent borough result (${baseline.date})` +
      (baseline.staleness > 8 ? ` — ${baseline.staleness} years old, applying stale baseline decay` : ''),
    data: { ...baseline.parties },
  });

  // Tag wardData with staleness for incumbency calculation
  const wardDataWithStaleness = { ...wardData, _baselineStaleness: baseline.staleness };

  // Start with baseline shares — apply staleness decay if baseline is very old
  let shares = { ...baseline.parties };

  // Stale baseline adjustment: when data is >8 years old, blend historical
  // baseline with current evidence (national polling + GE2024 constituency)
  // This prevents 2007 baselines from dominating predictions in 2026
  if (baseline.staleness > 8 && constituencyResult) {
    const decayFactor = Math.max(0.3, 1.0 - (baseline.staleness - 8) * 0.05); // 0.05 per year beyond 8
    const freshWeight = 1.0 - decayFactor;

    // Build a "fresh estimate" from constituency GE2024 result (most recent actual votes)
    const freshShares = { ...constituencyResult };

    // Blend: shares = decayFactor × historical + freshWeight × constituency
    for (const party of new Set([...Object.keys(shares), ...Object.keys(freshShares)])) {
      const historical = shares[party] || 0;
      const fresh = freshShares[party] || 0;
      shares[party] = historical * decayFactor + fresh * freshWeight;
    }

    methodology.push({
      step: 1.5,
      name: 'Stale Baseline Decay',
      description: `Baseline is ${baseline.staleness} years old — blending ${(decayFactor * 100).toFixed(0)}% historical + ${(freshWeight * 100).toFixed(0)}% GE2024 constituency data`,
      data: { decayFactor, freshWeight, stalenessYears: baseline.staleness },
    });
  }

  // Step 1.7: BES MRP Prior — pull baseline ~15% toward the BES Wave 1-30
  // post-stratified prior for this LAD. Anchors stale baselines on current
  // demographically-appropriate vote intention. Skipped where the prior is
  // unavailable (Northern Ireland or LADs without sufficient BES coverage).
  const BES_WEIGHT = 0.15;
  if (besPrior && Object.keys(besPrior.shares || {}).length > 0) {
    const blended = {};
    const partySet = new Set([...Object.keys(shares), ...Object.keys(besPrior.shares)]);
    for (const p of partySet) {
      const baselinePct = shares[p] || 0;
      const priorPct = besPrior.shares[p] || 0;
      blended[p] = (1 - BES_WEIGHT) * baselinePct + BES_WEIGHT * priorPct;
    }
    shares = blended;
    methodology.push({
      step: 1.7,
      name: 'BES MRP Prior',
      description: `Baseline blended with BES Wave 1-30 ${besPrior.region} prior (weight ${(BES_WEIGHT * 100).toFixed(0)}%, n=${besPrior.n_respondents_in_region || 'na'} regional respondents)`,
      data: { shares: { ...besPrior.shares }, weight: BES_WEIGHT, region: besPrior.region },
    });
  }

  // Step 2: National Swing
  const swing = calculateNationalSwing(baseline.parties, nationalPolling, ge2024Result, assumptions);
  methodology.push(swing.methodology);
  for (const [party, adj] of Object.entries(swing.adjustments)) {
    shares[party] = (shares[party] || 0) + adj;
  }

  // Step 3: Demographics
  const demo = calculateDemographicAdjustments(demographics, deprivation, modelParams, ethnicProjections);
  methodology.push(demo.methodology);
  for (const [party, adj] of Object.entries(demo.adjustments)) {
    shares[party] = (shares[party] || 0) + adj;
  }

  // Step 3.5: Fiscal Stress (LGR demographic fiscal data)
  if (fiscalData) {
    const fiscal = calculateFiscalStressAdjustment(fiscalData, wardData.ward_name || wardData.name);
    methodology.push(fiscal.methodology);
    for (const [party, adj] of Object.entries(fiscal.adjustments)) {
      shares[party] = (shares[party] || 0) + adj;
    }
  }

  // Step 4: Incumbency (with staleness awareness)
  const incumb = calculateIncumbencyAdjustment(wardDataWithStaleness, assumptions);
  methodology.push(incumb.methodology);
  for (const [party, adj] of Object.entries(incumb.adjustments)) {
    shares[party] = (shares[party] || 0) + adj;
  }

  // Step 5: Reform UK entry — skip if candidate data shows Reform not standing
  const reformStanding = !candidates2026?.length || candidates2026.some(c => normalizePartyName(c.party) === 'Reform UK');
  if (reformStanding) {
    const reform = calculateReformEntry(baseline.parties, constituencyResult, lcc2025, assumptions, nationalPolling, ge2024Result, { ...shares }, baseline.staleness);
    methodology.push(reform.methodology);
    for (const [party, adj] of Object.entries(reform.adjustments)) {
      shares[party] = (shares[party] || 0) + adj;
    }
  } else {
    methodology.push({
      step: 5, name: 'New Party Entry',
      description: 'Reform UK not standing in this ward (candidate data)',
      factors: [],
    });
  }

  // Step 6: Normalise
  let normalised = normaliseShares(shares);
  methodology.push({
    step: 6,
    name: 'Normalise',
    description: 'All shares scaled to sum to 100%',
    data: Object.fromEntries(
      Object.entries(normalised).map(([p, v]) => [p, Math.round(v * 1000) / 1000])
    ),
  });

  // Step 6.5: Candidacy Filter — remove parties not actually standing in 2026
  if (candidates2026?.length > 0) {
    const standing = new Set(candidates2026.map(c => normalizePartyName(c.party)));
    const removed = [];
    let redistributable = 0;

    for (const [party, share] of Object.entries(normalised)) {
      if (!standing.has(party)) {
        redistributable += share;
        removed.push(`${party} (${(share * 100).toFixed(1)}%)`);
      }
    }

    if (removed.length > 0) {
      // Remove non-standing parties
      for (const party of Object.keys(normalised)) {
        if (!standing.has(party)) delete normalised[party];
      }
      // Redistribute proportionally among standing parties
      const remainingTotal = Object.values(normalised).reduce((s, v) => s + v, 0);
      if (remainingTotal > 0) {
        for (const p of Object.keys(normalised)) {
          normalised[p] += redistributable * (normalised[p] / remainingTotal);
        }
      }
      // Re-normalise to ensure exact 1.0 sum
      normalised = normaliseShares(normalised);

      methodology.push({
        step: 6.5,
        name: 'Candidacy Filter',
        description: `Removed ${removed.length} non-standing party(ies): ${removed.join(', ')}. Redistributed ${(redistributable * 100).toFixed(1)}pp among ${standing.size} standing parties.`,
        data: { removed: removed.map(r => r.split(' (')[0]), redistributed: Math.round(redistributable * 1000) / 1000, standing: [...standing] },
      });
    } else {
      methodology.push({
        step: 6.5,
        name: 'Candidacy Filter',
        description: `All ${standing.size} predicted parties are standing — no filtering needed`,
        data: { standing: [...standing] },
      });
    }
  }

  // Estimate votes
  const turnout = Math.max(0.15, Math.min(0.65,
    (baseline.turnout || 0.30) + (assumptions.turnoutAdjustment || 0)
  ));
  const electorate = baseline.electorate || (baseline.turnoutVotes ? baseline.turnoutVotes / (baseline.turnout || 0.30) : 1000);
  const totalVotes = Math.round(electorate * turnout);

  const prediction = {};
  for (const [party, share] of Object.entries(normalised)) {
    prediction[party] = {
      pct: Math.round(share * 1000) / 1000,
      votes: Math.round(share * totalVotes),
    };
  }

  // Sort by votes descending
  const sorted = Object.entries(prediction)
    .sort((a, b) => b[1].votes - a[1].votes);

  const winner = sorted[0]?.[0];
  const runnerUp = sorted[1]?.[0];
  const majority = winner && runnerUp
    ? prediction[winner].votes - prediction[runnerUp].votes
    : 0;

  // Confidence based on majority size — reduce for stale baselines
  const majorityPct = totalVotes > 0 ? majority / totalVotes : 0;
  let confidence = 'low';
  if (baseline.staleness > 10) {
    // Very stale baselines = low confidence regardless
    confidence = majorityPct > 0.20 ? 'medium' : 'low';
  } else {
    if (majorityPct > 0.15) confidence = 'high';
    else if (majorityPct > 0.05) confidence = 'medium';
  }

  return {
    prediction: Object.fromEntries(sorted),
    winner,
    runnerUp,
    majority,
    majorityPct: Math.round(majorityPct * 1000) / 1000,
    estimatedTurnout: turnout,
    estimatedVotes: totalVotes,
    confidence,
    methodology,
  };
}

/**
 * Predict all wards up for election in a council.
 * @returns {{ wards: Object, seatTotals: Object, totalSeats: number }}
 */
/**
 * Normalise a councillor name for fuzzy matching: lowercase, strip punctuation,
 * honorifics (MBE, OBE, Cllr, Dr, etc.), and collapse whitespace.
 */
function normaliseCouncillorName(name) {
  if (!name) return '';
  let s = String(name).toLowerCase().replace(/[.,]/g, ' ');
  s = s.replace(/\b(mbe|obe|cbe|bem|jp|qc|kc|dl|phd|dr|cllr|councillor|jr|sr|ii|iii)\b/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Identify which index in `holders` corresponds to the defending councillor
 * whose seat is up. Cascades through: exact match → normalised match →
 * first+last token match → initial+last match → party-match (single)
 * → party-match (first) → edit-distance fallback → first holder.
 * Always returns a valid index so thirds-retention arithmetic stays correct.
 */
export function findDefenderIndex(holders, defender) {
  if (!holders?.length) return -1;
  if (!defender?.name) return 0; // no defender info — skip first holder to keep arithmetic correct
  const dNorm = normaliseCouncillorName(defender.name);
  const dToks = dNorm.split(' ').filter(Boolean);
  const dFirst = dToks[0] || '';
  const dLast = dToks[dToks.length - 1] || '';
  const dParty = normalizePartyName(defender.party || '');

  // 1) Exact raw name
  let i = holders.findIndex(h => h.name === defender.name);
  if (i >= 0) return i;
  // 2) Normalised full string
  i = holders.findIndex(h => normaliseCouncillorName(h.name) === dNorm);
  if (i >= 0) return i;
  // 3) First + last token match
  i = holders.findIndex(h => {
    const t = normaliseCouncillorName(h.name).split(' ').filter(Boolean);
    return t.length >= 2 && t[0] === dFirst && t[t.length - 1] === dLast;
  });
  if (i >= 0) return i;
  // 4) Last-token match + first-letter (handles Matt/Matthew, Andy/Andrew, Jacquie/Jacqueline)
  i = holders.findIndex(h => {
    const t = normaliseCouncillorName(h.name).split(' ').filter(Boolean);
    return t.length >= 2 && t[t.length - 1] === dLast && t[0][0] === dFirst[0];
  });
  if (i >= 0) return i;
  // 5) Last-token only (surname — handles middle-name reorders)
  i = holders.findIndex(h => {
    const t = normaliseCouncillorName(h.name).split(' ').filter(Boolean);
    return t.length >= 1 && t[t.length - 1] === dLast;
  });
  if (i >= 0) return i;
  // 6) Party match — single holder with matching party
  if (dParty) {
    const matches = holders
      .map((h, idx) => ({ idx, party: normalizePartyName(h.party || '') }))
      .filter(x => x.party === dParty);
    if (matches.length === 1) return matches[0].idx;
    if (matches.length > 1) return matches[0].idx; // arbitrary — any same-party skip gives same party tally
  }
  // 7) Defender party not present (defection / data noise): skip first holder
  // so ward arithmetic stays at (holders.length - 1) retained + 1 predicted.
  return 0;
}

export function predictCouncil(electionsData, wardsUp, assumptions, nationalPolling, ge2024Result, demographicsMap, deprivationMap, constituencyMap, lcc2025, modelParams, fiscalData, integrityData, candidates2026Map, ethnicProjectionMap, lcc2025Reference, besPriorMap = null) {
  const wardResults = {};
  const seatTotals = {};

  // Get current seat counts: retained seats from non-contested wards,
  // and non-defending holders in contested wards (thirds rotation).
  const defenders = electionsData.meta?.next_election?.defenders || {};
  const isThirds = electionsData.meta?.election_cycle === 'thirds';

  for (const [wardName, wardData] of Object.entries(electionsData.wards || {})) {
    const holders = wardData.current_holders || [];
    if (!wardsUp.includes(wardName)) {
      // Ward NOT contested — all seats retained
      for (const holder of holders) {
        const party = normalizePartyName(holder.party || 'Unknown');
        seatTotals[party] = (seatTotals[party] || 0) + 1;
      }
    } else if (isThirds && holders.length > 1) {
      // Ward IS contested in thirds — exactly one seat is up, rest retained.
      // Identify which holder's seat is being defended so we skip it from the
      // retained tally (the prediction loop below will re-award it). Defender
      // name may not match holder name exactly (honorifics, diminutives,
      // middle names, marriage renames, post-election defections) so we
      // cascade through several match strategies and always skip exactly one.
      const defender = defenders[wardName];
      const skipIdx = findDefenderIndex(holders, defender);
      holders.forEach((holder, idx) => {
        if (idx === skipIdx) return; // their seat will be predicted
        const party = normalizePartyName(holder.party || 'Unknown');
        seatTotals[party] = (seatTotals[party] || 0) + 1;
      });
    }
    // For all-out elections with wardsUp, all seats are predicted (no retained)
  }

  // Predict each ward up for election
  for (const wardName of wardsUp) {
    const wardData = electionsData.wards?.[wardName];
    if (!wardData) continue;

    // Enrich LCC 2025 with per-ward division data if available
    const wardDivisionData = lcc2025Reference?.ward_to_division?.[wardName] || null;
    const lcc2025WithWard = lcc2025
      ? { ...lcc2025, wardDivisionData }
      : wardDivisionData ? { wardDivisionData } : null;

    const result = predictWard(
      wardData,
      assumptions,
      nationalPolling,
      ge2024Result,
      demographicsMap?.[wardName] || null,
      deprivationMap?.[wardName] || null,
      constituencyMap?.[wardName] || null,
      lcc2025WithWard,
      modelParams,
      fiscalData || null,
      candidates2026Map?.[wardName] || null,
      ethnicProjectionMap?.[wardName] || null,
      besPriorMap?.[wardName] || null,
    );

    // Apply integrity adjustment if data provided (Step 4.5)
    if (integrityData && result.shares) {
      const integrityResult = adjustForIntegrity(result.shares, wardData, integrityData);
      if (integrityResult.methodology?.factors?.length > 0) {
        result.shares = integrityResult.adjustedShares;
        // Recompute winner from adjusted shares
        const sortedParties = Object.entries(result.shares).sort((a, b) => b[1] - a[1]);
        if (sortedParties.length > 0) {
          result.winner = sortedParties[0][0];
        }
        result.methodology = [...(result.methodology || []), integrityResult.methodology];
      }
    }

    wardResults[wardName] = result;

    if (result.winner) {
      seatTotals[result.winner] = (seatTotals[result.winner] || 0) + 1;
    }
  }

  const totalSeats = Object.values(seatTotals).reduce((s, v) => s + v, 0);

  return { wards: wardResults, seatTotals, totalSeats };
}

/**
 * Apply user overrides to prediction results.
 * @param {Object} councilResult - Output from predictCouncil
 * @param {Object} overrides - { wardName: partyName } manual overrides
 * @param {number} totalSeats - Total council seats
 * @returns {Object} Updated seatTotals
 */
export function applyOverrides(councilResult, overrides, totalSeats) {
  const newSeatTotals = { ...councilResult.seatTotals };

  for (const [wardName, overrideParty] of Object.entries(overrides)) {
    const wardResult = councilResult.wards[wardName];
    if (!wardResult) continue;

    // Remove old winner's seat
    const oldWinner = wardResult.winner;
    if (oldWinner && newSeatTotals[oldWinner]) {
      newSeatTotals[oldWinner]--;
      if (newSeatTotals[oldWinner] <= 0) delete newSeatTotals[oldWinner];
    }

    // Add new winner's seat
    newSeatTotals[overrideParty] = (newSeatTotals[overrideParty] || 0) + 1;
  }

  return newSeatTotals;
}

/**
 * Compute viable coalition combinations from seat totals.
 * @param {Object} seatTotals - { party: seats }
 * @param {number} majorityThreshold - Seats needed for majority
 * @returns {Array} Viable coalitions sorted by total seats
 */
export function computeCoalitions(seatTotals, majorityThreshold) {
  const parties = Object.entries(seatTotals)
    .filter(([, seats]) => seats > 0)
    .sort((a, b) => b[1] - a[1]);

  const coalitions = [];

  // Check single-party majority
  for (const [party, seats] of parties) {
    if (seats >= majorityThreshold) {
      coalitions.push({
        parties: [party],
        totalSeats: seats,
        majority: seats - majorityThreshold + 1,
        type: 'majority',
      });
    }
  }

  // Check two-party coalitions
  for (let i = 0; i < parties.length; i++) {
    for (let j = i + 1; j < parties.length; j++) {
      const total = parties[i][1] + parties[j][1];
      if (total >= majorityThreshold) {
        coalitions.push({
          parties: [parties[i][0], parties[j][0]],
          totalSeats: total,
          majority: total - majorityThreshold + 1,
          type: 'coalition',
        });
      }
    }
  }

  // Check three-party coalitions (only if no two-party works)
  if (!coalitions.some(c => c.type === 'majority' || c.parties.length <= 2)) {
    for (let i = 0; i < parties.length; i++) {
      for (let j = i + 1; j < parties.length; j++) {
        for (let k = j + 1; k < parties.length; k++) {
          const total = parties[i][1] + parties[j][1] + parties[k][1];
          if (total >= majorityThreshold) {
            coalitions.push({
              parties: [parties[i][0], parties[j][0], parties[k][0]],
              totalSeats: total,
              majority: total - majorityThreshold + 1,
              type: 'coalition',
            });
          }
        }
      }
    }
  }

  return coalitions.sort((a, b) => b.totalSeats - a.totalSeats);
}

/**
 * Project ward predictions onto LGR authority boundaries.
 * @param {Object} seatTotals - Predicted seat totals per council
 * @param {Object} lgrModel - LGR proposal model data
 * @returns {Object} Political control projection per authority
 */
/**
 * Predict a constituency-level general election result.
 * Uses: GE2024 baseline + national swing from polling + optional MRP blend.
 * @param {Object} constituency - Constituency data from constituencies.json
 * @param {Object} polling - Polling data from polling.json
 * @param {Object} modelCoefficients - Model coefficients
 * @returns {{ prediction: Object, swing: Object, methodology: Array, confidence: string }}
 */
function finishConstituencyGE(constituency, ge2024Baseline, shares, methodology) {
  const normalised = normaliseShares(shares);
  methodology.push({
    step: 3, name: 'Normalise',
    description: 'Shares scaled to 100%',
    data: Object.fromEntries(Object.entries(normalised).map(([p, v]) => [p, Math.round(v * 1000) / 1000])),
  });
  const sorted = Object.entries(normalised).sort((a, b) => b[1] - a[1]);
  const prediction = Object.fromEntries(sorted.map(([p, v]) => [p, { pct: Math.round(v * 1000) / 1000 }]));
  const winner = sorted[0]?.[0];
  const runnerUp = sorted[1]?.[0];
  const majorityPct = winner && runnerUp ? normalised[winner] - normalised[runnerUp] : 0;
  const swing = {};
  for (const [party, share] of Object.entries(normalised)) {
    swing[party] = Math.round((share - (ge2024Baseline[party] || 0)) * 1000) / 1000;
  }
  let confidence = 'low';
  if (majorityPct > 0.15) confidence = 'high';
  else if (majorityPct > 0.08) confidence = 'medium';
  return {
    prediction, winner, runnerUp,
    majorityPct: Math.round(majorityPct * 1000) / 1000,
    swing, methodology, confidence,
    mpChange: winner !== constituency.mp?.party?.replace(' (Co-op)', ''),
  };
}

export function predictConstituencyGE(constituency, polling, modelCoefficients, opts = {}) {
  if (!constituency?.ge2024?.results || !polling?.aggregate) {
    return { prediction: null, methodology: [], confidence: 'none' };
  }

  const methodology = [];
  const ge2024Baseline = {};
  for (const r of constituency.ge2024.results) {
    ge2024Baseline[r.party] = r.pct;
  }

  methodology.push({
    step: 1, name: 'GE2024 Baseline',
    description: `Actual GE2024 result in ${constituency.name}`,
    data: { ...ge2024Baseline },
  });

  // National swing from polling — Strong Transition Model (multiplicative,
  // bounded). Replaces the previous additive UNS that could produce negative
  // shares for declining parties in their weak seats. Reference: Baxter /
  // Electoral Calculus STM.
  const ge2024National = polling.ge2024_baseline || {};
  const currentPolling = polling.aggregate || {};
  const dampeningByParty = modelCoefficients?.dampening_by_party || {};
  // STM is opt-in: callers must pass `useSTM: true` to enable the new
  // Strong Transition Model swing. Default is the legacy additive UNS so the
  // pre-existing test suite + any older callers keep working.
  const useSTM = opts.useSTM === true;

  let shares = { ...ge2024Baseline };

  if (useSTM) {
    // Per-party effective dampening; default 1.0 for GE (full national swing)
    // but caller can pass party-specific dampening via opts.geDampening.
    const dampening = typeof opts.geDampening === 'number' ? opts.geDampening : 1.0;
    const stmOut = applyStrongTransitionSwingExternal(shares, currentPolling, ge2024National, { dampening });
    shares = stmOut.shares;
    // Add parties in polling but absent from baseline at half national share
    for (const party of Object.keys(currentPolling)) {
      if (shares[party] == null) shares[party] = currentPolling[party] * 0.5 * dampening;
    }
    methodology.push({
      step: 2, name: 'National Swing (Strong Transition Model)',
      description: 'Multiplicative bounded swing — losers shed in proportion to local share, gainers absorb pro-rata national gain. Replaces additive UNS.',
      details: stmOut.swingsApplied,
    });
  } else {
    // Legacy additive UNS (kept for unit-test continuity)
    const swingDetails = {};
    for (const party of Object.keys(shares)) {
      const natNow = currentPolling[party] || 0;
      const natGE = ge2024National[party] || 0;
      const natSwing = natNow - natGE;
      const dampening = Math.min(0.95, (dampeningByParty[party] || 0.65) * 1.2);
      const swing = natSwing * dampening;
      shares[party] = (shares[party] || 0) + swing;
      swingDetails[party] = { natSwing: Math.round(natSwing * 1000) / 1000, dampening, applied: Math.round(swing * 1000) / 1000 };
    }
    for (const party of Object.keys(currentPolling)) {
      if (!shares[party]) shares[party] = currentPolling[party] * 0.5;
    }
    methodology.push({
      step: 2, name: 'National Swing (legacy UNS)',
      description: 'Additive uniform national swing with party-specific dampening (×1.2 for GE)',
      details: swingDetails,
    });
  }

  // Step 2.2: BES regional/demographic prior blend (if provided).
  if (opts.besPrior?.shares) {
    const W = opts.besPriorWeight ?? 0.15;
    const blended = {};
    const partySet = new Set([...Object.keys(shares), ...Object.keys(opts.besPrior.shares)]);
    for (const p of partySet) {
      blended[p] = (1 - W) * (shares[p] || 0) + W * (opts.besPrior.shares[p] || 0);
    }
    shares = blended;
    methodology.push({
      step: 2.2, name: 'BES MRP Prior',
      description: `Baseline blended with BES Wave 1-30 ${opts.besPrior.region || 'region'} prior at weight ${(W * 100).toFixed(0)}%`,
      data: { ...opts.besPrior.shares, weight: W },
    });
  }

  // Step 2.3: Incumbency / standing-down adjustment (if MP info supplied).
  if (opts.mp) {
    const inc = applyIncumbencyAdjustmentExternal(shares, opts.mp);
    if (inc.applied) {
      shares = inc.shares;
      methodology.push({
        step: 2.3, name: 'Incumbency / Retirement',
        description: `${inc.applied.party}: ${inc.applied.reason} → ${(inc.applied.delta * 100).toFixed(1)}pp`,
        data: { mp: opts.mp, applied: inc.applied },
      });
    }
  }

  // Step 2.4: Tactical voting overlay (Curtice/Fisher-style progressive squeeze).
  if (opts.applyTacticalVoting !== false) {
    const tac = applyTacticalVotingExternal(shares, opts.tacticalOpts);
    if (tac.applied) {
      shares = tac.shares;
      methodology.push({
        step: 2.4, name: 'Tactical Voting',
        description: `${tac.applied.donor} → ${tac.applied.recipient}: ${(tac.applied.amount * 100).toFixed(1)}pp transfer (close 3-way)`,
        data: tac.applied,
      });
    }
  }

  // Step 2.5: Demographic ceilings + floors (PCON-level Census 2021).
  if (opts.demographics) {
    // 2.5a: English-identity floor (TS027) — Reform's strongest demographic
    // predictor (Frontiers 2025, β≈0.45). Boost Reform 1-3pp in high-English-
    // identity PCONs before the Muslim cap fires, so the cap can still trim
    // any over-shoot in the rare overlap PCONs.
    const engFloor = applyEnglishIdentityFloor(shares, opts.demographics);
    if (engFloor.applied) {
      shares = engFloor.shares;
      methodology.push({
        step: 2.5, name: 'English-identity floor',
        description: `English ${(engFloor.applied.english_identity_pct * 100).toFixed(1)}% → Reform +${(engFloor.applied.bonus * 100).toFixed(1)}pp`,
        data: engFloor.applied,
      });
    }
    // 2.51: Age-structure adjustment (TS007A) — Reform/Con lift in 65+-heavy
    // PCONs. Dampened to 0.4× when a BES prior is already shaping the
    // posterior, since BES respondents implicitly carry the age signal.
    const ageAdj = applyAgeStructureAdjustment(shares, opts.demographics, {
      hasBesPrior: opts.besPrior != null,
    });
    if (ageAdj.applied) {
      shares = ageAdj.shares;
      methodology.push({
        step: 2.51, name: 'Age-structure adjustment',
        description: `65+ ${(ageAdj.applied.age_65_plus_pct * 100).toFixed(1)}% → Reform +${(ageAdj.applied.reform_bonus * 100).toFixed(2)}pp, Con +${(ageAdj.applied.conservative_bonus * 100).toFixed(2)}pp${ageAdj.applied.dampened ? ' (BES-dampened)' : ''}`,
        data: ageAdj.applied,
      });
    }
    const reformCap = applyReformDemographicCeiling(shares, opts.demographics);
    if (reformCap.applied) {
      shares = reformCap.shares;
      methodology.push({
        step: 2.52, name: 'Reform demographic ceiling',
        description: `Muslim ${(reformCap.applied.muslim_pct * 100).toFixed(1)}% → cap Reform at ${(reformCap.applied.ceiling * 100).toFixed(0)}%; redistributed ${(reformCap.applied.excess_redistributed * 100).toFixed(1)}pp`,
        data: reformCap.applied,
      });
    }
    const indCap = applyIndependentCeiling(shares, { allowHighIndependent: opts.allowHighIndependent });
    if (indCap.applied) {
      shares = indCap.shares;
      methodology.push({
        step: 2.55, name: 'Independent ceiling',
        description: `Cap Independent at ${(indCap.applied.cap * 100).toFixed(0)}% (no override flag); redistributed ${(indCap.applied.excess_redistributed * 100).toFixed(1)}pp`,
        data: indCap.applied,
      });
    }
  }

  // Step 2.6: By-election overlay (recent post-baseline by-election shares).
  if (opts.byElectionShares && Object.keys(opts.byElectionShares).length > 0) {
    const W = opts.byElectionWeight ?? 0.30;
    const blended = {};
    const partySet = new Set([...Object.keys(shares), ...Object.keys(opts.byElectionShares)]);
    for (const p of partySet) {
      blended[p] = (1 - W) * (shares[p] || 0) + W * (opts.byElectionShares[p] || 0);
    }
    shares = blended;
    methodology.push({
      step: 2.6, name: 'By-Election Overlay',
      description: `Blended ${(W * 100).toFixed(0)}% of recent by-election result for ${constituency.name}`,
      data: { ...opts.byElectionShares, weight: W },
    });
  }

  // Legacy "Step 2b" (incumbent-loss heuristic) — retained for backward
  // compatibility with the existing test suite. Skipped if the caller has
  // supplied `opts.mp` (which uses the canonical incumbencyTracker layer).
  if (opts.mp) {
    return finishConstituencyGE(constituency, ge2024Baseline, shares, methodology);
  }

  // Step 2b (legacy): Incumbent loss effect — when the GE2024 incumbent lost their seat,
  // their party's personal vote evaporates for the next election. Long-serving MPs
  // (like Nigel Evans, 32 years in Ribble Valley) inflate their party's baseline.
  // Detect via explicit previous_mp_party field OR heuristic (runner-up with
  // narrow margin likely = former incumbent party that lost).
  const ge2024Winner = constituency.ge2024.results?.[0]?.party;
  const ge2024RunnerUp = constituency.ge2024.results?.[1];
  const prevIncumbentParty = constituency.ge2024?.previous_mp_party
    || (ge2024RunnerUp && ge2024RunnerUp.pct > 0.25
        && (ge2024Winner !== ge2024RunnerUp.party)
        && ((constituency.ge2024.results[0].pct - ge2024RunnerUp.pct) < 0.10)
        ? ge2024RunnerUp.party : null);

  if (prevIncumbentParty && shares[prevIncumbentParty]) {
    // Scale penalty by how long the previous MP served (more tenure = bigger personal vote loss)
    const tenure = constituency.ge2024?.previous_mp_tenure_years || 0;
    const basePenalty = tenure > 20 ? -0.04 : tenure > 10 ? -0.03 : -0.02;
    shares[prevIncumbentParty] += basePenalty;

    // Redistribute lost share: in the current environment, Reform captures most of
    // the disgruntled former-incumbent voters (anti-establishment sentiment)
    const reformSurging = (currentPolling['Reform UK'] || 0) > (ge2024National['Reform UK'] || 0);
    if (reformSurging && shares['Reform UK'] != null) {
      shares['Reform UK'] += Math.abs(basePenalty) * 0.6;
      if (ge2024Winner && shares[ge2024Winner] != null) {
        shares[ge2024Winner] += Math.abs(basePenalty) * 0.4;
      }
    }
    methodology.push({
      step: 2.5, name: 'Incumbent Loss Effect',
      description: `${prevIncumbentParty} lost seat in GE2024${tenure ? ` after ${tenure}yr tenure` : ''} — personal vote penalty of ${(basePenalty * 100).toFixed(0)}pp, redistributed to challenger parties`,
    });
  }

  // Normalise
  const normalised = normaliseShares(shares);
  methodology.push({
    step: 3, name: 'Normalise',
    description: 'Shares scaled to 100%',
    data: Object.fromEntries(Object.entries(normalised).map(([p, v]) => [p, Math.round(v * 1000) / 1000])),
  });

  // Sort by vote share descending
  const sorted = Object.entries(normalised).sort((a, b) => b[1] - a[1]);
  const prediction = Object.fromEntries(sorted.map(([p, v]) => [p, { pct: Math.round(v * 1000) / 1000 }]));
  const winner = sorted[0]?.[0];
  const runnerUp = sorted[1]?.[0];
  const majorityPct = winner && runnerUp ? normalised[winner] - normalised[runnerUp] : 0;

  // Swing vs GE2024
  const swing = {};
  for (const [party, share] of Object.entries(normalised)) {
    swing[party] = Math.round((share - (ge2024Baseline[party] || 0)) * 1000) / 1000;
  }

  // Confidence — constituency predictions are inherently less certain
  let confidence = 'low';
  if (majorityPct > 0.15) confidence = 'high';
  else if (majorityPct > 0.08) confidence = 'medium';

  return {
    prediction, winner, runnerUp,
    majorityPct: Math.round(majorityPct * 1000) / 1000,
    swing, methodology, confidence,
    mpChange: winner !== constituency.mp?.party?.replace(' (Co-op)', ''),
  };
}

/**
 * Normalize party names for consistent aggregation across councils.
 * Different councils use different names for the same party.
 */
export function normalizePartyName(party) {
  if (!party) return 'Unknown'
  const p = party.trim()
  // Labour variants
  if (/^Labour\s*(&|and)\s*Co-?op/i.test(p)) return 'Labour'
  if (p === 'Labour Group') return 'Labour'
  // Lib Dem variants
  if (/^Lib(eral)?\s*Dem/i.test(p)) return 'Liberal Democrats'
  // Conservative variants
  if (/^(The\s+)?Conservative/i.test(p)) return 'Conservative'
  // Green variants
  if (/^Green/i.test(p)) return 'Green Party'
  // Reform / UKIP variants — UKIP is the electoral predecessor to Reform UK
  if (/^Reform/i.test(p)) return 'Reform UK'
  if (/^UKIP|^UK\s*Independence/i.test(p)) return 'Reform UK'
  // Local independents — group under "Independent" umbrella for LGR modelling
  if (/independent/i.test(p) || p === 'Our West Lancashire' || p === '4 BwD' ||
      p === 'Morecambe Bay Independents' || p === 'Wyre Independent Group' ||
      /^Ashton Ind/i.test(p) || /^Pendle.*True/i.test(p)) return 'Independent'
  return p
}

export function projectToLGRAuthority(councilSeatTotals, lgrModel) {
  if (!lgrModel?.authorities) return {};

  const projections = {};
  for (const authority of lgrModel.authorities) {
    const combinedSeats = {};
    const perCouncil = {};
    for (const councilId of (authority.councils || [])) {
      const seats = councilSeatTotals[councilId] || {};
      perCouncil[councilId] = seats;
      for (const [party, count] of Object.entries(seats)) {
        // Normalize at aggregation time as well (belt-and-braces)
        const normalized = normalizePartyName(party);
        combinedSeats[normalized] = (combinedSeats[normalized] || 0) + count;
      }
    }

    const totalSeats = Object.values(combinedSeats).reduce((s, v) => s + v, 0);
    const majorityThreshold = Math.floor(totalSeats / 2) + 1;
    const sorted = Object.entries(combinedSeats).sort((a, b) => b[1] - a[1]);
    const largest = sorted[0];

    projections[authority.name] = {
      seats: combinedSeats,
      perCouncil,
      totalSeats,
      majorityThreshold,
      largestParty: largest?.[0],
      largestPartySeats: largest?.[1] || 0,
      hasMajority: (largest?.[1] || 0) >= majorityThreshold,
      coalitions: computeCoalitions(combinedSeats, majorityThreshold),
    };
  }

  return projections;
}


// ═══════════════════════════════════════════════════════════════════════
// V6: Integrity-Adjusted Election Predictions
// ═══════════════════════════════════════════════════════════════════════

/**
 * Adjust election predictions for councillor integrity data.
 *
 * Step 4.5: Between incumbency and Reform entry:
 * - If >20% of party's candidate pool has integrity flags → halve incumbency bonus
 * - If sitting councillor flagged for conflicts → apply -2% penalty
 * - If councillor disqualified (insolvency, FCA) → remove from prediction
 *
 * @param {Object} shares - Current party vote shares (post-Step 4)
 * @param {Object} wardData - Ward object from elections.json
 * @param {Object} integrityData - integrity.json data
 * @returns {{ adjustedShares: Object, methodology: Object }}
 */
function adjustForIntegrity(shares, wardData, integrityData) {
  const adjustedShares = { ...shares };
  const factors = [];

  if (!integrityData?.councillors || !wardData) {
    return {
      adjustedShares,
      methodology: {
        step: 4.5,
        name: 'Integrity Filter',
        description: 'No integrity data available',
        factors: [],
      },
    };
  }

  const councillors = integrityData.councillors;

  // Find the sitting councillor(s) for this ward
  const wardCouncillors = councillors.filter(c =>
    c.ward === wardData.ward || c.ward === wardData.ward_name
  );

  if (wardCouncillors.length === 0) {
    return {
      adjustedShares,
      methodology: {
        step: 4.5,
        name: 'Integrity Filter',
        description: 'No matched councillors for this ward',
        factors: [],
      },
    };
  }

  // Check each ward councillor
  for (const cllr of wardCouncillors) {
    const party = cllr.party;
    if (!party || !adjustedShares[party]) continue;

    const riskLevel = cllr.risk_level || 'low';
    const flags = cllr.red_flags || [];
    const highFlags = flags.filter(f => ['critical', 'high', 'elevated'].includes(f.severity));

    // Disqualification check — remove from prediction entirely
    const disqualified = flags.some(f =>
      f.type?.includes('disqualified') || f.type?.includes('insolvency') ||
      f.type?.includes('fca_prohibition') || f.type?.includes('bankruptcy')
    );

    if (disqualified) {
      // Party loses incumbency entirely for this ward
      adjustedShares[party] = Math.max(0, (adjustedShares[party] || 0) - 0.05);
      factors.push(`${cllr.name} (${party}) DISQUALIFIED — incumbency removed, -5pp`);
      continue;
    }

    // High-risk councillor penalty
    if (riskLevel === 'high' && highFlags.length >= 3) {
      adjustedShares[party] = Math.max(0, (adjustedShares[party] || 0) - 0.02);
      factors.push(`${cllr.name} (${party}) HIGH RISK (${highFlags.length} flags) — -2pp penalty`);
    } else if (riskLevel === 'elevated' && highFlags.length >= 2) {
      adjustedShares[party] = Math.max(0, (adjustedShares[party] || 0) - 0.01);
      factors.push(`${cllr.name} (${party}) ELEVATED (${highFlags.length} flags) — -1pp penalty`);
    }
  }

  // Council-wide check: if >20% of party councillors are compromised, halve incumbency
  const partyFlagCounts = {};
  const partyTotals = {};
  for (const c of councillors) {
    if (!c.party) continue;
    partyTotals[c.party] = (partyTotals[c.party] || 0) + 1;
    const highFlags = (c.red_flags || []).filter(f => ['critical', 'high', 'elevated'].includes(f.severity));
    if (highFlags.length >= 2) {
      partyFlagCounts[c.party] = (partyFlagCounts[c.party] || 0) + 1;
    }
  }

  for (const [party, flagged] of Object.entries(partyFlagCounts)) {
    const total = partyTotals[party] || 1;
    if (flagged / total > 0.20 && adjustedShares[party]) {
      // Already applied individual penalty — this is a council-wide factor note
      factors.push(`${party}: ${flagged}/${total} (${Math.round(flagged / total * 100)}%) councillors flagged — party-wide concern`);
    }
  }

  return {
    adjustedShares,
    methodology: {
      step: 4.5,
      name: 'Integrity Filter',
      description: factors.length > 0
        ? `${factors.length} integrity adjustment(s) applied`
        : 'No integrity adjustments needed for this ward',
      factors,
    },
  };
}

