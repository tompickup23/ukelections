import type { APIRoute } from "astro";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { SITE_URL } from "../lib/site";

export const prerender = true;

/**
 * Google News sitemap. News sitemaps may only list content published in the
 * last 48 hours, so this emits council by-election pages whose polling day
 * falls within the last two days of the build: the window in which the page
 * carries the freshly declared (or imminently declaring) result. The site
 * rebuilds nightly, so the window rolls forward on its own. An empty urlset
 * is valid when no contest is in the window.
 */

const esc = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

export const GET: APIRoute = () => {
  const dirAbs = path.join(process.cwd(), "data/contests/local-byelections");
  const now = Date.now();
  const windowMs = 48 * 60 * 60 * 1000;
  const entries: { loc: string; date: string; title: string }[] = [];

  if (existsSync(dirAbs)) {
    for (const f of readdirSync(dirAbs)) {
      if (!f.endsWith(".json") || f.startsWith("_")) continue;
      let d: any;
      try {
        d = JSON.parse(readFileSync(path.join(dirAbs, f), "utf8"));
      } catch {
        continue;
      }
      const c = d?.contest;
      if (!c?.polling_day || !d?.slug) continue;
      const polled = new Date(`${c.polling_day}T22:00:00Z`).getTime();
      if (Number.isNaN(polled) || now - polled > windowMs || polled - now > windowMs) continue;
      entries.push({
        loc: `${SITE_URL}/by-elections/local/${d.slug}/`,
        date: c.polling_day,
        title: `${c.ward_name}, ${c.council_name}. Council by-election ${c.polling_day}`
      });
    }
  }

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${entries
  .map(
    (e) => `<url>
<loc>${esc(e.loc)}</loc>
<news:news>
<news:publication>
<news:name>UK Elections</news:name>
<news:language>en</news:language>
</news:publication>
<news:publication_date>${e.date}</news:publication_date>
<news:title>${esc(e.title)}</news:title>
</news:news>
</url>`
  )
  .join("\n")}
</urlset>
`;
  return new Response(body, {
    headers: { "Content-Type": "application/xml; charset=utf-8" }
  });
};
