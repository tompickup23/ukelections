import { describe, it, expect } from "vitest";
import { applyStrongTransitionSwing } from "../src/lib/strongTransitionSwing.js";

describe("applyStrongTransitionSwing", () => {
  it("returns identity when no national change", () => {
    const local = { Lab: 0.4, Con: 0.4, LD: 0.2 };
    const r = applyStrongTransitionSwing(local, { Lab: 0.4, Con: 0.4, LD: 0.2 }, { Lab: 0.4, Con: 0.4, LD: 0.2 });
    expect(r.shares.Lab).toBeCloseTo(0.4, 6);
    expect(r.shares.Con).toBeCloseTo(0.4, 6);
    expect(r.shares.LD).toBeCloseTo(0.2, 6);
  });

  it("never produces negative share for a heavily-falling party in its weak seat", () => {
    // Con falls 30pp nationally; in a seat where they had only 5%, additive UNS
    // would make them -25%; STM should bound at >=0.
    const local = { Lab: 0.6, Con: 0.05, LD: 0.35 };
    const past = { Lab: 0.4, Con: 0.45, LD: 0.15 };
    const now = { Lab: 0.55, Con: 0.15, LD: 0.30 };
    const r = applyStrongTransitionSwing(local, now, past);
    expect(r.shares.Con).toBeGreaterThanOrEqual(0);
    expect(r.shares.Lab).toBeGreaterThan(0);
    expect(r.shares.LD).toBeGreaterThan(0);
  });

  it("preserves total share approximately", () => {
    const local = { Lab: 0.4, Con: 0.4, LD: 0.2 };
    const past = { Lab: 0.4, Con: 0.4, LD: 0.2 };
    const now = { Lab: 0.5, Con: 0.3, LD: 0.2 };
    const r = applyStrongTransitionSwing(local, now, past);
    const total = Object.values(r.shares).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(1.0, 4);
  });

  it("dampening scales down the swing", () => {
    const local = { Lab: 0.4, Con: 0.4, LD: 0.2 };
    const past = { Lab: 0.4, Con: 0.4, LD: 0.2 };
    const now = { Lab: 0.5, Con: 0.3, LD: 0.2 };
    const full = applyStrongTransitionSwing(local, now, past, { dampening: 1.0 });
    const half = applyStrongTransitionSwing(local, now, past, { dampening: 0.5 });
    // Half-dampening should produce a smaller change in Lab
    const fullDelta = Math.abs(full.shares.Lab - 0.4);
    const halfDelta = Math.abs(half.shares.Lab - 0.4);
    expect(halfDelta).toBeLessThan(fullDelta);
  });

  it("losers shed proportionally to their LOCAL share, not absolute", () => {
    // Con falls from 40% to 30% nationally (lose 25% of vote multiplicatively)
    const past = { Lab: 0.5, Con: 0.4, LD: 0.1 };
    const now = { Lab: 0.6, Con: 0.3, LD: 0.1 };
    // In a strong-Con seat (60%), Con should fall by ~15% (60% × 25% = 15pp)
    const strong = applyStrongTransitionSwing({ Lab: 0.3, Con: 0.6, LD: 0.1 }, now, past);
    expect(strong.shares.Con).toBeCloseTo(0.6 - 0.15, 1);
    // In a weak-Con seat (10%), Con should fall by ~2.5% (10% × 25% = 2.5pp)
    const weak = applyStrongTransitionSwing({ Lab: 0.7, Con: 0.1, LD: 0.2 }, now, past);
    expect(weak.shares.Con).toBeCloseTo(0.1 - 0.025, 1);
  });

  it("handles parties that were absent from the baseline", () => {
    const local = { Lab: 0.5, Con: 0.5 };
    const past = { Lab: 0.5, Con: 0.5 };
    const now = { Lab: 0.4, Con: 0.4, "Reform UK": 0.2 };
    const r = applyStrongTransitionSwing(local, now, past);
    // Total should still be ~1.0
    const total = Object.values(r.shares).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(1.0, 1);
  });
});
