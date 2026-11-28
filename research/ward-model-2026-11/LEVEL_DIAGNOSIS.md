# Party level of the ward model (arm C2): diagnosis

28 November 2026. **Research only**; nothing on the site, the engine or the published forecast reads anything here. Part 1 of the party level study. No model was fitted for it: it reads C2's cached forward only forecasts from the corrected rebuild (the "Both" column of `REBUILD_RESULTS.md`, `cache/rebuild/corrected/bridge_level_predictions.pkl`). Script: `level_diagnose.py`. Every figure below comes from its output, `results/level_diagnosis.json`, unless another file is named.

## The question

C2 calls Reform UK and Labour first in too few May 2026 wards and the Liberal Democrats, Greens and Others in too many, yet at the by-elections after May 2026 it calls Reform UK first too often. Is that shortfall (a) a share level error, (b) a compression of the lead between first and second within wards whose shares are right on average, or (c) a product of renormalising over six lanes? The answer decides what can fix it.

## Answer

1. **Renormalising is not the cause, and cannot be.** Every lane in a ward is divided by the same total, so the order of the lanes is unchanged. Checked: on every set below, the leaders called from the raw, unrenormalised forecasts equal those after renormalising, with no ward differing. Renormalising does move share levels: the raw forecasts sum to 0.95 on average over the six Mays (0.86 in 2025, 0.98 in 2026) and to 0.92 at by-elections (0.90 after May 2026), so dividing by the total lifts every lane, and the largest lanes most in points. That is why Reform UK's share error at the by-elections after May 2026 is minus 1.25 points raw and plus 1.63 after renormalising. It changes share error, never who is first.
2. **A within ward compression of the lead is not the fault either.** Stretching each ward's logits about the ward's own mean by one factor, chosen with the actual results of the set being scored, gains no ward on any set: the best factor is 1.0 everywhere.
3. **For Labour it is a share level error.** At May 2026 Labour's forecasts are low by 2.68 points (minus 0.21 on the logit scale before renormalising) with a calibration slope of 1.02, so the spread is right and the whole distribution sits low. The same holds at the by-elections after May 2026: minus 3.30 points, minus 0.22 logit. Labour won 447 May 2026 wards and was called first in 360; 23 by-elections and was called first in 13.
4. **For Reform UK it is mostly a between ward compression, with a level error in 2025 only.** Over the six Mays, Reform UK's calibration slope (actual share on forecast share, across wards where it stood) is 1.20, and 1.12 and 1.20 in 2025 and 2026 alone: its forecasts are bunched, too low where it is strong and too high where it is weak. In wards it won in May 2026, the forecast lead over the next lane averaged 2.93 points against an actual 14.53. On the logit scale its May 2026 level error is only minus 0.09; in May 2025 it was minus 0.38.
5. **The other half of the first place shortfall is the other lanes' level.** At May 2026 the Liberal Democrats (plus 0.24 logit), Greens (plus 0.17) and Others (plus 0.88) are high. Taking the level out of Others alone would have called 37 more May 2026 leaders; taking it out of Reform UK alone, 42 more.
6. **How much a level could recover, at most.** With every lane's level known exactly from the actual results, C2 would call 91 more leaders at May 2026, 4 more at May 2025, and 134 more summed over the six Mays, of which 2026 is two thirds. At by-elections the same exact level gains 7 of 1,149 forecast contests, and 2 of the 107 after May 2026. Allowing a per lane spread as well as a level adds 22 more at May 2026 and 15 at May 2025. These are ceilings computed with hindsight. A level estimated beforehand will recover less, and on the Mays other than 2026 there is little to recover.
7. **Whether a ward had a previous result does not explain Reform UK's shortfall.** In May 2025, where 1,259 of the 1,393 wards Reform UK stood in had no previous result in the same ward code, its share error is minus 4.14 points with a previous result and minus 4.23 without. In May 2026, minus 2.78 and minus 2.98. The split matters for Others (minus 0.96 with a previous result, minus 6.22 without, over the six Mays) and the Conservatives (plus 0.05 against plus 2.58).
8. **The level is only partly foreshadowed.** A lane's logit level at May T has the same sign as its level at the previous test May in 19 of 28 lane years, and the same sign as C2's own forward by-election residuals since the previous May in 19 of 27 (cells with at least 10 by-elections). In 2026, all six lanes' by-election residuals had the right sign; Labour's was nil (minus 0.00) against a May level of minus 0.21.

