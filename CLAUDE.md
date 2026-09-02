# UK Elections Notes

Astro static site for UK-wide election intelligence — `ukelections.co.uk`.

## Commands

```bash
npm test
npm run check
npm run build                          # iteration build, ~16s (see the boundary-cache note)
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
`npm run build` → step 10 `wrangler pages deploy dist`. Roughly 6 minutes when the
Democracy Club page cache is warm, closer to 50 when it expires and refetches.

To ship a merged change yourself, without waiting for the cron:

```bash
ssh vps-main
cd /root/ukelections && git pull --ff-only --autostash && git log --oneline -1   # the cron does NOT pull
npm test --silent
rm -rf dist .astro node_modules/.vite && npm run build                          # was ~5 min; expect well under after the 2 Sep boundary-cache fix, but it has not been timed on vps-main yet
rm -rf /tmp/uke-deploy-x && cp -a dist /tmp/uke-deploy-x                        # never deploy the shared dist
set -a; . /opt/dashboard/.env; set +a
wrangler pages deploy /tmp/uke-deploy-x --project-name ukelections --branch main --commit-dirty=true
```

`BUILD_OG=1` renders the OG cards and is opt-in: about 31 minutes for 811 cards,
so it is deliberately out of the nightly. Pages only advertise a card when one
was actually built.
(`UKE_ON_VPS_MAIN=1` makes it deploy the local dist instead of rsyncing).

**Timing — the OG pass is expensive, and the old "~3 min" was wrong.** Measured
on this Mac 20 Aug 2026, same tree, back to back:

| build | wall clock |
|---|---|
| `npx astro build` (3,820 pages, no cards) | 165s |
| `BUILD_OG=1 npx astro build` (+811 cards) | 2,059s |

**Those two numbers were mostly a bug, fixed 2 Sep 2026.** `MiniMap.astro` kept
its boundary cache in the component's frontmatter fence, which is the render
body and re-runs per page, so every mini-map page re-read, rewound and
re-indexed the boundary files from scratch. Instrumenting the build counted
**2,957 reloads costing 149s**, which was the bulk of the card-free build. The
cache now lives in `src/lib/boundaryCache.ts`, a real module evaluated once:

| build | before the fix | after |
|---|---|---|
| `npx astro build` (3,947 pages, no cards) | 116s | **16s** |

Measured back to back on this Mac, 2 Sep 2026, same tree. The OG pass is
unaffected. it is Satori time, not boundary time, so `BUILD_OG=1` still costs
roughly its ~31 minutes on top.

So the Satori pass costs ~31 min for 811 cards, ~2.3s each — roughly 6× the
300-400ms/card the code comments claim. That Mac run was under heavy load
(load avg 21), so treat it as an upper bound rather than a clean number.

On vps-main the data phases take ~6 min and the pre-OG build took 5m18s on the
19-20 Aug runs (`/var/log/ukelections-refresh.log`). That 5m18s predates the
2 Sep boundary-cache fix, which cut the same build from 116s to 16s on this
Mac; the vps figure should fall similarly but has not been re-measured, so read
the step 9 timestamps after the next cron run before quoting a number. The card pass **has never
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
- `ConstituencyChoropleth.astro` — interactive UK map (650 constituencies, from `pcon24-simplified.geojson`) with click-through to seat pages, tooltip with party strip, clickable legend filter. Renders server-side, so the GeoJSON never ships; what the page carries is 62KB of gzipped SVG path data.
- `MiniMap.astro` — per-place thumbnail SVG, supports `pcon | lad | ward`. Focal feature from the `*-detail.geojson` tier, grey neighbour context from `*-simplified.geojson`. Boundaries come from `src/lib/boundaryCache.ts`, which is a module so the cache survives between pages.
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
- Loaded through `src/lib/boundaryCache.ts`, which is a module so the parse/rewind/index happens once per process. **Never move that cache into an `.astro` frontmatter fence** — the fence is the render body and re-runs per page, which is exactly the bug that cost 149s per build until 2 Sep 2026.
- Focal feature from `pcon24-detail.geojson` (2.0 MB), `lad24-detail.geojson` (1.0 MB), `wd25-detail.geojson` (5.1 MB); grey neighbour context from the matching `*-simplified.geojson`, because context detail is invisible but still lands in every page's HTML.
- d3-geo at build time, no runtime JS, so the detail tier costs page weight nothing.

## Model calibration (21 Aug 2026)

Three fitted corrections sit between the raw model and the published forecast. Each lives in `data/calibration/`, each carries its own hold-out validation, and each is fitted by a script you re-run after every real election.

| File | What it does | Fitted by | Held-out effect |
|---|---|---|---|
| `party-bias.json` | subtracts a per-party constant offset (Labour ran 5.8pp hot, Greens 7.5pp cold) | `scripts/calibrate-party-bias.mjs` | +3.1pp winners, -0.90pp MAE |
| `confidence.json` | replaces the old high/medium/low label with a winner probability by predicted margin | `scripts/calibrate-confidence.mjs` | Brier 0.228 vs 0.247 flat |
| `baseline-recency.json` | half-life for blending a ward's earlier contests into its baseline | hold-out sweep, see the file | -0.135pp MAE |
| `reform-regional-multiplier.json` | step 9b uplift multipliers per region tier | `scripts/sweep-uplift-multipliers.mjs` | +1.50pp winners (metropolitan tier) |

**A calibration is a property of the model, so refit every one of them whenever the engine changes.** Changing the baseline rule or an uplift multiplier moves the residual error the calibrations describe.

**Never apply a calibration to the election it was fitted on.** Both apply-time libraries refuse it by polling date, and the fitters refuse to run on predictions already carrying a correction. Two circularity bugs were caught this way and one only by comparing the live page against working notes: a fit computed on already-corrected predictions came out a quarter too small and looked fine.

**The "other" uplift tier is deliberately unresolved** at its hand-set 0.85: three folds preferred 0.60 and two preferred 0.85, and taking every fold's pick produced one badly negative fold. It needs a second real election, not another opinion.

## By-election data (21 Aug 2026)

Two separate feeds, not interchangeable. **Models** read `data/history/dc-historic-results.json` (gitignored, vps only). **The site's ward scorecard** reads `data/results/local-byelections.json` (tracked, hand-curated). Updating one does nothing for the other.

The Friday sweep (`scripts/refresh-byelections.mjs`) writes the tracked sidecar `data/history/byelection-appends.json`, which `scripts/ingest-dc-historic-results.mjs` merges back on every rebuild. It used to write only into the history file, which the nightly ingest rebuilt from scratch, so every sweep was silently discarded within a day. `--from=` and `--pace=` flags exist for backfills; the DC ballots API rate-limits bulk callers.

**The ingest's page cache expires after 20 hours.** It previously had no expiry at all, replayed a 26 April snapshot nightly for four months, and froze the models' history at 23 April 2026 while looking perfectly healthy.

## Critical rules

1. **Don't render text where a chart can render the data.** The homepage hero + ConstituencyChoropleth + CommonsHorseshoe are the gold standard. Apply the same treatment to any new page.
2. **Use design tokens** — `--space-*`, `--text-*`, `--accent-*`, `--status-*`. Never hardcode hex literals in component CSS.
3. **Every component renders in both light + dark mode** — verify with `@media (prefers-color-scheme: dark)` in your reload cycle.
4. **`BUILD_OG=1` is opt-in everywhere, including the cron.** Builds without it skip the 811-card Satori pass and fall back to the committed `/og-default.png`. That is a supported state, not a broken one — the fallback is a real 1200×630 PNG and every page points at it.
4b. **Only advertise an OG card the build actually rendered.** `BaseLayout` asks `hasOgCard()` (from `ogEntries.ts`) before pointing `og:image` at `/og/<slug>.png`. Cloudflare Pages serves a missing path as the HTML 404 body under a **200**, so a dangling card URL doesn't 404 — it silently hands crawlers `text/html` and kills the preview. Add a page to `ogEntries.ts` if you want it to have a card; never hand-write the meta path.
5. **Party colours are saturated by design** — they look fine in both modes; don't dark-mode them.
6. **Boundaries are committed, in two tiers, and rebuilt by script.** `scripts/fetch-boundaries.mjs` downloads from ONS; `scripts/simplify-boundaries.mjs` turns each raw file into a `*-detail.geojson` (MiniMap, zoomed to one feature) and a `*-simplified.geojson` (the whole-UK choropleth and by-region maps). Both tiers are checked in. The `*-bgc-raw` downloads are **gitignored** — 40 MB that only the simplify script reads — so re-fetch rather than clone them. `wd25-bsc-raw.geojson` stays committed because there is no ward BGC to fetch (see below).
6b. **Simplify proportionally to feature size, never at one global tolerance.** Visvalingam drops points by effective area, so a single tolerance spends the budget on big rural shapes and strips small urban ones to nothing: the old files had a median of 8 vertices per seat and a floor of 4, and MiniMap drew Holborn and St Pancras as a pentagon and Exeter as a triangle. `simplify-boundaries.mjs` scales the interval by each feature's own `sqrt(area)` and enforces a vertex floor, and `tests/geoRewind.test.ts` guards that floor. Measured on the choropleth's own projection, that is ~4x more efficient than a uniform interval at the thing that was broken: lifting Holborn and St Pancras to 19 vertices cost 80KB of gzipped path data area-proportionally and 311KB uniformly.
6c. **Know which ONS product you are on.** BUC is Ultra Generalised (500m) and is too coarse to simplify from — Holborn and St Pancras is an 8-vertex octagon in raw BUC, so no re-simplification could ever have fixed it. PCON and LAD build from BGC (20m). Wards are stuck on BSC (200m): the ward BGC service is published TilesOnly and refuses feature queries, which is why a handful of City of London wards, and Brackla East Central at 4 vertices, cannot be improved from here.
7. **Reuse `partyColour()` and `shortPartyLabel()`** — don't create parallel mappings.
8. **OG card sub-labels follow the page's primary data** — candidate names on by-elections, seat counts on councils, % on vote shares.

## Deployment

- GitHub: `tompickup23/ukelections` (source of truth)
- Cloudflare Pages: `ukelections` (production)
- GitHub Pages: `tompickup23.github.io/ukelections/` (auto-mirrored backup)
- Domain: `ukelections.co.uk` (CF Pages custom domain, behind Cloudflare Access)
- **`refresh-pipeline.mjs` does NO git pull.** The nightly cron builds whatever is checked out at `/root/ukelections`, so merging to main ships nothing on its own. After any merge you expect to reach production: `git pull --ff-only --autostash` on vps-main, confirm with `git log --oneline -1`, then build.
- **Never `wrangler pages deploy dist` from the shared checkout.** A concurrent build empties `outDir` mid-upload and publishes an empty site. `cp -a dist /tmp/uke-deploy-x` and deploy the copy.
- A clean rebuild needs `rm -rf dist .astro node_modules/.vite`, otherwise you get `ERR_MODULE_NOT_FOUND` on prerender chunks.

## Cross-repo lessons (5 Jul 2026)

Hard-won gotchas for this site live in the clawd repo: `/Users/tompickup/clawd/docs/lessons/sister-sites.md` (deploy flows, CSP/Pagefind/Astro 6 gotchas, OG-card standard, em-dash sweep method) and `/Users/tompickup/clawd/docs/lessons/editorial-method.md` (fact-check protocol, factual anchors). Read the relevant one before major work, and append new lessons there, not here.
