import { describe, expect, it } from "vitest";
import { reformSlateFractions, slateStep } from "../scripts/score-london-v2-2026-11.mjs";

const cand = (party_name) => ({ party_name });

describe("Reform slate step", () => {
  it("measures Reform's slate as candidates over seats, capped at 1", () => {
    const f = reformSlateFractions([
      { ballot_paper_id: "local.a.x.2026-05-07", winner_count: 3, candidates: [cand("Reform UK"), cand("Reform UK"), cand("Labour Party")] },
      { ballot_paper_id: "local.a.y.2026-05-07", winner_count: 1, candidates: [cand("Reform UK"), cand("Reform UK")] },
      { ballot_paper_id: "mayor.a.2026-05-07", winner_count: 1, candidates: [cand("Reform UK")] },
    ]);
    expect(f["local.a.x.2026-05-07"]).toBeCloseTo(2 / 3, 10);
    expect(f["local.a.y.2026-05-07"]).toBe(1);
    expect(f["mayor.a.2026-05-07"]).toBeUndefined();
  });

  it("scales Reform only where Step 9b lifted it, and keeps shares summing to 1", () => {
    const pre = { w1: { shares: { "Reform UK": 0.1, Labour: 0.9 } }, w2: { shares: { "Reform UK": 0.3, Labour: 0.7 } } };
    const lifted = { w1: { shares: { "Reform UK": 0.3, Labour: 0.7 } }, w2: { shares: { "Reform UK": 0.3, Labour: 0.7 } } };
    const { stage, changed } = slateStep(pre, lifted, { w1: 0.5, w2: 0.5 });
    expect(changed).toBe(1);
    expect(stage.w1.shares["Reform UK"]).toBeCloseTo(0.15, 10);
    expect(stage.w1.shares.Labour).toBeCloseTo(0.85, 10);
    expect(stage.w2).toBe(lifted.w2);
  });
});

import { mergeDuplicateRows } from "../scripts/score-london-v3-2026-11.mjs";

describe("duplicate poll rows", () => {
  it("merges one pollster's overlapping rows with the same sample, and keeps others apart", () => {
    const rows = [
      { pollster: "S", sample: 1006, fieldwork_start_day: "15", fieldwork_end: "2025-12-21", shares: { Labour: 0.31 } },
      { pollster: "S", sample: 1006, fieldwork_start_day: "17", fieldwork_end: "2025-12-23", shares: { Labour: 0.3 } },
      { pollster: "S", sample: 1242, fieldwork_start_day: "30", fieldwork_end: "2025-11-07", shares: { Labour: 0.32 } },
    ];
    const m = mergeDuplicateRows(rows);
    expect(m).toHaveLength(2);
    expect(m[0].merged_rows).toBe(2);
    expect(m[0].shares.Labour).toBeCloseTo(0.305, 10);
  });
});
