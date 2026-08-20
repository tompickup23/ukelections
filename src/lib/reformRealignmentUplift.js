/**
 * reformRealignmentUplift.js. national Reform-realignment uplift for councils
 * with no parent-county 2025 cycle anchor.
 *
 * Background
 * ----------
 * The May-2025 county elections delivered a pronounced Reform UK realignment
 * across 2-tier districts (Lancashire, Lincs, Staffs, Derbys, Kent, Notts,
 * Leics, Warks, Northumberland, Cornwall, Bucks, Glos, Devon, Cambs, Herts).
 * The bulk-prediction pipeline already feeds those districts a county-aggregate
 * Reform proxy through the new-party-entry step (Step 5).
 *
 * Unitaries and metropolitan boroughs OUTSIDE those parent counties received
 * no such anchor. The fallback was national-swing-only, dampened by 0.10 in
 * the post-2024 calibration. Two consequences observed in the 7 May 2026
 * forecast (audited 7 May 2026):
 *   - Blackburn with Darwen (unitary, outside LCC): Reform predicted at 4.8%
 *     mean across 17 wards, zero predicted wins, despite cross-border evidence
 *     of a strong Reform realignment in adjacent Burnley/Hyndburn/Pendle.
 *   - 53 of 156 contesting councils flagged with no 2025 anchor and Reform
 *     mean predicted under 12%. Roughly 30 of those are demographically
 *     similar to Reform-realigning areas; the remainder are legitimately low
 *     (Asian-majority London boroughs, Manchester/Birmingham central) and are
 *     correctly held down by the existing demographic-ceiling rule.
 *
 * Approach
 * --------
 * For wards in councils with no county_2025_anchor, compute a target Reform
 * share from a piecewise-linear function of ward Asian%. The calibration
 * curve is empirically derived from Burnley 2026 ward-level forecasts (the
 * 2-tier district that DID receive the May-2025 LCC realignment lift, with
 * a clean monotone Asian%-vs-Reform% relationship). Apply only as an upward
 * floor. never reduce existing Reform share. Re-apply the demographic
 * ceiling afterwards as a safety net.
 *
 * Regional dampening attenuates the lift outside areas where the May-2025
 * realignment empirically mirrors the calibration source:
 *   - North/Midlands metropolitan + northern unitary  → 1.00 (full lift)
 *   - Southern unitaries + non-metropolitan districts → 0.85
 *   - London boroughs                                 → 0.50
 *
 * The step is gated by an enable flag so the May-2024 backtest (which
 * predates the realignment signal) does not see it.
 */

import { readFileSync } from "node:fs";
const REFORM_TARGET_BY_ASIAN_PCT = [
  { asian: 0.00, reform: 0.36 },
  { asian: 0.05, reform: 0.36 },
  { asian: 0.15, reform: 0.30 },
  { asian: 0.30, reform: 0.24 },
  { asian: 0.45, reform: 0.18 },
  { asian: 0.60, reform: 0.14 },
  { asian: 0.80, reform: 0.12 },
  { asian: 1.00, reform: 0.10 },
];

function reformTargetFromAsianPct(asianPct) {
  if (asianPct == null || Number.isNaN(asianPct)) return 0.28;
  const xs = REFORM_TARGET_BY_ASIAN_PCT;
  if (asianPct <= xs[0].asian) return xs[0].reform;
  if (asianPct >= xs[xs.length - 1].asian) return xs[xs.length - 1].reform;
  for (let i = 0; i < xs.length - 1; i += 1) {
    const a = xs[i];
    const b = xs[i + 1];
    if (asianPct >= a.asian && asianPct <= b.asian) {
      const t = (asianPct - a.asian) / (b.asian - a.asian);
      return a.reform + t * (b.reform - a.reform);
    }
  }
  return xs[xs.length - 1].reform;
}

/**
 * Northern unitaries that are demographically similar to Reform-realigning
 * 2-tier districts but have no parent-county 2025 anchor. Used to override
 * the default 'other'-region 0.85 multiplier with full 1.00.
 */
