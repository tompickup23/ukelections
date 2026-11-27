# Ward model back-test on 2021 to 2023, stage A: results

27 November 2026. **Research only.** Specification: `BACKTEST_SPEC.md`, committed before any forecast was produced (commit `db22e1d`). One run of the fit and one of the scorer. Every figure below is from `results/backtest_summary.json`, written by `backtest_score.py`; counts are wards (scheduled) or contests (by-elections) whose leader was called correctly.

## Answer

1. **(a) W365 is not supported.** On the scheduled elections it called 10 more leaders than S1 (3,559 against 3,549), but its share error was 0.01 points higher (5.61 against 5.60) and it called more leaders in only one of the two years that could be forecast (2022: +14; 2023: minus 4). It fails two of the three parts of the rule.
2. **(b) Both arms beat "same party as last time" in both years, and neither beats "last time moved by the national change" in either.** Against the swing benchmark the model is 31 and 21 wards short in 2022 and 2 and 1 short in 2023, on the wards where the benchmark exists.
3. **(c) A called leader is right about 87% of the time once the forecast lead is 5 points or more, and about 92% at 15 points or more,** in both years and for both arms. Under 5 points it is close to a coin toss (49% to 59%).
4. **May 2021 cannot be forecast.** No contest before it has a national anchor, so the model has no training row. The 2022 forecast learns from one year of results; the 2023 forecast from two.

## The run

- **Fit:** 39 fits (two scheduled election days, 37 by-election months), 185 lane jobs, both arms in each job, eight jobs at a time: 181 seconds of fitting, 3 minutes 6 seconds end to end on this Mac.
- **Fault fixed before any score was seen.** The first fit run stopped with an error before writing anything: sklearn's binning fails on an input with no non-missing value, which `prev_rel_ref` is in the 2021 training rows (Reform UK had stood in none of the earlier contests). The fit now fills such a column with 0 in the training rows only. A single-value column gets no split thresholds, so the forecasts are what they would have been. One further run followed; no score was read before it.
- **Anchors:** 2,015 rows dated in 2024 before 4 July had the July 2024 general election result as anchor; all were replaced with the poll anchor, and 4 are left blank (too few polls on 11, 16 and 18 April 2024). 21 test contests have no anchor (12 in 2020, 5 in August 2023, 4 in April 2024) and are counted as misses for the model arms.

## Question (a): W365 against S1, scheduled elections

| Set | Wards | S1 leaders | W365 leaders | S1 share error (pp) | W365 share error (pp) |
|---|---|---|---|---|---|
| 6 May 2021 | 2,255 | none forecast | none forecast | | |
| 5 May 2022 | 2,533 | 2,103 (83.0%) | 2,117 (83.6%) | 5.66 | 5.68 |
| 4 May 2023 | 1,734 | 1,446 (83.4%) | 1,442 (83.2%) | 5.51 | 5.53 |
| Pooled, 2021 to 2023 | 6,522 | 3,549 | 3,559 | 5.60 | 5.61 |

| Rule part | Holds |
|---|---|
| Pooled: more leaders than S1 | Yes (3,559 against 3,549) |
| Pooled: share error no higher | No (5.61 against 5.60) |
| More leaders in both forecastable years | No (2022 yes, 2023 no) |

By-elections, beside the rule: both arms called 180 of 327 (239 forecast); share error 7.69 for S1 and 7.62 for W365.

## Question (b): each arm against both benchmarks, on the wards both forecast

| Year | Arm | Against B1, same party as last time | Holds | Against B2, last time moved by the national change | Holds |
|---|---|---|---|---|---|
| 2022 | S1 | 1,928 to 1,828 of 2,265 | Yes | 1,340 to 1,371 of 1,568 | No |
| 2022 | W365 | 1,941 to 1,828 of 2,265 | Yes | 1,350 to 1,371 of 1,568 | No |
| 2023 | S1 | 1,374 to 1,342 of 1,608 | Yes | 1,236 to 1,238 of 1,414 | No |
| 2023 | W365 | 1,373 to 1,342 of 1,608 | Yes | 1,237 to 1,238 of 1,414 | No |

