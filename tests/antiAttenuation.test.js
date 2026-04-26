import { describe, it, expect } from "vitest";
import { applyAntiAttenuation, computeHistoricSigmas } from "../src/lib/antiAttenuation.js";

describe("computeHistoricSigmas", () => {
  it("returns per-party SD across constituencies", () => {
    const results = [
      { shares: { Lab: 0.5, Con: 0.3, LD: 0.2 } },
      { shares: { Lab: 0.4, Con: 0.4, LD: 0.2 } },
      { shares: { Lab: 0.6, Con: 0.2, LD: 0.2 } },
      { shares: { Lab: 0.3, Con: 0.5, LD: 0.2 } },
    ];
    const sigmas = computeHistoricSigmas(results);
    expect(sigmas.Lab).toBeGreaterThan(0);
    expect(sigmas.Con).toBeGreaterThan(0);
    expect(sigmas.LD).toBeCloseTo(0, 4); // LD constant at 0.2
  });
});

describe("applyAntiAttenuation", () => {
  it("expands an over-shrunk distribution to match historic spread", () => {
    // Predictions are tightly clustered around the mean
    const predictions = [
      { shares: { Lab: 0.50, Con: 0.30, LD: 0.20 } },
      { shares: { Lab: 0.49, Con: 0.31, LD: 0.20 } },
      { shares: { Lab: 0.51, Con: 0.29, LD: 0.20 } },
      { shares: { Lab: 0.48, Con: 0.32, LD: 0.20 } },
    ];
    // Historic distribution has much more spread
    const historicSigmas = { Lab: 0.10, Con: 0.10, LD: 0.05 };
    const r = applyAntiAttenuation(predictions, historicSigmas);
    // The output sigma should exceed the input sigma
    expect(r.stats.sigmasAfter.Lab).toBeGreaterThan(r.stats.sigmasBefore.Lab);
    // Gamma should be > 1
    expect(r.gammas.Lab).toBeGreaterThan(1);
  });

  it("does not amplify a party with a degenerate target sigma", () => {
    const predictions = [
      { shares: { Lab: 0.50, Con: 0.50 } },
      { shares: { Lab: 0.40, Con: 0.60 } },
    ];
    const historicSigmas = { Lab: 0, Con: 0 }; // degenerate
    const r = applyAntiAttenuation(predictions, historicSigmas);
    expect(r.gammas.Lab).toBe(1); // no rescale
    expect(r.gammas.Con).toBe(1);
  });

  it("re-normalises so each prediction sums to ~1.0", () => {
    const predictions = [
      { shares: { Lab: 0.50, Con: 0.30, LD: 0.20 } },
      { shares: { Lab: 0.40, Con: 0.40, LD: 0.20 } },
    ];
    const r = applyAntiAttenuation(predictions, { Lab: 0.15, Con: 0.15, LD: 0.05 });
    for (const p of r.adjusted) {
      const total = Object.values(p.shares).reduce((s, v) => s + v, 0);
      expect(total).toBeCloseTo(1.0, 5);
    }
  });

  it("clips gamma to [0.5, 2.5]", () => {
    const predictions = [
      { shares: { Lab: 0.50, Con: 0.50 } },
      { shares: { Lab: 0.51, Con: 0.49 } }, // tiny spread
    ];
    // Massive historic sigma — would naively give gamma >> 2.5
    const r = applyAntiAttenuation(predictions, { Lab: 0.5, Con: 0.5 });
    expect(r.gammas.Lab).toBeLessThanOrEqual(2.5);
  });
});
