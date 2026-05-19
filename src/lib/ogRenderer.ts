/**
 * ogRenderer.ts — Satori + Resvg rendering pipeline for per-page
 * Open Graph cards.
 *
 * Loaded once per build process. Fonts (Sora + Manrope) live in
 * data/fonts/ and are read on first call.
 *
 * Gated behind the BUILD_OG environment variable so iteration builds
 * (where you don't care about social previews) skip the ~20 min
 * full-site render cost. The production cron on vps-main sets
 * BUILD_OG=1.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

let _fontCache: any[] | null = null;
function loadFonts(): any[] {
  if (_fontCache) return _fontCache;
  const sora800 = readFileSync(resolve(process.cwd(), "data/fonts/Sora-ExtraBold.ttf"));
  const manrope600 = readFileSync(resolve(process.cwd(), "data/fonts/Manrope-SemiBold.ttf"));
  const manrope400 = readFileSync(resolve(process.cwd(), "data/fonts/Manrope-Regular.ttf"));
  _fontCache = [
    { name: "Sora", data: sora800, weight: 800, style: "normal" },
    { name: "Manrope", data: manrope600, weight: 600, style: "normal" },
    { name: "Manrope", data: manrope400, weight: 400, style: "normal" },
  ];
  return _fontCache;
}

export interface OgShare {
  party: string;
  partyLabel: string;
  pct: number;          // 0..1
  colour: string;
  /** Optional secondary value to render under the % (e.g. seat count, candidate name) */
  subLabel?: string;
}

export interface OgCardOpts {
  /** Big top-line eyebrow text (e.g. "GENERAL ELECTION FORECAST") */
  eyebrow: string;
  /** Big main headline (Sora display, the constituency/contest/council name) */
  headline: string;
  /**
   * Replaces the old text subline with a stacked horizontal race bar
   * showing the top 5-6 party shares. Each segment is sized by `pct`
   * and coloured by `colour`. When absent the card falls back to the
   * old text subline.
   */
  shares?: OgShare[];
  /**
   * Caption for the shares unit — "Predicted vote share", "Seats won",
   * "National polling", etc.
   */
  sharesCaption?: string;
  /** Fallback text subline when no shares are provided */
  subline?: string;
  /** Background accent colour — usually partyColour() of the winner */
  accentColour?: string;
  /** Optional party-pill chip in the corner (party display name) */
  partyChipLabel?: string | null;
  /** Optional party-pill chip colour */
  partyChipColour?: string | null;
}

/**
 * Renders an OG card to a PNG Buffer.
 * Satori → SVG → Resvg → PNG. All synchronous after the font load.
 */