**What this decides.** A per lane level can address Labour and the lanes that take wards from Reform UK and Labour (the Liberal Democrats, Greens, Others). It cannot fix Reform UK's own shortfall, which is a spread across wards. Scoring first place from simulated draws would not help, because the fault is not in the lead within wards. And no level should be carried forward from a contest the model has already trained on, as `OOT_CENSUS_REGION_RESULTS.md` showed. Part 2 therefore tests levels estimated from out of fold residuals inside each training window, with and without a per lane spread term. The spread term is not the stretch that `SEATS_RESULTS.md` rejected: that was one factor for every lane, while the diagnosis finds Reform UK's forecasts bunched (slope 1.20) and the other lanes' slightly over spread (0.86 to 0.97). See `LEVEL_SPEC.md`.

**A figure in the brief, corrected.** The brief gave C2 at May 2026 as calling Reform UK first in 883 wards against 1,210 won, Labour 757 against 925, the Liberal Democrats 800 against 690 and the Greens 647 against 532. **Those are seats, not wards**: the M0 seat totals (every seat in a ward to the forecast leader), from `results/level_diagnosis.json`, `seats_m0_c2`, and the seats won in `SEATS_RESULTS.md`. In wards, C2 called Reform UK first in 641 against 858 won, Labour 360 against 447, the Liberal Democrats 532 against 445 and the Greens 379 against 295 (tables below). Seat totals weight each ward by its seats up, so they are not comparable with ward counts.

## Definitions

- **Sets.** The six test Mays, each over the wards C2 forecast (May 2021 has 149 wards no arm forecasts, which are left out here; they count as misses in every leader total elsewhere in this folder). By-elections by half year (H1 January to June, H2 July to December), May 2018 to November 2026, over the 1,149 of 1,190 contests C2 forecasts. "After 7 May 2026" is the 107 scored contests from 11 June to 19 November 2026.
- **Share error.** Forecast minus actual full slate share, in points, mean over the wards where the lane stood.
- **Raw.** Before renormalising: expit(logit anchor plus predicted offset). **Logit error** is the mean of the predicted offset minus the actual offset, on the same scale the model fits. Positive means the forecast is high.
- **Calibration slope.** Least squares slope of actual share on forecast share across the wards where the lane stood. Above 1, the forecasts are more bunched than the outcomes; below 1, more spread.
- **Wards won.** In wards the lane won: its forecast share minus the best other lane's forecast, against the same from the actual result (wards where no other lane had a forecast are left out).
- **Oracles.** Computed with the actual results of the set they are scored on, so they are bounds, not forecasts, and nothing was chosen from them. **Level:** each lane's mean logit error subtracted from its offset, then renormalised. **Level and spread:** a per lane least squares line from forecast logit to actual logit. **Within ward stretch:** each ward's logits stretched about the ward mean by one factor from 0.50 to 2.50, the best factor for the set, ties to 1.

## Share error, and called first against won

Share error in points; in brackets, wards called first / wards won.

