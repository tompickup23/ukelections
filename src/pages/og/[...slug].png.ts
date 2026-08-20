/**
 * /og/[...slug].png. dynamic per-page Open Graph card endpoint.
 *
 * Each path enumerated in getStaticPaths emits a 1200×630 PNG rendered
 * by Satori (text + flex layout → SVG) and Resvg (SVG → PNG). Per-card
 * cost is roughly 300-400ms on a modern Mac.
 *
 * The card list lives in src/lib/ogEntries.ts, shared with
 * BaseLayout.astro so a page only advertises /og/<slug>.png when this
 * build actually rendered it. See that file for the slug shape and the
 * BUILD_OG gate.
 */
import type { APIRoute } from "astro";
import { OG_ENTRIES, type OgEntry } from "../../lib/ogEntries";
import { renderOgCard } from "../../lib/ogRenderer";

export async function getStaticPaths() {
  return OG_ENTRIES.map((e) => ({ params: { slug: e.slug }, props: { entry: e } }));
}

export const GET: APIRoute = async ({ props }) => {
  const entry = (props as any).entry as OgEntry;
  const png = await renderOgCard({
    eyebrow: entry.eyebrow,
    headline: entry.headline,
    subline: entry.subline,
    shares: entry.shares,
    sharesCaption: entry.sharesCaption,
    accentColour: entry.accentColour,
    partyChipLabel: entry.partyChipLabel,
    partyChipColour: entry.partyChipColour,
  });
  return new Response(new Uint8Array(png), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
