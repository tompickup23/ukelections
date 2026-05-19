/**
 * /og/[...slug].png — dynamic per-page Open Graph card endpoint.
 *
 * Each path enumerated in getStaticPaths emits a 1200×630 PNG rendered
 * by Satori (text + flex layout → SVG) and Resvg (SVG → PNG). Per-card
 * cost is roughly 300-400ms on a modern Mac.
 *
 * Gated behind BUILD_OG=1. When unset, getStaticPaths returns []
 * which means no OG endpoints are generated — iteration builds stay
 * sub-10s. The production cron on vps-main sets BUILD_OG=1.
 *
 * Slug shape:
 *   /og/index.png                              → homepage
 *   /og/forecasts/general-election.png         → GE forecast hub
 *   /og/by-elections/makerfield.png            → Makerfield by-election
 *   /og/polling.png                            → /polling/
 *   /og/past-results.png                       → /past-results/
 *   /og/councils.png                           → /councils/
 *   /og/seats/parliament/<slug>.png            → each of 650 PCONs
 *   /og/seats/<council>.png                    → ~360 LADs
 *
 * Ward pages (~3,000) are skipped in v1 to keep build time under
 * 12 minutes; can be enabled later by uncommenting the wardEntries.
 */
import type { APIRoute } from "astro";
import {
  loadGePredictions,
  loadGeIdentity,
  loadIdentity,
  loadMay7Control,
  partyColour,
} from "../../lib/predictions";
import {
  loadGeHeadline,
  loadMay7Headline,
  loadUpcomingElections,
  shortPartyLabel,
  partySlugToName,
} from "../../lib/siteData";
import { renderOgCard } from "../../lib/ogRenderer";

const BUILD_OG = process.env.BUILD_OG === "1";

interface Entry {
  slug: string; // url path WITHOUT leading /og and trailing .png — e.g. "index" or "seats/parliament/wigan"
  eyebrow: string;
  headline: string;
  subline?: string;
  accentColour?: string;
  partyChipLabel?: string | null;
  partyChipColour?: string | null;
}

function pct(n: number, digits = 1): string {
  return `${(n * 100).toFixed(digits)}%`;
}

