# Local upstream imports

UK Elections can now ingest the local AI DOGE, UKD/asylumstats, and Labour tracker datasets without committing those raw files to this repository.

Run:

```bash
node scripts/import-local-upstreams.mjs --output /tmp/ukelections-local-upstreams
```

The importer writes:

- `source-snapshots.json`
- `boundary-versions.json`
- `boundary-mappings.json`
- `election-history.json`
- `candidate-rosters.json`
- `poll-aggregate.json`
- `model-features.json`
- `import-summary.json`

Generated files should stay outside git until the source review is complete. The default output directory is `/tmp/ukelections-local-upstreams`; `data/imported/` and `data/upstream-cache/` are ignored if a local run writes inside the repo.

## Imported upstreams

AI DOGE local election data:

- Ward/division election history from council `elections.json` files.
- Current candidate rosters from `candidates_2026` where at least two standing parties are present.
- Lancashire `candidates_2026` rows are treated as statement-of-persons-nominated derived when they match `data/lancashire-2026-sopn-sources.json`.
- The Lancashire source manifest records official council notice URLs for Blackburn with Darwen, Burnley, Chorley, Hyndburn, Pendle, Preston, and West Lancashire.
- Shared national polling and local model parameters from `shared/polling.json` or `shared/elections_reference.json`.
- Ward demographic and composition projections from `demographics.json` and `composition_projections.json`.

UKD/asylumstats model data:

- 2021 local authority age, sex, and ethnicity base population model.
- Migration matrix presence is recorded as a source snapshot for method audit.
- Local route asylum mart from `data/marts/uk_routes/local-route-latest.json`.
- Area-level UKD matches raise population metadata from static census context to rebased partial model context.
- Exact-area rebased UKD/AI DOGE ward projections can pass the population-method readiness gate. Low-confidence local-authority proxy projections remain proxy-only.

Labour tracker data:

- Constituency asylum support stock and rate context.
- Matched by constituency name and local authority `area_name`.
- Used as fallback where the UKD/asylumstats local route mart does not provide a direct local-authority match.
- Local-authority matches are contextual area data; constituency-only matches remain proxy-only for ward models.

## Quality gates

The importer validates all generated manifests before exiting successfully:

- Source snapshots must have hashes, row counts, raw paths, and licence notes.
- Election history rows must link to a boundary version and have internally consistent candidate vote totals.
- Model feature snapshots must record population method, source depth, geography fit, confidence, and limitations.
- Candidate rosters must have contested candidates and only one defending-seat marker.
- Boundary lineage mappings are generated only as same-code identities for current-format GSS areas.
- County division local-authority asylum context is joined from local boundary geometry where the division centroid falls inside a district ward polygon; a small Lancashire locality-name fallback handles imported county divisions missing usable geometry.
- Lancashire statement-of-persons-nominated URLs are checked into a source manifest and can be curl-verified separately before each refresh.

Every imported row is marked `quarantined`. This is intentional. The upstream data is valuable for modelling, but public forecast claims need these checks first:

- Confirm each upstream licence and original data source.
- Check ward/division boundary spans against ONS Geography, Boundary-Line, Democracy Club, and official council notices.
- Resolve historical ward changes, abolished wards, renamed wards, and predecessor/successor joins.
- Verify all candidate rosters against statements of persons nominated.
- Review each area’s population method: AI DOGE ward projection, UKD rebased model, ONS-only projection, or static Census 2021 context.
- Confirm asylum data geography and route scope before using it in any area-specific feature.

## Current limitations

The importer deliberately does not claim complete national coverage. It turns the available local upstream work into reviewed backend manifests and shows where coverage is thin.

Known gaps still requiring additional ingestion:

- Full official historical results for every borough, county, unitary, Westminster constituency, Senedd region/constituency, Scottish Parliament constituency/region, and Scottish STV ward.
- Boundary version history over time, including ward order changes and predecessor/successor mappings.
- National and regional poll archive with pollster methodology, mode, client, fieldwork, and sample metadata.
- Seat-level Westminster, Senedd, and Scottish Parliament candidate histories.
- Area-specific population model coverage where UKD/asylumstats currently has local authority depth but ward or constituency allocation is still a proxy.
