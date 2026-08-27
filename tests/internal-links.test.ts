import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getIndexableSitePaths, NAV_GROUPS } from "../src/lib/site";
import { getParliamentSeatPaths } from "../src/lib/sitemapPaths";

/**
 * The 650 constituency pages were reachable only from sitemap.xml. Two pages on
 * the whole site linked to any of them, covering 60 URLs, so 590 were orphans:
 * Google discovered them and declined to index most, which is what a page with
 * no internal link pointing at it looks like from a crawler's side.
 *
 * These assert the index exists and that the nav points at it, which is the
 * cheap half. The expensive half (no orphan in the built output) is asserted
 * against dist in tests/build-output.test.ts, which only runs after a build.
 */
const CORPUS = path.join(process.cwd(), "data/predictions/ge-next/constituencies.json");
const hasCorpus = existsSync(CORPUS);

describe("constituency index", () => {
  it("is a route the sitemap and nav both know about", () => {
    expect(getIndexableSitePaths()).toContain("/seats/parliament/");
  });

  it("is what the nav's constituency entry points at, not the council browser", () => {
    const items = NAV_GROUPS.flatMap((group) => group.items);
    const constituencyEntry = items.find((i) => /constituenc/i.test(i.label));
    expect(constituencyEntry).toBeDefined();
    // It pointed at /seats/, which lists councils. The label said 650
    // Constituencies and the page had none on it.
    expect(constituencyEntry!.href).toBe("/seats/parliament/");
  });

  it("has a page file backing the route", () => {
    expect(existsSync(path.join(process.cwd(), "src/pages/seats/parliament/index.astro"))).toBe(true);
  });

  it.skipIf(!hasCorpus)("enumerates every constituency the router builds", () => {
    // The index renders from the same bundle getParliamentSeatPaths() reads, so
    // if that returns 650 the index cannot silently list fewer.
    expect(getParliamentSeatPaths().length).toBeGreaterThanOrEqual(600);
  });
});
