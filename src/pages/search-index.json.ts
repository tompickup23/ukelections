import type { APIRoute } from "astro";
import { getPublicSearchEntries } from "../lib/site-search";
import { getCollection } from "astro:content";

export const prerender = true;

export const GET: APIRoute = async () => {
  const entries = getPublicSearchEntries();

  // Add findings to search index
  const findings = await getCollection("findings");
  const findingEntries = findings.map((f) => ({
    href: `/findings/${f.id.replace(/\.md$/, "")}/`,
    title: f.data.headline,
    kind: "finding" as const,
    kicker: f.data.category,
    description: f.data.summary,
    priority: 80,
    searchText: `${f.data.headline} ${f.data.summary} ${f.data.category} ${f.data.stat_value} finding research analysis`.toLowerCase()
  }));

  return new Response(JSON.stringify([...entries, ...findingEntries]), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=3600"
    }
  });
};

