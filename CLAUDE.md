# UK Elections Notes

Astro static site for UK-wide election intelligence — `ukelections.co.uk`.

## Commands

```bash
npm test
npm run check
npm run build                          # iteration build, ~25s
BUILD_OG=1 npm run build               # full build with all 812 OG cards (slow — see timing note below)
npm run ge:refresh                     # one-command polling refresh → GE pipeline rerun → Restore Britain overlay
```

## Build pipeline (production cron, vps-main)

Production does **not** deploy via GitHub Actions. One crontab entry on vps-main
(`crontab -l` as root) runs the whole thing nightly at 04:30 UTC:

```
30 4 * * * cd /root/ukelections && CLAWD_DATA=/root/aidoge/burnley-council/data UKE_ROOT=/root/ukelections UKE_ON_VPS_MAIN=1 /usr/bin/node scripts/refresh-pipeline.mjs >> /var/log/ukelections-refresh.log 2>&1
```

`scripts/refresh-pipeline.mjs` is the source of truth for what runs: ingest →
features → predictions → backtests → Senedd/Holyrood → GE → vitest → step 9
`npm run build` → step 10 `wrangler pages deploy dist`
(`UKE_ON_VPS_MAIN=1` makes it deploy the local dist instead of rsyncing).

**Timing — the OG pass is expensive, and the old "~3 min" was wrong.** Measured
on this Mac 20 Aug 2026, same tree, back to back:

| build | wall clock |
|---|---|
| `npx astro build` (3,820 pages, no cards) | 165s |
| `BUILD_OG=1 npx astro build` (+811 cards) | 2,059s |

So the Satori pass costs ~31 min for 811 cards, ~2.3s each — roughly 6× the
300-400ms/card the code comments claim. That Mac run was under heavy load
(load avg 21), so treat it as an upper bound rather than a clean number.

On vps-main the data phases take ~6 min and the pre-OG build took 5m18s on the
19-20 Aug runs (`/var/log/ukelections-refresh.log`). The card pass **has never
run there**, so the nightly's new total is genuinely unknown — somewhere between
~15 min and ~45 min. Read the step 9 → step 10 timestamps after the first cron
run with cards and replace this paragraph with the real figure.

If it turns out to be intolerable, dropping `BUILD_OG` is a safe retreat, not a
regression: every page falls back to `/og-default.png` and nothing dangles.

**Per-page OG cards are currently OFF in the nightly, on purpose.** Step 9 runs
a plain `npm run build`, so every page advertises the committed static
`/og-default.png` and nothing dangles.

History: `BUILD_OG` was absent from ~Apr until 21 Aug 2026 while `BaseLayout`
still pointed every page at `/og/<path>.png` regardless. Production had no
`/og/` directory at all, so every social preview on the site served the HTML
404 body under a 200. The layout now asks `hasOgCard()` first, which makes the
flag genuinely optional in both directions.

To turn cards on, see the comment on step 9 in `scripts/refresh-pipeline.mjs`.
**Measure before you do** — the Satori pass has never run on vps-main and could
take the nightly from ~6.5 min to an hour (see the timing table below).

### Manual deploy from this Mac

```bash
npm run ge:refresh                                          # ~30s
BUILD_OG=1 npx astro build                                  # ~3 min (Pagefind index + 812 OG cards + 3,810 HTML pages)
rsync -az --delete dist/ vps-main:/tmp/ukelections-dist/    # ~5s
ssh vps-main 'set -a; . /opt/dashboard/.env; set +a; wrangler pages deploy /tmp/ukelections-dist --project-name ukelections --branch main'   # ~40s
```

Total ≈ 4 min wall-clock end-to-end.

**Never `wrangler pages deploy dist` against `/root/ukelections/dist` directly.**
Cron and other sessions build in that same checkout; a concurrent build empties
dist mid-upload and publishes an empty site (that caused a ~3 min outage on
20 Aug 2026). Check `pgrep -af "astro build"` first, then snapshot before
deploying: `cp -a dist /tmp/uke-deploy-$$ && wrangler pages deploy /tmp/uke-deploy-$$ …`.

**Cross-repo data dependency (10 Aug 2026):** `scripts/aggregate-lsoa-to-ward-demographics.py` and `src/lib/lancashireLcc2025.js` read `/Users/tompickup/clawd/burnley-council/data` directly off disk — a hardcoded absolute path, not an API. Local-only (not in CI); output gets committed. Only works on this Mac with `clawd` present at that exact path.

## Architecture (19 May 2026 state)

**Design system**
- Token-driven CSS in `src/styles/global.css` — spacing scale (`--space-*`), type scale (`--text-*`), party-aligned accents (`--accent`, `--accent-2`, `--accent-3`, `--accent-teal`), status palette (`--status-warn-*`, `--status-good-text`, `--status-bad-text`), tooltip surfaces.
- System-preference dark mode via `@media (prefers-color-scheme: dark)`. Header + footer + tooltips + status callouts all flip cleanly.
- Tailwind has been removed (was dead weight); no utility framework in use.

