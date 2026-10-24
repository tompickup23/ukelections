import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  CALENDAR,
  allCouncilRecords,
  councilNextElection,
  councilsVotingIn,
  firstThursdayInMay,
  uncoveredCouncils,
} from "../src/lib/nextElections";
import { councilNoticeForPostcode, voterIntentLinks, type DistrictEntry } from "../src/lib/electionLookup";

describe("next-election calendar", () => {
  it("computes the statutory first Thursday in May", () => {
    expect(firstThursdayInMay(2027)).toBe("2027-05-06");
    expect(firstThursdayInMay(2028)).toBe("2028-05-04");
    expect(firstThursdayInMay(2030)).toBe("2030-05-02");
    expect(firstThursdayInMay(2031)).toBe("2031-05-01");
  });

  it("cites a primary source for every dated row", () => {
    for (const row of CALENDAR) {
      if (!row.date_iso) continue;
      expect(row.sources.length, row.id).toBeGreaterThan(0);
      for (const source of row.sources) expect(source.url, row.id).toMatch(/^https:\/\//);
    }
  });

  it("gives the general election as a deadline, not a fixed day", () => {
    const ge = CALENDAR.find((r) => r.id === "general-election")!;
    expect(ge.date_kind).toBe("latest");
    // 15 August 2029 is a Wednesday; an earlier draft called it a Thursday.
    expect(ge.date_label).toBe("No later than 15 August 2029");
    expect(ge.sources.some((s) => s.url.includes("ukpga/2022/11/section/4"))).toBe(true);
  });

  it("keeps dashes out of the published data", () => {
    for (const file of ["data/identity/next-elections.json", "data/identity/council-next-elections.json"]) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/[–—]/);
    }
  });
});

describe("council next-election records", () => {
  it("corrects the councils the stored cycle arithmetic got wrong", () => {
    // SI 2025/564 art.4(3): a third retire after the 2027 ordinary day.
    expect(councilNextElection("sunderland").date_iso).toBe("2027-05-06");
    // SI 2015/43: whole-council elections every fourth year from 2018.
    expect(councilNextElection("birmingham").date_iso).toBe("2030-05-02");
  });

  it("never shows a date for an unverified council", () => {
    for (const record of allCouncilRecords().filter((r) => r.status === "unverified")) {
      const next = councilNextElection(record.slug);
      expect(next.date_iso, record.slug).toBeNull();
      expect(next.label).toBe("Not verified");
    }
  });

  it("gives every verified record a year, a source URL and a verbatim quote", () => {
    for (const record of allCouncilRecords().filter((r) => r.status === "verified")) {
      expect(record.next_year, record.slug).toBeTruthy();
      expect(record.source_url, record.slug).toMatch(/^https:\/\//);
      expect((record.quote || "").length, record.slug).toBeGreaterThan(10);
    }
  });

  it("says a council being abolished has no next election", () => {
    const surrey = allCouncilRecords().find((r) => r.status === "abolished");
    expect(surrey).toBeDefined();
    expect(councilNextElection(surrey!.slug).date_iso).toBeNull();
  });

  it("builds a placeholder page for 2027 councils the site has no results for", () => {
    const stubs = new Set(uncoveredCouncils(new Set(["burnley"])).map((r) => r.slug));
    expect(stubs.has("ribble-valley")).toBe(true);
    expect(stubs.has("glasgow-city")).toBe(true);
    expect(stubs.has("cardiff")).toBe(true);
    expect(stubs.has("burnley")).toBe(false);
    expect(councilsVotingIn(2027).some((r) => r.slug === "glasgow-city")).toBe(true);
  });
});

describe("postcode lookup council notice", () => {
  const districts: DistrictEntry[] = [
    { code: "E07000124", name: "Ribble Valley", href: "/seats/ribble-valley/", covered: false, status: "scheduled", next_label: "Thursday 6 May 2027" },
    { code: "E07000117", name: "Burnley", href: "/seats/burnley/", covered: true, status: "scheduled", next_label: "Thursday 6 May 2027" },
    { code: "E07000999", name: "Nowhere", href: "/seats/nowhere/", covered: false, status: "unknown", next_label: "Not verified" },
  ];

  it("names an uncovered council and says no forecast is published", () => {
    const notice = councilNoticeForPostcode({ codes: { admin_district: "e07000124" } }, districts)!;
    expect(notice.entry.href).toBe("/seats/ribble-valley/");
    expect(notice.message).toBe("Your council, Ribble Valley, next votes on Thursday 6 May 2027. We have not published a forecast for it yet.");
  });

  it("does not invent a date when none is verified", () => {
    const notice = councilNoticeForPostcode({ codes: { admin_district: "E07000999" } }, districts)!;
    expect(notice.message).toContain("We have not verified its next election date");
  });

  it("returns nothing without a district code", () => {
    expect(councilNoticeForPostcode({ codes: {} }, districts)).toBeNull();
  });

  it("routes 'when is the next election' to the calendar", () => {
    expect(voterIntentLinks("when is the next election")[0].href).toBe("/elections/");
  });
});
