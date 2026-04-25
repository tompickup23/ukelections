import { describe, it, expect } from "vitest";
import { allocateDhondt, allocateDhondtWithIntervals } from "../src/lib/dhondt.js";

describe("allocateDhondt", () => {
  it("classic Wikipedia example: 4 parties / 10 seats / known answer", () => {
    // From en.wikipedia.org/wiki/D%27Hondt_method (worked example)
    const votes = { A: 100, B: 80, C: 30, D: 20 };
    const { allocations } = allocateDhondt(votes, 10);
    expect(allocations).toEqual({ A: 5, B: 4, C: 1, D: 0 });
  });

  it("Senedd-style: 6 seats across 4 parties", () => {
    const votes = { Lab: 35000, Reform: 30000, Con: 18000, Plaid: 12000 };
    const { allocations, sequence } = allocateDhondt(votes, 6);
    const total = Object.values(allocations).reduce((a, b) => a + b, 0);
    expect(total).toBe(6);
    expect(sequence).toHaveLength(6);
  });

  it("Holyrood regional compensation: priorSeats penalises constituency winners", () => {
    // Same first-vote totals, but Lab won 3 constituency seats already
    const votes = { Lab: 50000, SNP: 40000, Con: 30000, Green: 20000 };
    const noPrior = allocateDhondt(votes, 7, {}).allocations;
    const withPrior = allocateDhondt(votes, 7, { priorSeats: { Lab: 3 } }).allocations;
    expect(withPrior.Lab).toBeLessThan(noPrior.Lab);
  });

  it("zero-vote party never wins", () => {
    const { allocations } = allocateDhondt({ A: 100, B: 50, C: 0 }, 5);
    expect(allocations.C).toBe(0);
  });

  it("seats = 0 returns all zero", () => {
    const { allocations } = allocateDhondt({ A: 10, B: 5 }, 0);
    expect(allocations.A).toBe(0);
    expect(allocations.B).toBe(0);
  });
});

describe("allocateDhondtWithIntervals", () => {
  it("dominant party gets high p50, near-1.0 win prob", () => {
    const result = allocateDhondtWithIntervals({
      shares: { Big: 0.55, Small: 0.30, Tiny: 0.15 },
      totalVotes: 100000,
      seats: 6,
      intervalSamples: 200,
      sigma: 0.02,
      seed: 42,
    });
    expect(result.per_party.Big.p50).toBeGreaterThanOrEqual(3);
    expect(result.per_party.Big.win_probability).toBeGreaterThan(0.95);
  });

  it("intervals respect p10 ≤ p50 ≤ p90 ordering", () => {
    const result = allocateDhondtWithIntervals({
      shares: { A: 0.3, B: 0.3, C: 0.25, D: 0.15 },
      seats: 6,
      intervalSamples: 200,
      seed: 7,
    });
    for (const party of Object.keys(result.per_party)) {
      const r = result.per_party[party];
      expect(r.p10).toBeLessThanOrEqual(r.p50);
      expect(r.p50).toBeLessThanOrEqual(r.p90);
    }
  });

  it("deterministic given a fixed seed", () => {
    const a = allocateDhondtWithIntervals({
      shares: { X: 0.4, Y: 0.35, Z: 0.25 },
      seats: 6, intervalSamples: 100, seed: 99,
    });
    const b = allocateDhondtWithIntervals({
      shares: { X: 0.4, Y: 0.35, Z: 0.25 },
      seats: 6, intervalSamples: 100, seed: 99,
    });
    expect(a.per_party).toEqual(b.per_party);
  });
});
