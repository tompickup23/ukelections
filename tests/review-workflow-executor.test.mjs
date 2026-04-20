import { describe, expect, it } from "vitest";
import { buildReviewWorkflowExecution } from "../scripts/lib/review-workflow-executor.mjs";

describe("review workflow executor", () => {
  it("marks area evidence coverage from fetched source targets", () => {
    const execution = buildReviewWorkflowExecution({
      workflows: {
        source_targets: [{ target_id: "t1" }, { target_id: "t2" }],
        areas: [{
          area_code: "E05000000",
          area_name: "Example Ward",
          model_family: "local_fptp_borough",
          priority: "P1",
          workflow_code: "repair_winner_signal",
          action_code: "vote_share_only_limited",
          source_targets: ["t1", "t2"],
          promotion_gate: "Strong elected-party backtest required."
        }]
      },
      sourceSnapshots: [{
        target_id: "t1",
        snapshot_id: "snapshot-1",
        raw_file_path: "/tmp/t1.html"
      }],
      fetchResults: [
        { target_id: "t1", ok: true },
        { target_id: "t2", ok: false, error: "404" }
      ],
      generatedAt: "2026-04-20T00:00:00Z"
    });

    expect(execution.fetched_source_targets).toBe(1);
    expect(execution.failed_source_targets).toBe(1);
    expect(execution.areas[0].source_evidence_status).toBe("partial_targets_fetched");
    expect(execution.areas[0].source_targets[1].error).toBe("404");
    expect(execution.areas[0].promotion_status).toBe("not_ready");
  });
});
