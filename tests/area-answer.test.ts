import { describe, expect, it } from "vitest";
import { areaAnswer, daysBetween, inDays, type AreaIndex } from "../src/lib/electionLookup";

const index: AreaIndex = {
  constituencies: [{ kind: "constituency", name: "Hyndburn", secondary: "", href: "/seats/parliament/hyndburn/", code: "E14001295" }],
  wards: [],
  districts: [
    { code: "E07000120", name: "Hyndburn", href: "/seats/hyndburn/", covered: true, status: "scheduled", next_label: "Thursday 6 May 2027" },
    { code: "E07000999", name: "Unverified Council", href: "/seats/unverified/", covered: false, status: "unknown", next_label: "Not verified" },
    { code: "E07000998", name: "Going Council", href: "/seats/going/", covered: false, status: "abolished", next_label: "None" },
  ],
  districtDates: { E07000120: "2027-05-06" },
  byElections: [
    { ward_code: "E05005290", ward: "Huncoat", council: "Hyndburn", date_iso: "2026-11-12", date_label: "Thursday 12 November", href: "/by-elections/local/hyndburn-huncoat-2026-11-12/" },
  ],
  national: {
    "general-election": { body: "UK general election", date_iso: "2029-08-15", date_label: "No later than 15 August 2029", date_kind: "latest", href: "/forecasts/general-election/" },
    senedd: { body: "Senedd Cymru", date_iso: "2030-05-02", date_label: "Thursday 2 May 2030", date_kind: "fixed", href: null },
    "ni-assembly": { body: "Northern Ireland Assembly", date_iso: "2027-05-06", date_label: "Thursday 6 May 2027", date_kind: "fixed", href: null },
  },
};
const codes = (ward: string, district: string) => ({ codes: { admin_ward: ward, admin_district: district, parliamentary_constituency: "E14001295" }, country: "England" });

describe("area answer", () => {
  it("leads with a by-election that has not polled", () => {
    const a = areaAnswer(codes("E05005290", "E07000120"), index, "2026-11-10");
    expect(a.tone).toBe("now");
    expect(a.headline).toBe("Yes. Huncoat has a council by-election on Thursday 12 November.");
    expect(a.detail).toBe("That is in 2 days.");
    expect(a.action?.href).toBe("/by-elections/local/hyndburn-huncoat-2026-11-12/#your-vote");
    expect(a.rows[0].body).toContain("by-election");
  });

  it("drops the by-election the day after it polls", () => {
    const a = areaAnswer(codes("E05005290", "E07000120"), index, "2026-11-13");
    expect(a.tone).toBe("later");
    expect(a.detail).toBe("The next one with a date is Hyndburn council, on Thursday 6 May 2027.");
  });

  it("says no election is under way and gives the council date elsewhere in the borough", () => {
    const a = areaAnswer(codes("E05009999", "E07000120"), index, "2026-11-10");
    expect(a.tone).toBe("later");
    expect(a.headline).toBe("No election is under way where you live.");
  });

  it("never offers the latest possible general election date as the next election", () => {
    const a = areaAnswer(codes("E05009999", "E07000999"), index, "2026-11-10");
    expect(a.tone).toBe("unknown");
    expect(a.detail).not.toContain("2029");
    const ge = a.rows.find((r) => r.body.startsWith("UK Parliament"))!;
    expect(ge.certainty).toBe("latest");
    const council = a.rows.find((r) => r.body === "Unverified Council council")!;
    expect(council.certainty).toBe("unverified");
    expect(council.date_iso).toBeNull();
  });

  it("gives no date for a council being abolished", () => {
    const a = areaAnswer(codes("E05009999", "E07000998"), index, "2026-11-10");
    expect(a.rows.find((r) => r.body === "Going Council council")!.certainty).toBe("none");
  });

  it("adds the devolved parliament by nation and points Northern Ireland elsewhere", () => {
    const wales = areaAnswer({ codes: { admin_ward: "W05000001", admin_district: "W06000018" }, country: "Wales" }, index, "2026-11-10");
    expect(wales.rows.some((r) => r.body === "Senedd Cymru")).toBe(true);
    const ni = areaAnswer({ codes: { admin_ward: "N08000101", admin_district: "N09000003" }, country: "Northern Ireland" }, index, "2026-11-10");
    expect(ni.rows.some((r) => r.body === "Northern Ireland Assembly")).toBe(true);
    expect(ni.rows.some((r) => r.certainty === "unverified")).toBe(false);
  });

  it("says a general election must come first when its last possible date is sooner", () => {
    const late: AreaIndex = { ...index, districtDates: { E07000120: "2030-05-02" }, districts: [{ ...index.districts![0], next_label: "Thursday 2 May 2030" }] };
    const a = areaAnswer(codes("E05009999", "E07000120"), late, "2026-11-10");
    expect(a.detail).toBe(
      "A general election has no date yet but must be held by 15 August 2029. The next one with a date is Hyndburn council, on Thursday 2 May 2030.",
    );
  });

  it("adds the London mayor and assembly for a London postcode", () => {
    const withLondon: AreaIndex = { ...index, national: { ...index.national!, "london-2028": { body: "Mayor of London and London Assembly", date_iso: "2028-05-04", date_label: "Thursday 4 May 2028", date_kind: "fixed", href: null } } };
    const a = areaAnswer({ ...codes("E05009999", "E07000999"), region: "London" }, withLondon, "2026-11-10");
    expect(a.detail).toBe("The next one with a date is Mayor of London and London Assembly, on Thursday 4 May 2028.");
  });

  it("counts days in words", () => {
    expect(inDays(daysBetween("2026-11-10", "2026-11-10"))).toBe("today");
    expect(inDays(daysBetween("2026-11-10", "2026-11-11"))).toBe("tomorrow");
    expect(inDays(daysBetween("2026-10-30", "2026-11-12"))).toBe("in 13 days");
  });
});