| Set | Rows | Leaders | Reform UK | Labour | Con | LD | Green | Others |
|---|---|---|---|---|---|---|---|---|
| may_2019 | 1,678 | 1,375 |  | plus 2.13 (713 / 671) | plus 1.81 (593 / 523) | plus 0.08 (251 / 274) | minus 3.92 (28 / 42) | minus 2.79 (93 / 168) |
| may_2021 | 2,106 | 1,713 |  | plus 3.96 (799 / 662) | minus 3.29 (901 / 982) | minus 0.34 (269 / 275) | plus 1.00 (65 / 69) | minus 2.29 (72 / 118) |
| may_2022 | 2,533 | 2,138 | minus 0.38 (0 / 0) | minus 1.66 (1309 / 1297) | plus 0.55 (720 / 624) | plus 0.10 (366 / 413) | plus 3.19 (67 / 72) | minus 2.86 (71 / 127) |
| may_2023 | 1,734 | 1,442 | plus 2.42 (0 / 0) | minus 0.32 (834 / 831) | plus 2.90 (484 / 364) | minus 0.07 (304 / 349) | minus 1.32 (58 / 90) | minus 4.44 (54 / 100) |
| may_2025 | 1,399 | 703 | minus 4.22 (447 / 551) | minus 0.37 (98 / 77) | plus 2.71 (485 / 278) | plus 3.59 (337 / 340) | plus 2.04 (31 / 71) | minus 7.23 (1 / 82) |
| may_2026 | 2,576 | 1,764 | minus 2.79 (641 / 858) | minus 2.68 (360 / 447) | minus 0.03 (411 / 386) | plus 1.58 (532 / 445) | plus 2.21 (379 / 295) | plus 4.69 (253 / 145) |
| may_pooled_six | 12,026 | 9,135 | minus 2.97 (1088 / 1409) | 0.00 (4113 / 3985) | plus 0.52 (3594 / 3157) | plus 0.79 (2059 / 2096) | plus 0.98 (628 / 639) | minus 1.91 (544 / 740) |
| by_2018H1 | 4 | 2 |  | minus 3.15 (2 / 2) | plus 9.21 (1 / 0) | minus 14.01 (1 / 2) | plus 4.38 (0 / 0) | minus 0.30 (0 / 0) |
| by_2018H2 | 40 | 33 |  | minus 0.13 (20 / 22) | plus 4.26 (15 / 11) | minus 3.80 (4 / 5) | plus 1.12 (0 / 0) | minus 2.79 (1 / 2) |
| by_2019H1 | 22 | 16 |  | plus 5.68 (10 / 8) | minus 2.95 (4 / 4) | plus 0.28 (4 / 6) | minus 0.64 (0 / 0) | minus 3.00 (4 / 4) |
| by_2019H2 | 38 | 34 |  | plus 1.18 (13 / 10) | minus 3.55 (12 / 15) | plus 4.53 (11 / 10) | minus 0.80 (0 / 0) | minus 2.71 (2 / 3) |
| by_2020H1 | 8 | 7 |  | plus 4.87 (2 / 1) | plus 6.07 (6 / 6) | minus 2.91 (0 / 0) | plus 1.70 (0 / 0) | minus 12.06 (0 / 1) |
| by_2021H1 | 70 | 63 |  | plus 3.15 (29 / 27) | minus 2.54 (30 / 33) | minus 0.88 (8 / 8) | plus 1.15 (0 / 1) | minus 1.36 (3 / 1) |
| by_2021H2 | 45 | 35 | plus 1.41 (0 / 0) | plus 4.47 (18 / 14) | plus 0.94 (19 / 17) | minus 2.86 (7 / 9) | minus 2.35 (0 / 1) | minus 3.55 (1 / 4) |
| by_2022H1 | 20 | 17 | minus 0.06 (0 / 0) | plus 2.80 (5 / 5) | plus 2.46 (10 / 8) | minus 5.50 (5 / 6) | plus 1.02 (0 / 1) | minus 2.84 (0 / 0) |
| by_2022H2 | 46 | 34 | plus 2.65 (0 / 0) | plus 4.35 (27 / 26) | minus 0.68 (11 / 9) | minus 1.65 (5 / 7) | minus 0.50 (2 / 1) | minus 3.84 (1 / 3) |
| by_2023H1 | 31 | 27 | plus 4.04 (0 / 0) | plus 4.05 (16 / 17) | minus 0.48 (9 / 7) | minus 3.34 (4 / 5) | plus 1.24 (2 / 2) | minus 2.89 (0 / 0) |
| by_2023H2 | 52 | 43 | minus 0.26 (0 / 0) | plus 6.05 (24 / 20) | minus 0.52 (7 / 5) | minus 3.37 (14 / 17) | minus 0.35 (2 / 4) | minus 3.18 (5 / 6) |
| by_2024H1 | 113 | 62 | plus 2.95 (0 / 0) | plus 4.87 (54 / 37) | minus 2.28 (36 / 30) | minus 0.12 (16 / 29) | plus 1.27 (2 / 5) | minus 6.93 (5 / 12) |
| by_2024H2 | 168 | 106 | minus 2.42 (0 / 8) | plus 2.36 (81 / 67) | minus 2.21 (37 / 48) | plus 2.56 (34 / 27) | minus 0.23 (5 / 9) | minus 2.64 (11 / 9) |
| by_2025H1 | 184 | 117 | minus 4.30 (31 / 48) | plus 1.17 (38 / 23) | plus 1.56 (38 / 25) | plus 0.22 (55 / 61) | plus 2.04 (10 / 13) | minus 1.48 (12 / 14) |
| by_2025H2 | 140 | 92 | plus 0.87 (64 / 49) | plus 0.07 (6 / 9) | plus 1.36 (17 / 17) | minus 1.96 (28 / 40) | plus 0.28 (11 / 10) | minus 1.51 (14 / 15) |
| by_2026H1 | 81 | 45 | minus 0.17 (28 / 22) | minus 1.72 (3 / 5) | minus 0.28 (9 / 19) | plus 1.61 (20 / 16) | plus 0.40 (14 / 15) | plus 0.26 (7 / 4) |
| by_2026H2 | 87 | 53 | plus 1.34 (24 / 18) | minus 2.69 (12 / 21) | plus 1.50 (25 / 20) | minus 2.95 (13 / 17) | plus 2.31 (11 / 8) | plus 0.20 (2 / 3) |
| by_after_2026-05-07 | 107 | 68 | plus 1.63 (30 / 22) | minus 3.30 (13 / 23) | plus 1.23 (28 / 25) | minus 1.75 (17 / 19) | plus 1.95 (17 / 15) | minus 0.14 (2 / 3) |
| by_all | 1,149 | 786 | minus 1.00 (147 / 145) | plus 1.86 (360 / 314) | minus 0.10 (286 / 274) | minus 0.49 (229 / 265) | plus 0.73 (59 / 70) | minus 2.51 (68 / 81) |

