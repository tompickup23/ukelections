#!/usr/bin/env node
// build-byelection-cards.mjs
//
// One shareable 1200x630 card per council by-election, rendered from the
// contest files and nothing else, so a card can never disagree with its page.
//
//   node scripts/build-byelection-cards.mjs                    # every upcoming contest
//   node scripts/build-byelection-cards.mjs --slug=<slug>      # just one
//   node scripts/build-byelection-cards.mjs --out=public/cards
//
// Brand: the estate system in briefings/uk-network-brand/BRAND-SYSTEM-2026-08-23.md.
// The ground, the accent triple, the mark and the type pairing are taken from
// that file's generated token block verbatim rather than re-chosen here.
//
// Deliberately separate from src/lib/ogRenderer.ts. That renderer is the
// site-wide OG card and is being reworked under the same brand programme; this
// is a content card for feeds, and keeping them apart means neither session
// has to wait on the other.
//
// Two rules from the house standards shape the layout:
//   One number per card. The claim is the win probability, big. The share bars
//   are the working, not four more headline figures.
//   The source line is on the image. A card travels without its page, so the
//   method, the date and the domain all have to survive the journey.
//
// The estate brand rule "no figures on any social asset" is deliberately not
// applied here, and this is the one place it should not be. It exists because
// avatars and covers live for months while every count on this estate is point
// in time. A by-election card is the opposite: it is stamped with its polling
// day, it is worthless a week later, and a projection with no number on it is
// not a projection. The polling day is therefore rendered prominently enough
// that the card dates itself.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const p = (rel) => path.join(ROOT, rel);
const CONTESTS = p("data/contests/local-byelections");

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  }),
);
const OUT = p(args.out || "public/cards/by-elections");

// ---------------------------------------------------------------------------
// Brand tokens, from the estate brand system's generated ukelections block.
// ---------------------------------------------------------------------------
const T = {
  ground: "#0f1317",
  ink: "#f4f6f7",
  muted: "#98a3ac",
  accentBright: "#e3d9c3", // the mark and the URL on the dark ground
};

// Party hues are the site's own, and they are the ONLY saturated colour on the
// card. UK Elections is chromatically neutral by decision precisely so that a
// party colour always means that party and the chrome never implies anything.
const PARTY = {
  "Labour": "#c1121f",
  "Conservative": "#1d4e89",
  "Reform UK": "#12b5cb",
  "Liberal Democrats": "#f59e0b",
  "Green Party": "#138a52",
  "SNP": "#fdf24e",
  "Plaid Cymru": "#3f9c35",
  "Independent": "#888888",
  "Restore Britain": "#0f2545",
  "Other": "#6b7280",
};
const SHORT = {
  "Liberal Democrats": "Lib Dem",
  "Conservative": "Conservative",
  "Green Party": "Green",
  "Reform UK": "Reform UK",
};
const label = (party) => SHORT[party] || party;

const fonts = [
  { name: "Display", data: readFileSync(p("data/fonts/source-serif-4-latin-600-normal.woff")), weight: 600, style: "normal" },
  { name: "UI", data: readFileSync(p("data/fonts/source-sans-3-latin-400-normal.woff")), weight: 400, style: "normal" },
  { name: "UI", data: readFileSync(p("data/fonts/source-sans-3-latin-600-normal.woff")), weight: 600, style: "normal" },
];

const box = (style, children) => ({ type: "div", props: { style: { display: "flex", ...style }, children } });
const txt = (text, style) => ({ type: "div", props: { style: { display: "flex", ...style }, children: text } });

/** The UK Elections mark: ballot box, ballot cross, on a rounded tile. */
function mark(size) {
  return {
    type: "svg",
    props: {
      width: size,
      height: size,
      viewBox: "0 0 64 64",
      children: [
        { type: "rect", props: { width: 64, height: 64, rx: 14, fill: T.ground } },
        { type: "rect", props: { x: 14, y: 10, width: 36, height: 44, rx: 5, fill: T.accentBright } },
        {
          type: "path",
          props: {
            d: "M24 25l16 16M40 25L24 41",
            stroke: T.ground,
            "stroke-width": 6.5,
            "stroke-linecap": "round",
            fill: "none",
          },
        },
      ],
    },
  };
}

