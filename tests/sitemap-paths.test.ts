import { existsSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadIdentity } from "../src/lib/predictions";
import { getIndexableSitePaths } from "../src/lib/site";
import {
  getAllSitemapPaths,
  getParliamentSeatPaths,
  getSeatPaths,
  wardSlug,
} from "../src/lib/sitemapPaths";

// This suite asserts against the real identity corpus, and loadIdentity() reads
// data/history/dc-historic-results.json, which is 64 MB and gitignored. It exists
// on vps-main and on a developer machine that has run the pipeline; it does not
// exist on a GitHub Actions runner, where the suite therefore died on ENOENT and
// kept CI red on every PR regardless of the change.
//
// Skipping where the corpus is absent rather than deleting the assertions: the
// build that actually gates a deploy is the vps-main one (step 8 of
// scripts/refresh-pipeline.mjs), and the corpus is present there, so the suite
// still runs for real everywhere it can protect anything.
const CORPUS = path.join(process.cwd(), "data/history/dc-historic-results.json");
const hasCorpus = existsSync(CORPUS);

if (!hasCorpus) {
  console.warn(
    `[sitemap-paths] skipped: ${CORPUS} not present. This is expected on a CI runner and NOT expected on vps-main.`
  );
}

describe.skipIf(!hasCorpus)("sitemap paths", () => {
  // loadIdentity() reads tens of MB of JSON on first call and memoises it.
  // Pay that in a hook so the cost isn't billed to whichever it() happens to
  // run first — that made this suite fail on timeout whenever the machine was
  // busy, which on vps-main means it blocked the nightly deploy.
  beforeAll(() => {
    loadIdentity();
  });

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
