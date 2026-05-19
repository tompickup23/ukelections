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
import { UK_WESTMINSTER_2026_APRIL_AVERAGE } from "../../lib/nationalPolling.js";
import { renderOgCard, type OgShare } from "../../lib/ogRenderer";

const BUILD_OG = process.env.BUILD_OG === "1";

interface Entry {
  slug: string; // url path WITHOUT leading /og and trailing .png — e.g. "index" or "seats/parliament/wigan"
  eyebrow: string;
  headline: string;
  subline?: string;
  shares?: OgShare[];
  sharesCaption?: string;
  accentColour?: string;
  partyChipLabel?: string | null;
  partyChipColour?: string | null;
}

// Helper: convert {party → number} into the top-N OgShare list with
// optional sub-labels (e.g. seat counts).
function topShares(
  rawShares: Record<string, number>,
  topN: number,
  subLabelOf?: (party: string, value: number) => string | undefined,
): OgShare[] {
  return Object.entries(rawShares)
    .filter(([, v]) => (v as number) > 0)
    .sort((a, b) => (b[1] as number) - (a[1] as number))
    .slice(0, topN)
    .map(([party, value]) => ({
      party,
      partyLabel: shortPartyLabel(party),
      pct: value as number,
      colour: partyColour(party),
      subLabel: subLabelOf ? subLabelOf(party, value as number) : undefined,
    }));
}

