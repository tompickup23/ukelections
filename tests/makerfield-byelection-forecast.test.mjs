import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const FORECAST_PATH = path.join(
  process.cwd(),
  "data/predictions/by-elections/makerfield-2026-06-18.json",
);

const forecast = JSON.parse(readFileSync(FORECAST_PATH, "utf8"));

describe("Makerfield by-election forecast", () => {
  it("targets the correct contest", () => {
    expect(forecast.contest.constituency_slug).toBe("makerfield");
    expect(forecast.contest.pcon24cd).toBe("E14001350");
    expect(forecast.contest.polling_day).toBe("2026-06-18");
    expect(forecast.contest.trigger.departing_mp).toBe("Josh Simons");
  });

  it("produces a probability-weighted central forecast", () => {
    expect(forecast.forecast.winner).toBeDefined();
    expect(forecast.forecast.runner_up).toBeDefined();
    expect(forecast.forecast.margin_pp).toBeGreaterThanOrEqual(0);
    expect(forecast.forecast.classification).toMatch(/toss-up|lean|likely|safe/);
    expect(forecast.forecast.burnham_on_ballot_probability).toBe(0.85);
  });

  it("renormalises central shares to ~1.0", () => {
    const sum = Object.values(forecast.forecast.central_shares).reduce(
      (a, b) => a + b,
      0,
    );
    expect(sum).toBeGreaterThan(0.999);
    expect(sum).toBeLessThan(1.001);
  });

  it("includes both Burnham scenarios with renormalised shares", () => {
    for (const scenario of [
      forecast.scenarios.burnham_stands,
      forecast.scenarios.burnham_withdraws,
    ]) {
      const sum = Object.values(scenario.central).reduce((a, b) => a + b, 0);
      expect(sum).toBeGreaterThan(0.999);
      expect(sum).toBeLessThan(1.001);
      expect(scenario.ranked.length).toBeGreaterThanOrEqual(5);
    }
  });

  it("Burnham scenario favours Labour; non-Burnham favours Reform", () => {
    const a = forecast.scenarios.burnham_stands.central;
    const b = forecast.scenarios.burnham_withdraws.central;
    expect(a["Labour"]).toBeGreaterThan(a["Reform UK"]);
    expect(b["Reform UK"]).toBeGreaterThan(b["Labour"]);
  });

  it("includes the 1 May 2026 ward signal across all nine Makerfield wards", () => {
    expect(forecast.inputs.ward_signal_2026_05_07.ward_count).toBe(9);
    expect(forecast.inputs.ward_signal_2026_05_07.aggregate_shares["Reform UK"]).toBeGreaterThan(
      0.45,
    );
    expect(forecast.inputs.ward_signal_2026_05_07.aggregate_shares["Reform UK"]).toBeGreaterThan(
      forecast.inputs.ward_signal_2026_05_07.aggregate_shares["Labour"],
    );
  });

  it("includes the Survation 14-15 May 2026 poll inputs", () => {
    expect(forecast.inputs.survation_poll_2026_05_15.pollster).toBe("Survation");
    expect(
      forecast.inputs.survation_poll_2026_05_15.scenarios.burnham_stands.shares["Labour"],
    ).toBe(0.45);
    expect(
      forecast.inputs.survation_poll_2026_05_15.scenarios.burnham_withdraws.shares["Reform UK"],
    ).toBe(0.53);
  });

  it("includes a 120-year historical anchor going back to 1983", () => {
    expect(forecast.historical_anchor.makerfield_results.length).toBeGreaterThanOrEqual(11);
    const years = forecast.historical_anchor.makerfield_results.map((r) => r.year);
    expect(Math.min(...years)).toBe(1983);
    expect(Math.max(...years)).toBe(2024);
    // Every GE since 1983 was a Labour win
    for (const r of forecast.historical_anchor.makerfield_results) {
      expect(r.winner).toBe("Labour");
    }
  });

  it("captures all expected parties in the candidate list", () => {
    const parties = forecast.candidates.map((c) => c.party);
    expect(parties).toContain("Labour");
    expect(parties).toContain("Reform UK");
    expect(parties).toContain("Conservative");
    expect(parties).toContain("Green Party");
    expect(parties).toContain("Liberal Democrats");
    expect(parties).toContain("Restore Britain");
  });

  it("exposes a 10-step methodology trace", () => {
    expect(forecast.methodology.length).toBe(10);
    const names = forecast.methodology.map((m) => m.name);
    expect(names).toContain("GE2024 baseline");
    expect(names).toContain("1 May 2026 ward signal");
    expect(names).toContain("Burnham personal-vote uplift (calibration)");
    expect(names).toContain("Probability-weighted blend");
  });
});
