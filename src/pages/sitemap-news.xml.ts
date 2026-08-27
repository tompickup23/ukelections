import type { APIRoute } from "astro";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { SITE_URL } from "../lib/site";
import { newsPublicationDate } from "../lib/seo";

export const prerender = true;

/**
 * Google News sitemap.
 *
 * A news sitemap may only carry content published in the last 48 hours, so this
 * emits council by-election pages whose polling day falls within the last two
 * days of the build. The site rebuilds nightly, so the window rolls forward on
 * its own; an empty urlset is valid when no contest is in it.
 *
 * Two rules this had wrong before, both of which cost News eligibility rather
 * than causing a visible error:
 *
 *   1. The window ran 48 hours either side of polling day, so a contest polling
 *      tomorrow was advertised as news that had already been published. The
 *      window is now post-polling only. The page template decides whether to
 *      emit its NewsArticle node by the same test against the same helper, so
 *      the entries here are always a subset of the pages that carry one.
 *   2. publication_date was a bare date and the title carried a raw ISO date
 *      ("Council by-election 2026-08-27"), which is what a reader would have
 *      seen in News. Both now use the shared helpers.
 */

const esc = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

const WINDOW_MS = 48 * 60 * 60 * 1000;

/**
 * Mirrors newsHeadline() in by-elections/local/[slug].astro. Google truncates a
 * News title past 110 characters, so fall back to the shorter form rather than
 * shipping one that gets cut mid-ward-name. No date in the title: News prints
 * the publication date itself, and the old form ended "...by-election 2026-08-27".
 */
export function newsTitle(wardName: string, councilName: string, declared: boolean): string {
  const tail = declared ? "council by-election result" : "council by-election";
  const forms = [`${wardName}, ${councilName}: ${tail}`, `${wardName}: ${tail}`];
  return forms.find((f) => f.length <= 110) ?? forms[forms.length - 1].slice(0, 110);
}

interface NewsEntry {
  loc: string;
  publishedAt: string;
  title: string;
}

export function collectNewsEntries(now: number, dirAbs: string): NewsEntry[] {
  if (!existsSync(dirAbs)) return [];
  const entries: NewsEntry[] = [];

  for (const file of readdirSync(dirAbs)) {
    if (!file.endsWith(".json") || file.startsWith("_")) continue;
    let d: any;
    try {
      d = JSON.parse(readFileSync(path.join(dirAbs, file), "utf8"));
    } catch {
      continue;
    }
    const c = d?.contest;
    if (!c?.polling_day || !d?.slug) continue;
    const publishedAt = newsPublicationDate(c.polling_day);
    const published = new Date(publishedAt).getTime();
    if (Number.isNaN(published)) continue;
    // Published, and within the last 48 hours. Nothing dated in the future.
    const age = now - published;
    if (age < 0 || age > WINDOW_MS) continue;

    entries.push({
      loc: `${SITE_URL}/by-elections/local/${d.slug}/`,
      publishedAt,
      title: newsTitle(c.ward_name, c.council_name, Boolean(d?.result?.winner_party))
    });
  }

  return entries.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

export const GET: APIRoute = () => {
  const entries = collectNewsEntries(Date.now(), path.join(process.cwd(), "data/contests/local-byelections"));

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
<news:publication_date>${e.publishedAt}</news:publication_date>
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
