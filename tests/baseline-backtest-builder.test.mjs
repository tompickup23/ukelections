import { describe, expect, it } from "vitest";
import { buildBaselineBacktests } from "../scripts/lib/baseline-backtest-builder.mjs";

describe("baseline backtest builder", () => {
  it("passes areas where previous contest persistence clears thresholds", () => {
    const history = [
      {
        history_id: "h1",
        area_code: "E05000000",
        election_date: "2022-05-05",
        contest_id: "c1",
        turnout_votes: 100,
        result_rows: [
          { party_name: "A", votes: 60, rank: 1 },
          { party_name: "B", votes: 40, rank: 2 }
        ]
      },
      {
        history_id: "h2",
        area_code: "E05000000",
        election_date: "2023-05-04",
        contest_id: "c2",
        turnout_votes: 100,
        result_rows: [
          { party_name: "A", votes: 58, rank: 1 },
          { party_name: "B", votes: 42, rank: 2 }
        ]
      },
      {
        history_id: "h3",
        area_code: "E05000000",
        election_date: "2024-05-02",
        contest_id: "c3",
        turnout_votes: 100,
        result_rows: [
          { party_name: "A", votes: 57, rank: 1 },
          { party_name: "B", votes: 43, rank: 2 }
        ]
      }
    ];

    const result = buildBaselineBacktests({
      history,
      featureSnapshots: [{ area_code: "E05000000", area_name: "Example Ward", model_family: "local_fptp_borough" }],
      generatedAt: "2026-04-19T00:00:00Z"
    });

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("passed");
    expect(result[0].metrics.winner_accuracy).toBe(1);
    expect(result[0].metrics.elected_party_hit_rate).toBe(1);
    expect(result[0].source_history_ids).toEqual(["h1", "h2", "h3"]);
  });

  it("uses elected-party hit rate for multi-member contests", () => {
    const history = [
      {
        history_id: "h1",
        area_code: "E05000000",
        election_date: "2022-05-05",
        contest_id: "c1",
        turnout_votes: 300,
        result_rows: [
          { party_name: "A", votes: 110, rank: 1, elected: true },
          { party_name: "A", votes: 100, rank: 2, elected: true },
          { party_name: "B", votes: 90, rank: 3, elected: false }
        ]
      },
      {
        history_id: "h2",
        area_code: "E05000000",
        election_date: "2023-05-04",
        contest_id: "c2",
        turnout_votes: 300,
        result_rows: [
          { party_name: "B", votes: 105, rank: 1, elected: true },
          { party_name: "A", votes: 100, rank: 2, elected: true },
          { party_name: "A", votes: 95, rank: 3, elected: false }
        ]
      },
      {
        history_id: "h3",
        area_code: "E05000000",
        election_date: "2024-05-02",
        contest_id: "c3",
        turnout_votes: 300,
        result_rows: [
          { party_name: "B", votes: 106, rank: 1, elected: true },
          { party_name: "A", votes: 101, rank: 2, elected: true },
          { party_name: "A", votes: 93, rank: 3, elected: false }
        ]
      }
    ];

    const result = buildBaselineBacktests({
      history,
      featureSnapshots: [{ area_code: "E05000000", area_name: "Example Ward", model_family: "local_fptp_borough" }],
      generatedAt: "2026-04-19T00:00:00Z"
    });

    expect(result[0].metrics.winner_accuracy).toBe(0);
    expect(result[0].metrics.elected_party_hit_rate).toBe(1);
    expect(result[0].status).toBe("passed");
  });
});
