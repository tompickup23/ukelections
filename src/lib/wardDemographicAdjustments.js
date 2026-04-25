/**
 * wardDemographicAdjustments.js — generic, nationwide, per-ward demographic
 * adjustment module. Replaces / supersedes the AI DOGE LA-aggregate
 * adjustments for non-Lancashire wards using ONS Census 2021 ward-level
 * data (TS021 ethnicity, TS030 religion, TS054 tenure, TS066 economic
 * activity, TS067 qualifications, TS004 country of birth) plus IMD 2019.
 *
 * Pure functions. Returns a per-party adjustment dict (additive
 * percentage points) that the bulk-predict step folds into the model
 * output AFTER the AI DOGE model's own demographic step.
 *
 * Why this exists: Tom flagged that high-Muslim wards (Daneshouse 75%
 * Muslim) were predicting Reform UK 43% top — implausible. Reform
 * empirically does not exceed ~10% in 50%+ Muslim wards. The AI DOGE
 * generic Asian-percentage tier system applies the right adjustment
 * but only fires off LA-level ethnicity data in the port. This module
 * applies the same logic with per-ward Census evidence.
 *
 * Calibration: thresholds + magnitudes derived from Sobolewska & Ford
 * (Brexitland 2020), Goodwin & Eatwell (National Populism 2018),
 * Cutts/Goodwin (2020 Politics & Policy review of UKIP/Brexit/Reform
 * voter profiles), and AI DOGE's own Lancashire-tuned numbers
 * generalised against the May 2024 backtest residuals.
 */

/**
 * Compute per-party additive adjustments from ward demographic profile.
 *
 * @param {object} demo - data/features/ward-demographics-2021.json#wards[gss]
 * @returns {{ adjustments: Object<string,number>, factors: string[] }}
 */
export function computeWardDemographicAdjustments(demo) {
  const adj = {};
  const factors = [];
  if (!demo) return { adjustments: adj, factors };

  const muslim = demo.muslim_pct || 0;
  const asian = demo.asian_pct || 0;
  const whiteBr = demo.white_british_pct || 0;
  const ownedOutright = demo.owned_outright_pct || 0;
  const degree = demo.degree_pct || 0;
  const noQuals = demo.no_quals_pct || 0;
  const studentsFt = demo.ft_students_pct || 0;
  const retired = demo.retired_pct || 0;
  const socialRented = demo.social_rented_pct || 0;
  const imd = demo.avg_imd_decile;
  const ukBorn = demo.uk_born_pct || 0;

  function add(party, pp, factor) {
    adj[party] = (adj[party] || 0) + pp;
    factors.push(`${factor} → ${party} ${pp >= 0 ? "+" : ""}${(pp * 100).toFixed(1)}pp`);
  }

  // -------- Reform UK (signed correlation with Census features) --------
  // Strongest predictor: % no religion + % Christian (positive); % Muslim (deeply negative).
  // From Sobolewska & Ford (2020) + Cutts/Goodwin: Reform/UKIP/Brexit Party have
  // ceiling around 8-12% in 50%+ Muslim wards across England 2014-2024 elections.
  if (muslim > 0.50) add("Reform UK", -0.20, `Muslim ${(muslim * 100).toFixed(0)}% (>50%)`);
  else if (muslim > 0.30) add("Reform UK", -0.12, `Muslim ${(muslim * 100).toFixed(0)}% (30-50%)`);
  else if (muslim > 0.15) add("Reform UK", -0.06, `Muslim ${(muslim * 100).toFixed(0)}% (15-30%)`);

  // White British correlation: AI DOGE rule fires at >85%, but the relationship
  // is monotonic from ~70% upward. Apply a graded bonus.
  if (whiteBr > 0.90) add("Reform UK", 0.04, `White British ${(whiteBr * 100).toFixed(0)}% (>90%)`);
  else if (whiteBr > 0.80) add("Reform UK", 0.02, `White British ${(whiteBr * 100).toFixed(0)}% (80-90%)`);

  // Owned-outright peak: Reform peaks in 30-55% owned-outright bands (Ford & Goodwin
  // *Revolt on the Right*; subsequent BES analysis). Lower in cities (low ownership)
  // AND in very-affluent suburbs (high mortgage / high degree).
  if (ownedOutright >= 0.30 && ownedOutright <= 0.55 && degree < 0.40) {
    add("Reform UK", 0.03, `Owned-outright ${(ownedOutright * 100).toFixed(0)}%, low-degree (Reform peak)`);
  }

  // Degree-qualified suppression
  if (degree > 0.45) add("Reform UK", -0.05, `Degree ${(degree * 100).toFixed(0)}% (>45%)`);
  else if (degree > 0.35) add("Reform UK", -0.03, `Degree ${(degree * 100).toFixed(0)}% (35-45%)`);

  // Student suppression (Reform vote scarce among full-time students)
  if (studentsFt > 0.20) add("Reform UK", -0.04, `FT students ${(studentsFt * 100).toFixed(0)}%`);

  // No-qualifications boost (Reform's strongest demographic in the BES)
  if (noQuals > 0.30) add("Reform UK", 0.03, `No-quals ${(noQuals * 100).toFixed(0)}%`);

  // -------- Conservative --------
  // Owned-outright + retired + low Muslim = Tory heartland; conservatives also
  // poll well in IMD 8-10 affluent rural areas (high degree, owned outright).
  if (ownedOutright > 0.55 && imd >= 7) add("Conservative", 0.03, `Owned-outright ${(ownedOutright * 100).toFixed(0)}% + IMD ${imd} (Tory rural)`);
  if (retired > 0.30) add("Conservative", 0.02, `Retired ${(retired * 100).toFixed(0)}%`);

  // -------- Labour --------
  // Social rented + IMD 1-2 + Asian/Muslim (Lab not in deep Muslim core where
  // Independent dominates, but historic Lab base in social-rented working-class).
  if (socialRented > 0.30 && imd <= 3) add("Labour", 0.04, `Social-rented ${(socialRented * 100).toFixed(0)}% + deprived`);
  if (degree > 0.40) add("Labour", 0.03, `Degree ${(degree * 100).toFixed(0)}% (Labour graduate base)`);

  // -------- Independent / community-bloc --------
  // High-Asian wards: empirically Independent dominates 50%+ Asian wards
  // (Burnley Bank Hall/Daneshouse/Queensgate; Birmingham Sparkbrook; Bradford
  // Manningham etc.). The AI DOGE tier system; we apply per-ward.
  if (asian > 0.60) add("Independent", 0.10, `Asian ${(asian * 100).toFixed(0)}% (>60%, Independent stronghold)`);
  else if (asian > 0.40) add("Independent", 0.06, `Asian ${(asian * 100).toFixed(0)}% (40-60%)`);
  else if (asian > 0.20) add("Independent", 0.03, `Asian ${(asian * 100).toFixed(0)}% (20-40%)`);

  // -------- Liberal Democrat --------
  // Affluent suburb signature: degree > 35% + owned-outright > 35% + IMD >= 7
  if (degree > 0.35 && ownedOutright > 0.35 && imd >= 7) {
    add("Liberal Democrats", 0.03, `Degree ${(degree * 100).toFixed(0)}% + Owned ${(ownedOutright * 100).toFixed(0)}% + IMD ${imd} (LD suburb)`);
  }

  // -------- Green Party --------
  // Student + degree concentration (urban progressive)
  if (studentsFt > 0.20 && degree > 0.50) {
    add("Green Party", 0.04, `Student ${(studentsFt * 100).toFixed(0)}% + degree ${(degree * 100).toFixed(0)}% (urban progressive)`);
  } else if (degree > 0.50) {
    add("Green Party", 0.02, `Degree ${(degree * 100).toFixed(0)}% (>50%)`);
  }

  return { adjustments: adj, factors };
}