**Benchmark cover.** B2 needs an anchor at the previous contest, so it exists only where that contest was in May 2021 or later.

| Set | Wards | Previous contest and both anchors | Previous contest, no anchor then | No previous contest |
|---|---|---|---|---|
| 6 May 2021 | 2,255 | 0 | 2,138 | 117 |
| 5 May 2022 | 2,533 | 1,568 | 697 | 268 |
| 4 May 2023 | 1,734 | 1,414 | 194 | 126 |
| By-elections, 2020 to April 2024 | 327 | 178 | 108 | 36 (and 5 with no anchor now) |

B1 called 1,703 of the 2,138 May 2021 wards with a previous contest; it is the only arm there.

## Year by year, every arm on every ward

A ward an arm cannot forecast counts as a miss. Share error is over the wards the arm forecasts.

| Set | Wards | S1 | W365 | B1 | B2 | Share error S1 / W365 / B1 / B2 (pp) |
|---|---|---|---|---|---|---|
| Scheduled 2021 | 2,255 | 0 | 0 | 1,703 (2,138 forecast) | 0 | none / none / 7.76 / none |
| Scheduled 2022 | 2,533 | 2,103 | 2,117 | 1,828 (2,265) | 1,371 (1,568) | 5.66 / 5.68 / 6.43 / 4.85 |
| Scheduled 2023 | 1,734 | 1,446 | 1,442 | 1,342 (1,608) | 1,238 (1,414) | 5.51 / 5.53 / 6.23 / 5.26 |
| By-elections 2020 | 12 | 0 | 0 | 7 (12) | 0 | none / none / 10.50 / none |
| By-elections 2021 | 116 | 41 (49) | 41 (49) | 94 (116) | 23 (28) | 7.49 / 7.42 / 7.97 / 7.08 |
| By-elections 2022 | 66 | 52 | 53 | 46 | 47 (58) | 7.09 / 7.02 / 8.74 / 7.75 |
| By-elections 2023 | 83 | 64 (78) | 65 (78) | 59 | 63 (78) | 6.29 / 6.16 / 8.16 / 7.71 |
| By-elections Jan to Apr 2024 | 50 | 23 (46) | 21 (46) | 7 (14) | 8 (14) | 11.30 / 11.40 / 7.80 / 7.90 |

- **B2 has the lowest share error on scheduled wards** (4.85 and 5.26), on its own subset of wards whose previous contest was recent.
- **B1 over-calls the Conservatives** by 218 wards in 2022 (842 called, 624 led) and 110 in 2023; S1 over-calls them by 28 and 107.
- **By-elections from January to April 2024 are poor for every arm:** only 14 of 50 have a previous contest under the same ward code, and the model's Others lane is 15.0 points low (S1). The reason for the missing previous contests has not been checked.

## Question (c): how often the called leader is right, by forecast lead

Rows with a lead in the band, and the share where the called leader won. Each arm's bands are over the wards that arm forecasts, so B2's are a different, smaller set.

**5 May 2022**

| Arm | Lead under 5 | 5 or more | 10 or more | 15 or more |
|---|---|---|---|---|
| S1 | 136 of 279 (48.7%) | 1,967 of 2,254 (87.3%) | 1,794 of 2,001 (89.7%) | 1,611 of 1,756 (91.7%) |
| W365 | 165 of 282 (58.5%) | 1,952 of 2,251 (86.7%) | 1,786 of 1,993 (89.6%) | 1,618 of 1,760 (91.9%) |
| B1 | 135 of 275 (49.1%) | 1,693 of 1,990 (85.1%) | 1,529 of 1,721 (88.8%) | 1,354 of 1,479 (91.5%) |
| B2 | 100 of 170 (58.8%) | 1,271 of 1,398 (90.9%) | 1,150 of 1,228 (93.6%) | 1,014 of 1,065 (95.2%) |

