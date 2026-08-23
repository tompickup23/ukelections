/**
 * Regenerate public/og-default.png — the static Open Graph card used by
 * every page that has no Satori-rendered per-page card (the ~3,000 ward
 * pages, and every page at all on a BUILD_OG=0 iteration build).
 *
 * It has to be a PNG, not the old og-card.svg: Facebook, X, LinkedIn,
 * Slack and WhatsApp all decline to render an SVG og:image, so an SVG
 * fallback is a broken preview with extra steps.
 *
 * Output is committed. Run this only when the brand card changes:
 *
 *   npm run build:og-default        # needs Node >= 23 (TS type stripping)
 *
 * Not part of the build or the nightly pipeline — nothing here depends
 * on forecast data, so there is no reason to re-render it every night.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderOgCard } from "../src/lib/ogRenderer.ts";

const OUT = resolve(process.cwd(), "public/og-default.png");

const png = await renderOgCard({
  eyebrow: "ukelections.co.uk",
  headline: "Every constituency, every forecast",
  subline:
    "650 UK parliamentary seats · 3,700 wards · backtests published on every page",
  accentColour: "#e3d9c3",
});

writeFileSync(OUT, new Uint8Array(png));
process.stdout.write(`wrote ${OUT} (${(png.length / 1024).toFixed(1)} KB)\n`);
