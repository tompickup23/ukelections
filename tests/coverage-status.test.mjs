import { describe, expect, it } from "vitest";
import { buildCoverageStatus } from "../scripts/lib/coverage-status.mjs";

describe("coverage status", () => {
  it("summarises completed councils, model areas, constituencies, and draft rows", () => {
    const status = buildCoverageStatus({
      generatedAt: "2026-04-21T00:00:00Z",
      boundaries: [
        { area_code: "E1", upstream: { council_name: "A Council" } },
        { area_code: "E2", upstream: { council_name: "A Council" } },
        { area_code: "E3", upstream: { council_name: "B Council" } }
      ],
      readiness: [
        {
          area_code: "E1",
          model_family: "local_fptp_borough",
          publication_status: "publishable",
          source_gates: { backtest: { status: "reviewed" } }
        },
        {
          area_code: "E2",
          model_family: "local_fptp_borough",
          publication_status: "review",
          source_gates: { backtest: { status: "accepted" } }
        },
        {
          area_code: "E3",
          model_family: "local_fptp_unitary",
          publication_status: "publishable",
          source_gates: { backtest: { status: "reviewed" } }
        },
        {
          area_code: "W1",
          model_family: "westminster_constituency",
          publication_status: "review",
          source_gates: {}
        }
      ],
      drafts: {
        structured: { total_areas: 3, drafted_records: 2, failed_records: 1 }
      }
    });

    expect(status.model_area_coverage).toMatchObject({
      total_model_areas: 4,
      completed_model_areas: 2,
      remaining_model_areas: 2
    });
    expect(status.council_coverage).toMatchObject({
      total_councils: 2,
      completed_councils: 1,
      remaining_councils: 1
    });
    expect(status.constituency_coverage).toMatchObject({
      total_constituency_model_areas_loaded: 1,
      completed_constituency_model_areas: 0,
      remaining_constituency_model_areas_loaded: 1
    });
    expect(status.draft_review_transcriptions.total_drafted_records).toBe(2);
    expect(status.readiness_gate_statuses.backtest).toEqual({ reviewed: 2, accepted: 1 });
  });
});
