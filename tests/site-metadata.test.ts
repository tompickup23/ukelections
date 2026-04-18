import { describe, expect, it } from "vitest";
import {
  DEFAULT_SOCIAL_IMAGE_PATH,
  SITE_NAME,
  SITE_URL,
  buildAbsoluteUrl,
  buildReleaseCollectionStructuredData,
  getIndexableSitePaths,
  normalisePageTitle
} from "../src/lib/site";

describe("site metadata helpers", () => {
  it("normalises page titles without duplicating the site name", () => {
    expect(normalisePageTitle("National")).toBe("National | UK Elections");
    expect(normalisePageTitle("National | UK Elections")).toBe("National | UK Elections");
  });

  it("uses the correct site identity", () => {
    expect(SITE_NAME).toBe("UK Elections");
    expect(SITE_URL).toBe("https://ukelections.co.uk");
  });

  it("builds absolute URLs on the production domain", () => {
    expect(buildAbsoluteUrl("/national/")).toBe(`${SITE_URL}/national/`);
  });

  it("returns unique indexable paths", () => {
    const paths = getIndexableSitePaths();

    expect(paths.length).toBeGreaterThanOrEqual(6);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toContain("/");
    expect(paths).toContain("/places/");
    // Asylum-specific pages should not exist
    expect(paths).not.toContain("/routes/");
    expect(paths).not.toContain("/entities/");
    expect(paths).not.toContain("/spending/");
    expect(paths).not.toContain("/councils/");
  });

  it("defaults social images to the SVG card", () => {
    expect(DEFAULT_SOCIAL_IMAGE_PATH).toBe("/og-card.svg");
  });

  it("builds release collection structured data with an item list", () => {
    const nodes = buildReleaseCollectionStructuredData(
      [
        {
          date: "2026-04-14",
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
