import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ANALYSIS_PATH = path.join(
  process.cwd(),
  "data/predictions/by-elections/makerfield-2026-06-18.analysis.json",
);

const analysis = JSON.parse(readFileSync(ANALYSIS_PATH, "utf8"));

describe("Makerfield by-election analysis dossier", () => {
  it("covers all nine Makerfield wards with demographics + 2024/2026 results", () => {
    expect(analysis.ward_dossier).toHaveLength(9);
    for (const w of analysis.ward_dossier) {
      expect(w.gss).toMatch(/^E0501[45]\d{3}$/);
      expect(w.white_british_pct).toBeGreaterThan(0.9);
      expect(w.imd_decile).toBeGreaterThan(0);
      expect(w.result_2026_council).not.toBeNull();
      expect(w.result_2026_council.winner).toBe("Reform UK");
    }
  });

  it("computes a 4-predictor regression with R² > 0.6 (clear signal in 9 wards)", () => {
    expect(analysis.regression.multiple_regression.r_squared).toBeGreaterThan(0.6);
    expect(analysis.regression.multiple_regression.ward_fits).toHaveLength(9);
  });

  it("identifies degree-share as the dominant single predictor of Reform vote", () => {
    const corrs = analysis.regression.single_predictor_pearson;
    const sorted = Object.entries(corrs).sort(
      (a, b) => Math.abs(b[1]) - Math.abs(a[1]),
    );
    expect(sorted[0][0]).toBe("degree_pct");
    expect(sorted[0][1]).toBeLessThan(-0.7); // strong negative
  });

  it("includes 7+ Lab-Reform comparator seats, of which 3 voted on 1 May 2026", () => {
    expect(analysis.comparators.length).toBeGreaterThanOrEqual(7);
    const withData = analysis.comparators.filter((c) => c.council_2026);
    expect(withData.length).toBe(3);
    // The three with data must be Grimsby/Cleethorpes, Bradford South, Barnsley South
    const slugs = withData.map((c) => c.pcon_slug).sort();
    expect(slugs).toEqual(
      [
        "barnsley-south",
        "bradford-south",
        "great-grimsby-and-cleethorpes",
      ].sort(),
    );
  });

  it("Makerfield's Reform-vs-Lab lead exceeds the comparator average", () => {
    expect(analysis.indicators.makerfield_reform_lead_pp).toBeGreaterThan(
      analysis.indicators.comparator_average_reform_lead_pp,
    );
  });

  it("flags Bryn-with-Ashton-N as a positive residual outlier", () => {
    const bryn = analysis.regression.multiple_regression.ward_fits.find(
      (w) => w.slug === "bryn-with-ashton-in-makerfield-north",
    );
    expect(bryn.residual_pp).toBeGreaterThan(3);
  });
});