Reform UK first stood widely in 2025; it stood in under a fifth of wards in earlier years and was called first nowhere. Before 2024 the half year by-election sets are small (4 to 70 contests).

## By whether the ward had a previous result

"Prev" is a ward with a previous result under the same ward code; "none" is one without.

| Set | Lane | Stood, prev / none | Won, prev / none | Called first, prev / none | Share error, prev / none |
|---|---|---|---|---|---|
| may_2025 | Reform UK | 134 / 1,259 | 26 / 525 | 5 / 442 | minus 4.14 / minus 4.23 |
| may_2025 | Labour | 133 / 1,185 | 8 / 69 | 15 / 83 | minus 2.01 / minus 0.19 |
| may_2025 | Con | 134 / 1,261 | 27 / 251 | 33 / 452 | minus 1.42 / plus 3.15 |
| may_2025 | LD | 133 / 1,140 | 59 / 281 | 68 / 269 | plus 5.78 / plus 3.33 |
| may_2025 | Green | 128 / 974 | 12 / 59 | 12 / 19 | plus 2.65 / plus 1.96 |
| may_2025 | Others | 56 / 528 | 2 / 80 | 1 / 0 | minus 1.69 / minus 7.82 |
| may_2026 | Reform UK | 2,434 / 135 | 792 / 66 | 573 / 68 | minus 2.78 / minus 2.98 |
| may_2026 | Labour | 2,347 / 122 | 441 / 6 | 359 / 1 | minus 2.74 / minus 1.47 |
| may_2026 | Con | 2,372 / 136 | 363 / 23 | 374 / 37 | minus 0.12 / plus 1.52 |
| may_2026 | LD | 2,093 / 107 | 414 / 31 | 510 / 22 | plus 1.72 / minus 1.18 |
| may_2026 | Green | 2,345 / 126 | 289 / 6 | 372 / 7 | plus 2.13 / plus 3.62 |
| may_2026 | Others | 1,010 / 39 | 141 / 4 | 252 / 1 | plus 4.83 / plus 1.17 |
| may_pooled_six | Reform UK | 2,830 / 1,419 | 818 / 591 | 578 / 510 | minus 2.46 / minus 4.00 |
| may_pooled_six | Labour | 9,554 / 2,003 | 3659 / 326 | 3725 / 388 | minus 0.10 / plus 0.45 |
| may_pooled_six | Con | 9,678 / 2,178 | 2579 / 578 | 2692 / 902 | plus 0.05 / plus 2.58 |
| may_pooled_six | LD | 7,793 / 1,862 | 1647 / 449 | 1719 / 340 | plus 0.62 / plus 1.52 |
| may_pooled_six | Green | 7,274 / 1,538 | 557 / 82 | 602 / 26 | plus 0.90 / plus 1.33 |
| may_pooled_six | Others | 4,180 / 920 | 572 / 168 | 516 / 28 | minus 0.96 / minus 6.22 |
| by_after_2026-05-07 | Reform UK | 63 / 44 | 10 / 12 | 14 / 16 | plus 1.81 / plus 1.36 |
| by_after_2026-05-07 | Labour | 58 / 40 | 19 / 4 | 11 / 2 | minus 4.34 / minus 1.79 |
| by_after_2026-05-07 | Con | 63 / 44 | 9 / 16 | 9 / 19 | plus 0.79 / plus 1.85 |
| by_after_2026-05-07 | LD | 53 / 33 | 11 / 8 | 11 / 6 | minus 0.94 / minus 3.05 |
| by_after_2026-05-07 | Green | 56 / 34 | 12 / 3 | 16 / 1 | plus 2.86 / plus 0.44 |
| by_after_2026-05-07 | Others | 32 / 16 | 2 / 1 | 2 / 0 | minus 0.70 / plus 0.99 |
| by_all | Reform UK | 297 / 247 | 64 / 81 | 55 / 92 | minus 1.35 / minus 0.57 |
| by_all | Labour | 725 / 338 | 254 / 60 | 283 / 77 | plus 2.13 / plus 1.29 |
| by_all | Con | 754 / 366 | 186 / 88 | 176 / 110 | minus 0.60 / plus 0.95 |
| by_all | LD | 670 / 318 | 168 / 97 | 167 / 62 | minus 0.11 / minus 1.28 |
| by_all | Green | 586 / 275 | 45 / 25 | 50 / 9 | plus 0.80 / plus 0.56 |
| by_all | Others | 395 / 192 | 47 / 34 | 33 / 35 | minus 2.75 / minus 2.03 |

