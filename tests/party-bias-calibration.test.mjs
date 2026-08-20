import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { applyPartyBias, calibrationApplies } from "../src/lib/partyBiasCalibration.js";

const calibration = JSON.parse(
  readFileSync(path.join(process.cwd(), "data/calibration/party-bias.json"), "utf8"),
);

describe("party bias calibration guard", () => {
  it("refuses the election it was fitted on, however the group id is spelled", () => {
    // The first version compared `local.2026-05-07` to `local.adur.2026-05-07`
    // by string equality, matched nothing, and corrected 2,600 May 2026 wards
    // with a May 2026 fit. That is self-scoring, and it looked like a success.
    expect(calibrationApplies(calibration, "local.adur.2026-05-07")).toBe(false);
    expect(calibrationApplies(calibration, "local.2026-05-07")).toBe(false);
    expect(calibrationApplies(calibration, "mayor.doncaster.2026-05-07")).toBe(false);
  });

  it("applies to a different election", () => {
    expect(calibrationApplies(calibration, "local.burnley.2027-05-06")).toBe(true);
  });

  it("declines when there is no calibration at all", () => {
    expect(calibrationApplies(null, "local.burnley.2027-05-06")).toBe(false);
    expect(calibrationApplies({}, "local.burnley.2027-05-06")).toBe(false);
  });
});

describe("party bias correction", () => {
  const bias = { Labour: 0.06, "Green Party": -0.07 };

  it("subtracts the offset and renormalises to one", () => {
    const { prediction, applied } = applyPartyBias(
      { Labour: { pct: 0.4 }, "Green Party": { pct: 0.2 }, "Reform UK": { pct: 0.4 } },
      bias,
    );
    expect(applied).toBe(true);
    const total = Object.values(prediction).reduce((s, p) => s + p.pct, 0);
    expect(total).toBeCloseTo(1, 10);
    // Labour down, Greens up, Reform untouched before renormalisation.
    expect(prediction.Labour.pct).toBeLessThan(0.4);
    expect(prediction["Green Party"].pct).toBeGreaterThan(0.2);
  });

  it("never drives a share below zero", () => {
    const { prediction } = applyPartyBias({ Labour: { pct: 0.01 }, "Reform UK": { pct: 0.99 } }, bias);
    expect(prediction.Labour.pct).toBe(0);
    expect(prediction["Reform UK"].pct).toBeCloseTo(1, 10);
  });

  it("preserves everything else on the payload", () => {
    const { prediction } = applyPartyBias({ Labour: { pct: 0.4, votes: 900, ci: [0.3, 0.5] } }, bias);
    expect(prediction.Labour.votes).toBe(900);
    expect(prediction.Labour.ci).toEqual([0.3, 0.5]);
  });
});

describe("the shipped calibration", () => {
  it("carries a held-out validation that actually improved the held-out folds", () => {
    const v = calibration.validation;
    expect(v.folds).toBeGreaterThanOrEqual(3);
    expect(v.mean_winner_delta_pp).toBeGreaterThan(0);
    expect(v.mean_mae_delta_pp).toBeLessThan(0);
    // Every fold, not just the average: one good fold carrying four bad ones
    // would mean the offset is not a constant.
    for (const fold of v.per_fold) expect(fold.mae_delta_pp).toBeLessThan(0);
  });

  it("is stable enough across folds to be a constant rather than a fit", () => {
    for (const [, stat] of Object.entries(calibration.validation.stability)) {
      expect(stat.sd_pp).toBeLessThan(1.5);
    }
  });
});
