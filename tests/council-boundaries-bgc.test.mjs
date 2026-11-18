import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const load = (file) => JSON.parse(readFileSync(`data/geography/${file}`, "utf8"));
const ringsOf = (g) => (g.type === "Polygon" ? [g.coordinates] : g.coordinates).flat();
const count = (g) => ringsOf(g).reduce((n, r) => n + r.length, 0);
const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];

function expectSound(features, codeField) {
  expect(new Set(features.map((f) => f.properties[codeField])).size).toBe(features.length);
  for (const f of features) {
    for (const ring of ringsOf(f.geometry)) {
      expect(ring.length).toBeGreaterThanOrEqual(4);
      expect(ring[0]).toEqual(ring.at(-1));
    }
  }
}

describe("committed BGC ward boundaries (May 2026)", () => {
  const wards = load("wd26-bgc.geojson").features;

  it("holds each ward once, with closed rings and its council", () => {
    expect(wards.length).toBeGreaterThanOrEqual(8000);
    expectSound(wards, "WD26CD");
    expect(wards.filter((f) => !f.properties.LAD26CD || !f.properties.WD26NM)).toEqual([]);
  });

  it("draws wards in far more detail than the BSC file did", () => {
    // BSC medians for the same areas: all wards 14, Camden 8, Burnley 12.
    const of = (council) => wards.filter((f) => f.properties.LAD26NM === council).map((f) => count(f.geometry));
    expect(median(wards.map((f) => count(f.geometry)))).toBeGreaterThan(30);
    expect(median(of("Camden"))).toBeGreaterThan(20);
    expect(median(of("Burnley"))).toBeGreaterThan(30);
  });

  it("still draws a ward map for every council that had one", () => {
    // WardResultsMap draws when at least 90% of a council's wards that voted
    // are on file. 111 councils met that on the May 2025 codes it used before.
    const codes = new Set(wards.map((f) => f.properties.WD26CD));
    const identity = JSON.parse(readFileSync("data/identity/wards-may-2026.json", "utf8"));
    const byCouncil = new Map();
    for (const w of identity.wards ?? identity) {
      if (w.tier !== "local" && w.tier !== "mayor") continue;
      byCouncil.set(w.council_slug, [...(byCouncil.get(w.council_slug) ?? []), w]);
    }
    let drawable = 0;
    for (const ws of byCouncil.values()) {
      if (ws.length >= 3 && ws.filter((w) => codes.has(w.gss_code)).length >= Math.ceil(ws.length * 0.9)) drawable++;
    }
    expect(drawable).toBeGreaterThanOrEqual(111);
  });

  it("stays small enough to commit", () => {
    expect(readFileSync("data/geography/wd26-bgc.geojson").length).toBeLessThan(10_000_000);
  });
});

describe("committed BGC council boundaries (December 2024)", () => {
  const councils = load("lad24-bgc.geojson").features;

  it("holds the same 361 councils as the simplified file, with closed rings", () => {
    expect(councils).toHaveLength(361);
    expectSound(councils, "LAD24CD");
    const codes = new Set(councils.map((f) => f.properties.LAD24CD));
    const simplified = load("lad24-simplified.geojson").features.map((f) => f.properties.LAD24CD);
    expect(simplified.filter((code) => !codes.has(code))).toEqual([]);
  });

  it("draws councils in far more detail than BUC did", () => {
    // BUC: median council 44 vertices, three with 8 or fewer.
    const counts = councils.map((f) => count(f.geometry));
    expect(median(counts)).toBeGreaterThan(150);
    expect(Math.min(...counts)).toBeGreaterThan(30);
  });

  it("stays small enough to commit", () => {
    expect(readFileSync("data/geography/lad24-bgc.geojson").length).toBeLessThan(2_000_000);
  });
});

describe("committed BGC county electoral divisions (May 2026)", () => {
  const divisions = load("ced26-bgc.geojson").features;

  it("holds each division once, with closed rings and its county", () => {
    expect(divisions.length).toBeGreaterThanOrEqual(1300);
    expectSound(divisions, "CED26CD");
    expect(divisions.filter((f) => !/^E10/.test(f.properties.CTY25CD) || !f.properties.CTY25NM)).toEqual([]);
  });

  it("puts in each county the number of divisions it elected by on 7 May 2026", () => {
    const identity = JSON.parse(readFileSync("data/identity/wards-may-2026.json", "utf8"));
    for (const county of ["East Sussex", "Essex", "Hampshire", "Norfolk", "Suffolk", "West Sussex"]) {
      const voted = identity.wards.filter((w) => w.council_name === county && w.tier === "local").length;
      expect(divisions.filter((f) => f.properties.CTY25NM === county), county).toHaveLength(voted);
    }
  });

  it("stays small enough to commit", () => {
    expect(readFileSync("data/geography/ced26-bgc.geojson").length).toBeLessThan(2_500_000);
  });
});
