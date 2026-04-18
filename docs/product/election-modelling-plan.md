# Election Modelling Plan

UK Elections needs model coverage for borough, county, unitary, Westminster, Senedd, and Scottish Parliament elections. The shared product rule is source-first modelling: data quality is resolved before publication, and each election type has its own methodology.

## Near-Term Priority

Use the AI DOGE Burnley and Lancashire May election work as the internal reference implementation for local ward modelling, especially its UKD demographic breakdowns, candidate filters, incumbency handling, and Lancashire-specific local election history. Treat it as a pilot model and schema source, not as automatically publishable public output.

The first public-ready local pilot should be a borough election model because borough contests use different wards, candidates, incumbency cycles, and local baselines from county elections.

## Source Review

Every source used by another project, including AI DOGE and Labour tracker, needs a full review before import:

- Licence and attribution.
- Collection date and update cadence.
- Whether the source is primary, verified secondary, or internal derived data.
- Row-level provenance and raw-file hash.
- Boundary generation and area code compatibility.
- Candidate and party normalisation rules.
- Known gaps, manual edits, and confidence notes.

Imported internal data should initially be staged as private snapshots and only promoted to public marts after these checks pass.

## Source Stack

- Candidate rosters: Democracy Club, official statements of persons nominated, local authority notices.
- Local results: local authority result pages, Local Elections Archive Project, Open Council Data, DCLEAPIL, House of Commons Library local election handbooks where available.
- Westminster results: House of Commons Library constituency and candidate files, official returning officer declarations where needed.
- Boundaries and lookup: ONSPD, OS Boundary-Line, ONS Open Geography, Boundaries Scotland, Senedd boundary resources, MapIt for lookup checks.
- Demographics and context: UKD ward demographics, Census 2021, ONS/Nomis, IMD, local fiscal/service indicators where sourceable.
- Polling: polling records with pollster, client, fieldwork dates, sample size, mode, geography, and source URL.
- Political context: Parliament Members API, Commons Votes, Hansard, IPSA, Electoral Commission political finance, Companies House, and Register of Members' Financial Interests for constituency profile pages.

## Model Families

### Borough FPTP

The borough model is ward-first. It should use current borough ward boundaries, wards up, defending councillor, candidate list, recent borough history, local by-elections, demographics, deprivation, and local campaign context. County results can be a feature but must not replace borough ward history.

### County FPTP

The county model is division-first. It should use county division results and boundaries, not borough wards as if they were equivalent. Borough ward data may be reweighted into county divisions only with an explicit geography mapping.

### Unitary FPTP or STV

The unitary model depends on each authority's cycle and voting system. English unitary authorities are usually FPTP wards or divisions; Scottish local government uses STV and needs a different allocator and uncertainty model.

### Westminster FPTP

The Westminster model is constituency-first. It should combine official constituency results, notional or mapped predecessor results, candidate/incumbency data, national and regional polling, demographics, and local election indicators.

### Senedd Closed List PR

The 2026 Senedd model must reflect the new closed-list system and new multi-member constituencies. It should model party list vote share and seat allocation directly, not adapt the old constituency plus regional-list system.

### Scottish Parliament AMS

The Scottish model needs separate constituency and regional list vote models, then an AMS allocation stage. Constituency calls and regional list allocation should be backtested separately before producing a national seat projection.

## Tooling

- Store raw source snapshots outside public pages until reviewed.
- Use JSON Schema or Zod validation for canonical entities.
- Use DuckDB and Parquet for local marts once files are large enough to justify it.
- Use reproducible model runs that write `input_snapshot_id`, model version, git revision, and generated timestamp.
- Use TopoJSON or GeoJSON boundary assets only after simplifying and checking source licence.
- Use Playwright screenshots once maps and interactive pages are added.

## Delivery Phases

1. Source inventory and quality review for AI DOGE, Labour tracker, UKD, and public feeds.
2. Canonical schema extension for local, devolved, and Westminster model families.
3. Private source snapshot staging with hashes and licence metadata.
4. Borough pilot using Burnley/Lancashire ward data with candidate and ward gates.
5. County and unitary pilots with separate division/ward mapping.
6. Westminster constituency model and backtests.
7. Senedd 2026 closed-list model.
8. Scottish Parliament AMS model.
9. Public forecast pages only after model-family quality gates pass.

## Publication Standard

No published forecast should appear without:

- model family and version;
- source snapshot;
- candidate roster status;
- boundary generation;
- uncertainty interval;
- backtest status;
- caveat for unmapped, stale, or internally derived features.
