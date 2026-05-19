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

export interface OgCardOpts {
  /** Big top-line eyebrow text (e.g. "GENERAL ELECTION FORECAST") */
  eyebrow: string;
  /** Big main headline (Sora display, the constituency/contest/council name) */
  headline: string;
  /** One-line stat sub-headline ("Reform UK 38.7% · 13.0pp margin") */
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
    accentColour = "#1d4e89",
    partyChipLabel = null,
    partyChipColour = null,
  } = opts;

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
        // Headline (Sora 96)
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              fontFamily: "Sora",
              fontSize: headline.length > 24 ? 84 : 104,
              fontWeight: 800,
              lineHeight: 1.02,
              letterSpacing: -2,
              color: "#0f172a",
              maxWidth: OG_WIDTH - 200,
            },
            children: headline,
          },
        },
        // Subline
        subline
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
