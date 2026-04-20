import { describe, expect, it } from "vitest";
import { auditLocalDataBundle } from "../scripts/lib/local-data-auditor.mjs";

describe("local data auditor", () => {
  it("flags weak source lineage, limited backtests, and readiness tasks", () => {
    const audit = auditLocalDataBundle({
      sourceSnapshots: [{
        snapshot_id: "s1",
        source_name: "AI DOGE Example election history",
        quality_status: "quarantined",
        upstream_data_sources: ["DCLEAPIL v1.0"]
      }],
      boundaries: [{
        boundary_version_id: "b1",
        area_code: "E05000000",
        area_name: "Example Ward",
        source_snapshot_id: "s1",
        review_status: "reviewed"
      }],
      history: [{
        history_id: "h1",
        contest_id: "c1",
        area_code: "E05000000",
        area_name: "Example Ward",
        election_date: "2024-05-02",
        election_type: "borough",
        source_snapshot_id: "s1",
        review_status: "quarantined",
        turnout_votes: 0,
        upstream: {
          source_area_code: "E05099999",
          area_code_method: "manual_name_match"
        },
        result_rows: []
      }],
      featureSnapshots: [{
        area_code: "E05000000",
        area_name: "Example Ward",
        model_family: "local_fptp_borough",
        features: {
          election_context: {
            contested_at_next_election: true,
            next_election_date: "2026-05-07"
          },
          population_projection: {
            quality_level: "proxy",
            geography_fit: "local_authority_proxy",
            confidence: "low",
            source_depth: "authority_total_only"
          },
          asylum_context: {
            precision: "local_authority_context",
            route_scope: "asylum_support"
          }
        }
      }],
      backtests: [{
        backtest_id: "bt1",
        area_code: "E05000000",
        area_name: "Example Ward",
        model_family: "local_fptp_borough",
        status: "passed",
        history_records: 1,
        required_history_records: 1,
        pass_reason: "cold_start_vote_share_only",
        evidence_tier: "weak",
        publication_gate: "review_required",
        metrics: {
          contests: 1,
          elected_party_hit_rate: 0,
          mean_absolute_error: 0.12
        }
      }],
      readiness: [{
        model_area_id: "r1",
        area_code: "E05000000",
        area_name: "Example Ward",
        model_family: "local_fptp_borough",
        publication_status: "review",
        review_status: "reviewed_with_warnings",
        source_gates: {
          backtest: {
            publication_gate: "review_required"
          }
        },
        methodology: {
          backtest_pass_reason: "cold_start_vote_share_only",
          backtest_evidence_tier: "weak"
        },
        readiness_tasks: ["Backtest pass is limited and needs manual review before publication."],
        blockers: [],
        coverage: {
          history_records: 1,
          raw_history_records: 1,
          quarantined_history_records: 0
        }
      }],
      generatedAt: "2026-04-20T00:00:00Z"
    });

    expect(audit.summary.history_records).toBe(1);
    expect(audit.sources.by_family.dcleapil_leap_democracy_club).toBe(1);
    expect(audit.backtests.review_required_passes).toBe(1);
    expect(audit.readiness.limited_backtest_areas).toBe(1);
    expect(audit.review_actions.total).toBe(1);
    expect(audit.review_actions.by_action_code.vote_share_only_limited).toBe(1);
    expect(audit.review_actions.areas[0].action).toContain("winner/elected-party calibration");
    expect(audit.issues.map((row) => row.code)).toContain("history_source_area_code_mismatch");
    expect(audit.issues.map((row) => row.code)).toContain("backtest_review_required_pass");
    expect(audit.issues.map((row) => row.code)).toContain("active_contest_without_roster");
  });
});
