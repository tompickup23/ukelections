import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  buildPollingDays,
  contestOutcome,
  dayTally,
  pollingDayDescription,
  pollingDayTitle,
  getByElectionDayPaths,
} from "../src/lib/byElectionDays";
import { pollingDaySummary } from "../src/lib/pageSummaries";
import { getAllSitemapPaths, sitemapGroupFor } from "../src/lib/sitemapPaths";

const contestDir = path.join(process.cwd(), "data/contests/local-byelections");
const contests = readdirSync(contestDir)
  .filter((f) => f.endsWith(".json") && !f.startsWith("_") && !f.endsWith(".analysis.json"))
  .map((f) => JSON.parse(readFileSync(path.join(contestDir, f), "utf8")));

// House style: no em or en dashes, and no spaced hyphen used as a dash.
const DASHES = /—|–| - /;
const candidateNames = (d: any) =>
  [...(d.field?.candidates || []).map((c: any) => c.name), d.result?.winner_candidate, d.declaration?.winner_candidate]
    .filter((x: unknown): x is string => typeof x === "string" && x.length > 3);

// A fixed "today" keeps the phases stable whatever day the suite runs.
const TODAY = "2026-11-28";
const days = buildPollingDays(contests, TODAY);

const fptp = (over: any = {}) => ({
  slug: over.slug ?? "x",
  contest: { polling_day: "2026-11-12", council_name: "A", ward_name: "W", voting_system: "FPTP", ...over.contest },
  field: { candidate_count: 3, parties: ["Labour", "Reform UK", "Conservative"] },
  result: { declared: true, winner_party: "Labour", shares: { Labour: 0.5, "Reform UK": 0.3, Conservative: 0.2 }, outcome: null, ...over.result },
  previous_holder: over.previous_holder ?? { established: false },
});

describe("polling days", () => {
  it("gives every date with a contest exactly one page, and no other date", () => {
    const dates = new Set(contests.map((d) => d.contest.polling_day));
    expect(days.map((d) => d.date).sort()).toEqual([...dates].sort());
    for (const day of days) expect(day.contests.length, day.date).toBeGreaterThan(0);
    expect(days.map((d) => d.date)).toEqual([...days.map((d) => d.date)].sort().reverse());
  });

  it("groups the index and the day pages for the sitemap", () => {
    const dayPaths = getByElectionDayPaths();
    expect(dayPaths[0]).toBe("/by-elections/week/");
    expect(sitemapGroupFor("/by-elections/week/")).toBe("core");
    expect(sitemapGroupFor(dayPaths[1])).toBe("by-elections");
  });

  // getAllSitemapPaths() reads the gitignored historic corpus, which is on
  // vps-main and this Mac but not on a CI runner (as in sitemap-paths.test.ts).
  it.skipIf(!existsSync(path.join(process.cwd(), "data/history/dc-historic-results.json")))(
    "puts the index and every day in the full sitemap list",
    () => {
      const all = getAllSitemapPaths();
      for (const p of getByElectionDayPaths()) expect(all).toContain(p);
    },
  );

  it("reads hold and gain from the recorded outcome first, then the reviewed holder", () => {
    expect(contestOutcome(fptp({ result: { outcome: "Labour hold" } }))).toMatchObject({ kind: "hold", previous: "Labour" });
    expect(contestOutcome(fptp({ result: { winner_party: "Reform UK", outcome: "Reform UK gain from Labour" } })))
      .toMatchObject({ kind: "gain", previous: "Labour", label: "Reform UK gain from Labour" });
    expect(contestOutcome(fptp({ previous_holder: { established: true, party: "Conservative" } })))
      .toMatchObject({ kind: "gain", previous: "Conservative", label: "Labour gain from Conservative" });
    // An unreviewed holder is not evidence of a gain.
    expect(contestOutcome(fptp({ previous_holder: { established: false, party: "Conservative" } }))).toMatchObject({ kind: null, label: null });
    expect(contestOutcome({ contest: {}, result: null })).toMatchObject({ winner: null });
  });

  it("tallies seats won, with net change that sums to zero", () => {
    const tally = dayTally([
      { winner: "Labour", previous: "Reform UK", kind: "gain", label: "" },
      { winner: "Labour", previous: "Labour", kind: "hold", label: "" },
      { winner: "Green Party", previous: null, kind: null, label: null },
    ]);
    expect(tally).toEqual([
      { party: "Labour", won: 2, net: 1 },
      { party: "Green Party", won: 1, net: 0 },
      { party: "Reform UK", won: 0, net: -1 },
    ]);
    for (const day of days) {
      expect(day.tally.reduce((n, t) => n + t.net, 0), day.date).toBe(0);
      expect(day.tally.reduce((n, t) => n + t.won, 0), day.date).toBe(day.declared);
    }
  });
});

