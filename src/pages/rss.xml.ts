import type { APIRoute } from "astro";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { RELEASES, SITE_URL } from "../lib/site";

export const prerender = true;

/**
 * RSS 2.0 feed: model/build releases plus declared council by-election
 * results. Both item kinds carry a stable date (the release date, or polling
 * day for a declared result), so the feed does not churn on nightly rebuilds.
 */

interface FeedItem {
  title: string;
  link: string;
  description: string;
  isoDate: string;
}

const esc = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

const rfc822 = (iso: string) => new Date(`${iso}T06:00:00Z`).toUTCString();

function byElectionResultItems(): FeedItem[] {
  const dirAbs = path.join(process.cwd(), "data/contests/local-byelections");
  if (!existsSync(dirAbs)) return [];
  const items: FeedItem[] = [];
  for (const f of readdirSync(dirAbs)) {
    if (!f.endsWith(".json") || f.startsWith("_")) continue;
    let d: any;
    try {
      d = JSON.parse(readFileSync(path.join(dirAbs, f), "utf8"));
    } catch {
      continue;
    }
    const c = d?.contest;
    const result = d?.result;
    if (!c?.polling_day || !d?.slug || !result?.winner_party) continue;
    const majority =
      typeof result.majority_votes === "number" && result.runner_up_party
        ? ` with a majority of ${result.majority_votes.toLocaleString("en-GB")} over ${result.runner_up_party}`
        : "";
    items.push({
      title: `${c.ward_name} (${c.council_name}) by-election result: ${result.winner_party} win`,
      link: `${SITE_URL}/by-elections/local/${d.slug}/`,
      description: `${result.winner_party} won the ${c.ward_name} council by-election in ${c.council_name}${majority}. Full result, the prior ward history and how the projection compared are on the page.`,
      isoDate: c.polling_day
    });
  }
  return items;
}

export const GET: APIRoute = () => {
  const releaseItems: FeedItem[] = RELEASES.map((r) => ({
    title: r.title,
    link: `${SITE_URL}/releases/`,
    description: r.summary,
    isoDate: r.date
  }));

  const items = [...releaseItems, ...byElectionResultItems()]
    .sort((a, b) => b.isoDate.localeCompare(a.isoDate))
    .slice(0, 50);

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>UK Elections</title>
<link>${SITE_URL}/</link>
<atom:link href="${SITE_URL}/rss.xml" rel="self" type="application/rss+xml"/>
<description>Forecasts, results and backtests for UK elections: every constituency, every council, every by-election, with the record published either way.</description>
<language>en-GB</language>
${items
  .map(
    (i) => `<item>
<title>${esc(i.title)}</title>
<link>${esc(i.link)}</link>
<guid isPermaLink="false">${esc(`${i.link}#${i.isoDate}`)}</guid>
<pubDate>${rfc822(i.isoDate)}</pubDate>
<description>${esc(i.description)}</description>
</item>`
  )
  .join("\n")}
</channel>
</rss>
`;
  return new Response(body, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" }
  });
};
