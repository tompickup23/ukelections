import { describe, expect, it } from "vitest";
import { runBacktest } from "../scripts/lib/backtest-runner.mjs";

describe("backtest runner", () => {
  it("computes MAE and winner accuracy", () => {
    const result = runBacktest(
      [
        { prediction_id: "p1", model_version: "m1", contest_id: "c1", party_name: "A", p50: 0.6, win_probability: 0.7 },
        { prediction_id: "p2", model_version: "m1", contest_id: "c1", party_name: "B", p50: 0.4, win_probability: 0.3 }
      ],
      [
        {
          contest_id: "c1",
          turnout_votes: 100,
          result_rows: [
            { party_name: "A", votes: 55, rank: 1 },
            { party_name: "B", votes: 45, rank: 2 }
          ]
        }
      ],
      { generatedAt: "2026-04-18T00:00:00Z" }
    );
    expect(result.contests).toBe(1);
    expect(result.metrics.winner_accuracy).toBe(1);
    expect(result.metrics.mean_absolute_error).toBeCloseTo(0.05);
  });
});
