import type { APIRoute, GetStaticPaths } from "astro";
import satori from "satori";
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getCollection } from "astro:content";
import { getPublicPlaceAreas, slugifyAreaName } from "../../lib/site";

// Brand colors — UK Demographics (indigo)
const COLORS = {
  bg: "#04070d",
  surface: "#0b1220",
  accent: "#4f46e5",
  accentLight: "#818cf8",
  text: "#f5f7fb",
  muted: "#91a7c4",
  alert: "#f59e0b",
  critical: "#ef4444",
  resolved: "#10b981"
};

const verdictColor: Record<string, string> = {
  alert: COLORS.alert,
  critical: COLORS.critical,
  resolved: COLORS.resolved,
  info: COLORS.accent
};

let manropeBold: ArrayBuffer | null = null;
let soraBold: ArrayBuffer | null = null;

function loadFont(name: string): ArrayBuffer {
  const fontFile = name === "Manrope" ? "Manrope-Bold.ttf" : "Sora-ExtraBold.ttf";
  const fontPath = join(process.cwd(), "src", "assets", "fonts", fontFile);
  return readFileSync(fontPath).buffer as ArrayBuffer;
}

function ensureFonts() {
  if (!manropeBold) manropeBold = loadFont("Manrope");
  if (!soraBold) soraBold = loadFont("Sora");
}

export const getStaticPaths: GetStaticPaths = async () => {
  const findings = await getCollection("findings");

  const findingPaths = findings.map((f) => ({
    params: { slug: `findings/${f.id.replace(/\.md$/, "")}` },
    props: {
      title: f.data.headline,
      stat: f.data.stat_value,
      statLabel: f.data.stat_label,
      verdict: f.data.verdict
    }
  }));

  const publicAreas = getPublicPlaceAreas();
  const placePaths = publicAreas.map((area) => ({
    params: { slug: `places/${slugifyAreaName(area.areaName)}` },
    props: {
      title: area.areaName,
      stat: area.wbiPct2021 != null ? `${area.wbiPct2021.toFixed(1)}%` : "n/a",
      statLabel: `White British 2021 · Population ${(area.population ?? 0).toLocaleString()}`,
      verdict: (area.wbiPct2021 ?? 100) < 50 ? "critical" : (area.wbiPct2021 ?? 100) < 70 ? "alert" : "info"
    }
  }));

  return [
    {
      params: { slug: "home" },
      props: {
        title: "Population data for every community",
        stat: `${publicAreas.length}`,
        statLabel: "Local authorities with projections",
        verdict: "info"
      }
    },
    ...findingPaths,
    ...placePaths
  ];
};

export const GET: APIRoute = async ({ props }) => {
  ensureFonts();

  const { title, stat, statLabel, verdict } = props as {
    title: string;
    stat: string;
    statLabel: string;
    verdict: string;
  };

  const statColor = verdictColor[verdict] ?? COLORS.accent;

  const svg = await satori(
    {
      type: "div",
      props: {
        style: {
          width: "1200px",
          height: "630px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "60px 70px",
          background: `linear-gradient(135deg, ${COLORS.bg} 0%, ${COLORS.surface} 100%)`,
          fontFamily: "Manrope"
        },
        children: [
          {
            type: "div",
            props: {
              style: {
                display: "flex",
                alignItems: "center",
                gap: "12px"
              },
              children: [
                {
                  type: "div",
                  props: {
                    style: {
                      width: "40px",
                      height: "40px",
                      borderRadius: "10px",
                      background: COLORS.accent,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: COLORS.bg,
                      fontFamily: "Sora",
                      fontWeight: 800,
                      fontSize: "16px"
                    },
                    children: "UKD"
                  }
                },
                {
                  type: "div",
                  props: {
                    style: {
                      display: "flex",
                      flexDirection: "column"
                    },
                    children: [
                      {
                        type: "span",
                        props: {
                          style: {
                            fontFamily: "Sora",
                            fontWeight: 700,
                            fontSize: "16px",
                            color: COLORS.text
                          },
                          children: "UK Demographics"
                        }
                      },
                      {
                        type: "span",
                        props: {
                          style: {
                            fontSize: "11px",
                            color: COLORS.muted,
                            letterSpacing: "0.05em"
                          },
                          children: "Population data for every community"
                        }
                      }
                    ]
                  }
                }
              ]
            }
          },
          {
            type: "div",
            props: {
              style: {
                display: "flex",
                flexDirection: "column",
                gap: "20px",
                flex: 1,
                justifyContent: "center"
              },
              children: [
                {
                  type: "div",
                  props: {
                    style: {
                      fontFamily: "Sora",
                      fontSize: "56px",
                      fontWeight: 800,
                      color: statColor,
                      lineHeight: 1
                    },
                    children: stat
                  }
                },
                {
                  type: "div",
                  props: {
                    style: {
                      fontSize: "14px",
                      color: COLORS.muted,
                      textTransform: "uppercase",
                      letterSpacing: "0.1em"
                    },
                    children: statLabel
                  }
                },
                {
                  type: "div",
                  props: {
                    style: {
                      fontFamily: "Sora",
                      fontSize: "32px",
                      fontWeight: 700,
                      color: COLORS.text,
                      lineHeight: 1.2,
                      maxWidth: "900px"
                    },
                    children: title
                  }
                }
              ]
            }
          },
          {
            type: "div",
            props: {
              style: {
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                borderTop: `2px solid ${COLORS.accent}`,
                paddingTop: "16px"
              },
              children: [
                {
                  type: "span",
                  props: {
                    style: {
                      fontSize: "14px",
                      color: COLORS.accent,
                      fontWeight: 600
                    },
                    children: "ukdemographics.co.uk"
                  }
                },
                {
                  type: "span",
                  props: {
                    style: {
                      fontSize: "12px",
                      color: COLORS.muted
                    },
                    children: "Every projection sourced."
                  }
                }
              ]
            }
          }
        ]
      }
    },
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: "Manrope", data: manropeBold!, weight: 700, style: "normal" },
        { name: "Sora", data: soraBold!, weight: 800, style: "normal" }
      ]
    }
  );

  const png = await sharp(Buffer.from(svg)).png({ quality: 90 }).toBuffer();

  return new Response(png as unknown as BodyInit, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400"
    }
  });
};