const NORTHERN_UNITARY_FULL_LIFT = new Set([
  "blackburn-with-darwen",
  "blackpool",
  "kingston-upon-hull",
  "north-east-lincolnshire",
  "north-lincolnshire",
  "redcar-and-cleveland",
  "middlesbrough",
  "stockton-on-tees",
  "darlington",
  "hartlepool",
  "york",
  "east-riding-of-yorkshire",
  "stoke-on-trent",
  "derby",
  "nottingham",
  "leicester",
  "telford-and-wrekin",
  "halton",
  "warrington",
]);

// Tier multipliers were hand-set from the 7 May 2026 audit: read them from the
// calibration file so they can be FITTED rather than chosen, and overridden per
// tier by env var while sweeping candidate values. Falls back to the audited
// hand-set values when the file is absent, so behaviour never silently changes.
const HAND_SET_TIERS = { london: 0.0, metropolitan: 0.75, county_district: 1.0, other: 0.85, northern_unitary: 1.0 };
let TIER_MULTIPLIERS = null;
function tierMultipliers() {
  if (TIER_MULTIPLIERS) return TIER_MULTIPLIERS;
  let fromFile = {};
  try {
    const url = new URL("../../data/calibration/reform-regional-multiplier.json", import.meta.url);
    const doc = JSON.parse(readFileSync(url, "utf8"));
    for (const [tier, cfg] of Object.entries(doc.tiers || {})) {
      if (typeof cfg?.multiplier === "number") fromFile[tier] = cfg.multiplier;
    }
  } catch {
    fromFile = {};
  }
  const merged = { ...HAND_SET_TIERS, ...fromFile };
  for (const tier of Object.keys(merged)) {
    const override = process.env[`UKE_UPLIFT_${tier.toUpperCase()}`];
    if (override != null && override !== "") merged[tier] = Number(override);
  }
  TIER_MULTIPLIERS = merged;
  return merged;
}

function regionalMultiplier(councilSlug, regionTag) {
  const tiers = tierMultipliers();
  // Northern unitaries demographically aligned with Reform-realigning 2-tier
  // districts get full lift (parity with 1.00 calibration source).
  if (NORTHERN_UNITARY_FULL_LIFT.has(councilSlug)) return tiers.northern_unitary;
  // London: zero lift. The 7 May 2026 post-audit (n=218 wards) found that
  // applying any positive multiplier in London made Reform predictions
  // HOTTER on average by 6.7pp. Pre-uplift bias was +2.85pp (already
  // slightly hot); post-uplift bias was +9.51pp. Live MAE 10.86pp vs
  // shadow MAE 7.43pp. London should fall through to the hard
  // plausibility ceiling instead.
  if (regionTag === "london") return tiers.london;
  // Metropolitan boroughs: post-audit (n=528) live MAE 9.31pp vs shadow
  // 18.56pp. Uplift helped; retain 0.75.
  if (regionTag === "metropolitan") return tiers.metropolitan;
  // Reform-realigning 2-tier districts already receive the May-2025
  // county anchor and would not normally land here, but if the anchor
  // failed for some reason we still want full lift.
  if (regionTag === "county_district") return tiers.county_district;
  // Southern unitaries / districts in counties that did NOT contest May
  // 2025. Post-audit (n=750) live MAE 8.45pp vs shadow 17.69pp. Uplift
  // helped; retain 0.85.
  return tiers.other;
}

/**
 * Hard plausibility ceiling on Reform UK predicted share. Applied AFTER
 * `regionalMultiplier()` and the per-Asian% target. The 7 May 2026
 * post-audit found Reform predictions of 25%+ in wards where the actual
 * Reform share was 0-8%. Those wards all had at least one of:
 *   (a) Asian % > 0.40 (Tower Hamlets, Newham, Brent, Birmingham core)
 *   (b) Muslim % > 0.30 (same)
 *   (c) Degree % > 0.45 (inner-London Lab + cosmopolitan-white wards)
 *
 * This ceiling acts as a regardless-of-upstream safety net. It is more
 * aggressive than the existing demographic-ceiling rule (which only
 * triggers on Muslim %).
 *
 * Returns the lower of the input share and the demographic ceiling.
 */
