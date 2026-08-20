import { describe, expect, it } from "vitest";
import { loadIdentity } from "../src/lib/predictions";
import { getIndexableSitePaths } from "../src/lib/site";
import {
  getAllSitemapPaths,
  getParliamentSeatPaths,
  getSeatPaths,
  wardSlug,
} from "../src/lib/sitemapPaths";

describe("sitemap paths", () => {
  it("covers every elected seat, not just the hand-listed static routes", () => {
    const identity = loadIdentity();
    const elected = identity.wards.filter(
      (ward) => ward.tier === "local" || ward.tier === "mayor"
    );
    const councils = new Set(elected.map((ward) => ward.council_slug));

    const seatPaths = getSeatPaths();

    // One page per ward plus one per council. The sitemap regressed to 35 URLs
    // against 3,820 built pages once before, so assert the real shape.
    expect(seatPaths.length).toBeGreaterThanOrEqual(councils.size);
    // "/seats/<council>/" splits into 4 parts; a ward page splits into 5.
    expect(seatPaths.filter((path) => path.split("/").length === 4).length).toBe(
      councils.size
    );
    expect(seatPaths.length).toBeGreaterThan(1_000);
  });

  it("derives ward slugs exactly as the ward route does", () => {
    expect(wardSlug({ ward_slug: "bank-hall", gss_code: "E05000001" })).toBe(
      "bank-hall"
    );
    expect(wardSlug({ gss_code: "E05000001" })).toBe("E05000001");
    expect(wardSlug({ ballot_paper_id: "local.burnley.bank-hall.2026-05-07" })).toBe(
      "bank-hall"
    );
  });

  it("includes parliamentary seats that have a prediction", () => {
    const paths = getParliamentSeatPaths();
    expect(paths.length).toBeGreaterThan(100);
    for (const path of paths.slice(0, 20)) {
      expect(path.startsWith("/seats/parliament/")).toBe(true);
      expect(path.endsWith("/")).toBe(true);
    }
  });

  it("keeps every static path and emits no duplicates", () => {
    const all = getAllSitemapPaths();
    expect(new Set(all).size).toBe(all.length);
    for (const path of getIndexableSitePaths()) {
      expect(all).toContain(path);
    }
    // Sitemaps cap at 50,000 URLs; if the site ever passes that, split the file.
    expect(all.length).toBeLessThan(50_000);
  });
});
