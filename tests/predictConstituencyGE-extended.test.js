import { describe, it, expect } from "vitest";
import { predictConstituencyGE } from "../src/lib/electionModel.js";

const baseConstituency = {
  name: "Test PCON",
  ge2024: {
    results: [
      { party: "Labour", pct: 0.40 },
      { party: "Conservative", pct: 0.30 },
      { party: "Reform UK", pct: 0.15 },
      { party: "Liberal Democrats", pct: 0.10 },
      { party: "Green Party", pct: 0.05 },
    ],
  },
};

const polling = {
  aggregate: { Labour: 0.20, Conservative: 0.20, "Reform UK": 0.30, "Liberal Democrats": 0.15, "Green Party": 0.15 },
  ge2024_baseline: { Labour: 0.34, Conservative: 0.24, "Reform UK": 0.14, "Liberal Democrats": 0.12, "Green Party": 0.07 },
};

describe("predictConstituencyGE — extended composition", () => {
  it("STM mode produces shares that sum to 1.0", () => {
    const r = predictConstituencyGE(baseConstituency, polling, {}, { useSTM: true });
    const total = Object.values(r.prediction).reduce((s, v) => s + (v.pct || 0), 0);
    expect(total).toBeCloseTo(1.0, 2);
  });

  it("STM produces non-zero share for declining parties in their strong seats", () => {
    const r = predictConstituencyGE(baseConstituency, polling, {}, { useSTM: true });
    expect(r.prediction.Labour.pct).toBeGreaterThan(0);
  });

  it("BES prior blend pulls shares toward the prior", () => {
    const besPrior = { region: "test", shares: { Labour: 0.10, Conservative: 0.10, "Reform UK": 0.50, "Liberal Democrats": 0.20, "Green Party": 0.10 } };
    const baseline = predictConstituencyGE(baseConstituency, polling, {}, { useSTM: true });
    const withPrior = predictConstituencyGE(baseConstituency, polling, {}, { useSTM: true, besPrior, besPriorWeight: 0.5 });
    // Reform should be higher with the prior pulling that direction
    expect(withPrior.prediction["Reform UK"].pct).toBeGreaterThan(baseline.prediction["Reform UK"].pct);
  });

  it("incumbency layer adds personal vote to a long-tenure incumbent", () => {
    const mp = { party: "Labour", tenure_years: 25, status: "standing_again" };
    const baseline = predictConstituencyGE(baseConstituency, polling, {}, { useSTM: true });
    const withMp = predictConstituencyGE(baseConstituency, polling, {}, { useSTM: true, mp });
    // After normalisation, Labour should be higher with the incumbency bump
    expect(withMp.prediction.Labour.pct).toBeGreaterThan(baseline.prediction.Labour.pct);
  });

  it("by-election overlay shifts prediction toward the by-election shares", () => {
    const byShares = { "Reform UK": 0.50, Labour: 0.30, Conservative: 0.20 };
    const baseline = predictConstituencyGE(baseConstituency, polling, {}, { useSTM: true });
    const withBy = predictConstituencyGE(baseConstituency, polling, {}, { useSTM: true, byElectionShares: byShares, byElectionWeight: 0.5 });
    expect(withBy.prediction["Reform UK"].pct).toBeGreaterThan(baseline.prediction["Reform UK"].pct);
  });

  it("includes a methodology trace with at least the STM step", () => {
    const r = predictConstituencyGE(baseConstituency, polling, {}, { useSTM: true });
    const stepNames = r.methodology.map((m) => m.name);
    expect(stepNames).toContain("National Swing (Strong Transition Model)");
  });

  it("legacy UNS path is preserved (default useSTM=false)", () => {
    const r = predictConstituencyGE(baseConstituency, polling, {});
    const stepNames = r.methodology.map((m) => m.name);
    expect(stepNames.some((n) => n.includes("National Swing"))).toBe(true);
  });

  it("returns a confidence label", () => {
    const r = predictConstituencyGE(baseConstituency, polling, {}, { useSTM: true });
    expect(["low", "medium", "high"]).toContain(r.confidence);
  });
});
