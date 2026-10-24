import { describe, expect, it } from "vitest";
import { gradePublished, summarise, byMonth } from "../scripts/build-byelection-post-mortem.mjs";

const forecasts = {
  "x-ward-2026-09-03": { page: "p", projected_winner: "Reform UK", leader_probability_pct: 60, too_close_to_call: false, central_pct: { "Reform UK": 40, "Labour": 30, "Green Party": 30 } },
  "y-ward-2026-10-01": { page: "p", projected_winner: "Labour", leader_probability_pct: 51, too_close_to_call: true, central_pct: { "Labour": 50, "Conservative": 50 } },
  "z-ward-2026-11-12": { page: "p", projected_winner: "Labour", too_close_to_call: true, central_pct: { "Labour": 60, "Conservative": 40 } },
};
const result = (council, date, votes) => ({ council_slug: council, ward_slug: "ward", election_date: date, review_status: "hand_verified_declaration", source: "s", candidates: Object.entries(votes).map(([party_name, v]) => ({ party_name, votes: v })) });
const results = [
  result("x", "2026-09-03", { "Reform UK": 500, "Labour Party": 300, "Green Party": 200 }),
  result("y", "2026-10-01", { "Labour Party": 400, "Conservative and Unionist Party": 600 }),
];

describe("by-election post-mortem", () => {
  it("grades the forecast as published against the declared result", () => {
    const { graded, pending } = gradePublished(forecasts, results);
    expect(pending).toEqual(["z-ward-2026-11-12"]);
    expect(graded.map((g) => g.called)).toEqual([true, false]);
    // |40-50| + |30-30| + |30-20| over three parties
    expect(graded[0].mae_pp).toBeCloseTo(6.67, 2);
    expect(graded[1].actual_winner).toBe("Conservative");
  });

  it("splits named favourites from too-close-to-call contests and groups by month", () => {
    const { graded } = gradePublished(forecasts, results);
    const s = summarise(graded);
    expect(s).toMatchObject({ contests: 2, winners_called: 1, named_favourite: { contests: 1, called: 1 }, too_close_to_call: { contests: 1, called: 0 } });
    expect(byMonth(graded).map((m) => [m.month, m.misses.length])).toEqual([["2026-09", 0], ["2026-10", 1]]);
  });
});
