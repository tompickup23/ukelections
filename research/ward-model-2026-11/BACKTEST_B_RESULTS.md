# Ward model back-test on 2018 to 2023, stage B: results

27 November 2026. **Research only.** Specification: `BACKTEST_B_SPEC.md`, committed before any stage B forecast was produced (commit `aa82991`). One run of the fit and one of the scorer. Every figure below is from `results/backtest_b_summary.json`, written by `backtest_b_score.py`; counts are wards (scheduled) or contests (by-elections) whose leader was called correctly.

**Stage B depends on PR 192** (branch `claude/data-polls-2017-2019-9876e6`, not merged) for the 2017 to 2019 polls. If that PR changes before it merges, these anchors would need rebuilding.

## Answer

1. **(a) W365c is not supported.** Pooled over 2019, 2021, 2022 and 2023 it called 6,621 leaders against S1c's 6,643, with share error 5.92 against 5.88, and more leaders in only one year (2019). It fails all three parts.
2. **(b) The clean model does not beat the swing benchmark, and the mix does not reliably beat either.** S1c beats B2 only in 2023, by 2 wards; it is 10, 28 and 30 short in 2019, 2021 and 2022. M2 calls more leaders than S1c in three of four years (2023 is 6 short) and beats B2 only in 2019. None of the three holds in all four years, so none is supported.
3. **(c) The six future inputs are worth 62 wards in 8,051, and 0.17 points of share error.** S1 beats S1c in every year (by 33, 15, 7 and 7 wards). So the July 2024 inputs flattered stage A only a little.
4. **(d) A called leader is right about 84% to 88% of the time at a forecast lead of 5 points or more,** and 90% to 93% at 15 points or more, for S1c and M2 alike. Under 5 points it is about a coin toss.
5. **(e) Where B2 cannot be computed, the clean model does no better than "same party as last time":** 567 against 579 of 722 wards, almost all of them in May 2021.
6. **May 2018 cannot be forecast,** and neither can the 149 May 2021 wards where Reform UK stood (see the run).

## The run

- **Fit:** 64 fits (five scheduled days, 59 by-election months), 292 lane jobs, four arms in each, eight jobs at a time. Fitting took 941 seconds; the whole script 15 minutes 46 seconds on this Mac.
- **Nothing failed and nothing was fixed after the specification.** Two choices were made before it, after seeing anchor coverage and before any forecast, and both are in the specification. A 21 day fallback window, without which 2 May 2019 has no anchor (only 2 of the 4 polls in 14 days carry a Green share). Rows are forecast only when every standing lane has a model, without which May 2018 would have been forecast as 100% Conservative everywhere.
- **Unforecastable rows.** May 2018: all 2,115, since only the Conservative lane had 50 training rows. May 2021: 149 wards where Reform UK stood, since Reform UK had stood in only 2 earlier anchored rows. By-elections: 22 with no anchor and 18 with a standing lane lacking a model, of 452.
- **Contest dates with no anchor:** 8 June and 17 August 2017; 4 January 2018; 10 January and 14 March 2019; 23 and 30 January, 13 and 27 February, 12 and 19 March 2020; 17 and 24 August 2023; 16 and 18 April 2024. No anchor was estimated.
- **The PR 192 extractor gives byte identical output on the 2024 page**, so the 2020 `Brx` gap and the 547 rows stage A lost both remain.

## Question (a): W365c against S1c, scheduled elections

| Year | Wards | S1c leaders | W365c leaders | S1c share error (pp) | W365c share error (pp) |
|---|---|---|---|---|---|
| 2019 | 1,678 | 1,362 | 1,367 | 6.27 | 6.25 |
| 2021 | 2,255 | 1,697 | 1,693 | 6.11 | 6.15 |
| 2022 | 2,533 | 2,139 | 2,121 | 5.81 | 5.81 |
| 2023 | 1,734 | 1,445 | 1,440 | 5.34 | 5.51 |
| Pooled | 8,200 | 6,643 | 6,621 | 5.88 | 5.92 |

