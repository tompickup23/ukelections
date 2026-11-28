# Ward Census correction and regional level, out of time: results

28 November 2026. **Research only**; nothing on the site, the engine or the published forecast reads anything here. Specification: `OOT_CENSUS_REGION_SPEC.md`, committed on its own (`15b1cdb`) before the scoring script was written. Every figure below is from `results/oot_census_region_summary.json`, written by `oot_census_region.py`.

## Verdict

- **A, the ward Census correction: not supported.** Fitted on May 2025 and scored on May 2026, it calls 25 more ward leaders than C2, but the 95% interval runs from 23 fewer to 72 more, and share error rises by 0.54 points (interval 0.35 to 0.74). Fitted on May 2026 and scored on the 107 later by-elections, it calls 9 fewer (interval 19 fewer to 1 more) and share error rises by 0.21 points. It fails all three conditions of the rule, and meets the "not supported" test because share error is higher on both sets.
- **B, the regional level proxy: not supported.** May 2026: 18 more leaders (interval 16 fewer to 49 more), share error up 0.10 points (0.02 to 0.17). By-elections: 4 fewer (10 fewer to 2 more), share error up 0.24 points (0.07 to 0.40). Share error is higher on both sets.
- **A and B together are worse than either alone on the by-elections**: 13 fewer leaders than C2, and that interval (23 fewer to 3 fewer) lies wholly below zero.
- **No regional polling exists to test I974 properly.** B is a proxy from the previous May's results, not a regional poll; see "What regional data exists" in the specification. A failed proxy does not show that regional polls would fail.

## Leaders called and share error

"Leaders" counts contests (by-elections) or wards (May 2026) whose first placed party, by full slate share over six pooled lanes, the arm called correctly. Every arm forecasts every row in both sets. Share error is the mean absolute error, in points, over lanes with a forecast or an actual share.

| Arm | By-elections after 7 May 2026 (107) | Share error | May 2026 wards (2,576) | Share error |
|---|---|---|---|---|
| C2 | 68 (63.6%) | 6.66 | 1,764 (68.5%) | 5.48 |
| C2+A | 59 (55.1%) | 6.87 | 1,789 (69.4%) | 6.02 |
| C2+B | 64 (59.8%) | 6.90 | 1,782 (69.2%) | 5.58 |
| C2+A+B | 55 (51.4%) | 7.34 | 1,777 (69.0%) | 6.09 |

The by-elections run from 11 June to 19 November 2026, with A and B fitted on the 2,576 scheduled wards of 7 May 2026. The May 2026 forward check has A and B fitted on the 1,399 scheduled wards of 1 May 2025. C2's 1,764 reproduces PR 211's corrected figure, so the base is the same.

## Paired differences against C2

95% percentile intervals from a paired bootstrap, 10,000 resamples, seed 20261128. By-elections are resampled by contest (107 units), May 2026 wards by council (134 units).

| Set | Arm | Leaders, difference (interval) | Gained / lost | Share error, difference in points (interval) |
|---|---|---|---|---|
| By-elections | C2+A | minus 9 (minus 19 to plus 1) | 8 / 17 | plus 0.21 (minus 0.07 to plus 0.49) |
| By-elections | C2+B | minus 4 (minus 10 to plus 2) | 3 / 7 | plus 0.24 (plus 0.07 to plus 0.40) |
| By-elections | C2+A+B | minus 13 (minus 23 to minus 3) | 8 / 21 | plus 0.68 (plus 0.31 to plus 1.05) |
| May 2026 | C2+A | plus 25 (minus 23 to plus 72) | 227 / 202 | plus 0.54 (plus 0.35 to plus 0.74) |
| May 2026 | C2+B | plus 18 (minus 16 to plus 49) | 110 / 92 | plus 0.10 (plus 0.02 to plus 0.17) |
| May 2026 | C2+A+B | plus 13 (minus 36 to plus 62) | 220 / 207 | plus 0.61 (plus 0.42 to plus 0.80) |

## The rule, applied

| Condition | A | B |
|---|---|---|
| 1. May 2026 leader interval wholly above zero | no (minus 23) | no (minus 16) |
| 2. By-election leader difference zero or more | no (minus 9) | no (minus 4) |
| 3. Share error no higher than C2 on both sets | no | no |
| Not supported trigger met | yes: share error higher on both | yes: share error higher on both |
| **Verdict** | **not supported** | **not supported** |

## Why A moves leaders but loses share accuracy

Signed bias, forecast minus actual share, in points, with leads called against leads won:

| Set | Arm | Reform UK | Labour | Conservative | Lib Dem | Green | Others |
|---|---|---|---|---|---|---|---|
| May 2026 | C2 | minus 2.79 (641 / 858) | minus 2.68 (360 / 447) | minus 0.03 (411 / 386) | plus 1.58 (532 / 445) | plus 2.21 (379 / 295) | plus 4.69 (253 / 145) |
| May 2026 | C2+A | minus 0.08 (991 / 858) | minus 2.45 (269 / 447) | plus 0.60 (300 / 386) | minus 1.21 (404 / 445) | minus 1.37 (301 / 295) | plus 10.29 (311 / 145) |
| By-elections | C2 | plus 1.63 (30 / 22) | minus 3.30 (13 / 23) | plus 1.23 (28 / 25) | minus 1.75 (17 / 19) | plus 1.95 (17 / 15) | minus 0.14 (2 / 3) |
| By-elections | C2+A | plus 5.42 (51 / 22) | minus 2.19 (13 / 23) | plus 0.11 (21 / 25) | minus 2.63 (13 / 19) | plus 0.01 (9 / 15) | minus 3.18 (0 / 3) |

- **On May 2026, A mostly carries forward a level, not a ward pattern.** The 2025 fit learned that C2 had Reform UK too low, and it lifts Reform UK almost exactly to level (minus 2.79 to minus 0.08). The same fit pushes Others up by 10 points, which is where the share error comes from.
- **On the by-elections the same move overshoots.** C2's own by-election forecasts were fitted with May 2026 in training and already sit high on Reform UK (plus 1.63). A, fitted on May 2026 residuals of a model that had not seen May 2026, adds Reform UK's May 2026 shortfall on top: Reform UK is called first in 51 contests and led 22. This double counting was named as a limit in the specification before the run.

## National seat totals, May 2026 (descriptive)

Method M0 (the leader takes every seat up), RMSE in seats over Reform UK, Labour, Conservative, Liberal Democrats and Green Party, against seats won in `results/seats_actual_wards.csv` (PR 203, read from main), all 2,576 wards matched:

| Arm | RMSE five | Reform UK | Labour | Conservative | Lib Dem | Green |
|---|---|---|---|---|---|---|
| C2 | 180.6 | minus 327 | minus 168 | plus 51 | plus 110 | plus 115 |
| C2+A | 159.8 | plus 150 | minus 296 | minus 116 | minus 62 | minus 14 |
| C2+B | 172.0 | minus 297 | minus 177 | plus 62 | plus 116 | plus 105 |
| C2+A+B | 143.8 | plus 125 | minus 280 | minus 67 | minus 61 | minus 33 |

Seat error falls under A, because A turns a large Reform UK shortfall into a smaller surplus. That is the level effect again, and it reverses at the by-elections. PR 203 reported 175.2 for C2 under M0 on the older inputs; this 180.6 is on PR 211's corrected inputs.

## Leakage checks

- The script asserts, for each set, that every fitting row is dated before every target row, that no target row is in the fit, and that the fitting election is the latest scheduled May before the targets. All passed.
- The C2 arm reproduces the rebuild's C2 shares exactly (asserted), and the predictions and settings files match the hashes in the specification.
- Nothing looks like leakage. The one structural issue is the double counting described above: it is not information from the future, but it means a residual correction fitted on one model's errors should not be applied to a later model that has already trained on the same election.

## What this means for the 2027 vintage 1 model

- **Keep C2 as it is.** Neither input earns a place on this evidence, and the combination is clearly worse on the only clean test.
- **The 26 November Census correction should not be described as a forward gain.** Its 872 to 984 was fitted on the election it scored. Fitted a year earlier, its effect on leaders is inside noise and its share error is worse.
- **The Reform UK level problem is real and A's forward check shows it**: carrying May 2025's Reform UK shortfall forward would have fixed May 2026's level almost exactly, then overshot at the by-elections. Any level correction for May 2027 needs a source that is current on the day, which today means national polls only.
- **A real test of I974 needs regional polling with an area field,** which the repo does not hold. That is an owner decision about data, not a modelling one.

## The run

- `uv run python oot_census_region.py`, 2 seconds. The first run wrote the rule's three conditions as text strings ("False") because numpy booleans passed through the JSON writer's string fallback. They were cast to booleans and the script run a second time; every set, score and interval is identical between the two runs (compared programmatically), only the three flags changed type. That is the only rerun.
- Fixed and unchanged: C2's forecasts (`cache/rebuild/corrected/bridge_level_predictions.pkl`), lambda 1, shrinkage 20, the feature list, the seed.