**4 May 2023**

| Arm | Lead under 5 | 5 or more | 10 or more | 15 or more |
|---|---|---|---|---|
| S1 | 92 of 175 (52.6%) | 1,354 of 1,559 (86.9%) | 1,235 of 1,387 (89.0%) | 1,112 of 1,211 (91.8%) |
| W365 | 93 of 175 (53.1%) | 1,349 of 1,559 (86.5%) | 1,245 of 1,388 (89.7%) | 1,105 of 1,204 (91.8%) |
| B1 | 111 of 184 (60.3%) | 1,231 of 1,424 (86.4%) | 1,112 of 1,236 (90.0%) | 978 of 1,070 (91.4%) |
| B2 | 86 of 151 (57.0%) | 1,152 of 1,263 (91.2%) | 1,047 of 1,116 (93.8%) | 928 of 973 (95.4%) |

**By-elections, all forecast, 2021 to April 2024**

| Arm | Lead under 5 | 5 or more | 10 or more | 15 or more |
|---|---|---|---|---|
| S1 | 10 of 23 (43.5%) | 170 of 216 (78.7%) | 153 of 189 (81.0%) | 132 of 163 (81.0%) |
| W365 | 11 of 26 (42.3%) | 169 of 213 (79.3%) | 152 of 185 (82.2%) | 133 of 160 (83.1%) |
| B1 | 10 of 28 (35.7%) | 203 of 263 (77.2%) | 188 of 232 (81.0%) | 163 of 200 (81.5%) |
| B2 | 8 of 15 (53.3%) | 133 of 163 (81.6%) | 124 of 147 (84.4%) | 111 of 126 (88.1%) |

Per year by-election bands are in the summary file.

## Reading

1. **The recency weighting adds nothing measurable on elections it has not seen.** Plus 14 and minus 4 wards on about 4,300 is noise. This is consistent with the 27 November reading that the May 2026 gain was a fit to one election; it is not evidence against carrying W365 into the May 2027 sealed test, because with at most two years of training here an age weight has little to discount.
2. **The model beats the naive "same party" call clearly** (by 100 and 32 wards on common wards), mainly by not over-calling the Conservatives as they fell from 2021 to 2023.
3. **It does not beat a uniform swing on the logit scale from a recent previous result.** Where the ward voted in the previous one or two years, last time plus the national change is as good or better on leaders and better on share error. The model's advantage, if any, is in the wards with an old or missing previous result, where B2 cannot be computed.
4. **The lead bands are the most useful output for the site.** On these years a 5 point forecast lead is right about 87% of the time and a 15 point lead about 92%, for either arm.

## Limits

- **Look ahead in the inputs.** Every year uses the 2021 Census and the 2019 deprivation index, and six inputs (`ge24_reform`, `ge24_labour`, `ge24_con`, `nb_ge24_reform`, `mrp_reform`, `mrp_labour`) are July 2024 general election results and later MRP estimates. For 2021 to 2023 these are from the future. This flatters both arms against the benchmarks, so finding (3) stands with more force.
- **Settings in `fit_meta.pkl` were selected on contests up to April 2026,** with knowledge of later elections.
- **May 2021 included elections postponed from 2020,** and here cannot be forecast at all. Training rows from 2016 to 2020 have no anchor and are unused, so 2022 learns from one year and 2023 from two.
- **The polling extract keeps 996 of 1,543 national rows** (a table format issue in the extractor; dropped rows are not misread) and reads no Reform UK share for 2020 (the column is headed `Brx`). The anchor windows are thinner than they need be.
- **B2 exists only where the previous contest was in May 2021 or later,** so it is compared on a different and more recent set of wards than the model's full figures.
- **This is the ward model alone,** not the blend with the candidate engine. **England only,** and only contests with a code in the Drive feature file.
