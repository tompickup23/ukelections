# UK Elections

Static Astro site for `ukelections.co.uk`, currently deployed as a placeholder while the domain is pending.

## Status

- GitHub: `https://github.com/tompickup23/ukelections`
- Cloudflare Pages: `https://ukelections.pages.dev/`
- GitHub Pages: `https://tompickup23.github.io/ukelections/`
- Production domain target: `https://ukelections.co.uk/`

## Commands

```bash
npm install
npm test
npm run check
npm run build
```

## Current Scope

The live scaffold is deliberately small: home, seats, area lookup, forecasts, methodology, sources, releases, and legal/accessibility pages.

The next product phase is data ingestion, not visual expansion:

1. Democracy Club candidates and election metadata.
2. House of Commons Library historic results.
3. Boundary and postcode joins from ONSPD and Boundary-Line.
4. Canonical schemas for contests, candidates, results, predictions, and backtests.
5. Forecast publication rules with uncertainty and archived predicted-vs-actual records.

## Principles

- Every public claim needs source provenance.
- Forecasts must show uncertainty.
- Boundary changes must be explicit.
- Backtests are part of the product.
- Do not add a custom domain or `CNAME` until `ukelections.co.uk` is acquired.
