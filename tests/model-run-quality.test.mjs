import { describe, expect, it } from "vitest";
import { validateModelRun } from "../scripts/lib/model-run-quality.mjs";

const run = {
  model_run_id: "run-1",
  model_family: "local_fptp_borough",
  model_version: "model.local.1",
  generated_at: "2026-04-18T00:00:00Z",
  code_revision: "abc123",
  source_snapshot_ids: ["source-1"],
  poll_aggregate_ids: ["polls-1"],
  feature_snapshot_ids: ["features-1"],
  candidate_roster_ids: ["roster-1"],
  boundary_version_ids: ["boundary-1"],
  assumptions: { dampening: 0.65 },
  review_status: "reviewed",
  publication_status: "published"
};

describe("model run validation", () => {
  it("accepts a reviewed published run", () => {
    expect(validateModelRun(run).ok).toBe(true);
  });

  it("rejects published runs that have not been reviewed", () => {
    const result = validateModelRun({ ...run, review_status: "quarantined" });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("published model runs must be reviewed");
  });
});
