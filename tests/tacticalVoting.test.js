import { describe, it, expect } from "vitest";
import { applyTacticalVoting } from "../src/lib/tacticalVoting.js";

describe("applyTacticalVoting", () => {
  it("transfers from Green to Labour when Con leads narrowly over Lab", () => {
    const shares = { Conservative: 0.36, Labour: 0.30, "Green Party": 0.10, "Liberal Democrats": 0.05 };
    const r = applyTacticalVoting(shares);
    expect(r.applied).not.toBeNull();
    expect(r.applied.donor).toBe("Green Party");
    expect(r.applied.recipient).toBe("Labour");
    expect(r.shares.Labour).toBeGreaterThan(0.30);
    expect(r.shares["Green Party"]).toBeLessThan(0.10);
  });

  it("transfers from LD to Labour when Reform leads narrowly over Lab", () => {
    const shares = { "Reform UK": 0.36, Labour: 0.30, "Liberal Democrats": 0.10, Conservative: 0.05 };
    const r = applyTacticalVoting(shares);
    expect(r.applied).not.toBeNull();
    expect(r.applied.donor).toBe("Liberal Democrats");
    expect(r.applied.recipient).toBe("Labour");
  });

  it("does not fire when 1st-2nd gap exceeds the competitiveness threshold", () => {
    const shares = { Conservative: 0.55, Labour: 0.20, "Green Party": 0.10 };
    const r = applyTacticalVoting(shares);
    expect(r.applied).toBeNull();
  });

  it("does not fire when 2nd-placed is Conservative or Reform", () => {
    const shares = { Labour: 0.40, Conservative: 0.35, "Green Party": 0.10 };
    const r = applyTacticalVoting(shares);
    expect(r.applied).toBeNull();
  });

  it("does not fire when 3rd-placed is below the tactical floor", () => {
    const shares = { Conservative: 0.40, Labour: 0.35, "Green Party": 0.02 };
    const r = applyTacticalVoting(shares);
    expect(r.applied).toBeNull();
  });

  it("respects custom transferRate", () => {
    const shares = { Conservative: 0.36, Labour: 0.30, "Green Party": 0.10 };
    const r = applyTacticalVoting(shares, { transferRate: 0.5 });
    // Green should drop by 50% of 0.10 = 0.05
    expect(r.shares["Green Party"]).toBeCloseTo(0.05, 3);
    expect(r.shares.Labour).toBeCloseTo(0.35, 3);
  });

  it("returns shape-stable output for shares with <3 parties", () => {
    const shares = { Conservative: 0.55, Labour: 0.45 };
    const r = applyTacticalVoting(shares);
    expect(r.applied).toBeNull();
    expect(r.shares.Conservative).toBe(0.55);
  });
});
