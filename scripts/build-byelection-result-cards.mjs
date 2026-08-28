#!/usr/bin/env node
// build-byelection-result-cards.mjs
//
// One 1080x1350 card per declared council by-election, showing the projection
// we published against the result. Portrait because these are for Instagram and
// Facebook feeds, where a 1200x630 landscape card renders at thumbnail size.
//
//   node scripts/build-byelection-result-cards.mjs --slug=<slug>
//   node scripts/build-byelection-result-cards.mjs --date=2026-08-27
//   node scripts/build-byelection-result-cards.mjs --date=2026-08-27 --out=/tmp/cards
//
// Two inputs, deliberately separate:
//   the forecast comes from data/cards/published-byelection-forecasts.json,
//   which records what the live page actually said before the poll. It cannot
//   come from the contest file: that is rebuilt nightly and a past contest's
//   projection keeps moving as older by-elections are ingested into the swing
//   corpus, so grading against today's rebuild would flatter or punish the
//   model for data it never had.
//   the result comes from data/history/byelection-appends.json, the tracked
//   sidecar, which is the same record the models read.
//
// Brand: briefings/uk-network-brand/BRAND-SYSTEM-2026-08-23.md, the ukelections
// block. Chromatically neutral chrome, party hues used only for party data.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const p = (rel) => path.join(ROOT, rel);
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  }),
);
const OUT = args.out || p("public/cards/by-election-results");

const T = { ground: "#0f1317", ink: "#f4f6f7", muted: "#98a3ac", accentBright: "#e3d9c3", rule: "#2a3138" };
const PARTY = {
  Labour: "#c1121f",
  Conservative: "#1d4e89",
  "Reform UK": "#12b5cb",
  "Liberal Democrats": "#f59e0b",
  "Green Party": "#138a52",
  SNP: "#fdf24e",
  "Plaid Cymru": "#3f9c35",
  Independent: "#888888",
  "Restore Britain": "#0f2545",
  Other: "#6b7280",
};
const SHORT = { "Liberal Democrats": "Lib Dem", "Green Party": "Green", "Conservative": "Conservative" };
const label = (q) => SHORT[q] || q;

const CANON = {
  "Labour Party": "Labour",
  "Labour and Co-operative Party": "Labour",
  "Conservative and Unionist Party": "Conservative",
  "Liberal Democrats": "Liberal Democrats",
  "Green Party": "Green Party",
  "Reform UK": "Reform UK",
  "Restore Britain": "Restore Britain",
  Independent: "Independent",
};
const canon = (name) => CANON[name] || name;

const fonts = [
  { name: "Display", data: readFileSync(p("data/fonts/source-serif-4-latin-600-normal.woff")), weight: 600, style: "normal" },
  { name: "UI", data: readFileSync(p("data/fonts/source-sans-3-latin-400-normal.woff")), weight: 400, style: "normal" },
  { name: "UI", data: readFileSync(p("data/fonts/source-sans-3-latin-600-normal.woff")), weight: 600, style: "normal" },
];

const box = (style, children) => ({ type: "div", props: { style: { display: "flex", ...style }, children } });
const txt = (text, style) => ({ type: "div", props: { style: { display: "flex", ...style }, children: text } });

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
        { type: "path", props: { d: "M24 25l16 16M40 25L24 41", stroke: T.ground, "stroke-width": 6.5, "stroke-linecap": "round", fill: "none" } },
      ],
    },
  };
}

const prettyDate = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** One party's row: the projection as a hollow bar, the result as a solid one. */
function partyRow(party, projPct, actPct, scale) {
  const hue = PARTY[party] || PARTY.Other;
  const err = Math.abs(projPct - actPct);
  const bar = (pct, solid) =>
    box(
      {
        width: Math.max(4, Math.round(pct * scale)),
        height: 22,
        backgroundColor: solid ? hue : "transparent",
        border: solid ? "none" : `2px solid ${hue}`,
        borderRadius: 3,
      },
      [],
    );
  return box({ flexDirection: "column", marginBottom: 24 }, [
    box({ alignItems: "baseline", justifyContent: "space-between" }, [
      txt(label(party), { fontSize: 30, fontWeight: 600, color: T.ink }),
      txt(`${err < 0.05 ? "0.0" : err.toFixed(1)}pp out`, { fontSize: 24, color: err <= 3 ? T.accentBright : T.muted }),
    ]),
    box({ alignItems: "center", gap: 14, marginTop: 8 }, [bar(projPct, false), txt(`${projPct.toFixed(1)}%`, { fontSize: 24, color: T.muted })]),
    box({ alignItems: "center", gap: 14, marginTop: 6 }, [bar(actPct, true), txt(`${actPct.toFixed(1)}%`, { fontSize: 24, color: T.ink })]),
  ]);
}