describe("polling day metadata", () => {
  it("leads with the figure, stays within the search limits and names the councils", () => {
    for (const day of days) {
      const title = pollingDayTitle(day);
      const description = pollingDayDescription(day);
      expect(title.length, title).toBeLessThanOrEqual(60);
      expect(title, day.date).toMatch(new RegExp(`${day.contests.length} contests?`));
      expect(description.length, description).toBeLessThanOrEqual(155);
      expect(description.length, description).toBeGreaterThanOrEqual(70);
      expect(description.includes(day.councils[0]), description).toBe(true);
      expect(DASHES.test(title + description), day.date).toBe(false);
    }
  });

  it("uses the results form once polls have closed and the preview form before", () => {
    const upcoming = buildPollingDays([fptp({ contest: { polling_day: "2026-12-03" }, result: { declared: false } })].map((d) => ({ ...d, result: null })), TODAY)[0];
    expect(upcoming.phase).toBe("upcoming");
    expect(pollingDayTitle(upcoming)).toMatch(/^Council by-elections on 3 December 2026: 1 contest/);
    const done = buildPollingDays([fptp()], TODAY)[0];
    expect(pollingDayTitle(done)).toBe("Council by-election results, 12 November 2026: 1 contest");
  });
});

describe("polling day summary", () => {
  it("is 15 to 110 words on every day, dash-free, and never names a candidate", () => {
    for (const day of days) {
      const text = pollingDaySummary(day).join(" ");
      const words = text.split(/\s+/).length;
      expect(words, day.date).toBeGreaterThanOrEqual(15);
      expect(words, day.date).toBeLessThanOrEqual(110);
      expect(DASHES.test(text), day.date).toBe(false);
      for (const d of day.contests) for (const name of candidateNames(d)) expect(text.includes(name), `${day.date} ${name}`).toBe(false);
    }
  });

  it("states how many of how many are declared on a part-declared day", () => {
    const part = buildPollingDays([fptp({ slug: "a" }), { ...fptp({ slug: "b", contest: { ward_name: "V" } }), result: null }], TODAY)[0];
    expect(part.phase).toBe("part-declared");
    const text = pollingDaySummary(part).join(" ");
    expect(text).toContain("One of the two results has been declared");
    expect(text).toContain("Seats won: Labour 1");
  });

  it("reports the seats won and seats changing hands from the record", () => {
    const day = buildPollingDays([
      fptp({ slug: "a", result: { winner_party: "Reform UK", outcome: "Reform UK gain from Labour" } }),
      fptp({ slug: "b", contest: { ward_name: "V", council_name: "B" }, result: { outcome: "Labour hold" } }),
    ], TODAY)[0];
    const text = pollingDaySummary(day).join(" ");
    expect(text).toContain("Two council by-elections were held on 12 November 2026, in A and B.");
    expect(text).toContain("Both results have been declared");
    expect(text).toContain("one seat changed hands in both contests");
  });

  it("previews an upcoming day by candidates and forecasts", () => {
    const up = { ...fptp({ contest: { polling_day: "2026-12-10" } }), result: null, forecast: { winner: "Labour" } };
    const text = pollingDaySummary(buildPollingDays([up], TODAY)[0]).join(" ");
    expect(text).toBe("One council by-election is due on 10 December 2026, in A. 3 candidates are listed so far, and a forecast is published for the contest.");
  });
});