## Level, spread and lead

| Set | Lane | Raw share error | Renormalised share error | Raw logit error | Calibration slope | SD forecast / actual | Wards won: forecast lead / actual lead |
|---|---|---|---|---|---|---|---|
| may_2025 | Reform UK | minus 8.14 | minus 4.22 | minus 0.38 | 1.116 | 7.01 / 11.26 | 0.53 / 13.42 |
| may_2025 | Labour | minus 2.82 | minus 0.37 | minus 0.17 | 0.695 | 9.79 / 10.66 | minus 8.82 / 9.28 |
| may_2025 | Con | minus 0.81 | plus 2.71 | plus 0.05 | 0.795 | 9.32 / 12.39 | 2.95 / 11.61 |
| may_2025 | LD | plus 1.08 | plus 3.59 | plus 0.36 | 0.856 | 11.25 / 16.99 | 3.2 / 17.1 |
| may_2025 | Green | plus 0.46 | plus 2.04 | plus 0.29 | 1.001 | 5.21 / 10.38 | minus 9.44 / 17.5 |
| may_2025 | Others | minus 8.50 | minus 7.23 | minus 0.33 | 1.561 | 3.91 / 15.88 | minus 23.63 / 19.88 |
| may_2026 | Reform UK | minus 3.08 | minus 2.79 | minus 0.09 | 1.195 | 10.27 / 14.02 | 2.93 / 14.53 |
| may_2026 | Labour | minus 3.59 | minus 2.68 | minus 0.21 | 1.016 | 11.03 / 13.06 | minus 0.7 / 10.09 |
| may_2026 | Con | minus 0.87 | minus 0.03 | plus 0.04 | 1.057 | 11.34 / 13.77 | 7.65 / 17.28 |
| may_2026 | LD | plus 1.32 | plus 1.58 | plus 0.24 | 0.976 | 14.86 / 15.82 | 16.29 / 17.23 |
| may_2026 | Green | plus 2.14 | plus 2.21 | plus 0.17 | 0.779 | 13.09 / 12.62 | 16.8 / 15.68 |
| may_2026 | Others | plus 5.70 | plus 4.69 | plus 0.88 | 0.717 | 16.8 / 15.37 | 20.7 / 17.17 |
| may_pooled_six | Reform UK | minus 4.43 | minus 2.97 | minus 0.15 | 1.197 | 10.19 / 14.11 | 1.99 / 14.1 |
| may_pooled_six | Labour | minus 1.49 | 0.00 | minus 0.07 | 0.935 | 20.17 / 20.48 | 24.27 / 26.64 |
| may_pooled_six | Con | minus 1.27 | plus 0.52 | minus 0.03 | 0.921 | 16.69 / 17.43 | 17.13 / 21.6 |
| may_pooled_six | LD | minus 0.14 | plus 0.79 | plus 0.11 | 0.97 | 16.15 / 18.11 | 12.41 / 20.05 |
| may_pooled_six | Green | plus 0.67 | plus 0.98 | plus 0.11 | 0.858 | 11.21 / 12.05 | 8.57 / 17.22 |
| may_pooled_six | Others | minus 2.79 | minus 1.91 | plus 0.03 | 0.881 | 14.67 / 17.56 | 0.1 / 21.29 |
| by_after_2026-05-07 | Reform UK | minus 1.25 | plus 1.63 | minus 0.00 | 0.924 | 11.79 / 12.92 | 7.34 / 8.71 |
| by_after_2026-05-07 | Labour | minus 5.26 | minus 3.30 | minus 0.22 | 1.165 | 12.25 / 15.96 | 0.25 / 9.95 |
| by_after_2026-05-07 | Con | minus 1.18 | plus 1.23 | plus 0.10 | 1.001 | 12.66 / 15.6 | 4.22 / 12.73 |
| by_after_2026-05-07 | LD | minus 3.50 | minus 1.75 | plus 0.17 | 1.167 | 13.11 / 19.81 | 3.96 / 25.36 |
| by_after_2026-05-07 | Green | plus 0.61 | plus 1.95 | plus 0.26 | 0.965 | 13.38 / 14.86 | 8.21 / 7.49 |
| by_after_2026-05-07 | Others | minus 1.10 | minus 0.14 | plus 0.12 | 0.788 | 8.0 / 11.16 | minus 5.03 / 17.0 |
| by_all | Reform UK | minus 3.20 | minus 1.00 | minus 0.12 | 0.938 | 11.05 / 13.27 | 3.85 / 12.86 |
| by_all | Labour | minus 0.40 | plus 1.86 | plus 0.04 | 0.858 | 19.37 / 18.62 | 23.06 / 21.14 |
| by_all | Con | minus 2.19 | minus 0.10 | minus 0.05 | 0.891 | 15.2 / 16.7 | 8.6 / 17.75 |
| by_all | LD | minus 1.76 | minus 0.49 | plus 0.07 | 0.884 | 16.48 / 19.18 | 9.17 / 20.19 |
| by_all | Green | minus 0.16 | plus 0.73 | plus 0.13 | 0.878 | 10.36 / 12.41 | 2.51 / 15.26 |
| by_all | Others | minus 3.83 | minus 2.51 | minus 0.11 | 0.897 | 14.54 / 17.85 | 0.63 / 24.51 |

