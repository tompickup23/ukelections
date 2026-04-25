# UK Elections Agent Guide

> **2026-04-25 — CODEX PAUSED on this repo until 2026-05-08.** See `STOP-CODEX.md`.
> Claude has control for the national May 7 2026 launch push. Plan: `~/clawd/.claude/plans/ukelections-finish.md`.

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

1. **Strict neutrality.** This is a public-utility election polling and information site. No partisan framing, no "watch" lists for any party, no editorial slant. Parties are listed alphabetically or by vote share, never by ideology. Surface every party that stands a candidate; show every contest equally.
2. **UKD demographic modelling is the analytical core.** UK Demographics HP v7.0 ethnic projections + Census 2021 composition change since last contest are the primary signal that distinguishes our forecast from competitors. Document the demographic adjustment on every prediction page.
3. Public copy must stand on official or named public sources.
4. Forecasts need uncertainty, model version, input snapshot, and publication timestamp.
5. Backtests are public product data, not internal notes.
6. Boundary changes require explicit mapping or a clear caveat.
7. Keep Cloudflare Pages as the production host unless the deployment plan is deliberately changed.

## Data Priorities

- Democracy Club candidates and Statements of Persons Nominated
- House of Commons Library general election results
- Andrew Teale/OpenCouncilData local election archive
- ONSPD, OS Boundary-Line, and LSOA-to-seat joins
- Polling records with source, fieldwork dates, sample size, and method notes
- Separate model families for borough, county, unitary, Westminster, Senedd, and Scottish Parliament contests