function card({ slug, forecast, result, ward, council, date, footnote }) {
  const W = 1080;
  const H = 1350;
  const parties = Object.keys(forecast.central_pct)
    .filter((q) => forecast.central_pct[q] > 0.5 || (result.shares_pct[q] || 0) > 0.5)
    .sort((a, b) => (result.shares_pct[b] || 0) - (result.shares_pct[a] || 0))
    .slice(0, 5);
  const maxPct = Math.max(...parties.map((q) => Math.max(forecast.central_pct[q] || 0, result.shares_pct[q] || 0)));
  const scale = 560 / maxPct;

  const lead = parties[0];
  const heading = `${ward}, ${council}`;
  const headFont = heading.length > 40 ? 46 : heading.length > 28 ? 54 : 62;

  return {
    type: "div",
    props: {
      style: { display: "flex", flexDirection: "column", width: W, height: H, backgroundColor: T.ground, fontFamily: "UI" },
      children: [
        box({ height: 12, backgroundColor: T.accentBright }, []),
        box({ flexDirection: "column", flexGrow: 1, padding: "40px 60px 0 60px" }, [
          box({ alignItems: "center", gap: 16 }, [
            mark(46),
            txt("UK Elections", { fontFamily: "Display", fontWeight: 600, fontSize: 32, color: T.ink }),
          ]),
          txt(`WE PROJECTED  ·  YOU VOTED  ·  ${prettyDate(date).toUpperCase()}`, {
            marginTop: 28,
            fontSize: 21,
            fontWeight: 600,
            letterSpacing: 2,
            color: T.accentBright,
          }),
          txt(heading, { marginTop: 10, fontFamily: "Display", fontWeight: 600, fontSize: headFont, color: T.ink, lineHeight: 1.05 }),
          txt(
            `${label(lead)} projected ${forecast.central_pct[lead].toFixed(1)}%, result ${result.shares_pct[lead].toFixed(1)}%`,
            { marginTop: 20, fontFamily: "Display", fontWeight: 600, fontSize: 40, color: T.accentBright, lineHeight: 1.15 },
          ),
          box({ height: 1, backgroundColor: T.rule, marginTop: 26, marginBottom: 30 }, []),
          box({ justifyContent: "space-between", marginBottom: 18 }, [
            txt("HOLLOW BAR: OUR PROJECTION", { fontSize: 19, fontWeight: 600, letterSpacing: 1.5, color: T.muted }),
            txt("SOLID: THE RESULT", { fontSize: 19, fontWeight: 600, letterSpacing: 1.5, color: T.muted }),
          ]),
          box({ flexDirection: "column" }, parties.map((q) => partyRow(q, forecast.central_pct[q] || 0, result.shares_pct[q] || 0, scale))),
          box({ flexGrow: 1 }, []),
          box({ height: 1, backgroundColor: T.rule, marginBottom: 20 }, []),
          txt(footnote, { fontSize: 23, color: T.muted, lineHeight: 1.35, marginBottom: 18 }),
          box({ justifyContent: "space-between", alignItems: "center", paddingBottom: 34 }, [
            txt("ukelections.co.uk", { fontSize: 26, fontWeight: 600, color: T.accentBright }),
            txt(`Turnout ${result.turnout_pct === null ? "not published" : (100 * result.turnout_pct).toFixed(1) + "%"}`, {
              fontSize: 23,
              color: T.muted,
            }),
          ]),
        ]),
      ],
    },
  };
}

async function render(node, file) {
  const svg = await satori(node, { width: 1080, height: 1350, fonts });
  const png = new Resvg(svg, { fitTo: { mode: "width", value: 1080 } }).render().asPng();
  writeFileSync(file, png);
  return png.length;
}

async function main() {
  const published = JSON.parse(readFileSync(p("data/cards/published-byelection-forecasts.json"), "utf8")).forecasts;
  const sidecar = JSON.parse(readFileSync(p("data/history/byelection-appends.json"), "utf8")).results;
  const byBallot = new Map(sidecar.map((r) => [r.ballot_paper_id, r]));
  mkdirSync(OUT, { recursive: true });

  const slugs = args.slug
    ? [args.slug]
    : Object.keys(published).filter((s) => (args.date ? s.endsWith(args.date) : true));
  if (!slugs.length) {
    console.error("no contests matched");
    process.exit(1);
  }

  for (const slug of slugs) {
    const contestFile = p(`data/contests/local-byelections/${slug}.json`);
    const contest = JSON.parse(readFileSync(contestFile, "utf8"));
    const ballotId = contest.contest.ballot_paper_id;
    const row = byBallot.get(ballotId);
    if (!row) {
      console.log(`  skip ${slug}: no result in the sidecar yet`);
      continue;
    }
    const total = row.candidates.reduce((a, c) => a + (c.votes || 0), 0);
    const shares_pct = {};
    for (const c of row.candidates) {
      const q = canon(c.party_name);
      shares_pct[q] = (shares_pct[q] || 0) + (100 * (c.votes || 0)) / total;
    }
    const note = (published[slug].footnote_override || "").trim();
    const f = published[slug];
    const lead = Object.keys(f.central_pct).sort((a, b) => (shares_pct[b] || 0) - (shares_pct[a] || 0))[0];
    const called = lead === Object.keys(f.central_pct).sort((a, b) => f.central_pct[b] - f.central_pct[a])[0];
    const footnote =
      note ||
      `${f.verdict}. The winner was ${called ? "the party our projection had in front" : "not the party our projection had in front"}. Projection published before polls opened; every figure is on the contest page.`;
    const bytes = await render(
      card({
        slug,
        forecast: f,
        result: { shares_pct, turnout_pct: row.turnout_pct ?? null },
        ward: contest.contest.ward_name,
        council: contest.contest.council_name,
        date: contest.contest.polling_day,
        footnote,
      }),
      path.join(OUT, `${slug}.png`),
    );
    console.log(`  + ${slug}.png (${Math.round(bytes / 1024)} KB)`);
  }
  console.log(`result cards written to ${OUT}`);
}

main();