**Shared components (`src/components/`)**
- `RaceBar.astro` — horizontal stacked race showing top 5-6 party shares with optional candidate sub-labels. Used on homepage hero, Makerfield, scenario panels.
- `HeroClock.astro` — giant Sora-display countdown ("30 days to polling").
- `PartyBars.astro` — vertical list of party-share bars (the workhorse chart).
- `StatCard.astro` — big-number card with optional sparkline + accent + trend annotation.
- `PartyTrendChart.astro` — server-rendered SVG line chart for polling ledger.
- `CommonsHorseshoe.astro` — 650-dot Parliament composition diagram, pure SVG, ideological left-to-right ordering.
- `ConstituencyChoropleth.astro` — interactive UK map (650 constituencies, ONS PCS24 BUC simplified to 218KB) with click-through to seat pages, tooltip with party strip, clickable legend filter.
- `MiniMap.astro` — per-place thumbnail SVG, supports `pcon | lad | ward`. Boundary cache shared at module load.
- `Search.astro` — Pagefind UI mount, `/` hotkey, native `<dialog>` modal.

**Per-page elevation (Tier B)**
Every detail page renders data as visual, not text. `/polling/` has a trend chart; `/by-elections/makerfield/` has race-bar hero + Scenario A/B side-by-side; `/councils/` has composition `<PartyBars />`; `/past-results/` has per-party MAE chart; `/seats/[council]/` has accuracy `<StatCard />` row + LAD mini-map; `/seats/parliament/[slug]/` has side-by-side predicted-vs-actual bars + PCON mini-map.

**OG cards (Tier C)**
- Card list: `src/lib/ogEntries.ts` — the single source of truth for which pages get a card and what's on it. 812 entries (homepage, GE forecast hub, by-elections, polling, past-results, councils, 650 parliament seats, 156 councils). Returns `[]` when `BUILD_OG` is unset.
- Endpoint: `src/pages/og/[...slug].png.ts` — renders one 1200×630 PNG per entry.
- Renderer: `src/lib/ogRenderer.ts` — Satori → SVG → Resvg → PNG.
- Each card embeds a mini stacked race bar with real per-page party shares + candidate sub-labels.
- Gated behind `BUILD_OG=1` so iteration builds stay <30s.
- Fonts: Sora-ExtraBold + Manrope-SemiBold/Regular static TTFs in `data/fonts/`.
- Fallback: `public/og-default.png` for the ~3,000 ward pages and every page on a `BUILD_OG=0` build. Regenerate with `npm run build:og-default` (needs Node ≥ 23); the output is committed. It must stay a **PNG** — the old `/og-card.svg` fallback was inert, since no major social platform renders an SVG `og:image`.

**Search (Tier C)**
- Pagefind via `astro-pagefind` integration. Indexes 3,810 dist/ HTML pages.
- `<main data-pagefind-body>` scopes the index.
- Lazy-loaded UI via dynamic `<script>` injection — dodges Vite's static analyser.

**Per-place mini-maps (Tier C)**
- LAD24 BUC + WD25 BSC boundaries simplified with mapshaper (152 KB + 2.9 MB).
- d3-geo at build time, no runtime JS.

## Critical rules

1. **Don't render text where a chart can render the data.** The homepage hero + ConstituencyChoropleth + CommonsHorseshoe are the gold standard. Apply the same treatment to any new page.
2. **Use design tokens** — `--space-*`, `--text-*`, `--accent-*`, `--status-*`. Never hardcode hex literals in component CSS.
3. **Every component renders in both light + dark mode** — verify with `@media (prefers-color-scheme: dark)` in your reload cycle.
4. **`BUILD_OG=1` is opt-in everywhere, including the cron.** Builds without it skip the 811-card Satori pass and fall back to the committed `/og-default.png`. That is a supported state, not a broken one — the fallback is a real 1200×630 PNG and every page points at it.
4b. **Only advertise an OG card the build actually rendered.** `BaseLayout` asks `hasOgCard()` (from `ogEntries.ts`) before pointing `og:image` at `/og/<slug>.png`. Cloudflare Pages serves a missing path as the HTML 404 body under a **200**, so a dangling card URL doesn't 404 — it silently hands crawlers `text/html` and kills the preview. Add a page to `ogEntries.ts` if you want it to have a card; never hand-write the meta path.
5. **Party colours are saturated by design** — they look fine in both modes; don't dark-mode them.
6. **Boundaries are committed.** `data/geography/*.geojson` files are checked in (raw + simplified). Re-download via the ArcGIS REST pattern at `services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/...`.
7. **Reuse `partyColour()` and `shortPartyLabel()`** — don't create parallel mappings.
8. **OG card sub-labels follow the page's primary data** — candidate names on by-elections, seat counts on councils, % on vote shares.

## Deployment

- GitHub: `tompickup23/ukelections` (source of truth)
- Cloudflare Pages: `ukelections` (production)
- GitHub Pages: `tompickup23.github.io/ukelections/` (auto-mirrored backup)
- Domain: `ukelections.co.uk` (CF Pages custom domain, behind Cloudflare Access)

## Cross-repo lessons (5 Jul 2026)

Hard-won gotchas for this site live in the clawd repo: `/Users/tompickup/clawd/docs/lessons/sister-sites.md` (deploy flows, CSP/Pagefind/Astro 6 gotchas, OG-card standard, em-dash sweep method) and `/Users/tompickup/clawd/docs/lessons/editorial-method.md` (fact-check protocol, factual anchors). Read the relevant one before major work, and append new lessons there, not here.
