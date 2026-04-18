# UK Elections

Static Astro site scaffold for `ukelections.co.uk`.

The project starts from the proven `ukdemographics` Astro stack and will become a UK-wide election intelligence product: candidates, historical results, boundary-aware forecasts, confidence intervals, demographic context, and published backtests.

## Current Status

- Local scaffold created at `/Users/tompickup/ukelections`
- Domain not yet acquired
- GitHub repository target: `tompickup23/ukelections`
- Hosting target: Cloudflare Pages once the domain is available

## Build

```bash
npm install
npm run build
npm test
```

## Initial Roadmap

1. Data foundation: Democracy Club candidates, House of Commons Library historic results, Andrew Teale/OpenCouncilData ward archive, ALDC results where available, ONSPD and Boundary-Line joins.
2. Canonical schema: elections, contests, candidates, results, areas, boundary mappings, predictions, and model backtests.
3. Model build: FPTP, MRP, AMS, Welsh closed-list PR, STV Monte Carlo, mayoral and PCC modules.
4. Site build: contest pages, national and regional rollups, interactive maps, methodology, sources, and search.
5. Launch discipline: publish confidence intervals and predicted-vs-actual backtests.

## Principles

- Every claim needs source provenance.
- Forecasts must show uncertainty.
- Boundary changes must be handled explicitly.
- Backtests are part of the product, not an internal afterthought.
- The site must stand on public evidence and avoid internal AI DOGE references.
