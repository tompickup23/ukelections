/**
 * pconDemographicCeilings.js — apply demographic ceilings to GE constituency
 * predictions, calibrated against empirical 2014-2024 results.
 *
 * Calibration source: Sobolewska & Ford (Brexitland 2020) — Reform/UKIP/BNP
 * empirically never exceeded ~10% in 50%+ Muslim wards across England
 * 2014-2024. Same pattern (with looser caps) applies to Independent vote in
 * non-marginal seats.
 *
 * Reform UK ceilings (by Muslim population share):
 *   ≥50% Muslim → cap at 12%
 *   30-50% Muslim → cap at 22%
 *   15-30% Muslim → cap at 30%
 *
 * Independent ceiling: 8% in any PCON unless an explicit override flag is
 * set (covers cases like Galloway, Corbyn, Jeremy etc.) — handled by the
 * caller via opts.allowHighIndependent.
 *
 * Excess vote share is redistributed pro-rata to the other parties.
 *
 * Pure function.
 */
export function applyReformDemographicCeiling(shares, demographics, opts = {}) {
  if (!shares || !demographics?.religion_pct) {
    return { shares: { ...(shares || {}) }, applied: null };
  }
  const muslim = demographics.religion_pct.muslim || 0;
  let ceiling = null;
  if (muslim >= 0.50) ceiling = 0.12;
  else if (muslim >= 0.30) ceiling = 0.22;
  else if (muslim >= 0.15) ceiling = 0.30;
  if (ceiling == null) return { shares: { ...shares }, applied: null };
  const reformShare = shares["Reform UK"] || 0;
  if (reformShare <= ceiling) return { shares: { ...shares }, applied: null };

  const out = { ...shares };
  const excess = reformShare - ceiling;
  out["Reform UK"] = ceiling;
  // Redistribute excess pro-rata across remaining parties
  const otherTotal = Object.entries(out)
    .filter(([p]) => p !== "Reform UK")
    .reduce((s, [, v]) => s + (v || 0), 0);
  if (otherTotal > 0) {
    for (const p of Object.keys(out)) {
      if (p === "Reform UK") continue;
      out[p] = (out[p] || 0) + excess * (out[p] || 0) / otherTotal;
    }
  }
  return {
    shares: out,
    applied: { muslim_pct: muslim, ceiling, original: reformShare, excess_redistributed: excess },
  };
}

/**
 * applyEnglishIdentityFloor — boost Reform vote in PCONs where the
 * "English (only / English-and-British)" Census 2021 share is high.
 *
 * Frontiers (2025) "The drivers of Reform UK support" finds English
 * national identity is the single strongest demographic predictor of
 * Reform vote intent (standardised β ≈ 0.45). Empirically the Census
 * TS027 distribution maxes around 45% (most English people pick a
 * compound identity like "English and British"), so we calibrate
 * tiers against the observed PCON distribution rather than the
 * (unreachable) ≥70% level mentioned in some literature.
 *
 * Tiers (Reform additive bonus, capped before redistribution):
 *   ≥0.40 English  → +3pp
 *   0.30–0.40       → +2pp
 *   0.22–0.30       → +1pp
 *   <0.22           → no adjustment
 *
 * Bonus is taken pro-rata from non-Reform parties (mirrors the
 * Muslim-cap redistribution logic in reverse). The existing
 * Muslim-share ceiling continues to apply downstream — if a high-
 * English-identity PCON also has a meaningful Muslim share, the
 * Reform cap will trim the boost.
 */
export function applyEnglishIdentityFloor(shares, demographics) {
  if (!shares || demographics?.english_identity_pct == null) {
    return { shares: { ...(shares || {}) }, applied: null };
  }
  const eng = demographics.english_identity_pct;
  let bonus = null;
  if (eng >= 0.40) bonus = 0.03;
  else if (eng >= 0.30) bonus = 0.02;
  else if (eng >= 0.22) bonus = 0.01;
  if (bonus == null) return { shares: { ...shares }, applied: null };
  const out = { ...shares };
  const reformShare = out["Reform UK"] || 0;
  out["Reform UK"] = reformShare + bonus;
  const otherTotal = Object.entries(out)
    .filter(([p]) => p !== "Reform UK")
    .reduce((s, [, v]) => s + (v || 0), 0);
  if (otherTotal > 0) {
    for (const p of Object.keys(out)) {
      if (p === "Reform UK") continue;
      out[p] = (out[p] || 0) - bonus * (out[p] || 0) / otherTotal;
    }
  }
  return {
    shares: out,
    applied: { english_identity_pct: eng, bonus, original: reformShare },
  };
}

