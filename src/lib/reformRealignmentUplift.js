/**
 * reformRealignmentUplift.js — national Reform-realignment uplift for councils
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
 * floor — never reduce existing Reform share. Re-apply the demographic
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

function regionalMultiplier(councilSlug, regionTag) {
  // Northern unitaries demographically aligned with Reform-realigning 2-tier
  // districts get full lift (parity with 1.00 calibration source).
  if (NORTHERN_UNITARY_FULL_LIFT.has(councilSlug)) return 1.00;
  // London: deep Lab/Asian strongholds plus cosmopolitan whites that polling
  // shows are markedly less Reform-leaning than equivalent demographics
  // outside London. Cap at 0.50.
  if (regionTag === "london") return 0.50;
  // Metropolitan boroughs: include both Reform-realigning outer-NW/Yorks
  // wards and deep Lab city-core wards. Polling regional split (NW Reform
  // 27%, Y/H 26%) supports a meaningful lift, but a 1.00 multiplier would
  // push Manchester / Liverpool / inner-Sheffield core wards above
  // empirically-plausible Reform shares. Use 0.75 as a defensible mid-point.
  if (regionTag === "metropolitan") return 0.75;
  // Reform-realigning 2-tier districts already receive the May-2025
  // county anchor and would not normally land here, but if the anchor
  // failed for some reason we still want full lift.
  if (regionTag === "county_district") return 1.00;
  // Southern unitaries / districts in counties that did NOT contest May
  // 2025 (Hampshire, Sussex, Surrey, etc.). Polling shows Reform there
  // ~22% — slightly below the calibration source. Use 0.85.
  return 0.85;
}

/**
 * Apply the realignment uplift to a single ward's prediction.
 *
 * @param {object} prediction — current per-party prediction (from prior steps)
 * @param {object} demo — ward demographics (must include asian_pct, optionally muslim_pct)
 * @param {object} ctx — { councilSlug, regionTag, hasCountyAnchor, enabled }
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
  const target = baseTarget * multiplier;

  const out = { ...prediction };
  if (!out["Reform UK"]) {
    out["Reform UK"] = { pct: 0, votes: 0, win_probability: 0 };
  }
  const before = out["Reform UK"].pct || 0;

  if (target <= before + 1e-6) {
    return { prediction: out, applied: null };
  }

  const lift = target - before;
  out["Reform UK"] = { ...out["Reform UK"], pct: target };

  // Pro-rata reduction across other parties so the prediction sums to ~1.0.
  const others = Object.keys(out).filter((p) => p !== "Reform UK");
  const otherSum = others.reduce((s, p) => s + (out[p].pct || 0), 0);
  if (otherSum > 0) {
    const scale = (1 - target) / otherSum;
    for (const p of others) {
      out[p] = { ...out[p], pct: (out[p].pct || 0) * scale };
    }
  }

  return {
    prediction: out,
    applied: {
      asian_pct: asianPct,
      muslim_pct: muslimPct,
      base_target: baseTarget,
      regional_multiplier: multiplier,
      final_target: target,
      reform_before: before,
      reform_after: target,
      lift,
    },
  };
}

export const _REFORM_TARGET_BY_ASIAN_PCT = REFORM_TARGET_BY_ASIAN_PCT;
export const _NORTHERN_UNITARY_FULL_LIFT = NORTHERN_UNITARY_FULL_LIFT;