Reading the table: Labour at May 2026 and at the later by-elections has a slope near or above 1 and a negative logit error, which is a level. Reform UK at May 2026 has a near nil logit error, a slope of 1.20, a forecast standard deviation of 10.3 points against an actual 14.0, and a forecast lead of 2.9 points where it won against an actual 14.5, which is a spread across wards. Others at May 2026 has a logit error of plus 0.88 and a slope of 0.72: a level and over spread.

## Renormalising and the oracles

| Set | C2 leaders | Raw (before renormalising) | Rows where they differ | Mean raw total | Oracle level | Oracle level and spread | Oracle within ward stretch (factor) |
|---|---|---|---|---|---|---|---|
| may_2019 | 1,375 | 1,375 | 0 | 0.8324 | 1,380 | 1,380 | 1,375 (1.0) |
| may_2021 | 1,713 | 1,713 | 0 | 0.9622 | 1,730 | 1,726 | 1,713 (1.0) |
| may_2022 | 2,138 | 2,138 | 0 | 1.0281 | 2,140 | 2,144 | 2,138 (1.0) |
| may_2023 | 1,442 | 1,442 | 0 | 0.9553 | 1,457 | 1,456 | 1,442 (1.0) |
| may_2025 | 703 | 703 | 0 | 0.8624 | 707 | 722 | 703 (1.0) |
| may_2026 | 1,764 | 1,764 | 0 | 0.9814 | 1,855 | 1,877 | 1,764 (1.0) |
| may_pooled_six | 9,135 | 9,135 | 0 | 0.9495 | 9,205 | 9,244 | 9,135 (1.0) |
| by_2018H1 | 2 | 2 | 0 | 1.0234 | 2 | 2 | 2 (1.0) |
| by_2018H2 | 33 | 33 | 0 | 0.9577 | 33 | 33 | 33 (1.0) |
| by_2019H1 | 16 | 16 | 0 | 0.9078 | 17 | 17 | 16 (1.0) |
| by_2019H2 | 34 | 34 | 0 | 0.9794 | 33 | 33 | 34 (1.0) |
| by_2020H1 | 7 | 7 | 0 | 0.996 | 7 | 7 | 7 (1.0) |
| by_2021H1 | 63 | 63 | 0 | 0.9959 | 62 | 64 | 63 (1.0) |
| by_2021H2 | 35 | 35 | 0 | 0.9763 | 35 | 35 | 35 (1.0) |
| by_2022H1 | 17 | 17 | 0 | 0.9632 | 17 | 17 | 17 (1.0) |
| by_2022H2 | 34 | 34 | 0 | 0.9336 | 33 | 33 | 34 (1.0) |
| by_2023H1 | 27 | 27 | 0 | 0.9538 | 28 | 28 | 27 (1.0) |
| by_2023H2 | 43 | 43 | 0 | 0.942 | 42 | 43 | 43 (1.0) |
| by_2024H1 | 62 | 62 | 0 | 0.8526 | 66 | 65 | 62 (1.0) |
| by_2024H2 | 106 | 106 | 0 | 0.9061 | 106 | 112 | 106 (1.0) |
| by_2025H1 | 117 | 117 | 0 | 0.9105 | 119 | 120 | 117 (1.0) |
| by_2025H2 | 92 | 92 | 0 | 0.9233 | 91 | 89 | 92 (1.0) |
| by_2026H1 | 45 | 45 | 0 | 0.9489 | 48 | 49 | 45 (1.0) |
| by_2026H2 | 53 | 53 | 0 | 0.8892 | 57 | 57 | 53 (1.0) |
| by_after_2026-05-07 | 68 | 68 | 0 | 0.8995 | 70 | 66 | 68 (1.0) |
| by_all | 786 | 786 | 0 | 0.9239 | 793 | 789 | 786 (1.0) |

