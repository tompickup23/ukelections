import { describe, expect, it } from "vitest";
import { loadHomepageContest, selectHomepageContest, type LocalHeroContest, type UpcomingContest } from "../src/lib/siteData";

const now = new Date("2026-11-09T12:00:00Z");
const local = (date = "2026-11-12", id = "local.fixture", status = "upcoming"): LocalHeroContest => ({
  status, contest: { polling_day: date, ballot_paper_id: id },
});
const parliamentary: UpcomingContest = {
  id: "fixture", kind: "by_election", name: "Fixture parliamentary by-election", short_name: "Fixture by-election",
  region: "England", polling_day_iso: "2026-11-12", polling_day_label: "Thursday 12 November 2026",
  polling_day_short_label: "12 Nov 2026", days_until: 3, headline_summary: "Forecast pending", headline_winner: null,
  headline_runner_up: null, margin_pp: null, classification: null, href: "/by-elections/fixture/", source_file: null,
  central_shares: [], key_candidates: [], trigger_note: null,
};

describe("Homepage next contest", () => {
  it("groups the next council polling day and ignores other dates and statuses", () => {
    const contests = Array.from({ length: 6 }, (_, i) => local("2026-11-12", `local.${i}`));
    const selected = selectHomepageContest([], [...contests, contests[0], local("2026-11-19"), local("2026-11-12", "closed", "declared")], now);
    expect(selected).toMatchObject({ count: 6, headline: "Six council by-elections on Thursday 12 November", href: "/by-elections/this-week/" });
  });
  it("retains the dated parliamentary hero when it is next or on the same day", () => {
    expect(selectHomepageContest([parliamentary], [local()], now)).toEqual(parliamentary);
  });
  it("shows an earlier council polling day before a later parliamentary contest", () => {
    expect(selectHomepageContest([{ ...parliamentary, polling_day_iso: "2026-11-19" }], [local()], now)?.kind).toBe("local_by_elections");
  });
  it("falls back to Westminster when no contest polls within fourteen days", () => {
    expect(selectHomepageContest([{ ...parliamentary, polling_day_iso: "2026-11-26" }], [local("2026-11-08"), local("2026-11-24"), local("invalid")], now)).toBeNull();
  });
  it("includes polling day and the fourteenth day but excludes the previous day", () => {
    expect(selectHomepageContest([], [local("2026-11-09")], now)).not.toBeNull();
    expect(selectHomepageContest([], [local("2026-11-23")], now)).not.toBeNull();
    expect(selectHomepageContest([], [local("2026-11-08")], now)).toBeNull();
  });
  it("loads the six committed November contests without changing their files", () => {
    expect(loadHomepageContest(now)).toMatchObject({ kind: "local_by_elections", count: 6, polling_day_iso: "2026-11-12" });
  });
});
