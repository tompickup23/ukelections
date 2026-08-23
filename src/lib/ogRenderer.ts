/**
 * ogRenderer.ts. Satori + Resvg rendering pipeline for per-page
 * Open Graph cards.
 *
 * Loaded once per build process. Fonts (Source Serif 4 + Source Sans 3)
 * live in data/fonts/ and are read on first call.
 *
 * Gated behind the BUILD_OG environment variable so iteration builds
 * (where you don't care about social previews) skip the ~20 min
 * full-site render cost. The production cron on vps-main sets
 * BUILD_OG=1.
 *
 * Standard layout (shared with ukdemographics.co.uk + asylumstats.co.uk):
 *   Brand row top-left (40×40 logo tile + name + tagline)
 *   Hero block (eyebrow + headline + optional shares race bar with
 *               legend, OR fallback subline text)
 *   Single-line footer (site URL + sourced-tagline, brand-colour rule)
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

// The estate ground. Every social and Open Graph surface across the five
// estate sites uses the same dark ground with the site's own accent-bright on
// top; only the accent varies. UK Elections' accent is parchment, the colour
// of a ballot paper, because on a forecast site every hue is a claim.
// Values from briefings/uk-network-brand/BRAND-SYSTEM-2026-08-23.md.
const COLORS = {
  bg: "#0f1317",
  surface: "#0f1317",
  text: "#f4f6f7",
  muted: "#98a3ac",
  brand: "#e3d9c3",         // UK Elections accent-bright (mark + footer URL)
};

// The mark, as a data URI because Satori takes SVG through an img element.
// Same marked ballot as the favicon and the site header, on the 64 unit grid.
const MARK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">' +
  '<rect x="14" y="10" width="36" height="44" rx="5" fill="#e3d9c3"/>' +
  '<path d="M24 25l16 16M40 25L24 41" stroke="#0f1317" stroke-width="6.5" stroke-linecap="round" fill="none"/></svg>';
const MARK_URI = `data:image/svg+xml;base64,${Buffer.from(MARK_SVG).toString("base64")}`;

// Source Serif 4 for display, Source Sans 3 for everything else, matching the
// site. woff rather than woff2: Satori reads ttf, otf and woff only, and a
// variable-weight file fails on its fvar table, so these are the static
// single-weight fontsource files, committed in data/fonts/.
let _fontCache: any[] | null = null;
function loadFonts(): any[] {
  if (_fontCache) return _fontCache;
  const serif600 = readFileSync(resolve(process.cwd(), "data/fonts/source-serif-4-latin-600-normal.woff"));
  const sans400 = readFileSync(resolve(process.cwd(), "data/fonts/source-sans-3-latin-400-normal.woff"));
  const sans600 = readFileSync(resolve(process.cwd(), "data/fonts/source-sans-3-latin-600-normal.woff"));
  _fontCache = [
    { name: "Source Serif 4", data: serif600, weight: 600, style: "normal" },
    { name: "Source Sans 3", data: sans400, weight: 400, style: "normal" },
    { name: "Source Sans 3", data: sans600, weight: 600, style: "normal" },
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
  /** Big main headline (display serif, the constituency/contest/council name) */
  headline: string;
  /**
   * Replaces the old text subline with a stacked horizontal race bar
   * showing the top 5-6 party shares. Each segment is sized by `pct`
   * and coloured by `colour`. When absent the card falls back to the
   * old text subline.
   */
  shares?: OgShare[];
  /**
   * Caption for the shares unit. "Predicted vote share", "Seats won",
   * "National polling", etc.
   */
  sharesCaption?: string;
  /** Fallback text subline when no shares are provided */
  subline?: string;
  /** Background accent colour. usually partyColour() of the winner */
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
    accentColour = COLORS.brand,
    partyChipLabel = null,
    partyChipColour = null,
  } = opts;

  // Each share segment is sized by pct relative to the sum of all
  // tracked shares. important because the input may not sum to 1
  // (we typically pass top 5–6 parties, so others are excluded).
  const trackedShares = (shares || []).filter((s) => s.pct > 0);
  const sharesTotal = trackedShares.reduce((sum, s) => sum + s.pct, 0);
  const hasShares = trackedShares.length > 0 && sharesTotal > 0;

  // Inline label visible only on segments that occupy at least 11% of
  // the bar. narrower segments still render the swatch + sit in the
  // legend strip below.
  const labelMinPct = 0.11;

  const fonts = loadFonts();

  // The card uses a Satori-flavoured Flexbox layout. Satori doesn't
  // accept JSX in this entry. we feed it a plain element tree (the
  // shape satori expects under the hood).
  const tree: any = {
    type: "div",
    props: {
      style: {
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        width: OG_WIDTH,
        height: OG_HEIGHT,
        padding: "60px 70px",
        background: COLORS.bg,
        fontFamily: "Source Sans 3",
        color: COLORS.text,
      },
      children: [
        // Brand row. 40×40 logo tile + name + tagline. Shared across
        // UKD / UKE / AS.
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              alignItems: "center",
              gap: 12,
            },
            children: [
              {
                type: "img",
                props: { src: MARK_URI, width: 40, height: 40 },
              },
              {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    flexDirection: "column",
                  },
                  children: [
                    {
                      type: "span",
                      props: {
                        style: {
                          display: "flex",
                          fontFamily: "Source Serif 4",
                          fontWeight: 600,
                          fontSize: 18,
                          color: COLORS.text,
                        },
                        children: "UK Elections",
                      },
                    },
                    {
                      type: "span",
                      props: {
                        style: {
                          display: "flex",
                          fontSize: 11,
                          color: COLORS.muted,
                          letterSpacing: "0.05em",
                        },
                        children: "Forecasting every council and constituency",
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
        // Hero block. eyebrow + headline + race bar (or subline fallback).
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              flexDirection: "column",
              flex: 1,
              justifyContent: "center",
              maxWidth: OG_WIDTH - 200,
            },
            children: [
              {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    fontSize: 20,
                    fontWeight: 600,
                    letterSpacing: 2.8,
                    color: accentColour,
                    textTransform: "uppercase",
                    marginBottom: 18,
                  },
                  children: eyebrow,
                },
              },
              {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    fontFamily: "Source Serif 4",
                    fontSize: hasShares
                      ? headline.length > 22 ? 64 : 84
                      : headline.length > 24 ? 80 : 96,
                    fontWeight: 600,
                    lineHeight: 1.02,
                    letterSpacing: -1.5,
                    color: COLORS.text,
                    marginBottom: hasShares ? 28 : 18,
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
                      },
                      children: [
                        // Optional caption above the bar
                        sharesCaption
                          ? {
                              type: "div",
                              props: {
                                style: {
                                  display: "flex",
                                  fontSize: 16,
                                  fontWeight: 600,
                                  letterSpacing: 2,
                                  color: COLORS.muted,
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
                              boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.08)",
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
                                    fontWeight: 600,
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
                        // Legend strip below the bar. every party + share + sub-label
                        {
                          type: "div",
                          props: {
                            style: {
                              display: "flex",
                              flexWrap: "wrap",
                              marginTop: 12,
                              rowGap: 6,
                              columnGap: 18,
                            },
                            children: trackedShares.map((s) => ({
                              type: "div",
                              props: {
                                style: {
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 8,
                                  fontSize: 18,
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
                                      style: { display: "flex", fontWeight: 600, color: COLORS.text },
                                      children: s.partyLabel,
                                    },
                                  },
                                  {
                                    type: "div",
                                    props: {
                                      style: { display: "flex", fontWeight: 600, color: COLORS.muted },
                                      children: `${(s.pct * 100).toFixed(1)}%`,
                                    },
                                  },
                                  s.subLabel
                                    ? {
                                        type: "div",
                                        props: {
                                          style: { display: "flex", color: COLORS.muted },
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
                          fontSize: 32,
                          fontWeight: 600,
                          color: COLORS.muted,
                          maxWidth: OG_WIDTH - 200,
                        },
                        children: subline,
                      },
                    }
                  : null,
            ].filter(Boolean),
          },
        },
        // Single-line footer. URL (brand colour) + tagline (muted),
        // 2px brand-colour top border. Optional party-chip on the right
        // replaces the tagline for party-winner cards.
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              borderTop: `2px solid ${COLORS.brand}`,
              paddingTop: 16,
            },
            children: [
              {
                type: "span",
                props: {
                  style: {
                    display: "flex",
                    fontSize: 14,
                    fontWeight: 600,
                    color: COLORS.brand,
                  },
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
                        gap: 8,
                        padding: "6px 14px",
                        background: COLORS.surface,
                        borderRadius: 999,
                        border: `1px solid ${partyChipColour || accentColour}`,
                        fontSize: 14,
                        fontWeight: 600,
                        color: COLORS.text,
                      },
                      children: [
                        {
                          type: "div",
                          props: {
                            style: {
                              display: "flex",
                              width: 8,
                              height: 8,
                              borderRadius: 999,
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
                : {
                    type: "span",
                    props: {
                      style: {
                        display: "flex",
                        fontSize: 12,
                        color: COLORS.muted,
                      },
                      children: "Every forecast backtested.",
                    },
                  },
            ],
          },
        },
      ],
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