export async function renderOgCard(opts: OgCardOpts): Promise<Buffer> {
  const {
    eyebrow,
    headline,
    subline,
    shares,
    sharesCaption,
    accentColour = "#1d4e89",
    partyChipLabel = null,
    partyChipColour = null,
  } = opts;

  // Each share segment is sized by pct relative to the sum of all
  // tracked shares — important because the input may not sum to 1
  // (we typically pass top 5–6 parties, so others are excluded).
  const trackedShares = (shares || []).filter((s) => s.pct > 0);
  const sharesTotal = trackedShares.reduce((sum, s) => sum + s.pct, 0);
  const hasShares = trackedShares.length > 0 && sharesTotal > 0;

  // Inline label visible only on segments that occupy at least 11% of
  // the bar — narrower segments still render the swatch + sit in the
  // legend strip below.
  const labelMinPct = 0.11;

  const fonts = loadFonts();

  // The card uses a Satori-flavoured Flexbox layout. Satori doesn't
  // accept JSX in this entry — we feed it a plain element tree (the
  // shape satori expects under the hood).
  const tree: any = {
    type: "div",
    props: {
      style: {
        display: "flex",
        flexDirection: "column",
        width: OG_WIDTH,
        height: OG_HEIGHT,
        padding: 80,
        background: "#ffffff",
        backgroundImage: `linear-gradient(135deg, ${accentColour}14 0%, ${accentColour}04 50%, #ffffff 100%)`,
        fontFamily: "Manrope",
        color: "#111827",
        position: "relative",
      },
      children: [
        // Coloured accent strip down the left edge
        {
          type: "div",
          props: {
            style: {
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: 14,
              background: accentColour,
            },
          },
        },
        // Eyebrow
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: 3.2,
              color: accentColour,
              textTransform: "uppercase",
              marginBottom: 24,
            },
            children: eyebrow,
          },
        },
        // Headline (Sora 96) — slightly smaller when the shares bar is
        // present, since the chart adds visual weight below.
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              fontFamily: "Sora",
              fontSize: hasShares
                ? headline.length > 22 ? 72 : 92
                : headline.length > 24 ? 84 : 104,
              fontWeight: 800,
              lineHeight: 1.02,
              letterSpacing: -2,
              color: "#0f172a",
              maxWidth: OG_WIDTH - 200,
            },
            children: headline,
          },
        },
        // Shares bar (preferred) OR fallback subline text.
        hasShares
          ? {
              type: "div",
              props: {
                style: {
                  display: "flex",
                  flexDirection: "column",
                  marginTop: 36,
                  maxWidth: OG_WIDTH - 200,
                },
                children: [
                  // Optional caption above the bar
                  sharesCaption
                    ? {
                        type: "div",
                        props: {
                          style: {
                            display: "flex",
                            fontSize: 18,
                            fontWeight: 700,
                            letterSpacing: 2.4,
                            color: "#475467",
                            textTransform: "uppercase",
                            marginBottom: 10,
                          },
                          children: sharesCaption,
                        },
                      }
                    : null,
                  // The stacked race bar itself
                  {
                    type: "div",
                    props: {
                      style: {
                        display: "flex",
                        width: "100%",
                        height: 56,
                        borderRadius: 10,
                        overflow: "hidden",
                        boxShadow: "inset 0 0 0 1px rgba(15, 23, 42, 0.08)",
                      },
                      children: trackedShares.map((s) => {
                        const rel = s.pct / sharesTotal;
                        const wide = rel >= labelMinPct;
                        return {
                          type: "div",
                          props: {
                            style: {
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "center",
                              justifyContent: "center",
                              flexBasis: `${(rel * 100).toFixed(2)}%`,
                              background: s.colour,
                              color: "#ffffff",
                              fontSize: 18,
                              fontWeight: 800,
                              lineHeight: 1.05,
                              padding: "0 4px",
                            },
                            children: wide
                              ? [
                                  {
                                    type: "div",
                                    props: {
                                      style: { display: "flex", fontSize: 16, opacity: 0.92, letterSpacing: 0.8 },
                                      children: s.partyLabel,
                                    },
                                  },
                                  {
                                    type: "div",
                                    props: {
                                      style: { display: "flex", fontSize: 22, marginTop: 1 },
                                      children: `${(s.pct * 100).toFixed(1)}%`,
                                    },
                                  },
                                ]
                              : "",
                          },
                        };
                      }),
                    },
                  },
                  // Legend strip below the bar — every party + share + sub-label
                  {
                    type: "div",
                    props: {
                      style: {
                        display: "flex",
                        flexWrap: "wrap",
                        marginTop: 14,
                        rowGap: 6,
                        columnGap: 22,
                      },
                      children: trackedShares.map((s) => ({
                        type: "div",
                        props: {
                          style: {
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            fontSize: 20,
                          },
                          children: [
                            {
                              type: "div",
                              props: {
                                style: {
                                  display: "flex",
                                  width: 12,
                                  height: 12,
                                  borderRadius: 3,
                                  background: s.colour,
                                },
                              },
                            },
                            {
                              type: "div",
                              props: {
                                style: { display: "flex", fontWeight: 700, color: "#0f172a" },
                                children: s.partyLabel,
                              },
                            },
                            {
                              type: "div",
                              props: {
                                style: { display: "flex", fontWeight: 600, color: "#475467" },
                                children: `${(s.pct * 100).toFixed(1)}%`,
                              },
                            },
                            s.subLabel
                              ? {
                                  type: "div",
                                  props: {
                                    style: { display: "flex", color: "#667085" },
                                    children: `· ${s.subLabel}`,
                                  },
                                }
                              : null,
                          ].filter(Boolean),
                        },
                      })),
                    },
                  },
                ].filter(Boolean),
              },
            }
          : subline
            ? {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    marginTop: 28,
                    fontSize: 36,
                    fontWeight: 600,
                    color: "#374151",
                    maxWidth: OG_WIDTH - 200,
                  },
                  children: subline,
                },
              }
            : null,
        // Spacer that pushes the footer to the bottom
        {
          type: "div",
          props: { style: { display: "flex", flexGrow: 1 } },
        },
        // Footer row
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: 28,
              fontWeight: 700,
              color: "#475467",
            },
            children: [
              {
                type: "div",
                props: {
                  style: { display: "flex" },
                  children: "ukelections.co.uk",
                },
              },
              partyChipLabel
                ? {
                    type: "div",
                    props: {
                      style: {
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "10px 22px",
                        background: "#ffffff",
                        borderRadius: 999,
                        border: "1px solid #d4dce6",
                        fontSize: 22,
                        fontWeight: 700,
                        color: "#111827",
                      },
                      children: [
                        {
                          type: "div",
                          props: {
                            style: {
                              display: "flex",
                              width: 14,
                              height: 14,
                              borderRadius: 7,
                              background: partyChipColour || accentColour,
                            },
                          },
                        },
                        {
                          type: "div",
                          props: { style: { display: "flex" }, children: partyChipLabel },
                        },
                      ],
                    },
                  }
                : null,
            ].filter(Boolean),
          },
        },
      ].filter(Boolean),
    },
  };

  const svg = await satori(tree, {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    fonts: fonts as any,
  });

  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: OG_WIDTH },
  });
  return Buffer.from(resvg.render().asPng());
}