function buildEntries(): Entry[] {
  if (!BUILD_OG) return [];

  const out: Entry[] = [];

  // 1. Homepage — promote whatever the soonest upcoming contest is
  const upcoming = loadUpcomingElections();
  const top = upcoming[0];
  if (top) {
    out.push({
      slug: "index",
      eyebrow: "UK Elections",
      headline: top.short_name,
      subline: `${top.headline_summary}`,
      accentColour: partyColour(top.headline_winner || "Reform UK"),
      partyChipLabel: top.headline_winner
        ? `${shortPartyLabel(top.headline_winner)} forecast to win`
        : null,
      partyChipColour: top.headline_winner ? partyColour(top.headline_winner) : null,
    });
  } else {
    out.push({
      slug: "index",
      eyebrow: "UK Elections",
      headline: "Every constituency, every forecast",
      subline: "650 UK parliamentary seats · backtests on every page",
      accentColour: "#1d4e89",
    });
  }

  // 2. GE forecast hub
  const geHead = loadGeHeadline();
  const geLeader = geHead.seat_tallies[0];
  if (geLeader) {
    out.push({
      slug: "forecasts/general-election",
      eyebrow: "If a UK general election were held today",
      headline: `${shortPartyLabel(geLeader.party)} ${geLeader.seats} seats`,
      subline: `${geHead.total_seats} UK constituencies · 326-seat majority threshold`,
      accentColour: partyColour(geLeader.party),
      partyChipLabel: shortPartyLabel(geLeader.party),
      partyChipColour: partyColour(geLeader.party),
    });
  }

  // 3. By-elections (Makerfield + any future ones from loadUpcomingElections)
  for (const u of upcoming) {
    out.push({
      slug: `by-elections/${u.id.replace(/-\d{4}-\d{2}-\d{2}$/, "")}`,
      eyebrow: `Polling day · ${u.polling_day_short_label}`,
      headline: u.short_name,
      subline: u.headline_summary,
      accentColour: partyColour(u.headline_winner || "Reform UK"),
      partyChipLabel: u.headline_winner ? shortPartyLabel(u.headline_winner) : null,
      partyChipColour: u.headline_winner ? partyColour(u.headline_winner) : null,
    });
  }

  // 4. Polling
  out.push({
    slug: "polling",
    eyebrow: "Polling transparency",
    headline: "The numbers driving the forecast",
    subline: "Current UK / Welsh / Scottish Westminster polling, refresh history, methodology",
    accentColour: "#12b5cb",
  });

  // 5. Past results
  const may7 = loadMay7Headline();
  out.push({
    slug: "past-results",
    eyebrow: "May 7 2026 · accuracy audit",
    headline: `${(may7.live_winner_accuracy * 100).toFixed(1)}% winners correct`,
    subline: `${may7.reform_majorities} Reform majorities · ${may7.reform_seats_won.toLocaleString()} Reform seats won`,
    accentColour: partyColour("Reform UK"),
  });

  // 6. Councils hub
  out.push({
    slug: "councils",
    eyebrow: "Council elections",
    headline: "Every council, before and after May 7",
    subline: `${may7.contesting_councils} councils · sortable by control + next-vote date`,
    accentColour: "#1d4e89",
  });

  // 7. Parliament seat pages (650)
  const ge = loadGePredictions();
  const preds = ge.predictions || {};
  for (const [slug, p] of Object.entries(preds) as Array<[string, any]>) {
    if (!p?.prediction || !p?.name || !p?.winner) continue;
    const winShare = p.prediction[p.winner]?.pct || 0;
    const margin = (p.majority_pct || 0) * 100;
    out.push({
      slug: `seats/parliament/${slug}`,
      eyebrow: "General election forecast",
      headline: p.name,
      subline: `${shortPartyLabel(p.winner)} ${pct(winShare)} · ${margin.toFixed(1)}pp margin over ${shortPartyLabel(p.runner_up || "")}`,
      accentColour: partyColour(p.winner),
      partyChipLabel: shortPartyLabel(p.winner),
      partyChipColour: partyColour(p.winner),
    });
  }

  // 8. Council pages (~360)
  const identity = loadIdentity();
  const ctl = loadMay7Control();
  const ctlBySlug = new Map<string, any>();
  for (const c of ctl.councils as any[]) ctlBySlug.set(c.council_slug, c);
  const seenCouncils = new Set<string>();
  for (const w of identity.wards as any[]) {
    if (w.tier !== "local" && w.tier !== "mayor") continue;
    if (!w.council_slug || seenCouncils.has(w.council_slug)) continue;
    seenCouncils.add(w.council_slug);
    const ctlRow = ctlBySlug.get(w.council_slug);
    const controllingSlug: string | null = ctlRow?.control?.controlling_party || null;
    const controllingName = controllingSlug
      ? partySlugToName(controllingSlug)
      : "No overall control";
    out.push({
      slug: `seats/${w.council_slug}`,
      eyebrow: "Council · May 7 2026",
      headline: w.council_name || w.council_slug,
      subline: controllingSlug
        ? `${controllingName} majority · ${ctlRow?.reform?.won_seats || 0} Reform seats won`
        : `No overall control · ${ctlRow?.reform?.won_seats || 0} Reform seats won`,
      accentColour: partyColour(controllingName),
      partyChipLabel: controllingName,
      partyChipColour: partyColour(controllingName),
    });
  }

  return out;
}

const ENTRIES = buildEntries();

export async function getStaticPaths() {
  return ENTRIES.map((e) => ({ params: { slug: e.slug }, props: { entry: e } }));
}

export const GET: APIRoute = async ({ props }) => {
  const entry = (props as any).entry as Entry;
  const png = await renderOgCard({
    eyebrow: entry.eyebrow,
    headline: entry.headline,
    subline: entry.subline,
    accentColour: entry.accentColour,
    partyChipLabel: entry.partyChipLabel,
    partyChipColour: entry.partyChipColour,
  });
  return new Response(png, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
