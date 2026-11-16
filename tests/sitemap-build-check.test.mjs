import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertNonEmptySitemaps } from "../scripts/lib/sitemap-build-check.mjs";
const directories = [];
const fixture = () => { const dir = mkdtempSync(path.join(tmpdir(), "uke-sitemaps-")); directories.push(dir); return dir; };
afterEach(() => directories.splice(0).forEach(dir => rmSync(dir, { recursive: true })));

describe("built sitemap gate", () => {
  it("rejects an empty urlset even when another sitemap has entries", () => {
    const dir = fixture();
    writeFileSync(path.join(dir, "sitemap.xml"), '<urlset><url><loc>https://ukelections.co.uk/</loc></url></urlset>');
    mkdirSync(path.join(dir, "nested"));
    writeFileSync(path.join(dir, "nested", "empty.xml"), '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
    expect(() => assertNonEmptySitemaps(dir)).toThrow("Empty sitemap: nested/empty.xml");
  });
  it("accepts populated sitemaps and ignores RSS", () => {
    const dir = fixture();
    writeFileSync(path.join(dir, "sitemap.xml"), '<sitemapindex><sitemap><loc>https://ukelections.co.uk/core.xml</loc></sitemap></sitemapindex>');
    writeFileSync(path.join(dir, "core.xml"), '<urlset><url><loc>https://ukelections.co.uk/</loc></url></urlset>');
    writeFileSync(path.join(dir, "feed.xml"), '<rss><channel></channel></rss>');
    expect(assertNonEmptySitemaps(dir)).toHaveLength(2);
  });
  it("rejects an empty index and a build with no sitemap", () => {
    const dir = fixture();
    expect(() => assertNonEmptySitemaps(dir)).toThrow("No built sitemap");
    writeFileSync(path.join(dir, "sitemap.xml"), '<sitemapindex></sitemapindex>');
    expect(() => assertNonEmptySitemaps(dir)).toThrow("Empty sitemap");
  });
});