export function reformPlausibilityCeiling(demo) {
  if (!demo) return 1.0;
  const asian = demo.asian_pct ?? 0;
  const muslim = demo.muslim_pct ?? 0;
  const degree = demo.degree_pct ?? 0;
  // Strongest cap: highly Asian or Muslim concentration.
  if (asian > 0.40 || muslim > 0.30) return 0.15;
  // Inner-suburb high-degree + meaningful Asian presence.
  if (asian > 0.25 && degree > 0.35) return 0.18;
  // High-degree wards without the Asian factor (Oxford / inner-Edinburgh
  // / Greater London suburbs with graduate professional bases).
  if (degree > 0.45) return 0.25;
  return 1.0;
}

/**
 * Apply the realignment uplift to a single ward's prediction.
 *
 * @param {object} prediction. current per-party prediction (from prior steps)
 * @param {object} demo. ward demographics (must include asian_pct, optionally muslim_pct)
 * @param {object} ctx. { councilSlug, regionTag, hasCountyAnchor, enabled }
 * @returns {{ prediction, applied: object|null }}
 */
export function applyReformRealignmentUplift(prediction, demo, ctx) {
  if (!ctx?.enabled) return { prediction, applied: null };
  if (ctx.hasCountyAnchor) return { prediction, applied: null };
  if (!prediction || !demo) return { prediction, applied: null };
  if (demo.asian_pct == null) return { prediction, applied: null };

  const asianPct = demo.asian_pct;
  const muslimPct = demo.muslim_pct || 0;

  const baseTarget = reformTargetFromAsianPct(asianPct);
  const multiplier = regionalMultiplier(ctx.councilSlug, ctx.regionTag);
  // Hard plausibility ceiling, regardless of the uplift target. This is
  // the safety net the 7 May post-audit demanded.
  const ceiling = reformPlausibilityCeiling(demo);
  const target = Math.min(baseTarget * multiplier, ceiling);

  const out = { ...prediction };
  if (!out["Reform UK"]) {
    out["Reform UK"] = { pct: 0, votes: 0, win_probability: 0 };
  }
  const before = out["Reform UK"].pct || 0;

  // If the upstream prediction is already above the plausibility ceiling
  // (e.g. an aggressive Reform stronghold prior), pull it down.
  const ceilingTriggered = before > ceiling + 1e-6;

  if (target <= before + 1e-6 && !ceilingTriggered) {
    return { prediction: out, applied: null };
  }

  const finalReform = ceilingTriggered ? ceiling : target;
  const lift = finalReform - before;
  out["Reform UK"] = { ...out["Reform UK"], pct: finalReform };

  // Pro-rata reduction (or expansion if lift is negative) across other
  // parties so the prediction sums to ~1.0.
  const others = Object.keys(out).filter((p) => p !== "Reform UK");
  const otherSum = others.reduce((s, p) => s + (out[p].pct || 0), 0);
  if (otherSum > 0) {
    const scale = (1 - finalReform) / otherSum;
    for (const p of others) {
      out[p] = { ...out[p], pct: (out[p].pct || 0) * scale };
    }
  }

  return {
    prediction: out,
    applied: {
      asian_pct: asianPct,
      muslim_pct: muslimPct,
      degree_pct: demo.degree_pct ?? null,
      base_target: baseTarget,
      regional_multiplier: multiplier,
      plausibility_ceiling: ceiling,
      final_target: finalReform,
      reform_before: before,
      reform_after: finalReform,
      lift,
      ceiling_triggered: ceilingTriggered,
    },
  };
}

/**
 * Green cap. The 7 May 2026 post-audit found Greens were systematically
 * COLD by 4.04pp (predicted lower than actual on average) BUT also had
 * the second-highest MAE bucket at 7.76pp. Both signs in the residuals.
 * The fix isn't a flat lift; it's bounding the prior. Where there's no
 * meaningful Green presence in GE2024 (< 8% Green share in the host
 * PCON), cap Greens at 25%. Where GE2024 Green was already >= 8%, leave
 * the prior alone (those wards are correctly heavy-Green by prior).
 *
 * Returns { prediction, applied } in the same shape as the uplift step.
 */
