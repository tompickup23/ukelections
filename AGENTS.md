# UK Elections — Agent Guide

## What This Is

UK election intelligence site. Astro 5 static frontend, initially cloned from the UK Demographics scaffold. The product direction is public, source-led election data: candidates, historic results, forecasts, confidence intervals, boundary mapping, and transparent backtests.

## Architecture

- **Framework:** Astro 5 static site
- **Language:** TypeScript data loaders, Astro components, Node transform scripts
- **Hosting target:** Cloudflare Pages after domain acquisition
- **Repo target:** `tompickup23/ukelections`
- **Domain target:** `ukelections.co.uk`

## Current Scaffold State

The repo still contains UK Demographics pages and datasets as reusable infrastructure. Treat those as scaffold material until the election data model replaces them.

Do not remove broad page/data infrastructure just because it is not yet election-specific; refactor it deliberately as election datasets land.

## Build Commands

```bash
npm run build
npm test
npm run check
```

## Critical Rules

1. **No stale AI DOGE dependency in public copy.** AI DOGE can inform private modelling work, but public pages must stand on official/public sources.
2. **Source every figure.** Election results, polling, candidates, and boundary mappings need visible provenance.
3. **Forecasts need uncertainty.** Include P10/P50/P90 or equivalent intervals where predictions appear.
4. **Publish backtests.** Model credibility comes from predicted-vs-actual tables, not just nice maps.
5. **Boundary changes are first-class.** Do not compare old and new areas without mapping logic or a clear caveat.
6. **Keep domain steps separate.** Do not add `CNAME` or Cloudflare custom-domain assumptions until `ukelections.co.uk` is acquired.

## Initial Data Priorities

- Democracy Club candidates and Statements of Persons Nominated
- House of Commons Library general election results
- Andrew Teale/OpenCouncilData local election archive
- ALDC historic local results where usable
- ONSPD, OS Boundary-Line, and LSOA-to-seat best-fit joins
- Polling aggregation with source, fieldwork dates, sample size, and margin-of-error handling

## UX Direction

Use the existing UK Demographics scaffold for speed, but move the product language toward:

- contest search
- seat/ward pages
- forecast cards
- methodology and backtest pages
- map-first exploration
- public source ledger