| Rule part | Holds |
|---|---|
| Pooled: more leaders than S1c | No |
| Pooled: share error no higher | No |
| More leaders in at least three of four years | No (2019 only) |

The full-input pair tells the same story: W365 6,656, S1 6,705. By-elections lean the other way (W365c 322, S1c 314 of 452), as they did not in stage A.

## Question (b): S1c against B2, and M2 against both

Leaders called, on the rows both forecast.

| Year | S1c against B2 | Holds | M2 against S1c | Holds | M2 against B2 | Holds |
|---|---|---|---|---|---|---|
| 2019 | 1,153 to 1,163 of 1,339 | No | 1,383 to 1,362 of 1,678 | Yes | 1,174 to 1,163 of 1,339 | Yes |
| 2021 | 1,167 to 1,195 of 1,412 | No | 1,715 to 1,697 of 2,106 | Yes | 1,185 to 1,195 of 1,412 | No |
| 2022 | 1,877 to 1,907 of 2,179 | No | 2,166 to 2,139 of 2,533 | Yes | 1,904 to 1,907 of 2,179 | No |
| 2023 | 1,373 to 1,371 of 1,606 | Yes | 1,439 to 1,445 of 1,734 | No | 1,367 to 1,371 of 1,606 | No |
| All four | | Not supported | | Not supported | | Not supported |

M2 adds leaders but costs share error: 5.99 pooled against S1c's 5.88 and B2's 5.81 (B2 on its own wards).

**Benchmark cover.**

| Year | Wards | Previous contest and both anchors | Previous contest, no anchor then | No previous contest |
|---|---|---|---|---|
| 2018 | 2,115 | 42 | 1,408 | 665 |
| 2019 | 1,678 | 1,339 | 53 | 286 |
| 2021 | 2,255 | 1,505 | 633 | 117 |
| 2022 | 2,533 | 2,179 | 86 | 268 |
| 2023 | 1,734 | 1,606 | 2 | 126 |

## Question (c): what the six future inputs are worth

| Year | S1 leaders | S1c leaders | Difference | S1 share error | S1c share error |
|---|---|---|---|---|---|
| 2019 | 1,395 | 1,362 | +33 | 6.10 | 6.27 |
| 2021 | 1,712 | 1,697 | +15 | 5.98 | 6.11 |
| 2022 | 2,146 | 2,139 | +7 | 5.57 | 5.81 |
| 2023 | 1,452 | 1,445 | +7 | 5.24 | 5.34 |
| Pooled scheduled | 6,705 | 6,643 | +62 of 8,051 | 5.71 | 5.88 |
| By-elections, all | 319 | 314 | +5 of 412 | 6.96 | 7.12 |

The gain is largest in 2019, the year furthest from 2024, which is the pattern a look ahead would give.

## Year by year, every arm on every ward

A ward an arm cannot forecast counts as a miss; the number forecast is in brackets where it is not every ward. Share error (pp) is over the wards forecast.

| Set | Wards | S1 | W365 | S1c | W365c | B1 | B2 | M2 |
|---|---|---|---|---|---|---|---|---|
| Scheduled 2018 | 2,115 | 0 | 0 | 0 | 0 | 1,209 (1,450) | 38 (42) | 0 |
| Scheduled 2019 | 1,678 | 1,395 | 1,392 | 1,362 | 1,367 | 1,175 (1,392) | 1,163 (1,339) | 1,383 |
| Scheduled 2021 | 2,255 | 1,712 (2,106) | 1,689 (2,106) | 1,697 (2,106) | 1,693 (2,106) | 1,703 (2,138) | 1,271 (1,505) | 1,715 (2,106) |
| Scheduled 2022 | 2,533 | 2,146 | 2,127 | 2,139 | 2,121 | 1,828 (2,265) | 1,907 (2,179) | 2,166 |
| Scheduled 2023 | 1,734 | 1,452 | 1,448 | 1,445 | 1,440 | 1,342 (1,608) | 1,371 (1,606) | 1,439 |
| By-elections 2018 | 60 | 33 (44) | 35 (44) | 33 (44) | 33 (44) | 43 (54) | 35 (38) | 34 (44) |
| By-elections 2019 | 65 | 49 (60) | 49 (60) | 49 (60) | 49 (60) | 51 (64) | 44 (51) | 49 (60) |
| By-elections 2020 | 12 | 0 | 0 | 0 | 0 | 7 | 0 | 0 |
| By-elections 2021 | 116 | 95 (115) | 96 (115) | 95 (115) | 97 (115) | 94 | 93 (111) | 96 (115) |
| By-elections 2022 | 66 | 53 | 55 | 53 | 54 | 46 | 52 | 52 |
| By-elections 2023 | 83 | 67 (80) | 67 (80) | 67 (80) | 68 (80) | 59 | 65 (80) | 66 (80) |
| By-elections Jan to Apr 2024 | 50 | 22 (47) | 22 (47) | 17 (47) | 21 (47) | 7 (14) | 8 (14) | 17 (47) |

