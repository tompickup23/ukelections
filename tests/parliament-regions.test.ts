import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { loadGePredictions } from "../src/lib/predictions";
import { PARLIAMENT_REGIONS, regionForSeat, seatsByRegion, getParliamentRegionPaths } from "../src/lib/parliamentRegions";
import { getAllSitemapPaths } from "../src/lib/sitemapPaths";

const records = Object.values((loadGePredictions() as any).predictions || {}).filter((r: any) => r?.prediction) as any[];

describe("parliamentary region hubs", () => {
  it("never share a URL with a constituency", () => {
    const seatSlugs = new Set(records.map((r) => r.slug));
    for (const region of PARLIAMENT_REGIONS) expect(seatSlugs.has(region.slug), region.slug).toBe(false);
  });

  it("place every constituency in exactly one hub, matching the 2024 allocation", () => {
    const byRegion = seatsByRegion(records);
    const counts = Object.fromEntries([...byRegion.entries()].map(([slug, list]) => [slug, list.length]));
    // Seats per nation and English region under the 2023 Boundary Review, as
    // contested on 4 July 2024.
    expect(counts).toEqual({
      "north-east": 27, "north-west": 73, "yorkshire-and-the-humber": 54, "east-midlands": 47,
      "west-midlands": 57, "east-of-england": 61, london: 75, "south-east": 91, "south-west": 58,
      wales: 32, scotland: 57, "northern-ireland": 18,
    });
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(records.length);
  });

  it("trusts the ONS code over a wrong country on the model record", () => {
    expect(regionForSeat({ name: "Motherwell Wishaw and Carluke", country: "england", region: null, pcon24cd: null })?.slug).toBe("scotland");
  });

  it("places seats in reorganised districts by their boundary, not by a typed table", () => {
    const bySlug = Object.fromEntries(records.map((r) => [r.slug, r]));
    expect(regionForSeat(bySlug["barrow-and-furness"])?.slug).toBe("north-west");
    expect(regionForSeat(bySlug["yeovil"])?.slug).toBe("south-west");
    expect(regionForSeat(bySlug["skipton-and-ripon"])?.slug).toBe("yorkshire-and-the-humber");
  });

  // getAllSitemapPaths() reads the gitignored historic corpus, as in
  // tests/sitemap-paths.test.ts: present on this Mac and vps-main, not on CI.
  it.skipIf(!existsSync(path.join(process.cwd(), "data/history/dc-historic-results.json")))("are in the sitemap", () => {
    const paths = new Set(getAllSitemapPaths());
    for (const p of getParliamentRegionPaths()) expect(paths.has(p), p).toBe(true);
  });
});
