# Notional previous result for the site engine on the bridged wards: specification

Written 27 November 2026, before the engine was run with any notional result. Research only.

## The gap

The ward code bridge (`BRIDGE_RESULTS.md`) gave the ward model inputs for 220 of the 301 May 2026 wards it could not score. The candidate engine of 24 October already forecast those wards, but from its fallback: the council's 2024 general election result, national swing and the county's 2025 result. It called Reform UK first in all 220 and was right in 110. In county divisions, and in wards cut from several old areas, the 0.5 and 0.5 blend scored below the model alone.

## Counted before any forecast

- All 220 bridged wards get a notional result by party (`engine_notional_build.py`): 129 dated 2024, 89 dated 2021, 2 dated 2023. All 374 old area results used are from scheduled contests.
- The engine as it stood on polling day (commit `5e85c84`), re-run today on contests dated before 7 May 2026 with nothing added, reproduces the published forecast exactly: 2,971 forecasts, largest difference 0.

## Method

1. **Old areas and weights.** As the bridge: each bridged ward's old areas and their population weights, from `cache/bridge.pkl`.
2. **Notional result.** For each old area, its latest scheduled contest before 7 May 2026 (a by-election only if it has no scheduled contest). Each party's share is its candidates' votes over all candidate votes; independents are pooled. The ward's notional share for a party is the weighted mean over old areas with a result, counting a party that did not stand in an old area as zero there. Date: the largest old area's contest. Ballots: the weighted mean of the old areas' ballots. If old areas with a result cover less than half the population, no notional result is given.
3. **Engine.** The notional result is added to the history bundle as one earlier scheduled contest for the ward, with one notional candidate per party. The polling-day engine (`5e85c84`, `scripts/run-bulk-predictions.mjs`) is then run unchanged. Nothing else in the bundle changes; council and county aggregates do not include the notional rows.
4. **Candidate stages.** The 220 wards' new forecasts replace their fallback forecasts in the published file, and the 24 October candidate's stages (Step 9b with the refitted multipliers, Final-C aimed at the local-election target) are replayed over all wards with the functions exported by `scripts/replay-may-2026-candidate.mjs`. The replay is first checked to reproduce the stored candidate arm with nothing replaced.
5. **Blend.** 0.5 engine and 0.5 bridged ward model, as before.

Final-C scales every ward by multipliers set on the national total, and the 220 wards carried no weight in that total before (the fallback gives them no votes). So the other wards' forecasts can move slightly. That is reported, not hidden.

## Scoring

The 220 bridged wards, with the November scorer: the engine before and after, the bridged model, and the blend before and after. Then all 2,897 wards, the two strata where the blend fell short (county divisions; wards cut from more than one old area), and the number of other wards whose called leader changes.

## What would count

Supported if, on the 220 wards, the engine with a notional result calls more leaders than without (110), and the blend calls more than before (143). If the blend does not improve, the notional result is not worth carrying into the engine for 2027 on this evidence.

## Run rule

One scoring run. A fault that stops the run can be fixed without reading scores. Any rerun after a score is seen is reported.

## Limits known in advance

- May 2026 has been scored many times. This is a fair test of the notional result, since nothing is fitted to these wards, but not a clean test of the engine.
- The notional result assumes every small area voted as its old ward did.
- A result dated 2021 is five years old on polling day; the engine treats it as it treats any stale baseline.
