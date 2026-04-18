# UK Elections Agent Guide

## Product

UK election intelligence site. The public product direction is candidates, historic results, boundaries, forecasts, confidence intervals, source notes, and transparent backtests.

## Architecture

- Astro static site
- TypeScript helpers and tests
- Cloudflare Pages production deployment
- GitHub Pages fallback deployment
- Production domain: `ukelections.co.uk`

## Commands

```bash
npm test
npm run check
npm run build
```

## Rules

1. Public copy must stand on official or named public sources.
2. Forecasts need uncertainty, model version, input snapshot, and publication timestamp.
3. Backtests are public product data, not internal notes.
4. Boundary changes require explicit mapping or a clear caveat.
5. Keep Cloudflare Pages as the production host unless the deployment plan is deliberately changed.

## Data Priorities

- Democracy Club candidates and Statements of Persons Nominated
- House of Commons Library general election results
- Andrew Teale/OpenCouncilData local election archive
- ONSPD, OS Boundary-Line, and LSOA-to-seat joins
- Polling records with source, fieldwork dates, sample size, and method notes
- Separate model families for borough, county, unitary, Westminster, Senedd, and Scottish Parliament contests
