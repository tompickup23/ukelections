import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  geWinProbabilityApplies,
  leaderWinProbability,
  shareIntervals,
  simulateSeatRanges,
  normalQuantile,
  inHundred,
} from "../src/lib/geWinProbability.js";
import { assertUncalibrated } from "../scripts/calibrate-ge-win-probability.mjs";

const readJson = (rel) => JSON.parse(readFileSync(path.join(process.cwd(), rel), "utf8"));
const calibration = readJson("data/calibration/ge-win-probability.json");

describe("GE win probability guard", () => {
  it("refuses the 2024 general election by date", () => {
    expect(geWinProbabilityApplies(calibration, { electionDate: "parl.2024-07-04" })).toBe(false);
    expect(geWinProbabilityApplies(calibration, { electionDate: "2024-07-04" })).toBe(false);
  });
  it("refuses a forecast built on polling from the 2024 campaign", () => {
    expect(geWinProbabilityApplies(calibration, { pollingLatest: "2024-05-01" })).toBe(false);
    expect(geWinProbabilityApplies(calibration, { pollingLatest: "2024-07-04" })).toBe(false);
  });
  it("applies to current polling", () => {
    expect(geWinProbabilityApplies(calibration, { pollingLatest: "2026-10-26" })).toBe(true);
  });
  it("refuses an empty calibration", () => {
    expect(geWinProbabilityApplies({}, { pollingLatest: "2026-10-26" })).toBe(false);
  });
});

describe("the fitted curve", () => {
  it("records its date, n and a reliability table", () => {
    expect(calibration.fitted_on_date).toBe("2024-07-04");
    expect(calibration.n).toBeGreaterThanOrEqual(600);
    expect(calibration.reliability.reduce((s, r) => s + r.seats, 0)).toBe(calibration.n);
  });
  it("never quotes a lower probability for a wider margin", () => {
    const ps = calibration.bins.map((b) => b.winner_probability);
    for (let i = 1; i < ps.length; i += 1) expect(ps[i]).toBeGreaterThanOrEqual(ps[i - 1]);
  });
  it("beats a flat rate on held-out Brier", () => {
    expect(calibration.validation.brier).toBeLessThan(calibration.validation.flat_baseline_brier);
  });
  it("reads the margin between first and second", () => {
    const wp = leaderWinProbability({ A: { pct: 0.4 }, B: { pct: 0.39 }, C: { pct: 0.21 } }, calibration);
    expect(wp.margin_pp).toBeCloseTo(1, 6);
    expect(wp.win_probability).toBe(calibration.bins[0].winner_probability);
  });
});

describe("the fitter refuses calibrated input", () => {
  it("throws on rows that already carry a probability", () => {
    expect(() => assertUncalibrated([{ slug: "x", predicted: { A: 0.5 }, win_probability: 0.7 }])).toThrow(/already carries/);
    expect(() => assertUncalibrated([{ slug: "x", predicted: { A: { pct: 0.5, p10: 0.4 } } }])).toThrow(/already carry/);
    expect(() => assertUncalibrated([{ slug: "x", predicted: { A: 0.5 } }])).not.toThrow();
  });
});

describe("share intervals and seat ranges", () => {
  it("brackets each contender's share and leaves trace parties out", () => {
    const iv = shareIntervals({ A: { pct: 0.45 }, B: { pct: 0.4 }, C: { pct: 0.145 }, D: { pct: 0.005 } }, calibration);
    expect(iv.A.p10).toBeLessThan(0.45);
    expect(iv.A.p90).toBeGreaterThan(0.45);
    expect(iv.D).toBeUndefined();
  });
  it("keeps each seat's own probability under correlation", () => {
    const seats = Array.from({ length: 200 }, () => ({ winner: "A", runner_up: "B", win_probability: 0.7 }));
    for (const rho of [0, 0.3, 0.9]) {
      const sim = simulateSeatRanges(seats, { draws: 4000, seed: 7, rho });
      expect(sim.by_party.A.mean / 200).toBeCloseTo(0.7, 1);
    }
  });
  it("widens the national range as seats move together", () => {
    const seats = Array.from({ length: 300 }, () => ({ winner: "A", runner_up: "B", win_probability: 0.6 }));
    const width = (rho) => {
      const r = simulateSeatRanges(seats, { draws: 3000, seed: 3, rho }).by_party.A;
      return r.p95 - r.p05;
    };
    expect(width(0.3)).toBeGreaterThan(width(0) * 2);
  });
  it("normalQuantile inverts the normal CDF", () => {
    expect(normalQuantile(0.5)).toBeCloseTo(0, 8);
    expect(normalQuantile(0.975)).toBeCloseTo(1.959964, 5);
    expect(normalQuantile(0.01)).toBeCloseTo(-2.326348, 5);
  });
  it("speaks in hundreds", () => {
    expect(inHundred(0.537)).toBe("54 in 100");
  });
});

describe("the published forecast carries its uncertainty", () => {
  const ge = readJson("data/predictions/ge-next/constituencies.json");
  const summary = readJson("data/predictions/ge-next/summary.json");
  it("puts a win probability and intervals on every predicted seat", () => {
    const seats = Object.values(ge.predictions).filter((p) => p?.prediction);
    expect(seats.length).toBe(650);
    for (const p of seats) {
      expect(p.win_probability).toBeGreaterThan(0);
      expect(p.win_probability).toBeLessThanOrEqual(1);
      expect(p.share_intervals?.[p.winner]).toBeTruthy();
    }
  });
  it("states the seat-range method and draw count", () => {
    expect(summary.seat_ranges.draws).toBeGreaterThanOrEqual(1000);
    expect(summary.seat_ranges.method).toMatch(/win probability/);
    const lab = summary.seat_ranges.by_party.Labour;
    expect(lab.p05).toBeLessThanOrEqual(lab.p50);
    expect(lab.p50).toBeLessThanOrEqual(lab.p95);
  });
});
