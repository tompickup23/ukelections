import type { APIRoute } from "astro";
import { buildAbsoluteUrl } from "../lib/site";
import { SITEMAP_GROUPS } from "../lib/sitemapPaths";

export const prerender = true;

// A sitemap index, not a URL list, since the quality reset (register T13,
// November 2026). It stays at /sitemap.xml, the address robots.txt and Search
// Console already hold, and points at one child file per page type
// (src/pages/sitemap-[group].xml.ts). The child files carry no lastmod from
// the build; the publisher stamps them, and each index entry, from the
// discovery ledger (scripts/lib/discovery-manifest.mjs).
export const GET: APIRoute = () => {
  const entries = SITEMAP_GROUPS
    .map((group) => `  <sitemap>\n    <loc>${buildAbsoluteUrl(`/sitemap-${group}.xml`)}</loc>\n  </sitemap>`)
    .join("\n");
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</sitemapindex>\n`,
    { headers: { "Content-Type": "application/xml; charset=utf-8" } }
  );
};
