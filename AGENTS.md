# UK Elections Agent Guide

## Product

UK election intelligence site. The public product direction is candidates, historic results, boundaries, forecasts, confidence intervals, source notes, and transparent backtests.

## Architecture

- Astro static site
- TypeScript helpers and tests
- Cloudflare Pages placeholder deployment
- GitHub Pages fallback deployment
- Production domain target: `ukelections.co.uk`

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
5. Do not add custom-domain files or DNS assumptions until `ukelections.co.uk` is acquired.

## Data Priorities

- Democracy Club candidates and Statements of Persons Nominated
- House of Commons Library general election results
- Andrew Teale/OpenCouncilData local election archive
- ONSPD, OS Boundary-Line, and LSOA-to-seat joins
- Polling records with source, fieldwork dates, sample size, and method notes
