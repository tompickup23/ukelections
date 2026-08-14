import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { geoArea, geoBounds } from "d3-geo";
import {
  ringIsClockwise,
  rewindRings,
  rewindGeometry,
  rewindFeatures,
  bboxPolygon,
} from "../src/lib/geoRewind";

// A small counter-clockwise square in lon/lat, roughly the size of a district.
const CCW_SQUARE = [
  [-2, 53],
  [-1, 53],
  [-1, 54],
  [-2, 54],
  [-2, 53],
];
const CW_SQUARE = [...CCW_SQUARE].reverse();

describe("ringIsClockwise", () => {
  it("distinguishes the two windings", () => {
    expect(ringIsClockwise(CW_SQUARE)).toBe(true);
    expect(ringIsClockwise(CCW_SQUARE)).toBe(false);
  });
});

describe("rewindRings", () => {
  it("forces the exterior ring clockwise", () => {
    expect(ringIsClockwise(rewindRings([CCW_SQUARE])[0])).toBe(true);
  });

  it("leaves an already-clockwise exterior ring untouched", () => {
    const rings = [CW_SQUARE];
    // Same array identity, i.e. no needless copy.
    expect(rewindRings(rings)[0]).toBe(CW_SQUARE);
  });

  it("forces holes counter-clockwise", () => {
    const hole = [
      [-1.8, 53.2],
      [-1.6, 53.2],
      [-1.6, 53.4],
      [-1.8, 53.4],
      [-1.8, 53.2],
    ];
    const out = rewindRings([CCW_SQUARE, [...hole].reverse()]);
    expect(ringIsClockwise(out[0])).toBe(true);
    expect(ringIsClockwise(out[1])).toBe(false);
  });
});

describe("rewindGeometry", () => {
  it("makes a wrongly wound Polygon a small area rather than the whole sphere", () => {
    const before = { type: "Polygon", coordinates: [CCW_SQUARE] };
    expect(geoArea(before as any)).toBeGreaterThan(6); // ~4*pi, the whole sphere
    expect(geoArea(rewindGeometry(before) as any)).toBeLessThan(0.01);
  });

  it("handles MultiPolygon", () => {
    const before = { type: "MultiPolygon", coordinates: [[CCW_SQUARE]] };
    expect(geoArea(rewindGeometry(before) as any)).toBeLessThan(0.01);
  });

  it("passes non-polygon geometry through untouched", () => {
    const pt = { type: "Point", coordinates: [-2, 53] };
    expect(rewindGeometry(pt)).toBe(pt);
    expect(rewindGeometry(null)).toBe(null);
  });

  it("does not mutate its input", () => {
    const before = { type: "Polygon", coordinates: [CCW_SQUARE] };
    rewindGeometry(before);
    expect(before.coordinates[0]).toEqual(CCW_SQUARE);
  });
});

describe("rewindFeatures", () => {
  it("preserves properties", () => {
    const out = rewindFeatures([
      { properties: { PCON24CD: "E14001063" }, geometry: { type: "Polygon", coordinates: [CCW_SQUARE] } } as any,
    ]);
    expect(out[0].properties.PCON24CD).toBe("E14001063");
  });
});

describe("bboxPolygon", () => {
  it("returns a clockwise ring, so fitExtent sees the box and not its complement", () => {
    const poly = bboxPolygon([-2, 53, -1, 54]);
    expect(ringIsClockwise(poly.coordinates[0])).toBe(true);
    expect(geoArea(poly as any)).toBeLessThan(0.01);
  });
});

// The regression these functions exist for: every feature in the shipped
// boundary files read as the whole sphere, so every map rendered as a solid
// rectangle. Guards the data as well as the code.
const BOUNDARY_FILES = [
  "data/geography/pcon24-simplified.geojson",
  "data/geography/lad24-simplified.geojson",
  "data/geography/wd25-simplified.geojson",
];

describe("shipped boundary files, once rewound", () => {
  for (const file of BOUNDARY_FILES) {
    const path = resolve(process.cwd(), file);
    const present = existsSync(path);

    it.skipIf(!present)(`${file} has no whole-sphere features`, () => {
      const raw = JSON.parse(readFileSync(path, "utf8")) as { features: any[] };
      const features = rewindFeatures(raw.features);
      expect(features.length).toBeGreaterThan(0);

      const wholeSphere = features.filter((f) => geoArea(f as any) > 6);
      expect(wholeSphere).toHaveLength(0);

      // And bounds must be inside the UK, not [[-180,-90],[180,90]].
      for (const f of features) {
        const [[west, south], [east, north]] = geoBounds(f as any);
        expect(west).toBeGreaterThan(-14);
        expect(east).toBeLessThan(3);
        expect(south).toBeGreaterThan(49);
        expect(north).toBeLessThan(62);
      }
    });
  }
});
