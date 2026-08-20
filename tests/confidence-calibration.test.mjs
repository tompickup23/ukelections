import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { calibratedConfidence, confidenceApplies, predictedMargin } from "../src/lib/confidenceCalibration.js";

const calibration = JSON.parse(
  readFileSync(path.join(process.cwd(), "data/calibration/confidence.json"), "utf8"),
);

describe("confidence calibration guard", () => {
  it("refuses the election it was fitted on", () => {
    expect(confidenceApplies(calibration, "local.adur.2026-05-07")).toBe(false);
    expect(confidenceApplies(calibration, "mayor.doncaster.2026-05-07")).toBe(false);
  });
  it("applies to a later election", () => {
    expect(confidenceApplies(calibration, "local.burnley.2027-05-06")).toBe(true);
  });
});

describe("margin and band", () => {
  it("measures the gap between first and second, not first and last", () => {
    const m = predictedMargin({ A: { pct: 0.5 }, B: { pct: 0.3 }, C: { pct: 0.2 } });
    expect(m).toBeCloseTo(0.2, 10);
  });

  it("returns nothing for an uncontested ward", () => {
    expect(predictedMargin({ A: { pct: 1 } })).toBeNull();
    expect(calibratedConfidence({ A: { pct: 1 } }, calibration)).toBeNull();
  });

  it("quotes a higher probability for a wider margin", () => {
    const tight = calibratedConfidence({ A: { pct: 0.36 }, B: { pct: 0.35 } }, calibration);
    const wide = calibratedConfidence({ A: { pct: 0.6 }, B: { pct: 0.2 } }, calibration);
    expect(tight.winner_probability).toBeLessThan(wide.winner_probability);
    expect(["low", "medium"]).toContain(tight.band);
    expect(wide.band).toBe("high");
  });
});

describe("the shipped curve", () => {
  it("rises monotonically, so a wider margin never means less confidence", () => {
    const probs = calibration.bins.map((b) => b.winner_probability);
    for (let i = 1; i < probs.length; i += 1) expect(probs[i]).toBeGreaterThanOrEqual(probs[i - 1]);
  });

  it("beats quoting a flat base rate on held-out councils", () => {
    // Brier, not calibration error: the flat baseline wins on calibration error
    // simply by having one coarse bucket, which is not a virtue.
    expect(calibration.validation.mean_brier).toBeLessThan(calibration.validation.mean_flat_baseline_brier);
  });

  it("records what it replaced, including that the old label ranked backwards", () => {
    const legacy = calibration.replaces.measured;
    expect(legacy.high.winner_accuracy_pct).toBeLessThan(legacy.medium.winner_accuracy_pct);
  });
});
