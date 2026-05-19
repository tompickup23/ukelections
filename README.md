# UK Elections

Static Astro site for `ukelections.co.uk` — election intelligence for every UK contest.

## Status

- GitHub: `https://github.com/tompickup23/ukelections`
- Cloudflare Pages: `https://ukelections.pages.dev/`
- GitHub Pages mirror: `https://tompickup23.github.io/ukelections/`
- Production domain: `https://ukelections.co.uk/`

## Commands

```bash
npm install
npm test
npm run check
npm run build                  # iteration build (~25s)
BUILD_OG=1 npm run build       # full build with 812 OG cards (~3 min)
npm run ge:refresh             # polling refresh → GE pipeline → Restore Britain overlay (~30s)
```

## What's shipped

**Pages**
- Homepage with data-first hero (next imminent UK contest as race bar + giant day countdown)
- General-election forecast for all 650 UK parliamentary constituencies, including an interactive UK choropleth + Commons-horseshoe seat tally
- Per-seat detail pages (650) with GE2024 backtest predicted-vs-actual side-by-side
- Council pages (~360) with May 7 2026 result, accuracy stat-card row, and a LAD mini-map
- Ward pages (~3,000) with per-ward backtest callouts
- Polling page with rolling Westminster average + per-party trend chart + refresh ledger
- Past-results page with accuracy audit + per-party MAE bar chart + Reform-majority list
- By-elections detail (Makerfield) with scenario A/B race-bar comparison
- About / methodology / sources / transparency / coverage

**Build-time visualisation stack**
- d3-geo for the choropleth + mini-maps (no client runtime)
- Server-rendered SVG everywhere (Commons horseshoe, party bars, race bars, trend chart, mini-maps)
- Satori + @resvg/resvg-js for 812 per-page OG cards with embedded mini race bars
- Pagefind static-site search (3,810 pages indexed)

**Design**
- Token-driven CSS — spacing scale, type scale, party-aligned accents, status palette
- System-preference dark mode (no manual toggle in v1)
- Sora display + Manrope body
- Tabular numerals everywhere

## Principles

- **Data is the visual.** Don't render text where a chart can render the data.
- Every public claim needs source provenance.
- Forecasts must show uncertainty (confidence intervals + classification labels).
- Boundary changes must be explicit (TBC where Local Government Reorganisation is in play).
- Backtests are part of the product — every place page carries its own forecast-vs-actual record.
- Both modes work — verify in light AND dark before shipping.
- Cloudflare Pages is the production host for the custom domain; GitHub Pages is the backup mirror.
