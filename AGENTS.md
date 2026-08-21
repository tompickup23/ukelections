# UK Elections Agent Guide

> **2026-05-19 update**: Tier-A/B/C elevation campaign shipped. Site is now
> data-first across every page (race bars, Commons horseshoe, choropleth,
> mini-maps, dark mode, Pagefind search, 812 per-page Satori OG cards).
> See `CLAUDE.md` for the architecture snapshot and `~/.claude/plans/swift-scribbling-gadget.md` for the plan.

## Product

UK election intelligence site. The public product direction is candidates, historic results, boundaries, forecasts, confidence intervals, source notes, and transparent backtests. **Gold-standard rule (19 May 2026):** data should be rendered as the visual — never describe a stat in text where a chart can show it.

## Model calibration and by-election feeds (21 Aug 2026)

Read the same-named sections of `CLAUDE.md` before touching the model or the
by-election data. The two rules that bite hardest:

- **A calibration is a property of the model.** Refit `data/calibration/party-bias.json`
  and `confidence.json` whenever the engine changes, and never apply either to the
  election it was fitted on. The apply libraries and the fitters both refuse, because
  the circular version looks like a success.
- **Two by-election feeds exist and are not interchangeable**: models read
  `data/history/dc-historic-results.json`, the site scorecard reads
  `data/results/local-byelections.json`.

## Architecture

- Astro static site
- TypeScript helpers + Vitest unit tests
- Cloudflare Pages production deployment (custom domain `ukelections.co.uk`, behind Cloudflare Access)
- GitHub Pages auto-mirror at `tompickup23.github.io/ukelections/`
- Token-driven CSS in `src/styles/global.css` with system-preference dark mode
- Build-time visualisation: d3-geo (maps), Satori (OG cards), Pagefind (search), inline SVG (charts)

## Commands

```bash
npm test
npm run check
npm run build                  # iteration build, ~25s
BUILD_OG=1 npm run build       # full build with 812 OG cards, ~3 min
npm run ge:refresh             # polling refresh → GE pipeline → Restore Britain overlay
```

## Rules

1. **Strict neutrality.** Public-utility election information site. No partisan framing, no "watch" lists for any party, no editorial slant. Parties listed alphabetically or by vote share, never by ideology. Surface every party that stands a candidate.
2. **Data is the visual.** Never render a stat in text where a chart can render the data. Reference: homepage hero, ConstituencyChoropleth, CommonsHorseshoe.
3. **UKD demographic modelling is the analytical core.** UK Demographics HP v7.0 ethnic projections + Census 2021 composition change drive the forecast. Document the demographic adjustment on every prediction page.
4. **Use design tokens.** `--space-*`, `--text-*`, `--accent-*`, `--status-*` in `src/styles/global.css`. Never hardcode hex literals or rem/px spacing in component CSS.
5. **Verify in both modes.** Every component must render cleanly in light AND dark mode (`@media (prefers-color-scheme: dark)`).
6. Public copy must stand on official or named public sources.
7. Forecasts need uncertainty, model version, input snapshot, and publication timestamp.
8. Backtests are public product data, not internal notes — surface them on every place page.
9. Boundary changes require explicit mapping or a clear caveat (e.g. `TBC (Local Government Reorganisation)`).
10. **Reuse shared components.** `<RaceBar />`, `<HeroClock />`, `<PartyBars />`, `<StatCard />`, `<MiniMap />`, `<PartyTrendChart />`, `<ConstituencyChoropleth />`, `<CommonsHorseshoe />`. Don't reimplement.
11. **Reuse `partyColour()` + `shortPartyLabel()`** — single source of truth for the palette + display labels.
12. Keep Cloudflare Pages as the production host unless deliberately changed.

## Data Priorities

- Democracy Club candidates and Statements of Persons Nominated
- House of Commons Library general election results
- Andrew Teale/OpenCouncilData local election archive
- ONSPD, OS Boundary-Line, and LSOA-to-seat joins
- Polling records with source, fieldwork dates, sample size, and method notes
- Separate model families for borough, county, unitary, Westminster, Senedd, and Scottish Parliament contests
