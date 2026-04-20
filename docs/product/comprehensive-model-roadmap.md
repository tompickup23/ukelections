# Comprehensive Model Roadmap

This is the remaining backend work needed before UK Elections can publish serious model outputs for every area.

## 1. Source Acquisition

- Democracy Club ballots and candidates.
- Official statements of persons nominated.
- Local authority result pages and returning officer declarations.
- Local Elections Archive Project, Open Council Data, DCLEAPIL, and Commons Library local election handbooks.
- House of Commons Library Westminster result files.
- Boundary-Line, ONS Open Geography, ONSPD, Boundaries Scotland, and Senedd boundary resources.
- Polling records with British Polling Council disclosure fields.
- Home Office local asylum support tables.
- ONS/Nomis Census, ONS subnational population projections, and local population model outputs from asylumstats and ukdemographics.

## 2. Backend Marts

Build reviewed marts for:

- `source_snapshots`
- `boundary_versions`
- `boundary_mappings`
- `election_history_records`
- `candidate_rosters`
- `poll_aggregates`
- `population_feature_snapshots`
- `asylum_context_snapshots`
- `model_feature_snapshots`
- `model_runs`
- `prediction_outputs`
- `backtests`

## 3. Election-Specific Models

- Borough FPTP: ward history, current wards up, defending councillor, candidate roster, local cycle, local demographics, asylum/population context only when reviewed and backtested.
- County FPTP: county division history and division boundaries. Borough ward data only via explicit mapping.
- Unitary FPTP: authority-specific cycle and predecessor-boundary mapping.
- Local STV: first-preference model and seat allocator with transfer assumptions.
- Westminster FPTP: constituency result history, notional or mapped predecessor data, candidates, incumbency, national and regional polls, local election signals.
- Senedd closed-list PR: new multi-member constituencies, party lists, Welsh polling, list allocation rules.
- Scottish AMS: constituency and regional list models, then AMS allocation.

## 4. Poll Aggregation

Needed before forecasts:

- Pollster, client, fieldwork dates, sample size, mode, geography, population, source URL.
- Recency weighting with a documented half-life.
- Sample-size weighting with caps to avoid one poll dominating.
- Pollster house-effect adjustment only after enough historic data exists.
- Separate national, regional, Westminster, Scottish, Welsh, and local-context aggregates.
- Archived aggregate snapshots for every model run.

## 5. Asylum And Population Integration

Asylum data should be route-specific and unit-specific:

- Home Office local asylum support is quarter-end stock, not arrivals or total migration.
- It should not be merged with small boats, Ukraine, Afghan, family reunion, or generic migration totals.
- Local nationality breakdown is not published, so ethnicity impact estimates using national nationality mix are indicative only.
- Asylum context can be stored per local authority and mapped to constituencies or wards only with explicit precision metadata.

Population features must be area-specific:

- Some areas can use high-quality Census 2021 rebased cohort-component modelling.
- Some areas only have ONS SNPP totals, Census static baselines, or parent-area proxies.
- Every area needs method, source depth, geography fit, confidence, and limitations before use.

## 6. Accuracy And Backtesting

No model family is publication-grade until:

- historic contests are boundary-versioned;
- candidates are verified;
- source snapshots are hashable;
- model inputs are immutable;
- outputs include uncertainty intervals;
- backtests report calibration, mean absolute error, winner accuracy, and biggest misses;
- feature ablation shows whether asylum/population/polling features improve or harm predictions.

## 7. Still To Build

- A persistent local data store, likely DuckDB plus Parquet once data volume grows.
- Crosswalk generation for wards, divisions, constituencies, LSOAs, local authorities, Senedd areas, and Scottish regions.
- Candidate roster importer and withdrawal/replacement handling.
- Public result and forecast pages backed by reviewed data.

## 8. Backend Now Wired

