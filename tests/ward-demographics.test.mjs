import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Guards the tracked ward demographics table.
//
// On 14 August 2026 scripts/aggregate-lsoa-to-ward-demographics.py ran on
// vps-main without .cache/census, skipped every input table with a printed
// note, aggregated zero wards, and wrote the empty result over a file holding
// 8,732. The by-election cron's unscoped commit then put it on main, where it
// sat for nine days. Nothing failed, because computeWardDemographicAdjustments()
// returns an empty adjustment for a ward it does not know, so every ward
// prediction quietly lost its demographic layer instead.
//
// The script now refuses to write an empty or halved table. This is the second
// line: if the file on main is ever gutted again, the suite goes red the same
// day rather than nine days later.

const doc = JSON.parse(
  readFileSync(path.join(process.cwd(), "data/features/ward-demographics-2021.json"), "utf8"),
);

describe("ward demographics table", () => {
  it("holds a table, not an empty shell", () => {
    const wards = doc.wards || {};
    expect(Object.keys(wards).length).toBeGreaterThan(5000);
  });

  it("agrees with its own summary", () => {
    expect(doc.summary.ward_count_total).toBe(Object.keys(doc.wards).length);
    expect(doc.summary.identity_target_wards_covered).toBeLessThanOrEqual(doc.summary.identity_target_wards);
    expect(doc.summary.coverage_pct_of_identity).toBeGreaterThanOrEqual(0);
    expect(doc.summary.coverage_pct_of_identity).toBeLessThanOrEqual(100);
  });

  it("still covers most of the wards the model asks about", () => {
    // The layer is worthless if it does not reach the wards being predicted.
    expect(doc.summary.coverage_pct_of_identity).toBeGreaterThan(50);
  });

  it("carries real proportions, not placeholders", () => {
    const entries = Object.entries(doc.wards);
    const sample = entries.slice(0, 200);
    for (const [gss, w] of sample) {
      expect(gss, "ward keys are GSS codes").toMatch(/^[ESWN]\d{8}$/);
      for (const key of ["white_british_pct", "no_quals_pct", "degree_pct", "social_rented_pct"]) {
        if (typeof w[key] !== "number") continue;
        expect(w[key], `${gss}.${key}`).toBeGreaterThanOrEqual(0);
        expect(w[key], `${gss}.${key}`).toBeLessThanOrEqual(1);
      }
      if (typeof w.avg_imd_decile === "number") {
        expect(w.avg_imd_decile).toBeGreaterThanOrEqual(1);
        expect(w.avg_imd_decile).toBeLessThanOrEqual(10);
      }
    }
    // Not every ward can be identical, which is what a placeholder fill looks like.
    const distinct = new Set(sample.map(([, w]) => w.white_british_pct));
    expect(distinct.size).toBeGreaterThan(20);
  });
});