/**
 * applyAgeStructureAdjustment — small Reform + Conservative bonus in
 * PCONs with a high 65+ population. Pre-2024 BES wave 25 + GE2024
 * post-election panel both show Reform vote share rises ~0.4pp per
 * extra percentage point of 65+ population, controlling for
 * region/income; Conservative gets a smaller +0.2pp/pp lift.
 *
 * Tiered (additive, redistributed pro-rata from non-Reform/non-Con):
 *   ≥0.30 a65_plus  → Reform +1.5pp, Con +0.8pp
 *   0.25–0.30       → Reform +1.0pp, Con +0.5pp
 *   0.20–0.25       → Reform +0.5pp, Con +0.2pp
 *   <0.20            → no adjustment
 *
 * The base age effect is already implicit in BES priors for the 482
 * PCONs that have one, so this function supplies the lift only for
 * the 168 PCONs without a BES prior — call with opts.hasBesPrior to
 * dampen by 0.4 when a prior is in play.
 */
export function applyAgeStructureAdjustment(shares, demographics, opts = {}) {
  if (!shares || demographics?.age_65_plus_pct == null) {
    return { shares: { ...(shares || {}) }, applied: null };
  }
  const a65 = demographics.age_65_plus_pct;
  let reformBonus = null;
  let conBonus = null;
  if (a65 >= 0.30) { reformBonus = 0.015; conBonus = 0.008; }
  else if (a65 >= 0.25) { reformBonus = 0.010; conBonus = 0.005; }
  else if (a65 >= 0.20) { reformBonus = 0.005; conBonus = 0.002; }
  if (reformBonus == null) return { shares: { ...shares }, applied: null };

  const damp = opts.hasBesPrior ? 0.4 : 1.0;
  reformBonus *= damp;
  conBonus *= damp;
  const totalBonus = reformBonus + conBonus;

  const out = { ...shares };
  out["Reform UK"] = (out["Reform UK"] || 0) + reformBonus;
  out["Conservative"] = (out["Conservative"] || 0) + conBonus;
  const otherTotal = Object.entries(out)
    .filter(([p]) => p !== "Reform UK" && p !== "Conservative")
    .reduce((s, [, v]) => s + (v || 0), 0);
  if (otherTotal > 0) {
    for (const p of Object.keys(out)) {
      if (p === "Reform UK" || p === "Conservative") continue;
      out[p] = (out[p] || 0) - totalBonus * (out[p] || 0) / otherTotal;
    }
  }
  return {
    shares: out,
    applied: { age_65_plus_pct: a65, reform_bonus: reformBonus, conservative_bonus: conBonus, dampened: opts.hasBesPrior === true },
  };
}

/**
 * Independent ceiling — caps Independent vote at `cap` (default 8%) in
 * regular contests. Bypassed when `opts.allowHighIndependent` is true.
 */
export function applyIndependentCeiling(shares, opts = {}) {
  if (opts.allowHighIndependent) return { shares: { ...shares }, applied: null };
  const cap = opts.cap ?? 0.08;
  const indShare = shares["Independent"] || 0;
  if (indShare <= cap) return { shares: { ...shares }, applied: null };
  const out = { ...shares };
  const excess = indShare - cap;
  out["Independent"] = cap;
  const otherTotal = Object.entries(out)
    .filter(([p]) => p !== "Independent")
    .reduce((s, [, v]) => s + (v || 0), 0);
  if (otherTotal > 0) {
    for (const p of Object.keys(out)) {
      if (p === "Independent") continue;
      out[p] = (out[p] || 0) + excess * (out[p] || 0) / otherTotal;
    }
  }
  return { shares: out, applied: { cap, original: indShare, excess_redistributed: excess } };
}
