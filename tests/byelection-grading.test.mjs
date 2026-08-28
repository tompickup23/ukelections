import { describe, expect, it } from "vitest";
import { gradeAgainst } from "../scripts/lib/local-byelection-model.mjs";

// A contest file is rebuilt every night and a past contest's projection keeps
// moving as older by-elections are ingested into the swing corpus, so grading a
// result against the current rebuild produces a record that changes underneath
// itself. These tests pin the fix: where we hold a snapshot of what the page
// actually said before the poll, that is what gets graded.
//
// The fixture is built so it MUST fire. The snapshot and the rebuild disagree on
// the winner and on the error, so a grader that quietly used the rebuild would
// report call_correct true where the truth is false. A test where both agree
// would pass whatever the code did and would prove nothing.

const field = new Set(["Reform UK", "Labour", "Green Party"]);
const actual = { "Reform UK": 0.5, Labour: 0.37, "Green Party": 0.13 };

// What the page said before the poll: Labour ahead, and wrong.
const snapshot = {
  captured_at: "2026-08-26",
  central_pct: { "Reform UK": 30.0, Labour: 45.0, "Green Party": 25.0 },
};

// What tonight's rebuild says, with hindsight baked into the corpus: Reform
// ahead, and right.
const rebuild = {
  winner: "Reform UK",
  central: { "Reform UK": 0.5, Labour: 0.37, "Green Party": 0.13 },
};

describe("grading a by-election against the forecast as published", () => {
  it("uses the snapshot, not the rebuild, when a snapshot exists", () => {
    const g = gradeAgainst(snapshot, rebuild, actual, field, "Reform UK");
    expect(g.graded_against).toBe("forecast_as_published");
    expect(g.published_captured_at).toBe("2026-08-26");
    expect(g.projected_winner).toBe("Labour");
    expect(g.call_correct).toBe(false);
    // (20 + 8 + 12) / 3
    expect(g.mae_pp).toBeCloseTo(13.333, 2);
  });

  it("would have reported the opposite had it used the rebuild", () => {
    // Guards the fixture itself: if this ever stops holding, the test above has
    // stopped discriminating and is passing by construction.
    const g = gradeAgainst(null, rebuild, actual, field, "Reform UK");
    expect(g.graded_against).toBe("current_rebuild");
    expect(g.call_correct).toBe(true);
    expect(g.mae_pp).toBeCloseTo(0, 6);
  });

  it("labels a rebuild grade as one that can move", () => {
    const g = gradeAgainst(undefined, rebuild, actual, field, "Reform UK");
    expect(g.note).toMatch(/can move/);
  });

  it("returns null when there is neither a snapshot nor a forecast", () => {
    expect(gradeAgainst(null, null, actual, field, "Reform UK")).toBeNull();
  });

  it("ignores a snapshot with no shares in it", () => {
    const g = gradeAgainst({ captured_at: "2026-08-26" }, rebuild, actual, field, "Reform UK");
    expect(g.graded_against).toBe("current_rebuild");
  });
});