| Set | S1 | W365 | S1c | W365c | B1 | B2 | M2 |
|---|---|---|---|---|---|---|---|
| Share error, scheduled 2019 | 6.10 | 6.06 | 6.27 | 6.25 | 8.09 | 6.67 | 6.83 |
| Share error, scheduled 2021 | 5.98 | 6.01 | 6.11 | 6.15 | 7.76 | 5.98 | 6.15 |
| Share error, scheduled 2022 | 5.57 | 5.64 | 5.81 | 5.81 | 6.43 | 5.14 | 5.46 |
| Share error, scheduled 2023 | 5.24 | 5.38 | 5.34 | 5.51 | 6.23 | 5.80 | 5.74 |
| Share error, by-elections all | 6.96 | 6.84 | 7.12 | 6.93 | 7.98 | 7.26 | 7.60 |

**Conservative calls**, called first against led: 2019 S1c 597 / 523, B1 428, B2 275; 2021 S1c 916 / 1,055, B2 594; 2022 S1c 693 / 624, B1 842; 2023 S1c 480 / 364, B2 389. S1c is nearer the actual count than both benchmarks in 2019 and 2021; B2, on its smaller set of wards, is nearer in 2022 and 2023.

## Stage A against stage B, 2022 and 2023

The training history now reaches back to 2017, so the stage A figures change. B2 changes too, because far more previous contests now have an anchor.

| Year | Arm | Stage A leaders | Stage B leaders | Stage A share error | Stage B share error |
|---|---|---|---|---|---|
| 2022 | S1 | 2,103 | 2,146 | 5.66 | 5.57 |
| 2022 | W365 | 2,117 | 2,127 | 5.68 | 5.64 |
| 2022 | B1 | 1,828 | 1,828 | 6.43 | 6.43 |
| 2022 | B2 | 1,371 (1,568 forecast) | 1,907 (2,179) | 4.85 | 5.14 |
| 2023 | S1 | 1,446 | 1,452 | 5.51 | 5.24 |
| 2023 | W365 | 1,442 | 1,448 | 5.53 | 5.38 |
| 2023 | B1 | 1,342 | 1,342 | 6.23 | 6.23 |
| 2023 | B2 | 1,238 (1,414) | 1,371 (1,606) | 5.26 | 5.80 |

Longer history helps S1 (43 more wards in 2022) and does not help W365 as much, which is what an age weight that discounts the added old rows would do.

## Question (d): how often the called leader is right, by forecast lead