## Which lanes a level moves

| Set | Reform UK | Labour | Con | LD | Green | Others |
|---|---|---|---|---|---|---|
| may_2025, called first with all lanes levelled | 925 | 44 | 282 | 128 | 17 | 3 |
| may_2025, leaders with only this lane levelled (C2 703) | 752 | 661 | 703 | 676 | 702 | 703 |
| may_2026, called first with all lanes levelled | 779 | 514 | 368 | 449 | 332 | 134 |
| may_2026, leaders with only this lane levelled (C2 1,764) | 1,806 | 1,758 | 1,768 | 1,779 | 1,775 | 1,801 |
| by_after_2026-05-07, called first with all lanes levelled | 37 | 24 | 23 | 12 | 10 | 1 |
| by_after_2026-05-07, leaders with only this lane levelled (C2 68) | 67 | 70 | 67 | 67 | 69 | 68 |

At May 2025, levelling every lane at once gains only 4 wards: it takes Reform UK from 447 called first to 925, against 551 won, overshooting. Levelling Reform UK alone gains 49. The level helps only where the spread is right.

## Is the level foreshadowed?

Each cell: C2's logit level at that May; its level at the previous test May; its mean forward by-election residual between the previous first Thursday of May and the test day, with the number of by-elections. Positive is high.