- Source snapshot validation.
- Boundary-versioned history validation.
- Candidate roster validation.
- Boundary mapping weight validation.
- Poll aggregation implementation.
- Area model feature validation, including asylum and population safeguards.
- Model-run manifest validation.
- Backtest metrics runner.
- Generic source snapshot fetcher.
- Area feature compiler.
- Local upstream importer for AI DOGE, UKD/asylumstats, and Labour tracker data.
- National model readiness validation, so every area can be blocked until source, boundary, candidate, population, poll, and backtest gates pass.
- Baseline historical-persistence backtests, so missing backtests are replaced by measured passed/failed/missing status.

## 9. National Readiness Standard

Every model area now needs a readiness record before it can be promoted beyond internal use. A record has hard gates for:

- boundary versions;
- election history;
- candidate rosters;
- poll context;
- population method;
- asylum context;
- backtest status.

`publishable` and `published` records are rejected unless boundary, history, candidates, polling, population, and backtest gates are reviewed or accepted, blockers are empty, and backtests have passed. This is the practical interpretation of 100% accuracy: no forecast is public unless its inputs and method are traceable, current, and reviewed.

Candidate rosters are now split between active-contest gates and deferred nomination gates. A ward or division with no active contest is not blocked for lacking current nominees. Active Lancashire 2026 candidate rosters can be promoted to reviewed when they are linked to official statement-of-persons-nominated URLs.

Asylum and population gaps are non-blocking warnings for baseline forecasts. They remain blocking for any specific asylum-enhanced or population-enhanced claim unless the relevant feature gate is reviewed for that area.

Readiness output now separates three concepts:

- `blockers`: hard failures that prevent an area from reaching review status;
- `warnings`: validation anomalies that need immediate data-quality attention;
- `readiness_tasks`: visible remaining work before publication or enhanced-feature claims.

The baseline local model can therefore have zero blockers and zero warnings while still staying in `review` because publication tasks remain. That is deliberate: it prevents source gaps from being hidden, while avoiding false alarm warnings for optional context such as asylum or population-enhanced features.

Current importer/readiness improvements:

- current-format GSS wards and divisions now get generated identity boundary-lineage mappings, so unchanged imported boundary versions are auditable instead of held on a generic lineage warning;
- exact-area, medium-confidence UKD/AI DOGE ward population projections are promoted to reviewed method metadata, while local-authority proxy projections remain proxy-only;
- UKD/asylumstats local route asylum rows are imported before Labour tracker fallback rows. Local-authority asylum stock is reviewed as contextual area data; constituency-only matches remain proxy-only;
- Lancashire county divisions can inherit local-authority asylum context from local boundary geometry, with a locality-name fallback only where imported county division geometry is missing;
- baseline backtests use a fixed rolling two-contest party-share average in walk-forward testing, replacing single previous-contest persistence where it improves stability without looking ahead.
- baseline backtests prefer same-council comparators when enough local evidence exists, then fall back to the wider model-family pool.
- the local audit classifies every review area into a concrete action code, separating post-boundary single-contest gaps, temporal-validation limits, winner-signal failures, and vote-share calibration failures.

The current local audit can be reproduced with:

```bash
npm run build:local-audit -- --output /tmp/ukelections-local-upstreams
```

As of the latest local run, the imported Lancashire-focused bundle has 335 model areas, 334 passed baseline backtests, 1 failed backtest, 284 publishable areas, 51 review areas, and no internal blockers. The 51 review areas are deliberately not public-grade: most need another current-boundary contest, official notional history, or a stronger elected-party signal.

Official and verified source catalogue examples are in `data/national-source-catalog.example.json`. Current source priorities are:

- House of Commons Library Westminster result files for 2024 and 1918-2019.
- Democracy Club and Electoral Commission election APIs for current election/candidate discovery.
- Statements of persons nominated as the promotion gate for candidate rosters.
- ONS small-area population methodology and Census/ONS estimates for demographic features.
- Boundaries Scotland and DataMapWales/Senedd resources for devolved boundaries.
- Home Office local asylum support tables for route-specific asylum context.

The remaining work is mainly real data acquisition, crosswalk generation at national scale, and model-family-specific forecast algorithms using these validated marts.
