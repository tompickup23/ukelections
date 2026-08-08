# Model improvements, 8 Aug 2026: what generalises platform-wide

Born from the Lancashire unitaries rebuild. Each pattern below is implemented
there and is a candidate for every council and mayoral forecast on the site.

## 1. Data-vintage disclosure (implemented for Lancashire)

Every forecast should say, per geography, how old its inputs are and where its
swing signal comes from. Lancashire now publishes a per-district table
(observed swing / blended / borrowed, own-signal weight, by-elections
ingested) plus the validation error of transferred swing. Generalise: emit a
`data_vintage` block from every build script; render one shared component.

## 2. Demographic swing borrowing (implemented for Lancashire)

Geographies with no recent contest previously froze at their last result.
Instead, borrow swing from demographically similar areas that do have an
observed swing (Gaussian kernel over standardised Census 2021 ward profiles,
`data/features/ward-demographics-2021.json`, 8,732 wards national coverage),
with the shrink factor chosen by leave-one-out and published. Lancashire:
transfer at lambda 0.5 beats freezing (2.53pp vs 2.62pp MAE per party).
Generalise to: all council forecasts with mixed election cycles, and mayoral
ge_swing apportionment.

## 3. Volume-weighted signal blending (implemented for Lancashire)

Never let one by-election speak for a district: own-signal weight is
votes/(votes+10k), so a 2k-vote by-election nudges (w~0.16) while a full
borough election dominates (w~0.75+). Replaces hard vote thresholds.

## 4. Old-base + level-correction for stale geographies (implemented: Blackpool)

When the only granular base predates a realignment (Blackpool 2023: Reform
stood 4 paper candidates), raw shares are systematically wrong and small
swings cannot fix them. Keep the old base for GEOGRAPHY (which wards lean
where) and correct the LEVEL with the best current borough-wide estimate
(by-election pool + GE2024), applied in full with a wide clamp. This is the
general recipe for any all-out council last fought pre-2024.

## 5. By-election feed discipline

The model reads `data/history/dc-historic-results.json`; the scorecard JSON is
display-only. Any by-election result must land in the HISTORY file or the
models never see it (this bit us: the feed had stopped at 23 Apr 2026).
Convention: every by-election ingestion goes through an append script
(`scripts/append-*.mjs`, idempotent by ballot id, declaration-PDF-verified
votes). TODO: a cron wrapping the Democracy Club EveryElection API sweep the
8 Aug agent used, so the feed refreshes itself.

## 6. Registry rules that keep the mayoral page honest

Watchlist entries carry `verified` (primary-source check date) and
`voting_system_if_called` (s.63/Sch.30 EDCEA 2026 = supplementary vote).
Nothing promotes to a forecast contest without an SI, an official
announcement, or a statutory cycle. Methods stay separate, never blended
(Makerfield rule), and where methods disagree the split is presented as the
finding.

## Deferred

- Cohort-drift (2025->2027 age structure) sensitivity via UKD projections.
- Electorate-growth flags for new-build wards.
- Turnout structure by demographic profile in the Monte Carlo noise.
- Ward-level (not district-level) swing regression once more 2026 ward
  results accumulate.
