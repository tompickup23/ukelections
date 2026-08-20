import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// The tier multipliers are fitted now, not hand-set, so read the shipped value
// rather than hardcoding one that goes stale the next time they are refitted.
// Metropolitan moved from a hand-set 0.75 to a fitted 1.00 on 21 Aug 2026.
const TIERS = JSON.parse(
  readFileSync(path.join(process.cwd(), "data/calibration/reform-regional-multiplier.json"), "utf8"),
).tiers;
const metropolitan = TIERS.metropolitan.multiplier;
import {
  applyReformRealignmentUplift,
  applyGreenCap,
  applyToryFloor,
} from "../src/lib/reformRealignmentUplift.js";

const baselinePred = () => ({
  Labour: { pct: 0.45, votes: 900 },
  Conservative: { pct: 0.30, votes: 600 },
  "Reform UK": { pct: 0.05, votes: 100 },
  "Liberal Democrats": { pct: 0.15, votes: 300 },
  "Green Party": { pct: 0.05, votes: 100 },
});

describe("applyReformRealignmentUplift", () => {
  it("does nothing when disabled", () => {
    const r = applyReformRealignmentUplift(baselinePred(), { asian_pct: 0.05 }, {
      councilSlug: "blackburn-with-darwen", regionTag: "other", hasCountyAnchor: false, enabled: false,
    });
    expect(r.applied).toBeNull();
  });

  it("does nothing when the ward already has a county anchor", () => {
    const r = applyReformRealignmentUplift(baselinePred(), { asian_pct: 0.02 }, {
      councilSlug: "burnley", regionTag: "county_district", hasCountyAnchor: true, enabled: true,
    });
    expect(r.applied).toBeNull();
  });

  it("does nothing when no demographics are available", () => {
    const r = applyReformRealignmentUplift(baselinePred(), null, {
      councilSlug: "blackburn-with-darwen", regionTag: "other", hasCountyAnchor: false, enabled: true,
    });
    expect(r.applied).toBeNull();
  });

  it("lifts a low-Asian northern unitary to ~36% Reform", () => {
    const r = applyReformRealignmentUplift(baselinePred(), { asian_pct: 0.02 }, {
      councilSlug: "blackburn-with-darwen", regionTag: "other", hasCountyAnchor: false, enabled: true,
    });
    expect(r.applied).not.toBeNull();
    expect(r.prediction["Reform UK"].pct).toBeCloseTo(0.36, 2);
    // sum to ~1
    const sum = Object.values(r.prediction).reduce((s, p) => s + p.pct, 0);
    expect(sum).toBeCloseTo(1.0, 4);
  });

  it("applies zero uplift in London (audit-driven)", () => {
    // Post-7-May audit found the 0.50 London multiplier made the bias
    // worse by 3.43pp on n=218 wards. Tier is now 0.00; the baseline
    // Reform share is preserved.
    const r = applyReformRealignmentUplift(baselinePred(), { asian_pct: 0.05 }, {
      councilSlug: "newham", regionTag: "london", hasCountyAnchor: false, enabled: true,
    });
    // 36% × 0.00 = 0%, target below the 5% baseline, no lift applied.
    expect(r.prediction["Reform UK"].pct).toBeCloseTo(0.05, 4);
    expect(r.applied).toBeNull();
  });

  it("applies the hard plausibility ceiling in a high-Asian ward", () => {
    // High Asian % (>40%) should cap Reform at 15% regardless of upstream.
    const pred = baselinePred();
    pred["Reform UK"].pct = 0.28;
    const r = applyReformRealignmentUplift(pred, { asian_pct: 0.50, muslim_pct: 0.40 }, {
      councilSlug: "tower-hamlets", regionTag: "london", hasCountyAnchor: false, enabled: true,
    });
    expect(r.applied).not.toBeNull();
    expect(r.applied.ceiling_triggered).toBe(true);
    expect(r.prediction["Reform UK"].pct).toBeCloseTo(0.15, 4);
  });

  it("applies the hard plausibility ceiling in a high-degree ward", () => {
    const pred = baselinePred();
    pred["Reform UK"].pct = 0.30;
    const r = applyReformRealignmentUplift(pred, { asian_pct: 0.10, degree_pct: 0.50 }, {
      councilSlug: "oxford", regionTag: "county_district", hasCountyAnchor: false, enabled: true,
    });
    expect(r.applied).not.toBeNull();
    expect(r.applied.ceiling_triggered).toBe(true);
    expect(r.prediction["Reform UK"].pct).toBeCloseTo(0.25, 4);
  });

  it("caps Reform low in high-Asian wards via the calibration curve", () => {
    const r = applyReformRealignmentUplift(baselinePred(), { asian_pct: 0.80 }, {
      councilSlug: "manchester", regionTag: "metropolitan", hasCountyAnchor: false, enabled: true,
    });
    // The 80%-Asian point on the calibration curve is a 12% Reform target,
    // scaled by the metropolitan multiplier. The original 5% prediction is below
    // that, so it lifts to the target and stays capped by the demographic profile.
    expect(r.prediction["Reform UK"].pct).toBeCloseTo(0.12 * metropolitan, 2);
  });

  it("never reduces Reform — applies as upward floor only", () => {
    const pred = baselinePred();
    pred["Reform UK"].pct = 0.55;
    const r = applyReformRealignmentUplift(pred, { asian_pct: 0.02 }, {
      councilSlug: "blackburn-with-darwen", regionTag: "other", hasCountyAnchor: false, enabled: true,
    });
    expect(r.applied).toBeNull();
    expect(r.prediction["Reform UK"].pct).toBeCloseTo(0.55, 4);
  });

  it("northern unitary in NORTHERN_UNITARY_FULL_LIFT gets full 1.00 multiplier", () => {
    const r = applyReformRealignmentUplift(baselinePred(), { asian_pct: 0.02 }, {
      councilSlug: "kingston-upon-hull", regionTag: "other", hasCountyAnchor: false, enabled: true,
    });
    expect(r.prediction["Reform UK"].pct).toBeCloseTo(0.36, 2);
  });

  it("metropolitan boroughs get the fitted multiplier (Manchester floor)", () => {
    const r = applyReformRealignmentUplift(baselinePred(), { asian_pct: 0.02 }, {
      councilSlug: "manchester", regionTag: "metropolitan", hasCountyAnchor: false, enabled: true,
    });
    // 36% target at this demographic point, scaled by the metropolitan multiplier.
    expect(r.prediction["Reform UK"].pct).toBeCloseTo(0.36 * metropolitan, 2);
  });

  it("non-Reform parties scale pro-rata so the ward sums to 1.0", () => {
    const r = applyReformRealignmentUplift(baselinePred(), { asian_pct: 0.02 }, {
      councilSlug: "blackburn-with-darwen", regionTag: "other", hasCountyAnchor: false, enabled: true,
    });
    const sum = Object.values(r.prediction).reduce((s, p) => s + p.pct, 0);
    expect(sum).toBeCloseTo(1.0, 4);
    // Labour-Conservative ratio preserved
    const labCon = r.prediction.Labour.pct / r.prediction.Conservative.pct;
    expect(labCon).toBeCloseTo(0.45 / 0.30, 4);
  });
});

