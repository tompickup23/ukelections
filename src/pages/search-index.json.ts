import type { APIRoute } from "astro";
import { getPublicSearchEntries } from "../lib/site";
import { loadAreaLookup } from "../lib/areaLookupData";

export const prerender = true;
export const GET: APIRoute = () => {
  const index = loadAreaLookup();
  const entries = new Map(getPublicSearchEntries().map(entry => [entry.href, { ...entry } as Record<string, unknown>]));
  for (const lookup of [...index.constituencies, ...index.wards, ...index.councils]) {
    entries.set(lookup.href, {
      title: lookup.name, description: lookup.secondary, kind: "page", priority: 0,
      ...entries.get(lookup.href), href: lookup.href, lookup,
    });
  }
  for (const district of index.districts) {
    const entry = entries.get(district.href);
    if (entry) entry.district = district;
  }
  return new Response(JSON.stringify([...entries.values()]), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
