import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { controlFromCounts, normName, CONFLICT_SLUGS } from "../scripts/build-councils-2027.mjs";

const data = JSON.parse(readFileSync("data/identity/councils-2027.json", "utf8"));

describe("councils voting on 6 May 2027", () => {
  it("lists only councils whose 2027 election is verified", () => {
    const cal = JSON.parse(readFileSync("data/identity/council-next-elections.json", "utf8")).councils;
    for (const c of data.councils) expect(cal[c.slug], c.slug).toMatchObject({ status: "verified", next_year: 2027 });
    expect(data.totals.councils_verified).toBe(data.councils.length);
  });

  it("gives every published value a source, and a note for every blank", () => {
    for (const c of data.councils) {
      for (const [field, v] of [["seats_up", c.seats_up], ["total_seats", c.total_seats]]) {
        if (v.value != null) expect(v.source_url, `${c.slug} ${field}`).toMatch(/^https?:\/\//);
        else expect(v.note, `${c.slug} ${field}`).toBeTruthy();
      }
      if (c.control.value != null) expect(c.control.source_url, `${c.slug} control`).toMatch(/^https?:\/\//);
      if (c.last_election.date) expect(c.last_election.source_url, `${c.slug} last election`).toMatch(/^https?:\/\//);
    }
  });

  it("never states seats up for a thirds council without a source that says so", () => {
    for (const c of data.councils.filter((x) => x.cycle === "Thirds" && x.seats_up.value != null)) {
      expect(c.seats_up.quote, c.slug).toBeTruthy();
    }
  });

  it("keeps the four disputed councils out of the list, with both sides recorded", () => {
    const listed = new Set(data.councils.map((c) => c.slug));
    for (const slug of CONFLICT_SLUGS) {
      expect(listed.has(slug)).toBe(false);
      const nv = data.not_verified.find((c) => c.slug === slug);
      expect(nv?.conflict?.council_page?.source_url, slug).toMatch(/^https:\/\//);
    }
  });

  it("works out control from counts only on a strict majority", () => {
    expect(controlFromCounts({ A: 21, B: 20 }, 41)).toBe("A");
    expect(controlFromCounts({ A: 20, B: 20, C: 1 }, 41)).toBe("No overall control");
    expect(controlFromCounts({ A: 21 }, 42)).toBe("No overall control");
    expect(normName("City of Lincoln")).toBe(normName("Lincoln"));
  });

  it("keeps dashes out of the published data", () => {
    for (const f of ["data/identity/councils-2027.json", "data/identity/council-2027-sources.json"]) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/[–—]| - /);
    }
  });
});