function prettyDate(iso) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function card(contest) {
  const c = contest.contest;
  const f = contest.forecast;
  const W = 1200;
  const H = 630;

  const pct = Math.round(f.leader_probability * 100);
  const tooClose = Boolean(f.too_close_to_call);

  // Long ward names wrap to two lines and used to push the footer off the
  // bottom of the card. Everything below scales off an estimated line count
  // rather than assuming one line: Dover's "Guston, Kingsdown &
  // St Margaret's-at-Cliffe" is the worst case in the current set.
  const heading = `${c.ward_name}, ${c.council_name}`;
  const headFont = heading.length > 44 ? 40 : heading.length > 30 ? 46 : 56;
  const headLines = Math.max(1, Math.ceil(heading.length / (heading.length > 44 ? 40 : 34)));
  const tight = headLines > 1;

  const rows = Object.entries(f.central)
    .filter(([, v]) => v > 0.005)
    .sort((a, b) => b[1] - a[1])
    .slice(0, tight ? 4 : 5);
  const top = rows[0];

  return {
    type: "div",
    props: {
      style: {
        display: "flex",
        flexDirection: "column",
        width: W,
        height: H,
        backgroundColor: T.ground,
        fontFamily: "UI",
      },
      children: [
        box({ height: 12, backgroundColor: T.accentBright }, []),
        box(
          { flexDirection: "column", flexGrow: 1, padding: "36px 64px 0 64px" },
          [
            // Brand row
            box({ alignItems: "center", gap: 16 }, [
              mark(44),
              txt("UK Elections", { fontFamily: "Display", fontWeight: 600, fontSize: 30, color: T.ink }),
            ]),

            // Eyebrow: where and when, so the card dates itself
            txt(`COUNCIL BY-ELECTION  ·  ${prettyDate(c.polling_day).toUpperCase()}`, {
              marginTop: 30,
              fontSize: 21,
              fontWeight: 600,
              letterSpacing: 2,
              color: T.accentBright,
            }),

            // The ward
            txt(heading, {
              marginTop: 12,
              fontFamily: "Display",
              fontWeight: 600,
              fontSize: headFont,
              color: T.ink,
              lineHeight: 1.05,
            }),

            // The one number, or the honest absence of one. Leading with a
            // sub-coin-flip probability reads as a call, which is the opposite
            // of what the model is saying about these.
            tooClose
              ? box({ marginTop: tight ? 14 : 26, flexDirection: "column" }, [
                  txt("Too close to call", {
                    fontFamily: "Display",
                    fontWeight: 600,
                    fontSize: tight ? 56 : 76,
                    color: T.ink,
                    lineHeight: 1,
                  }),
                  txt(`No party clears our confidence floor. ${label(top[0])} is narrowly strongest at ${pct}%.`, {
                    marginTop: tight ? 8 : 12,
                    fontSize: tight ? 21 : 24,
                    color: T.muted,
                  }),
                ])
              : box({ marginTop: tight ? 14 : 26, alignItems: "baseline", gap: 18 }, [
                  txt(`${pct}%`, {
                    fontFamily: "Display",
                    fontWeight: 600,
                    fontSize: tight ? 72 : 96,
                    color: PARTY[top[0]] || T.ink,
                    lineHeight: 1,
                  }),
                  txt(`chance ${label(top[0])} wins it`, { fontSize: tight ? 25 : 30, color: T.ink }),
                ]),

            // The working
            box({ marginTop: tight ? 14 : 22, flexDirection: "column", gap: tight ? 7 : 9 }, rows.map(([party, share]) =>
              box({ alignItems: "center", gap: 14 }, [
                txt(label(party), { width: 168, fontSize: 20, color: T.muted }),
                box({ width: 640, height: tight ? 18 : 20, backgroundColor: "#1b2229", borderRadius: 3 }, [
                  box({ width: Math.max(3, Math.round(share * 640)), backgroundColor: PARTY[party] || T.muted, borderRadius: 3 }, []),
                ]),
                txt(`${(share * 100).toFixed(1)}%`, { fontSize: 20, fontWeight: 600, color: T.ink }),
              ]),
            )),
          ],
        ),

        // Footer: domain and the source line
        box(
          {
            margin: "0 64px",
            paddingTop: 18,
            paddingBottom: 26,
            borderTop: `1px solid #2a333c`,
            justifyContent: "space-between",
            fontSize: 19,
          },
          [
            txt("ukelections.co.uk", { color: T.accentBright }),
            txt("Projection from the ward's own last result. Method and record on the page.", { color: T.muted }),
          ],
        ),
      ],
    },
  };
}

async function render(contest, outFile) {
  const svg = await satori(card(contest), { width: 1200, height: 630, fonts });
  const png = new Resvg(svg, { fitTo: { mode: "width", value: 1200 } }).render().asPng();
  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, png);
  // A JPEG sibling for the Instagram Content Publishing API, which accepts
  // only JPEG at a public URL. Same pixels, same nightly refresh.
  const sharp = (await import("sharp")).default;
  await sharp(png).flatten({ background: "#0f1317" }).jpeg({ quality: 90 })
    .toFile(outFile.replace(/\.png$/, ".jpg"));
}

async function main() {
  if (!existsSync(CONTESTS)) throw new Error("no contest files: run build:local-byelections first");
  const files = readdirSync(CONTESTS).filter((f) => f.endsWith(".json") && !f.startsWith("_"));
  const today = new Date().toISOString().slice(0, 10);
  let made = 0;
  for (const file of files) {
    const contest = JSON.parse(readFileSync(path.join(CONTESTS, file), "utf8"));
    if (args.slug && contest.slug !== args.slug) continue;
    // A card is only ever made for a contest that has a projection to show and
    // has not already been decided.
    if (!contest.forecast) continue;
    if (!args.slug && contest.contest.polling_day < today) continue;
    const outFile = path.join(OUT, `${contest.slug}.png`);
    await render(contest, outFile);
    made += 1;
    console.log(`  ${path.relative(ROOT, outFile)}  ${contest.forecast.winner} ${Math.round(contest.forecast.leader_probability * 100)}%`);
  }
  console.log(`${made} card(s)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
