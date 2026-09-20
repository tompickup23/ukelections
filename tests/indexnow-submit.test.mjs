import { describe, expect, it } from "vitest";
import { urlsFromSitemapXml, validateUrls } from "../scripts/indexnow-submit.mjs";

describe("IndexNow safety", () => {
  it("selects only sitemap URLs with a truthful lastmod at or after the cutoff", () => {
    const xml = `<?xml version="1.0"?><urlset>
      <url><loc>https://ukelections.co.uk/old/</loc><lastmod>2026-09-01</lastmod></url>
      <url><loc>https://ukelections.co.uk/new/</loc><lastmod>2026-09-20</lastmod></url>
      <url><loc>https://ukelections.co.uk/no-date/</loc></url>
    </urlset>`;
    expect(urlsFromSitemapXml(xml, "2026-09-20")).toEqual(["https://ukelections.co.uk/new/"]);
  });

  it("deduplicates same-host canonicals and rejects query, fragment and foreign-host URLs", () => {
    const canonical = "https://ukelections.co.uk/councils/";
    expect(validateUrls([canonical, canonical], "https://ukelections.co.uk")).toEqual([canonical]);
    expect(() => validateUrls([`${canonical}?preview=1`], "https://ukelections.co.uk")).toThrow(/canonical/);
    expect(() => validateUrls(["https://example.com/councils/"], "https://ukelections.co.uk")).toThrow(/same-host/);
  });
});