| Year | Arm | Lead under 5 | 5 or more | 10 or more | 15 or more |
|---|---|---|---|---|---|
| 2019 | S1c | 83 of 173 (48.0%) | 1,279 of 1,505 (85.0%) | 1,144 of 1,310 (87.3%) | 1,047 of 1,159 (90.3%) |
| 2019 | M2 | 82 of 169 (48.5%) | 1,301 of 1,509 (86.2%) | 1,205 of 1,360 (88.6%) | 1,088 of 1,202 (90.5%) |
| 2021 | S1c | 115 of 218 (52.8%) | 1,582 of 1,888 (83.8%) | 1,444 of 1,664 (86.8%) | 1,287 of 1,431 (89.9%) |
| 2021 | M2 | 113 of 225 (50.2%) | 1,602 of 1,881 (85.2%) | 1,457 of 1,654 (88.1%) | 1,283 of 1,418 (90.5%) |
| 2022 | S1c | 133 of 251 (53.0%) | 2,006 of 2,282 (87.9%) | 1,798 of 1,982 (90.7%) | 1,580 of 1,707 (92.6%) |
| 2022 | M2 | 149 of 267 (55.8%) | 2,017 of 2,266 (89.0%) | 1,841 of 2,013 (91.5%) | 1,623 of 1,745 (93.0%) |
| 2023 | S1c | 76 of 155 (49.0%) | 1,369 of 1,579 (86.7%) | 1,254 of 1,395 (89.9%) | 1,082 of 1,167 (92.7%) |
| 2023 | M2 | 73 of 166 (44.0%) | 1,366 of 1,568 (87.1%) | 1,246 of 1,384 (90.0%) | 1,093 of 1,188 (92.0%) |
| By-elections, all | S1c | 17 of 37 (45.9%) | 297 of 375 (79.2%) | 271 of 331 (81.9%) | 246 of 288 (85.4%) |
| By-elections, all | M2 | 15 of 35 (42.9%) | 299 of 377 (79.3%) | 277 of 335 (82.7%) | 250 of 291 (85.9%) |

Bands for every arm are in the summary file.

## Question (e): S1c against B1 where B2 does not exist

| Year | Wards with S1c and B1 but no B2 | S1c leaders | B1 leaders |
|---|---|---|---|
| 2019 | 53 | 41 | 40 |
| 2021 | 581 | 456 | 478 |
| 2022 | 86 | 69 | 60 |
| 2023 | 2 | 1 | 1 |
| Pooled | 722 | 567 | 579 |

These are wards whose previous contest predates the anchors (before June 2017), nearly all of them in May 2021.

## Reading

1. **The recency weighting fails again on unseen elections,** now with a longer history to discount. Two stages, two failures; carry it into the May 2027 sealed test only as a named arm, if at all.
2. **The ward model's edge over a plain logit swing from a recent result is nil.** Clean of the future inputs, it loses to B2 in three of four years by 10 to 30 wards and wins in one by 2. Its share error is lower than B2's only in 2019 and 2023, and B2's is measured on its own, smaller set of wards.
3. **Mixing the two adds a few leaders** (21, 18 and 27 wards over S1c in 2019, 2021 and 2022) but not in 2023, and it raises share error. Not a robust gain.
4. **The future inputs cost little** (62 wards of 8,051), so stage A's main reading stands.
5. **The model's real use is coverage:** it forecasts every ward, where B2 exists for about four in five. But where B2 is missing it does no better than B1.
6. **Lead bands are stable across four years** and are the most usable output: 5 points of forecast lead is right about 86% of the time, 15 points about 91%.

## Limits

- **Depends on PR 192, not merged.**
- **Features are fixed in time:** the 2021 Census and the 2019 deprivation index for every year, so the Census is after 2019. S1c removes only the six July 2024 inputs.
- **Settings in `fit_meta.pkl` were selected on contests up to April 2026,** with the six future inputs present, and were not reselected for the clean arms.
- **Anchor gaps:** none before June 2017; none from late 2019 to May 2021 (no 2020 poll carries a Reform UK share in the extract, and no poll is extracted from 12 December 2019 to 25 January 2020); 1,709 rows on the 21 day window, including May 2019. Training therefore jumps from 2019 to 2021.
- **May 2018 cannot be forecast** and the 149 May 2021 Reform UK wards cannot; both count as misses for the model arms.
- **May 2021 included elections postponed from 2020.**
- **The ward model alone,** not the blend with the candidate engine. **England only,** and only contests with a code in the Drive feature file.
