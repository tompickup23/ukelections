import { describe, it, expect } from "vitest";
import {
  UK_WESTMINSTER_2024_GE_RESULT,
  UK_WESTMINSTER_2026_APRIL_AVERAGE,
  latestUKWestminster,
  ge2024UKBaseline,
  pollingPair,
} from "../src/lib/nationalPolling.js";

function sumShares(shares) {
  return Object.values(shares).reduce((a, b) => a + b, 0);
}

describe("nationalPolling snapshots", () => {
  it("GE2024 shares sum to ~1.0 (within rounding)", () => {
    expect(sumShares(UK_WESTMINSTER_2024_GE_RESULT.shares)).toBeCloseTo(1.0, 1);
  });

  it("Apr 2026 placeholder shares sum to ~1.0", () => {
    expect(sumShares(UK_WESTMINSTER_2026_APRIL_AVERAGE.shares)).toBeCloseTo(1.0, 1);
  });

  it("Apr 2026 snapshot is flagged either draft_placeholder or auto_refreshed", () => {
    // Either state is a valid pre-launch posture: draft_placeholder means
    // refresh-polling.mjs hasn't run yet (and refresh_required_by is set);
    // auto_refreshed means the cron has populated data/polling/override.json.
    const status = UK_WESTMINSTER_2026_APRIL_AVERAGE._meta.review_status;
    expect(["draft_placeholder", "auto_refreshed"]).toContain(status);
    if (status === "draft_placeholder") {
      expect(UK_WESTMINSTER_2026_APRIL_AVERAGE._meta.refresh_required_by).toBe("2026-05-01");
    } else {
      expect(UK_WESTMINSTER_2026_APRIL_AVERAGE._meta.retrieved_at).toMatch(/^\d{4}-\d{2}-\d{2}/);
    }
  });

  it("GE2024 every share between 0 and 1", () => {
    for (const [, v] of Object.entries(UK_WESTMINSTER_2024_GE_RESULT.shares)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("pollingPair returns the correct shape for predictWard", () => {
    const pair = pollingPair();
    expect(pair.nationalPolling).toEqual(latestUKWestminster().shares);
    expect(pair.ge2024Result).toEqual(ge2024UKBaseline().shares);
  });

  it("Reform 2026 share is non-trivial vs 2024 (reflects recent polling movement)", () => {
    // Sanity check that the placeholder reflects the post-2024 polling environment
    // rather than holding GE2024 numbers static.
    expect(UK_WESTMINSTER_2026_APRIL_AVERAGE.shares["Reform UK"])
      .toBeGreaterThan(UK_WESTMINSTER_2024_GE_RESULT.shares["Reform UK"]);
  });
});
