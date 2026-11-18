import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { matchCouncilBoundaries, normaliseAreaName } from "../src/lib/wardBoundaryJoin";

const load = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const wards = load("data/geography/wd26-bgc.geojson").features;
const divisions = load("data/geography/ced26-bgc.geojson").features;
const identity = load("data/identity/wards-may-2026.json");

const byCouncil = new Map<string, any[]>();
for (const w of identity.wards) {
  if (w.tier !== "local") continue;
  byCouncil.set(w.council_slug, [...(byCouncil.get(w.council_slug) ?? []), w]);
}
const match = (slug: string) => {
  const rows = byCouncil.get(slug)!;
  return { rows, found: matchCouncilBoundaries(rows, rows[0].council_name, wards, divisions) };
};

// Wards redrawn for 2026: Democracy Club slugs in place of ONS codes.
const REDRAWN = [
  "barnsley", "bradford", "calderdale", "coventry", "gateshead", "kirklees", "milton-keynes",
  "newcastle-upon-tyne", "sandwell", "sefton", "solihull", "south-tyneside", "sunderland",
  "swindon", "thurrock", "wakefield", "walsall",
];
const COUNTIES = ["east-sussex", "essex", "hampshire", "norfolk", "suffolk", "west-sussex"];

describe("ward and division boundary join", () => {
  it.each(REDRAWN)("matches every ward of %s by name, inside that council only", (slug) => {
    const { rows, found } = match(slug);
    expect(found?.kind).toBe("ward");
    expect(found!.byCode.size).toBe(rows.length);
    expect(found!.features).toHaveLength(rows.length);
    expect(new Set(found!.features.map((f) => f.properties.LAD26NM))).toEqual(new Set([rows[0].council_name]));
  });

  it.each(COUNTIES)("matches every division of %s, inside that county only", (slug) => {
    const { rows, found } = match(slug);
    expect(found?.kind).toBe("division");
    expect(found!.byCode.size).toBe(rows.length);
    expect(found!.features).toHaveLength(rows.length);
    expect(new Set(found!.features.map((f) => f.properties.CTY25NM))).toEqual(new Set([rows[0].council_name]));
  });

  it("never gives two rows the same boundary", () => {
    for (const slug of [...REDRAWN, ...COUNTIES]) {
      const { rows, found } = match(slug);
      expect(new Set(found!.byCode.values()).size, slug).toBe(rows.length);
    }
  });

  it("keeps a name that two counties share inside its own county", () => {
    // Constable and Hadleigh are divisions of both Essex and Suffolk.
    for (const slug of ["essex", "suffolk"]) {
      const { found } = match(slug);
      const names = found!.features.map((f) => normaliseAreaName(f.properties.CED26NM));
      expect(names.filter((n) => n === "constable"), slug).toHaveLength(1);
      expect(names.filter((n) => n === "hadleigh"), slug).toHaveLength(1);
    }
  });

  it("draws no map for the Surrey unitaries, whose wards are on no ONS layer", () => {
    // ONS still holds the 81 old Surrey County Council divisions; 11 of the 81
    // new unitary wards have no division of the same name, and the rest are
    // not known to share a boundary. No match is the honest answer.
    expect(match("east-surrey").found).toBeNull();
    expect(match("west-surrey").found).toBeNull();
  });

  it("draws a map for every council but those two", () => {
    const none = [...byCouncil.entries()]
      .filter(([, rows]) => rows.length >= 3)
      .filter(([, rows]) => !matchCouncilBoundaries(rows, rows[0].council_name, wards, divisions))
      .map(([slug]) => slug);
    expect(none.sort()).toEqual(["east-surrey", "west-surrey"]);
  });

  it("does not match on a near miss", () => {
    const rows = [{ ward_name: "Abbey Road" }, { ward_name: "Acle" }, { ward_name: "Attleborough" }];
    expect(matchCouncilBoundaries(rows, "Norfolk", wards, divisions)).toBeNull();
  });
});
