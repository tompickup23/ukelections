import { describe, expect, it } from "vitest";
import { assertFractionalTurnout, mergeHistoryRows } from "../scripts/lib/election-history.mjs";

describe("election-history provenance", () => {
  it("lets a reviewed sidecar correction replace an unreviewed archive row", () => {
    const merged = mergeHistoryRows(
      [{ ballot_paper_id: "local.example.ward.by.2026-05-21", turnout_pct: 34.03 }],
      [{
        ballot_paper_id: "local.example.ward.by.2026-05-21",
        turnout_pct: 0.3403,
        review_status: "auto_ingested_dc",
      }],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].turnout_pct).toBe(0.3403);
  });

  it("preserves a hand-verified declaration over a lower-ranked update", () => {
    const merged = mergeHistoryRows(
      [{
        ballot_paper_id: "local.example.ward.by.2026-05-21",
        turnout_pct: 0.3403,
        review_status: "hand_verified_declaration",
      }],
      [{
        ballot_paper_id: "local.example.ward.by.2026-05-21",
        turnout_pct: 0.34,
        review_status: "auto_ingested_dc",
      }],
    );

    expect(merged[0].turnout_pct).toBe(0.3403);
  });
});

describe("election-history turnout units", () => {
  it("accepts documented turnout fractions", () => {
    expect(() => assertFractionalTurnout([
      { ballot_paper_id: "a", turnout_pct: 0 },
      { ballot_paper_id: "b", turnout_pct: 0.3403 },
      { ballot_paper_id: "c", turnout_pct: 1 },
      { ballot_paper_id: "d", turnout_pct: null },
    ])).not.toThrow();
  });

  it("rejects percentage points before they reach generated copy", () => {
    expect(() => assertFractionalTurnout([
      { ballot_paper_id: "local.fylde.kirkham.by.2026-05-21", turnout_pct: 34.03 },
    ])).toThrow(/local\.fylde\.kirkham\.by\.2026-05-21=34\.03/);
  });
});
