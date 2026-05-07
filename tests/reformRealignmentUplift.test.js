import { describe, it, expect } from "vitest";
import { applyReformRealignmentUplift } from "../src/lib/reformRealignmentUplift.js";

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

  it("dampens the lift in London", () => {
    const r = applyReformRealignmentUplift(baselinePred(), { asian_pct: 0.05 }, {
      councilSlug: "newham", regionTag: "london", hasCountyAnchor: false, enabled: true,
    });
    // 36% × 0.50 = 18%
    expect(r.prediction["Reform UK"].pct).toBeCloseTo(0.18, 2);
  });

  it("caps Reform low in high-Asian wards via the calibration curve", () => {
    const r = applyReformRealignmentUplift(baselinePred(), { asian_pct: 0.80 }, {
      councilSlug: "manchester", regionTag: "metropolitan", hasCountyAnchor: false, enabled: true,
    });
    // 12% × 0.75 metropolitan = 9% — but the original 5% Reform pred is below
    // that, so target lifts to 9% (still capped by demographic profile).
    expect(r.prediction["Reform UK"].pct).toBeCloseTo(0.09, 2);
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

  it("metropolitan boroughs get 0.75 multiplier (Manchester floor)", () => {
    const r = applyReformRealignmentUplift(baselinePred(), { asian_pct: 0.02 }, {
      councilSlug: "manchester", regionTag: "metropolitan", hasCountyAnchor: false, enabled: true,
    });
    // 36% × 0.75 = 27%
    expect(r.prediction["Reform UK"].pct).toBeCloseTo(0.27, 2);
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
