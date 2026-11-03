import { describe, expect, it } from "vitest";
import { councilByElectionWeek } from "../src/lib/byElections";

const contest = (day: string, council = "A") => ({ contest: { polling_day: day, council_name: council } });

describe("council by-elections this week", () => {
  it("takes the seven days to today as held and the seven after as next", () => {
    const all = ["2026-11-05", "2026-11-06", "2026-11-12", "2026-11-13", "2026-11-19", "2026-11-20", "2026-11-21"].map((d) => contest(d));
    const week = councilByElectionWeek(all, "2026-11-13");
    expect(week.from).toBe("2026-11-07");
    expect(week.held.map((c) => c.contest.polling_day)).toEqual(["2026-11-12", "2026-11-13"]);
    expect(week.next.map((c) => c.contest.polling_day)).toEqual(["2026-11-19", "2026-11-20"]);
  });

  it("orders a polling day by council", () => {
    const week = councilByElectionWeek([contest("2026-11-12", "Wigan"), contest("2026-11-12", "Hyndburn")], "2026-11-13");
    expect(week.held.map((c) => c.contest.council_name)).toEqual(["Hyndburn", "Wigan"]);
  });
});