export function applyGreenCap(prediction, ctx) {
  if (!prediction || !ctx) return { prediction, applied: null };
  const greenPrior = ctx.ge2024GreenShare ?? 0;
  if (greenPrior >= 0.08) return { prediction, applied: null };
  const before = prediction["Green Party"]?.pct ?? 0;
  if (before <= 0.25) return { prediction, applied: null };
  const out = { ...prediction };
  out["Green Party"] = { ...out["Green Party"], pct: 0.25 };
  // Redistribute the shed share to the prediction's other parties pro-rata.
  const others = Object.keys(out).filter((p) => p !== "Green Party");
  const otherSum = others.reduce((s, p) => s + (out[p].pct || 0), 0);
  if (otherSum > 0) {
    const scale = (1 - 0.25) / otherSum;
    for (const p of others) {
      out[p] = { ...out[p], pct: (out[p].pct || 0) * scale };
    }
  }
  return {
    prediction: out,
    applied: {
      ge2024_green_share: greenPrior,
      green_before: before,
      green_after: 0.25,
      shed_to_others_pp: (before - 0.25) * 100,
    },
  };
}

/**
 * Tory floor. The 7 May post-audit found Conservatives were systematically
 * HOT by 2.66pp (predicted higher than actual). In wards where Reform took
 * the lion's share of the protest vote, the model still expected residual
 * Tory loyalists at GE2024 levels. Where Reform > 30% in the same ward,
 * the historical Tory base has typically gone to Reform, not stayed home.
 * Halve the Tory share against its GE2024 PCON baseline when Reform > 30%.
 *
 * Returns { prediction, applied } in the same shape as the uplift step.
 */
export function applyToryFloor(prediction, ctx) {
  if (!prediction || !ctx) return { prediction, applied: null };
  const reformShare = prediction["Reform UK"]?.pct ?? 0;
  if (reformShare <= 0.30) return { prediction, applied: null };
  const toryBefore = prediction["Conservative"]?.pct ?? 0;
  const toryBaseline = ctx.ge2024TorySharePcon ?? 0;
  if (toryBaseline <= 0) return { prediction, applied: null };
  // Halve the Tory share against the GE2024 baseline, not zero. There's
  // always some residual Tory floor even in deep Reform wards (older,
  // home-owning, faithful to brand).
  const target = Math.max(0.05, toryBaseline * 0.5);
  if (toryBefore <= target + 1e-6) return { prediction, applied: null };
  const out = { ...prediction };
  out["Conservative"] = { ...out["Conservative"], pct: target };
  // The shed share goes to Reform first (since this is the protest-vote
  // realignment), then pro-rata across remaining parties.
  const shed = toryBefore - target;
  out["Reform UK"] = {
    ...out["Reform UK"],
    pct: (out["Reform UK"].pct || 0) + shed * 0.7,
  };
  const others = Object.keys(out).filter(
    (p) => p !== "Conservative" && p !== "Reform UK",
  );
  const remainingShed = shed * 0.3;
  const otherSum = others.reduce((s, p) => s + (out[p].pct || 0), 0);
  if (otherSum > 0 && remainingShed > 0) {
    const scale = (otherSum + remainingShed) / otherSum;
    for (const p of others) {
      out[p] = { ...out[p], pct: (out[p].pct || 0) * scale };
    }
  }
  return {
    prediction: out,
    applied: {
      ge2024_tory_share_pcon: toryBaseline,
      reform_share: reformShare,
      tory_before: toryBefore,
      tory_after: target,
      shed_pp: shed * 100,
    },
  };
}

export const _REFORM_TARGET_BY_ASIAN_PCT = REFORM_TARGET_BY_ASIAN_PCT;
export const _NORTHERN_UNITARY_FULL_LIFT = NORTHERN_UNITARY_FULL_LIFT;
