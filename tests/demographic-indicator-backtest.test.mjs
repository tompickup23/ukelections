import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const PATH = path.join(
  process.cwd(),
  "data/predictions/historical/demographic-indicator-backtest.json",
);

const data = JSON.parse(readFileSync(PATH, "utf8"));

describe("Demographic indicator backtest 2025 → 2026", () => {
  it("covers 24+ councils in 2025 and 130+ councils in 2026", () => {
    expect(data.summary.n_councils_2025).toBeGreaterThanOrEqual(24);
    expect(data.summary.n_councils_2026).toBeGreaterThanOrEqual(130);
  });

  it("Reform UK degree-share correlation is the most stable in the set", () => {
    const r2025 = data.per_party["Reform UK"].regression_2025.single_predictor_pearson.degree;
    const r2026 = data.per_party["Reform UK"].regression_2026.single_predictor_pearson.degree;
    expect(r2025).toBeLessThan(-0.85);
    expect(r2026).toBeLessThan(-0.85);
    expect(Math.abs(r2025 - r2026)).toBeLessThan(0.1);
  });

  it("Reform UK regression R² > 0.8 in both years", () => {
    expect(data.per_party["Reform UK"].regression_2025.r_squared).toBeGreaterThan(0.8);
    expect(data.per_party["Reform UK"].regression_2026.r_squared).toBeGreaterThan(0.8);
  });

  it("Reform UK predictive backtest beats Conservative on Pearson r", () => {
    const reformR = data.predictive_backtest_2025_to_2026["Reform UK"].correlation;
    const conR = data.predictive_backtest_2025_to_2026["Conservative"].correlation;
    expect(reformR).toBeGreaterThan(conR);
  });

  it("Labour's no-quals correlation collapsed between 2025 and 2026", () => {
    const r2025 = data.per_party["Labour"].regression_2025.single_predictor_pearson.no_quals;
    const r2026 = data.per_party["Labour"].regression_2026.single_predictor_pearson.no_quals;
    expect(r2025).toBeGreaterThan(0.7);
    expect(r2026).toBeLessThan(0.3);
  });

  it("Labour's degree correlation flipped sign between 2025 and 2026", () => {
    const r2025 = data.per_party["Labour"].regression_2025.single_predictor_pearson.degree;
    const r2026 = data.per_party["Labour"].regression_2026.single_predictor_pearson.degree;
    expect(r2025).toBeLessThan(0);
    expect(r2026).toBeGreaterThan(0);
  });

  it("Conservative regression has low R² in both years (low demographic predictability)", () => {
    expect(data.per_party["Conservative"].regression_2025.r_squared).toBeLessThan(0.5);
    expect(data.per_party["Conservative"].regression_2026.r_squared).toBeLessThan(0.5);
  });

  it("best single indicator per party covers all 5 parties", () => {
    for (const party of ["Reform UK", "Labour", "Conservative", "Liberal Democrats", "Green Party"]) {
      expect(data.best_indicator_per_party[party]).toBeDefined();
      expect(data.best_indicator_per_party[party].predictor).toBeDefined();
    }
  });

  it("Reform UK's best single predictor is degree-share, negative", () => {
    const b = data.best_indicator_per_party["Reform UK"];
    expect(b.predictor).toBe("degree");
    expect(b.direction).toBe("negative");
    expect(b.pearson_r).toBeLessThan(-0.8);
  });

  it("IMD is the best single predictor for both Labour and Conservative in 2026", () => {
    expect(data.best_indicator_per_party["Labour"].predictor).toBe("imd");
    expect(data.best_indicator_per_party["Conservative"].predictor).toBe("imd");
    // Opposite signs — class axis
    expect(data.best_indicator_per_party["Labour"].pearson_r).toBeLessThan(0);
    expect(data.best_indicator_per_party["Conservative"].pearson_r).toBeGreaterThan(0);
  });
});