| May | Reform UK | Labour | Con | LD | Green | Others |
|---|---|---|---|---|---|---|
| 2019 | 0.00; prev May none; by-el. none (0) | minus 0.18; prev May none; by-el. plus 0.07 (56) | minus 0.20; prev May none; by-el. plus 0.11 (57) | minus 0.21; prev May none; by-el. minus 0.20 (45) | minus 0.58; prev May none; by-el. plus 0.25 (31) | minus 0.30; prev May none; by-el. minus 0.11 (36) |
| 2021 | 0.00; prev May 0.00; by-el. none (0) | plus 0.19; prev May minus 0.18; by-el. none (0) | minus 0.24; prev May minus 0.20; by-el. none (0) | minus 0.03; prev May minus 0.21; by-el. none (0) | plus 0.14; prev May minus 0.58; by-el. none (0) | minus 0.04; prev May minus 0.30; by-el. none (0) |
| 2022 | plus 0.17; prev May 0.00; by-el. plus 0.37 (3) | plus 0.00; prev May plus 0.19; by-el. plus 0.28 (57) | plus 0.07; prev May minus 0.24; by-el. plus 0.05 (61) | plus 0.20; prev May minus 0.03; by-el. minus 0.07 (52) | plus 0.45; prev May plus 0.14; by-el. plus 0.06 (37) | minus 0.06; prev May minus 0.04; by-el. minus 0.04 (28) |
| 2023 | plus 0.48; prev May plus 0.17; by-el. plus 0.61 (5) | minus 0.06; prev May plus 0.00; by-el. plus 0.10 (65) | plus 0.11; prev May plus 0.07; by-el. minus 0.17 (64) | plus 0.02; prev May plus 0.20; by-el. plus 0.02 (52) | minus 0.10; prev May plus 0.45; by-el. plus 0.16 (42) | minus 0.32; prev May minus 0.06; by-el. minus 0.34 (40) |
| 2025 | minus 0.38; prev May plus 0.48; by-el. minus 0.12 (106) | minus 0.17; prev May minus 0.06; by-el. minus 0.01 (218) | plus 0.05; prev May plus 0.11; by-el. minus 0.16 (228) | plus 0.36; prev May plus 0.02; by-el. plus 0.15 (211) | plus 0.29; prev May minus 0.10; by-el. plus 0.13 (183) | minus 0.33; prev May minus 0.32; by-el. minus 0.21 (123) |
| 2026 | minus 0.09; prev May minus 0.38; by-el. minus 0.11 (213) | minus 0.21; prev May minus 0.17; by-el. minus 0.00 (193) | plus 0.04; prev May plus 0.05; by-el. plus 0.10 (213) | plus 0.24; prev May plus 0.36; by-el. plus 0.15 (191) | plus 0.17; prev May plus 0.29; by-el. plus 0.07 (172) | plus 0.88; prev May minus 0.33; by-el. plus 0.23 (116) |

Same sign as the previous test May in 19 of 28 lane years, opposite in 9; same sign as the by-election window in 19 of 27 (cells with at least 10 by-elections), opposite in 8. Most of the agreement is in 2025 and 2026. C3 of `BRIDGE_LEVEL_SPEC.md` already tested a shrunk version of the by-election window, which is listed as fragile and is not repeated here.

## Limits

- **May 2026 has been scored many times** and the diagnosis leans on it. Nothing here is a test.
- The oracles are measured on the set they correct. Their gains are ceilings.
- C2's forecasts for each May come from a fit that has already seen the previous May, so "the level at the previous May" is the level of a different model. That is why carrying it forward double counts, and why part 2 uses out of fold residuals instead.
- The calibration slope is sensitive to the many wards where a lane is small; it is a summary of spread, not a test.
