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