// Normalise an absolute-value distribution (e.g. seat counts) into
// 0..1 shares. Returns the same shape as topShares but with pct
// renormalised so the bar fills 100%.
function topSharesAbsolute(
  rawCounts: Record<string, number>,
  topN: number,
  subLabelOf?: (party: string, count: number) => string | undefined,
): OgShare[] {
  const entries = Object.entries(rawCounts).filter(([, v]) => (v as number) > 0);
  const sorted = entries.sort((a, b) => (b[1] as number) - (a[1] as number)).slice(0, topN);
  const sum = sorted.reduce((s, [, v]) => s + (v as number), 0) || 1;
  return sorted.map(([party, count]) => ({
    party,
    partyLabel: shortPartyLabel(party),
    pct: (count as number) / sum,
    colour: partyColour(party),
    subLabel: subLabelOf ? subLabelOf(party, count as number) : `${(count as number).toLocaleString()} seats`,
  }));
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
    const upcomingShares: OgShare[] = top.central_shares.slice(0, 5).map((s) => {
      const cand = top.key_candidates.find((c) => c.party === s.party);
      return {
        party: s.party,
        partyLabel: shortPartyLabel(s.party),
        pct: s.pct,
        colour: partyColour(s.party),
        subLabel: cand?.candidate,
      };
    });
    out.push({
      slug: "index",
      eyebrow: `Polling day · ${top.polling_day_short_label}`,
      headline: top.short_name,
      shares: upcomingShares,
      sharesCaption: "Central forecast — projected vote share",
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
    // Seats by party — top 6, normalised across the bar
    const geSeatRaw: Record<string, number> = {};
    for (const t of geHead.seat_tallies) geSeatRaw[t.party] = t.seats;
    const geSeatShares = topSharesAbsolute(
      geSeatRaw,
      6,
      (_p, n) => `${n.toLocaleString()} seats`,
    );
    out.push({
      slug: "forecasts/general-election",
      eyebrow: "If a UK general election were held today",
      headline: `${shortPartyLabel(geLeader.party)} ${geLeader.seats} seats`,
      shares: geSeatShares,
      sharesCaption: `Projected Commons composition · 326-seat majority threshold`,
      accentColour: partyColour(geLeader.party),
      partyChipLabel: shortPartyLabel(geLeader.party),
      partyChipColour: partyColour(geLeader.party),
    });
  }

  // 3. By-elections (Makerfield + any future ones from loadUpcomingElections)
  for (const u of upcoming) {
    const ucShares: OgShare[] = u.central_shares.slice(0, 5).map((s) => {
      const cand = u.key_candidates.find((c) => c.party === s.party);
      return {
        party: s.party,
        partyLabel: shortPartyLabel(s.party),
        pct: s.pct,
        colour: partyColour(s.party),
        subLabel: cand?.candidate,
      };
    });
    out.push({
      slug: `by-elections/${u.id.replace(/-\d{4}-\d{2}-\d{2}$/, "")}`,
      eyebrow: `Polling day · ${u.polling_day_short_label}`,
      headline: u.short_name,
      shares: ucShares,
      sharesCaption: "Central forecast — projected vote share",
      accentColour: partyColour(u.headline_winner || "Reform UK"),
      partyChipLabel: u.headline_winner ? shortPartyLabel(u.headline_winner) : null,
      partyChipColour: u.headline_winner ? partyColour(u.headline_winner) : null,
    });
  }

  // 4. Polling
  const ukShares = (UK_WESTMINSTER_2026_APRIL_AVERAGE.shares || {}) as Record<string, number>;
  const pollShares = topShares(ukShares, 6);
  out.push({
    slug: "polling",
    eyebrow: "Westminster polling — current",
    headline: "The numbers driving the forecast",
    shares: pollShares,
    sharesCaption: "Wikipedia 14-day rolling average + Restore Britain overlay",
    accentColour: "#12b5cb",
  });

  // 5 & 6. Past results + Councils hub — both share the same "council
  // majorities by party" breakdown as the visual.
  const may7 = loadMay7Headline();
  const controlSlugs = may7.control_by_party || {};
  // The control_by_party dict is slug-keyed (lab / con / ref / etc.);
  // expand to display names so the bar shares the partyColour palette.
  const councilControlRaw: Record<string, number> = {};
  for (const [slug, n] of Object.entries(controlSlugs)) {
    const name = partySlugToName(slug);
    councilControlRaw[name] = ((councilControlRaw[name] || 0) + (n as number));
  }
  const councilShares = topSharesAbsolute(
    councilControlRaw,
    6,
    (_p, n) => `${n} ${n === 1 ? "council" : "councils"}`,
  );

  out.push({
    slug: "past-results",
    eyebrow: "May 7 2026 · accuracy audit",
    headline: `${(may7.live_winner_accuracy * 100).toFixed(1)}% winners correct`,
    shares: councilShares,
    sharesCaption: "Council control after May 7",
    accentColour: partyColour("Reform UK"),
  });

  out.push({
    slug: "councils",
    eyebrow: "Council elections",
    headline: "Every council, before and after May 7",
    shares: councilShares,
    sharesCaption: `${may7.contesting_councils} contested · current control breakdown`,
    accentColour: "#1d4e89",
  });

  // 7. Parliament seat pages (650)
  const ge = loadGePredictions();
  const preds = ge.predictions || {};
  for (const [slug, p] of Object.entries(preds) as Array<[string, any]>) {
    if (!p?.prediction || !p?.name || !p?.winner) continue;
    const predRaw: Record<string, number> = {};
    for (const [party, info] of Object.entries(p.prediction)) {
      const pctShare = (info as any)?.pct;
      if (typeof pctShare === "number" && pctShare > 0) predRaw[party] = pctShare;
    }
    const predShares = topShares(predRaw, 5);
    const margin = (p.majority_pct || 0) * 100;
    out.push({
      slug: `seats/parliament/${slug}`,
      eyebrow: "General election forecast",
      headline: p.name,
      shares: predShares,
      sharesCaption: `Predicted vote share · ${margin.toFixed(1)}pp margin over ${shortPartyLabel(p.runner_up || "")}`,
      accentColour: partyColour(p.winner),
      partyChipLabel: shortPartyLabel(p.winner),
      partyChipColour: partyColour(p.winner),
    });
  }

  // 8. Council pages (~360) — show seats won by each party on May 7
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

    // Build seats-won-by-party shares from may7_wins.by_party (slug-keyed)
    const byPartySlug: Record<string, number> = (ctlRow?.may7_wins?.by_party || {}) as Record<string, number>;
    const byPartyRaw: Record<string, number> = {};
    for (const [slug, n] of Object.entries(byPartySlug)) {
      const count = n as number;
      if (count <= 0) continue;
      const name = partySlugToName(slug);
      byPartyRaw[name] = (byPartyRaw[name] || 0) + count;
    }
    const councilSeatShares = topSharesAbsolute(
      byPartyRaw,
      5,
      (_p, n) => `${n} ${n === 1 ? "seat" : "seats"}`,
    );

    out.push({
      slug: `seats/${w.council_slug}`,
      eyebrow: "Council · May 7 2026",
      headline: w.council_name || w.council_slug,
      shares: councilSeatShares.length > 0 ? councilSeatShares : undefined,
      sharesCaption: controllingSlug
        ? `Seats won on May 7 · ${controllingName} majority`
        : `Seats won on May 7 · No overall control`,
      subline: councilSeatShares.length > 0
        ? undefined
        : `No seat data yet · ${ctlRow?.reform?.won_seats || 0} Reform seats won`,
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
