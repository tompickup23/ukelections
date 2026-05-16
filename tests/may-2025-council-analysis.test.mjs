import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const PATH = path.join(
  process.cwd(),
  "data/predictions/historical/may-2025-council-analysis.json",
);

const analysis = JSON.parse(readFileSync(PATH, "utf8"));

describe("1 May 2025 council analysis", () => {
  it("covers 24 councils with usable Reform vote data (Isles of Scilly excluded)", () => {
    expect(analysis.national.councils_analysed).toBe(24);
    expect(analysis.councils.length).toBeGreaterThanOrEqual(24);
  });

  it("sums to 1,400 division/ward seats contested across the 24 councils", () => {
    expect(analysis.national.total_seats_contested).toBe(1400);
  });

  it("identifies 9 Reform UK majority councils", () => {
    expect(analysis.national.reform_majority_councils).toHaveLength(9);
    const slugs = analysis.national.reform_majority_councils.map((c) => c.slug);
    for (const expected of [
      "county-durham",
      "doncaster",
      "kent",
      "lancashire",
      "lincolnshire",
      "nottinghamshire",
      "staffordshire",
      "derbyshire",
      "north-northamptonshire",
    ]) {
      expect(slugs).toContain(expected);
    }
  });

  it("Reform UK is the largest party by both vote share and seats", () => {
    const shares = analysis.national.national_vote_shares;
    const seats = analysis.national.seats_by_party;
    expect(shares["Reform UK"]).toBeGreaterThan(shares["Conservative"]);
    expect(shares["Reform UK"]).toBeGreaterThan(shares["Labour"]);
    expect(seats["Reform UK"]).toBeGreaterThan(seats["Conservative"]);
    expect(seats["Reform UK"]).toBeGreaterThan(seats["Labour"]);
  });

  it("regression R² > 0.7 (strong demographic signal)", () => {
    expect(analysis.indicators.multiple_regression.r_squared).toBeGreaterThan(0.7);
  });

  it("no-quals % is the dominant single predictor (r > +0.85)", () => {
    const corrs = analysis.indicators.single_predictor_pearson;
    expect(corrs.no_quals).toBeGreaterThan(0.85);
    expect(corrs.degree).toBeLessThan(-0.85);
  });

  it("Staffordshire is the top campaign-over-performer vs demographics", () => {
    const top = analysis.national.reform_overperformers_vs_demographics[0];
    expect(top.slug).toBe("staffordshire");
    expect(top.residual_pp).toBeGreaterThan(4);
  });

  it("Doncaster is the top campaign-under-performer (Lab mayor incumbency effect)", () => {
    const bottom = analysis.national.reform_underperformers_vs_demographics[0];
    expect(bottom.slug).toBe("doncaster");
    expect(bottom.residual_pp).toBeLessThan(-5);
  });

  it("regional breakdown covers at least 6 English regions", () => {
    expect(Object.keys(analysis.regional).length).toBeGreaterThanOrEqual(6);
    for (const r of Object.values(analysis.regional)) {
      expect(r.total_seats).toBeGreaterThan(0);
    }
  });
});
