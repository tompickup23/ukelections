import type { APIRoute } from "astro";
import { buildAbsoluteUrl } from "../lib/site";
import { getAllSitemapPaths, getLastmodByPath } from "../lib/sitemapPaths";

export const prerender = true;

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export const GET: APIRoute = () => {
  // Only the paths with a genuine content date carry a lastmod. See
  // getLastmodByPath() for why a uniform build-time stamp would be worse than none.
  const lastmod = getLastmodByPath();
  const urlEntries = getAllSitemapPaths()
    .map((path) => {
      const changed = lastmod[path];
      return (
        `  <url>\n    <loc>${escapeXml(buildAbsoluteUrl(path))}</loc>` +
        (changed ? `\n    <lastmod>${escapeXml(changed)}</lastmod>` : "") +
        `\n  </url>`
      );
    })
    .join("\n");

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urlEntries}\n</urlset>\n`,
    {
      headers: {
        "Content-Type": "application/xml; charset=utf-8"
      }
    }
  );
};
