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

    expect(result[0].metrics.winner_accuracy).toBe(1);
    expect(result[0].metrics.elected_party_hit_rate).toBe(1);
    expect(result[0].status).toBe("passed");
  });

  it("merges duplicate contest ids before evaluating sequential history", () => {
    const history = [
      {
        history_id: "h1a",
        area_code: "E05000000",
        election_date: "2022-05-05",
        contest_id: "c1",
        turnout_votes: 100,
        result_rows: [
          { party_name: "A", votes: 60, rank: 1, elected: true },
          { party_name: "B", votes: 40, rank: 2, elected: false }
        ]
      },
      {
        history_id: "h1b",
        area_code: "E05000000",
        election_date: "2022-05-05",
        contest_id: "c1",
        turnout_votes: 100,
        result_rows: [
          { party_name: "A", votes: 80, rank: 1, elected: true },
          { party_name: "B", votes: 20, rank: 2, elected: false }
        ]
      },
      {
        history_id: "h2",
        area_code: "E05000000",
        election_date: "2023-05-04",
        contest_id: "c2",
        turnout_votes: 100,
        result_rows: [
          { party_name: "A", votes: 58, rank: 1, elected: true },
          { party_name: "B", votes: 42, rank: 2, elected: false }
        ]
      },
      {
        history_id: "h3",
        area_code: "E05000000",
        election_date: "2024-05-02",
        contest_id: "c3",
        turnout_votes: 100,
        result_rows: [
          { party_name: "A", votes: 57, rank: 1, elected: true },
          { party_name: "B", votes: 43, rank: 2, elected: false }
        ]
      }
    ];

    const result = buildBaselineBacktests({
      history,
      featureSnapshots: [{ area_code: "E05000000", area_name: "Example Ward", model_family: "local_fptp_borough" }],
      generatedAt: "2026-04-19T00:00:00Z"
    });

    expect(result[0].history_records).toBe(3);
    expect(result[0].source_history_ids).toEqual(["h1a", "h1b", "h2", "h3"]);
    expect(result[0].metrics.contests).toBe(2);
    expect(result[0].status).toBe("passed");
  });

  it("excludes quarantined historical rows from backtest evidence", () => {
    const history = [
      {
        history_id: "h0",
        area_code: "E05000000",
        election_date: "2021-05-06",
        contest_id: "c0",
        review_status: "quarantined",
        turnout_votes: 100,
        result_rows: [
          { party_name: "B", votes: 80, rank: 1, elected: true },
          { party_name: "A", votes: 20, rank: 2, elected: false }
        ]
      },
      {
        history_id: "h1",
        area_code: "E05000000",
        election_date: "2022-05-05",
        contest_id: "c1",
        review_status: "reviewed_with_warnings",
        turnout_votes: 100,
        result_rows: [
          { party_name: "A", votes: 60, rank: 1, elected: true },
          { party_name: "B", votes: 40, rank: 2, elected: false }
        ]
      },
      {
        history_id: "h2",
        area_code: "E05000000",
        election_date: "2023-05-04",
        contest_id: "c2",
        review_status: "reviewed_with_warnings",
        turnout_votes: 100,
        result_rows: [
          { party_name: "A", votes: 58, rank: 1, elected: true },
          { party_name: "B", votes: 42, rank: 2, elected: false }
        ]
      }
    ];

    const result = buildBaselineBacktests({
      history,
      featureSnapshots: [{ area_code: "E05000000", area_name: "Example Ward", model_family: "local_fptp_borough" }],
      generatedAt: "2026-04-19T00:00:00Z"
    });

    expect(result[0].history_records).toBe(2);
    expect(result[0].source_history_ids).toEqual(["h1", "h2"]);
  });

  it("calibrates against same-election swing from other areas without using the target result", () => {
    const target = [
      ["t1", "2022-05-05", 60, 40, 0],
      ["t2", "2023-05-04", 58, 42, 0],
      ["t3", "2024-05-02", 30, 30, 40]
    ].map(([history_id, election_date, aVotes, bVotes, cVotes], index) => ({
      history_id,
      area_code: "E05000000",
      election_date,
      contest_id: `target-${index + 1}`,
      turnout_votes: 100,
      result_rows: [
        { party_name: "A", votes: aVotes, rank: cVotes > aVotes ? 2 : 1, elected: cVotes < aVotes },
        { party_name: "B", votes: bVotes, rank: 2, elected: false },
        { party_name: "C", votes: cVotes, rank: cVotes > aVotes ? 1 : 3, elected: cVotes > aVotes }
      ].filter((row) => row.votes > 0)
    }));
    const comparator = [
      ["c1", "2022-05-05", 60, 40, 0],
      ["c2", "2023-05-04", 58, 42, 0],
      ["c3", "2024-05-02", 30, 30, 40]
    ].map(([history_id, election_date, aVotes, bVotes, cVotes], index) => ({
      history_id,
      area_code: "E05000001",
      election_date,
      contest_id: `comparator-${index + 1}`,
      turnout_votes: 100,
      result_rows: [
        { party_name: "A", votes: aVotes, rank: cVotes > aVotes ? 2 : 1, elected: cVotes < aVotes },
        { party_name: "B", votes: bVotes, rank: 2, elected: false },
        { party_name: "C", votes: cVotes, rank: cVotes > aVotes ? 1 : 3, elected: cVotes > aVotes }
      ].filter((row) => row.votes > 0)
    }));

    const result = buildBaselineBacktests({
      history: [...target, ...comparator],
      featureSnapshots: [
        { area_code: "E05000000", area_name: "Target Ward", model_family: "local_fptp_borough" },
        { area_code: "E05000001", area_name: "Comparator Ward", model_family: "local_fptp_borough" }
      ],
      generatedAt: "2026-04-19T00:00:00Z"
    });

    const targetBacktest = result.find((row) => row.area_code === "E05000000");
    expect(targetBacktest.method).toBe("rolling_two_contest_party_share_average_with_preferred_same_council_leave_one_area_out_swing");
    expect(targetBacktest.metrics.mean_calibration_area_count).toBe(1);
    expect(targetBacktest.metrics.elected_party_hit_rate).toBe(1);
    expect(targetBacktest.status).toBe("passed");
  });

  it("restricts calibrated predictions to parties standing in the target contest", () => {
    const history = [
      {
        history_id: "target-1",
        area_code: "E05000000",
        election_date: "2022-05-05",
        contest_id: "target-1",
        turnout_votes: 100,
        result_rows: [
          { party_name: "A", votes: 60, rank: 1, elected: true },
          { party_name: "B", votes: 40, rank: 2, elected: false }
        ]
      },
      {
        history_id: "target-2",
        area_code: "E05000000",
        election_date: "2023-05-04",
        contest_id: "target-2",
        turnout_votes: 100,
        result_rows: [
          { party_name: "A", votes: 58, rank: 1, elected: true },
          { party_name: "B", votes: 42, rank: 2, elected: false }
        ]
      },
      {
        history_id: "target-3",
        area_code: "E05000000",
        election_date: "2024-05-02",
        contest_id: "target-3",
        turnout_votes: 100,
        result_rows: [
          { party_name: "A", votes: 80, rank: 1, elected: true },
          { party_name: "B", votes: 20, rank: 2, elected: false }
        ]
      },
      {
        history_id: "comparator-1",
        area_code: "E05000001",
        election_date: "2022-05-05",
        contest_id: "comparator-1",
        turnout_votes: 100,
        result_rows: [
          { party_name: "A", votes: 60, rank: 1, elected: true },
          { party_name: "B", votes: 40, rank: 2, elected: false }
        ]
      },
      {
        history_id: "comparator-2",
        area_code: "E05000001",
        election_date: "2023-05-04",
        contest_id: "comparator-2",
        turnout_votes: 100,
        result_rows: [
          { party_name: "A", votes: 58, rank: 1, elected: true },
          { party_name: "B", votes: 42, rank: 2, elected: false }
        ]
      },
      {
        history_id: "comparator-3",
        area_code: "E05000001",
        election_date: "2024-05-02",
        contest_id: "comparator-3",
        turnout_votes: 100,
        result_rows: [
          { party_name: "C", votes: 90, rank: 1, elected: true },
          { party_name: "A", votes: 10, rank: 2, elected: false }
        ]
      }
    ];

    const result = buildBaselineBacktests({
      history,
      featureSnapshots: [
        { area_code: "E05000000", area_name: "Target Ward", model_family: "local_fptp_borough" },
        { area_code: "E05000001", area_name: "Comparator Ward", model_family: "local_fptp_borough" }
      ],
      generatedAt: "2026-04-19T00:00:00Z"
    });

    expect(result.find((row) => row.area_code === "E05000000").status).toBe("passed");
  });

  it("marks single-contest cold-start passes as limited review-required evidence", () => {
    const history = [
      {
        history_id: "target-1",
        area_code: "E05000000",
        election_date: "2024-05-02",
        contest_id: "target-1",
        turnout_votes: 100,
        result_rows: [
          { party_name: "A", votes: 60, rank: 1, elected: true },
          { party_name: "B", votes: 40, rank: 2, elected: false }
        ]
      },
      {
        history_id: "comparator-1",
        area_code: "E05000001",
        election_date: "2024-05-02",
        contest_id: "comparator-1",
        turnout_votes: 100,
        result_rows: [
          { party_name: "A", votes: 62, rank: 1, elected: true },
          { party_name: "B", votes: 38, rank: 2, elected: false }
        ]
      }
    ];

    const result = buildBaselineBacktests({
      history,
      featureSnapshots: [
        { area_code: "E05000000", area_name: "Target Ward", model_family: "local_fptp_borough" },
        { area_code: "E05000001", area_name: "Comparator Ward", model_family: "local_fptp_borough" }
      ],
      generatedAt: "2026-04-19T00:00:00Z"
    });

    const targetBacktest = result.find((row) => row.area_code === "E05000000");
    expect(targetBacktest.status).toBe("passed");
    expect(targetBacktest.pass_reason).toBe("single_contest_elected_party_hit");
    expect(targetBacktest.evidence_tier).toBe("limited");
    expect(targetBacktest.publication_gate).toBe("review_required");
  });

  it("prefers same-council comparators for cold-start local election backtests", () => {
    const makeRecord = ({ history_id, area_code, partyAVotes, partyCVotes, council }) => ({
      history_id,
      area_code,
      election_date: "2024-05-02",
      contest_id: history_id,
      turnout_votes: partyAVotes + partyCVotes,
      upstream: { council },
      result_rows: [
        { party_name: "A", votes: partyAVotes, rank: partyAVotes > partyCVotes ? 1 : 2, elected: partyAVotes > partyCVotes },
        { party_name: "C", votes: partyCVotes, rank: partyCVotes > partyAVotes ? 1 : 2, elected: partyCVotes > partyAVotes }
      ]
    });
    const history = [
      makeRecord({ history_id: "target", area_code: "E05000000", partyAVotes: 30, partyCVotes: 70, council: "Local Borough" }),
      makeRecord({ history_id: "local-1", area_code: "E05000001", partyAVotes: 25, partyCVotes: 75, council: "Local Borough" }),
      makeRecord({ history_id: "local-2", area_code: "E05000002", partyAVotes: 35, partyCVotes: 65, council: "Local Borough" }),
      makeRecord({ history_id: "local-3", area_code: "E05000003", partyAVotes: 30, partyCVotes: 70, council: "Local Borough" }),
      makeRecord({ history_id: "distant-1", area_code: "E05000004", partyAVotes: 90, partyCVotes: 10, council: "Distant Borough" }),
      makeRecord({ history_id: "distant-2", area_code: "E05000005", partyAVotes: 90, partyCVotes: 10, council: "Distant Borough" }),
      makeRecord({ history_id: "distant-3", area_code: "E05000006", partyAVotes: 90, partyCVotes: 10, council: "Distant Borough" })
    ];

    const result = buildBaselineBacktests({
      history,
      featureSnapshots: history.map((record) => ({
        area_code: record.area_code,
        area_name: record.area_code,
        model_family: "local_fptp_borough"
      })),
      generatedAt: "2026-04-19T00:00:00Z"
    });

    const targetBacktest = result.find((row) => row.area_code === "E05000000");
    expect(targetBacktest.metrics.calibration_scope_counts).toEqual({ local_authority: 1 });
    expect(targetBacktest.metrics.elected_party_hit_rate).toBe(1);
    expect(targetBacktest.status).toBe("passed");
  });

  it("review-gates local competitive-party hits instead of failing useful same-council calibration", () => {
    const history = [
      {
        history_id: "target-1",
        area_code: "E05000000",
        election_date: "2023-05-04",
        contest_id: "target-1",
        turnout_votes: 100,
        upstream: { council: "Example Borough" },
        result_rows: [
          { party_name: "A", votes: 60, rank: 1, elected: true },
          { party_name: "B", votes: 40, rank: 2, elected: false }
        ]
      },
      {
        history_id: "target-2",
        area_code: "E05000000",
        election_date: "2024-05-02",
        contest_id: "target-2",
        turnout_votes: 100,
        upstream: { council: "Example Borough" },
        result_rows: [
          { party_name: "B", votes: 55, rank: 1, elected: true },
          { party_name: "A", votes: 45, rank: 2, elected: false }
        ]
      },
      ...["E05000001", "E05000002", "E05000003"].flatMap((areaCode, index) => [
        {
          history_id: `local-${index}-1`,
          area_code: areaCode,
          election_date: "2023-05-04",
          contest_id: `local-${index}-1`,
          turnout_votes: 100,
          upstream: { council: "Example Borough" },
          result_rows: [
            { party_name: "A", votes: 60, rank: 1, elected: true },
            { party_name: "B", votes: 40, rank: 2, elected: false }
          ]
        },
        {
          history_id: `local-${index}-2`,
          area_code: areaCode,
          election_date: "2024-05-02",
          contest_id: `local-${index}-2`,
          turnout_votes: 100,
          upstream: { council: "Example Borough" },
          result_rows: [
            { party_name: "A", votes: 60, rank: 1, elected: true },
            { party_name: "B", votes: 40, rank: 2, elected: false }
          ]
        }
      ])
    ];

    const result = buildBaselineBacktests({
      history,
      featureSnapshots: [...new Set(history.map((record) => record.area_code))].map((areaCode) => ({
        area_code: areaCode,
        area_name: areaCode,
        model_family: "local_fptp_borough"
      })),
      generatedAt: "2026-04-19T00:00:00Z"
    });

    const targetBacktest = result.find((row) => row.area_code === "E05000000");
    expect(targetBacktest.status).toBe("passed");
    expect(targetBacktest.pass_reason).toBe("local_competitive_party_hit_rate");
    expect(targetBacktest.evidence_tier).toBe("limited");
    expect(targetBacktest.publication_gate).toBe("review_required");
  });

  it("review-gates local vote-share-only passes when winner calibration is absent", () => {
    const history = [
      {
        history_id: "target-1",
        area_code: "E05000000",
        election_date: "2023-05-04",
        contest_id: "target-1",
        turnout_votes: 100,
        upstream: { council: "Example Borough" },
        result_rows: [
          { party_name: "A", votes: 60, rank: 1, elected: true },
          { party_name: "B", votes: 25, rank: 2, elected: false },
          { party_name: "C", votes: 15, rank: 3, elected: false }
        ]
      },
      {
        history_id: "target-2",
        area_code: "E05000000",
        election_date: "2024-05-02",
        contest_id: "target-2",
        turnout_votes: 100,
        upstream: { council: "Example Borough" },
        result_rows: [
          { party_name: "C", votes: 40, rank: 1, elected: true },
          { party_name: "B", votes: 35, rank: 2, elected: false },
          { party_name: "A", votes: 25, rank: 3, elected: false }
        ]
      },
      {
        history_id: "local-1",
        area_code: "E05000001",
        election_date: "2023-05-04",
        contest_id: "local-1",
        turnout_votes: 100,
        upstream: { council: "Example Borough" },
        result_rows: [
          { party_name: "A", votes: 60, rank: 1, elected: true },
          { party_name: "B", votes: 25, rank: 2, elected: false },
          { party_name: "C", votes: 15, rank: 3, elected: false }
        ]
      },
      {
        history_id: "local-2",
        area_code: "E05000001",
        election_date: "2024-05-02",
        contest_id: "local-2",
        turnout_votes: 100,
        upstream: { council: "Example Borough" },
        result_rows: [
          { party_name: "A", votes: 41, rank: 1, elected: true },
          { party_name: "B", votes: 34, rank: 2, elected: false },
          { party_name: "C", votes: 25, rank: 3, elected: false }
        ]
      },
      {
        history_id: "local-3",
        area_code: "E05000002",
        election_date: "2023-05-04",
        contest_id: "local-3",
        turnout_votes: 100,
        upstream: { council: "Example Borough" },
        result_rows: [
          { party_name: "A", votes: 60, rank: 1, elected: true },
          { party_name: "B", votes: 25, rank: 2, elected: false },
          { party_name: "C", votes: 15, rank: 3, elected: false }
        ]
      },
      {
        history_id: "local-4",
        area_code: "E05000002",
        election_date: "2024-05-02",
        contest_id: "local-4",
        turnout_votes: 100,
        upstream: { council: "Example Borough" },
        result_rows: [
          { party_name: "A", votes: 41, rank: 1, elected: true },
          { party_name: "B", votes: 34, rank: 2, elected: false },
          { party_name: "C", votes: 25, rank: 3, elected: false }
        ]
      },
      {
        history_id: "local-5",
        area_code: "E05000003",
        election_date: "2023-05-04",
        contest_id: "local-5",
        turnout_votes: 100,
        upstream: { council: "Example Borough" },
        result_rows: [
          { party_name: "A", votes: 60, rank: 1, elected: true },
          { party_name: "B", votes: 25, rank: 2, elected: false },
          { party_name: "C", votes: 15, rank: 3, elected: false }
        ]
      },
      {
        history_id: "local-6",
        area_code: "E05000003",
        election_date: "2024-05-02",
        contest_id: "local-6",
        turnout_votes: 100,
        upstream: { council: "Example Borough" },
        result_rows: [
          { party_name: "A", votes: 41, rank: 1, elected: true },
          { party_name: "B", votes: 34, rank: 2, elected: false },
          { party_name: "C", votes: 25, rank: 3, elected: false }
        ]
      }
    ];

    const result = buildBaselineBacktests({
      history,
      featureSnapshots: [
        { area_code: "E05000000", area_name: "Target Ward", model_family: "local_fptp_borough" },
        { area_code: "E05000001", area_name: "Comparator Ward", model_family: "local_fptp_borough" },
        { area_code: "E05000002", area_name: "Comparator Ward 2", model_family: "local_fptp_borough" },
        { area_code: "E05000003", area_name: "Comparator Ward 3", model_family: "local_fptp_borough" }
      ],
      generatedAt: "2026-04-19T00:00:00Z"
    });

    const targetBacktest = result.find((row) => row.area_code === "E05000000");
    expect(targetBacktest.status).toBe("passed");
    expect(targetBacktest.pass_reason).toBe("local_vote_share_only");
    expect(targetBacktest.evidence_tier).toBe("limited");
    expect(targetBacktest.publication_gate).toBe("review_required");
  });
});
