# UK Elections Notes

Astro static site for UK-wide election intelligence — `ukelections.co.uk`.

## Commands

```bash
npm test
npm run check
npm run build                          # iteration build, ~25s
BUILD_OG=1 npm run build               # full build with all 812 OG cards, ~3 min
npm run ge:refresh                     # one-command polling refresh → GE pipeline rerun → Restore Britain overlay
```

## Build pipeline (production cron, vps-main)

```bash
npm run ge:refresh                                          # ~30s
BUILD_OG=1 npx astro build                                  # ~3 min (Pagefind index + 812 OG cards + 3,810 HTML pages)
rsync -az --delete dist/ vps-main:/tmp/ukelections-dist/    # ~5s
ssh vps-main 'set -a; . /opt/dashboard/.env; set +a; wrangler pages deploy /tmp/ukelections-dist --project-name ukelections --branch main'   # ~40s
```

Total deploy ≈ 4 min wall-clock end-to-end.

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
- Endpoint: `src/pages/og/[...slug].png.ts` — 812 dynamic 1200×630 PNGs (homepage, GE forecast hub, Makerfield, polling, past-results, councils, 650 parliament seats, 156 councils).
- Renderer: `src/lib/ogRenderer.ts` — Satori → SVG → Resvg → PNG.
- Each card embeds a mini stacked race bar with real per-page party shares + candidate sub-labels.
- Gated behind `BUILD_OG=1` so iteration builds stay <30s.
- Fonts: Sora-ExtraBold + Manrope-SemiBold/Regular static TTFs in `data/fonts/`.

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
4. **`BUILD_OG=1` is opt-in.** Iteration builds skip the 812-card Satori pass.
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
