import { describe, expect, it } from "vitest";
import {
  DEFAULT_SOCIAL_IMAGE_PATH,
  NAV_ITEMS,
  SEARCH_ENTRIES,
  SITE_NAME,
  SITE_URL,
  buildAbsoluteUrl,
  buildReleaseCollectionStructuredData,
  getIndexableSitePaths,
  getPublicSearchEntries,
  normalisePageTitle
} from "../src/lib/site";

describe("site metadata helpers", () => {
  it("normalises page titles without duplicating the site name", () => {
    expect(normalisePageTitle("Forecasts")).toBe("Forecasts | UK Elections");
    expect(normalisePageTitle("Forecasts | UK Elections")).toBe("Forecasts | UK Elections");
  });

  it("uses the correct site identity", () => {
    expect(SITE_NAME).toBe("UK Elections");
    expect(SITE_URL).toBe("https://ukelections.co.uk");
  });

  it("builds absolute URLs on the production domain", () => {
    expect(buildAbsoluteUrl("/forecasts/")).toBe(`${SITE_URL}/forecasts/`);
  });

  it("returns unique election-first indexable paths", () => {
    const paths = getIndexableSitePaths();

    expect(paths.length).toBeGreaterThanOrEqual(8);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toContain("/");
    expect(paths).toContain("/seats/");
    expect(paths).toContain("/forecasts/");
    expect(paths).toContain("/your-area/");
    expect(paths).not.toContain("/places/");
    expect(paths).not.toContain("/national/");
    expect(paths).not.toContain("/regional/");
    expect(paths).not.toContain("/findings/");
  });

  it("keeps navigation and search pointed at real pages", () => {
    const paths = new Set(getIndexableSitePaths());
    const searchEntries = getPublicSearchEntries();

    for (const item of NAV_ITEMS) {
      expect(paths.has(item.href)).toBe(true);
    }

    expect(searchEntries).toHaveLength(SEARCH_ENTRIES.length);
    for (const entry of searchEntries) {
      expect(paths.has(entry.href)).toBe(true);
    }
  });

  it("defaults social images to the SVG card", () => {
    expect(DEFAULT_SOCIAL_IMAGE_PATH).toBe("/og-card.svg");
  });

  it("builds release collection structured data with an item list", () => {
    const nodes = buildReleaseCollectionStructuredData(
      [
        {
          date: "2026-04-18",
          title: "UK Elections scaffold",
          summary: "Initial scaffold for UK-wide contest intelligence.",
          sourceUrl: "https://ukelections.co.uk"
        }
      ],
      {
        canonicalUrl: buildAbsoluteUrl("/releases/"),
        description: "Release diary",
        socialImageUrl: buildAbsoluteUrl("/og-card.svg")
      }
    );

    expect(nodes).toHaveLength(3);
    expect(nodes[1]["@type"]).toBe("CollectionPage");
    expect(nodes[2]["@type"]).toBe("ItemList");
  });
});