/**
 * Apply per-ward demographic ceilings — caps a party's predicted share at a
 * demographically-plausible maximum. Currently:
 *   - Reform UK ≤ 12% if Muslim > 50%
 *   - Reform UK ≤ 22% if Muslim > 30%
 *   - Reform UK ≤ 30% if Muslim > 15%
 *
 * Excess share is redistributed pro-rata to the remaining parties.
 */
export function applyDemographicCeilings(prediction, demo) {
  if (!prediction || !demo) return { prediction, capped: [] };
  const muslim = demo.muslim_pct || 0;
  const out = { ...prediction };
  const capped = [];

  let reformCap = null;
  if (muslim > 0.50) reformCap = 0.12;
  else if (muslim > 0.30) reformCap = 0.22;
  else if (muslim > 0.15) reformCap = 0.30;

  if (reformCap != null && out["Reform UK"]?.pct > reformCap) {
    const before = out["Reform UK"].pct;
    const excess = before - reformCap;
    out["Reform UK"] = { ...out["Reform UK"], pct: reformCap };
    capped.push({ party: "Reform UK", before, after: reformCap, excess, reason: `Muslim ${(muslim * 100).toFixed(0)}% — Reform demographic ceiling` });
    // Redistribute excess pro-rata to other parties
    const others = Object.keys(out).filter((p) => p !== "Reform UK");
    const otherSum = others.reduce((s, p) => s + (out[p].pct || 0), 0);
    if (otherSum > 0) {
      for (const p of others) {
        const share = (out[p].pct || 0) / otherSum;
        out[p] = { ...out[p], pct: (out[p].pct || 0) + excess * share };
      }
    }
  }

  return { prediction: out, capped };
}

/**
 * Apply additive adjustments to a prediction dict, then re-normalise.
 * Floors each party at 0.
 */
export function applyAdjustments(prediction, adjustments) {
  if (!prediction) return prediction;
  const out = {};
  for (const [party, payload] of Object.entries(prediction)) {
    const adj = adjustments[party] || 0;
    out[party] = { ...payload, pct: Math.max(0, (payload.pct || 0) + adj) };
  }
  // Re-normalise
  const sum = Object.values(out).reduce((s, v) => s + (v.pct || 0), 0);
  if (sum > 0) for (const p of Object.keys(out)) out[p].pct = out[p].pct / sum;
  return out;
}
