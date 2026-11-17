import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { simplifyCoverage } from "../scripts/lib/simplify-shared-borders.mjs";

const poly = (code, ...rings) => ({ type: "Feature", properties: { code }, geometry: { type: "Polygon", coordinates: rings } });
const close = (pts) => [...pts, pts[0]];
const k = (p) => `${p[0]},${p[1]}`;

// A shared border running north along x = 0 from y = 51.00 to 51.01, with
// tiny wiggles (about 1m) and one large bump (about 350m) half way up.
const border = [];
for (let i = 0; i <= 20; i++) {
  const y = +(51 + i * 0.0005).toFixed(5);
  const x = i === 10 ? 0.005 : (i % 2 ? 0.00001 : 0);
  border.push([x, y]);
}
const west = poly("W", close([[-0.01, 51], ...border.slice(0, -1), [0, 51.01], [-0.01, 51.01]]));
const east = poly("E", close([[0, 51.01], ...border.slice(1, -1).reverse(), [0, 51], [0.01, 51], [0.01, 51.01]]));

// The run of vertices a ring has strictly between two junctions, read forwards.
function between(ring, a, b) {
  const open = ring.slice(0, -1);
  const i = open.findIndex((p) => k(p) === k(a));
  const out = [];
  for (let s = 1; s < open.length; s++) {
    const p = open[(i + s) % open.length];
    if (k(p) === k(b)) return out;
    out.push(k(p));
  }
  throw new Error("junction not found");
}

describe("simplifyCoverage", () => {
  it("simplifies a shared border identically from both sides", () => {
    const [w, e] = simplifyCoverage([west, east], 20);
    const fromWest = between(w.geometry.coordinates[0], [0, 51], [0, 51.01]);
    const fromEast = between(e.geometry.coordinates[0], [0, 51.01], [0, 51]).reverse();
    expect(fromWest).toEqual(fromEast);
    expect(fromWest).toContain(k([0.005, 51.005])); // the bump survives
    expect(fromWest.length).toBeLessThan(5); // the wiggles do not
  });

  it("keeps an enclave and the hole around it the same ring", () => {
    const inner = [];
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * 2 * Math.PI;
      const r = 0.002 + (i % 2 ? 0.000005 : 0);
      inner.push([+(r * Math.cos(a)).toFixed(6), +(51 + r * Math.sin(a)).toFixed(6)]);
    }
    const outer = close([[-0.01, 50.99], [0.01, 50.99], [0.01, 51.01], [-0.01, 51.01]]);
    const big = poly("B", outer, close(inner.slice().reverse()));
    const small = poly("S", close(inner));
    const [b, s] = simplifyCoverage([big, small], 5);
    const hole = new Set(b.geometry.coordinates[1].map(k));
    const ring = new Set(s.geometry.coordinates[0].map(k));
    expect(hole).toEqual(ring);
    expect(ring.size).toBeLessThan(40);
  });

  it("scales the tolerance to the smallest feature on each border", () => {
    // A 1 km seat and a 100 km seat, each with its own coastline wiggling by
    // about 7 m. At 1/400 of the diagonal the small seat keeps its wiggles
    // (tolerance ~3.5 m, floored to 1 m) and the large one loses them.
    const wiggly = (x0, y0, size) => {
      const pts = [];
      for (let i = 0; i <= 40; i++) pts.push([+(x0 + (i / 40) * size).toFixed(6), +(y0 + (i % 2 ? 0.00006 : 0)).toFixed(6)]);
      return close([...pts, [x0 + size, y0 + size / 1.6], [x0, y0 + size / 1.6]]);
    };
    const tiny = poly("T", wiggly(0, 51, 0.014));
    const huge = poly("H", wiggly(1, 51, 1.4));
    const [t, h] = simplifyCoverage([tiny, huge], { fraction: 1 / 400, min: 1, max: 1500 });
    expect(t.geometry.coordinates[0].length).toBe(tiny.geometry.coordinates[0].length);
    expect(h.geometry.coordinates[0].length).toBeLessThan(10);
  });

  it("drops a collapsed island but never a feature's main outline", () => {
    const main = close([[0, 51], [0.01, 51], [0.01, 51.01], [0, 51.01]]);
    const islet = close([[0.02, 51], [0.02001, 51], [0.02, 51.00001]]);
    const f = { type: "Feature", properties: { code: "I" }, geometry: { type: "MultiPolygon", coordinates: [[main], [islet]] } };
    const [out] = simplifyCoverage([f], 50);
    expect(out.geometry.type).toBe("Polygon");
    expect(out.geometry.coordinates[0]).toEqual(main);
    const [alone] = simplifyCoverage([poly("A", islet)], 50);
    expect(alone.geometry.coordinates[0]).toEqual(islet);
  });
});

describe("committed BGC constituency boundaries", () => {
  const g = JSON.parse(readFileSync("data/geography/pcon24-bgc.geojson", "utf8"));
  const count = (geom) => (geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates).flat().reduce((n, r) => n + r.length, 0);
  const byName = new Map(g.features.map((f) => [f.properties.PCON24NM, f]));

  it("holds all 650 constituencies once each, with closed rings", () => {
    expect(g.features).toHaveLength(650);
    expect(new Set(g.features.map((f) => f.properties.PCON24CD)).size).toBe(650);
    for (const f of g.features) {
      for (const ring of (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates).flat()) {
        expect(ring.length).toBeGreaterThanOrEqual(4);
        expect(k(ring[0])).toBe(k(ring.at(-1)));
      }
    }
  });

  it("draws small urban seats in far more detail than BUC did", () => {
    // BUC counts for the same seats: Holborn 8, Birmingham Northfield 13, Exeter 16.
    expect(count(byName.get("Holborn and St Pancras").geometry)).toBeGreaterThan(50);
    expect(count(byName.get("Birmingham Northfield").geometry)).toBeGreaterThan(100);
    expect(count(byName.get("Exeter").geometry)).toBeGreaterThan(100);
  });

  it("has an outline for every seat code the seat pages can ask for", () => {
    // Seat pages fall back to the lookup file's code when the model record
    // carries none, so every one of those codes must resolve to a boundary.
    const lookup = JSON.parse(readFileSync("data/identity/parliament-lookup-codes.json", "utf8")).entries;
    const codes = new Set(g.features.map((f) => f.properties.PCON24CD));
    const entries = Object.values(lookup);
    expect(entries).toHaveLength(650);
    expect(entries.filter((e) => !codes.has(e.code))).toEqual([]);
  });

  it("stays small enough to commit", () => {
    expect(readFileSync("data/geography/pcon24-bgc.geojson").length).toBeLessThan(4_000_000);
  });
});