describe("applyGreenCap", () => {
  const baselinePred = () => ({
    Labour: { pct: 0.30 },
    Conservative: { pct: 0.10 },
    "Reform UK": { pct: 0.20 },
    "Green Party": { pct: 0.35 },
    "Liberal Democrats": { pct: 0.05 },
  });

  it("caps Greens at 25% when GE2024 Green share was below 8%", () => {
    const r = applyGreenCap(baselinePred(), { ge2024GreenShare: 0.04 });
    expect(r.applied).not.toBeNull();
    expect(r.prediction["Green Party"].pct).toBeCloseTo(0.25, 4);
    const sum = Object.values(r.prediction).reduce((s, p) => s + p.pct, 0);
    expect(sum).toBeCloseTo(1.0, 4);
  });

  it("leaves Greens alone when GE2024 Green share was already meaningful", () => {
    const r = applyGreenCap(baselinePred(), { ge2024GreenShare: 0.12 });
    expect(r.applied).toBeNull();
    expect(r.prediction["Green Party"].pct).toBeCloseTo(0.35, 4);
  });

  it("leaves Greens alone when predicted share is below the cap", () => {
    const pred = baselinePred();
    pred["Green Party"].pct = 0.18;
    const r = applyGreenCap(pred, { ge2024GreenShare: 0.02 });
    expect(r.applied).toBeNull();
  });
});

describe("applyToryFloor", () => {
  const baselinePred = () => ({
    Labour: { pct: 0.20 },
    Conservative: { pct: 0.25 },
    "Reform UK": { pct: 0.40 },
    "Green Party": { pct: 0.10 },
    "Liberal Democrats": { pct: 0.05 },
  });

  it("halves Tory share against GE2024 baseline when Reform > 30%", () => {
    const r = applyToryFloor(baselinePred(), { ge2024TorySharePcon: 0.30 });
    expect(r.applied).not.toBeNull();
    // 0.30 baseline × 0.5 = 0.15 target
    expect(r.prediction["Conservative"].pct).toBeCloseTo(0.15, 4);
  });

  it("respects the 5% absolute floor", () => {
    const r = applyToryFloor(baselinePred(), { ge2024TorySharePcon: 0.05 });
    // 0.05 × 0.5 = 0.025; floor lifts to 0.05.
    expect(r.applied).not.toBeNull();
    expect(r.prediction["Conservative"].pct).toBeCloseTo(0.05, 4);
  });

  it("does nothing when Reform share is below 30%", () => {
    const pred = baselinePred();
    pred["Reform UK"].pct = 0.20;
    const r = applyToryFloor(pred, { ge2024TorySharePcon: 0.30 });
    expect(r.applied).toBeNull();
  });

  it("70% of the shed Tory share goes to Reform", () => {
    const pred = baselinePred();
    const before = pred["Reform UK"].pct;
    const r = applyToryFloor(pred, { ge2024TorySharePcon: 0.30 });
    const shed = 0.25 - 0.15; // 0.10pp shed
    expect(r.prediction["Reform UK"].pct).toBeCloseTo(before + shed * 0.7, 4);
  });
});
