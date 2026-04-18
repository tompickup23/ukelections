import { describe, expect, it } from "vitest";
import { getAreaTrendSummary, loadAreaSeries } from "../src/lib/area-series";

describe("area series helpers", () => {
  it("loads the live area series dataset", () => {
    const points = loadAreaSeries();

    expect(points.length).toBeGreaterThan(10000);
    expect(points[0]).toHaveProperty("areaCode");
    expect(points[0]).toHaveProperty("periodEnd");
    expect(points[0]).toHaveProperty("value");
  });

  it("builds an official quarterly trend summary with current and previous deltas", () => {
    const summary = getAreaTrendSummary("E08000025");

    expect(summary).not.toBeNull();
    expect(summary?.areaName).toBe("Birmingham");
    expect(summary?.points.length).toBeGreaterThan(40);
    expect(summary?.latestValue).toBe(2637);
    expect(summary?.deltaFromPrevious).toBe(-195);
    expect(summary?.changePctFromPrevious).toBe(-6.9);
    expect(summary?.officialAnchorCount).toBe(summary?.points.length);
    expect(summary?.hasIllustrativeData).toBe(false);
  });

  it("returns null when a place has no trend series", () => {
    expect(getAreaTrendSummary("NO_SERIES")).toBeNull();
  });
});
