# National seat totals from ward forecasts: results

One run of `seats_score.py` on 27 November 2026, after the specification commit (`06d261c`, `SEATS_SPEC.md`). Output `results/seats_summary.json`. Research only; nothing on the site reads it.

All scores below are RMSE five: the root mean square error, in seats, of national seat totals over Reform UK, Labour, Conservative, Liberal Democrats and Green Party, counted over the scored set of wards (`SEATS_SPEC.md`, step 1), against seats won (Democracy Club elected flags for 2019 to 2025; the merged May 2026 results file for 2026). Lower is better.

## Answer

- **Under C0, M3 is supported**: expected seats with the spread step and a shrunk per lane seat ratio. Its mean over six elections is 105.7, against 120.9 for M0 (leader takes every seat) and 122.0 for M1 (expected seats). It beats M1 in four of six elections (2019, 2022, 2025, 2026).
- **Under C2, no method is supported.** M3 beats M1 in five of six elections (mean 102.5 against 109.0), but not M0 (98.9). M0 on C2 has the lowest six election mean of anything tested.
- **The spread correction (M2) does nothing useful.** The fitted stretch factor is 0.95 to 1.10 in every fold: the win chances were already about right in the pooled training data. The idea that forecasts are too bunched across wards is not supported as a spread problem. The error is in level.
- **The top down method (M4) is poor** (mean 190.2 over its five years) and averaging it in (M5) makes things worse than M3 under both arms.
- **What drives the remaining error is Reform UK's level in 2025 and 2026.** Even after M3, Reform UK is short by 308 and 371 seats under C0, and by 193 and 261 under C2. In May 2026 the Green Party is over by 252 (C0) or 281 (C2) seats. From 2022 to 2025 the Conservatives are over by 110 to 191 seats after M3, in both arms.
- **May 2026, RMSE five:**

| Arm | M0 | M1 | M2 | M3 | M4 | M5 |
|---|---|---|---|---|---|---|
| C0 | 232.9 | 271.1 | 273.9 | **203.2** | 419.8 | 277.5 |
| C2 | **175.2** | 225.4 | 225.4 | 205.3 | 419.8 | 229.4 |

## (a) Score per election and mean

RMSE five. M4 and M5 have no 2025 score (dropped in advance: 8% of seats had a previous contest), so their means are over five elections and are compared with M0 and M1 over the same five.

**C0**

| Method | 2019 | 2021 | 2022 | 2023 | 2025 | 2026 | Mean | Mean RMSE six | Lower than M1 in | Supported |
|---|---|---|---|---|---|---|---|---|---|---|
| M0 | 50.4 | 79.2 | 68.3 | 88.0 | 206.5 | 232.9 | 120.9 | 115.3 | | benchmark |
| M1 | 38.0 | 75.9 | 70.3 | 86.2 | 190.5 | 271.1 | 122.0 | 113.4 | | benchmark |
| M2 | 38.0 | 75.9 | 67.6 | 88.6 | 193.0 | 273.9 | 122.8 | 114.3 | 1 of 6 | no |
| M3 | 34.9 | 85.5 | 60.5 | 87.1 | 163.0 | 203.2 | **105.7** | 99.1 | 4 of 6 | **yes** |
| M4 | 220.8 | 169.1 | 61.4 | 79.7 | | 419.8 | 190.2 (M0 103.8, M1 108.3) | 177.9 | 2 of 5 | no |
| M5 | 95.6 | 126.8 | 59.3 | 80.9 | | 277.5 | 128.0 (M0 103.8, M1 108.3) | 120.1 | 2 of 5 | no |

**C2**

| Method | 2019 | 2021 | 2022 | 2023 | 2025 | 2026 | Mean | Mean RMSE six | Lower than M1 in | Supported |
|---|---|---|---|---|---|---|---|---|---|---|
| M0 | 59.4 | 95.1 | 65.8 | 90.5 | 107.6 | 175.2 | **98.9** | 97.6 | | benchmark |
| M1 | 32.8 | 88.6 | 83.6 | 98.6 | 124.9 | 225.4 | 109.0 | 103.9 | | benchmark |
| M2 | 32.8 | 88.6 | 83.6 | 101.8 | 134.6 | 225.4 | 111.1 | 105.8 | 0 of 6 | no |
| M3 | 26.4 | 103.3 | 71.9 | 97.1 | 110.7 | 205.3 | 102.5 | 98.3 | 5 of 6 | no (mean above M0) |
| M4 | 220.8 | 169.1 | 61.4 | 79.7 | | 419.8 | 190.2 (M0 97.2, M1 105.8) | 177.9 | 2 of 5 | no |
| M5 | 101.4 | 135.9 | 64.0 | 85.1 | | 229.4 | 123.2 (M0 97.2, M1 105.8) | 116.7 | 2 of 5 | no |

Seats won over the scored set (the yardstick), Reform UK, Labour, Conservative, Liberal Democrats, Green Party, Others: 2019 0, 793, 685, 356, 66, 177; 2021 0, 834, 1,136, 308, 75, 127; 2022 0, 2,190, 965, 639, 100, 187; 2023 0, 1,129, 494, 476, 125, 142; 2025 677, 98, 319, 370, 79, 94; 2026 1,210, 925, 700, 690, 532, 209.

## (b) Which parties drive the error

Signed seat error, forecast minus actual. M1 and M3 (the supported method under C0; under C2 M3 is the lowest of M2 to M5 and is **not supported**).

**C0**

| Election | Method | Reform UK | Labour | Conservative | Lib Dem | Green | Others |
|---|---|---|---|---|---|---|---|
| 2019 | M1 | 0 | minus 65 | plus 47 | minus 20 | minus 21 | plus 58 |
| | M3 | 0 | minus 62 | plus 37 | minus 15 | minus 24 | plus 64 |
| 2021 | M1 | 0 | plus 131 | minus 103 | minus 32 | plus 10 | minus 6 |
| | M3 | 0 | plus 146 | minus 120 | minus 26 | plus 6 | minus 6 |
| 2022 | M1 | 0 | minus 60 | plus 124 | minus 67 | plus 36 | minus 33 |
| | M3 | 0 | minus 23 | plus 110 | minus 72 | plus 23 | minus 37 |
| 2023 | M1 | 0 | minus 20 | plus 170 | minus 81 | minus 39 | minus 30 |
| | M3 | 0 | minus 1 | plus 168 | minus 86 | minus 48 | minus 34 |
| 2025 | M1 | minus 364 | plus 65 | plus 181 | plus 103 | plus 42 | minus 27 |
| | M3 | minus 308 | plus 62 | plus 156 | plus 98 | plus 26 | minus 34 |
| 2026 | M1 | minus 514 | plus 37 | plus 20 | plus 66 | plus 311 | plus 80 |
| | M3 | minus 371 | plus 17 | minus 30 | plus 62 | plus 252 | plus 70 |

**C2**

| Election | Method | Reform UK | Labour | Conservative | Lib Dem | Green | Others |
|---|---|---|---|---|---|---|---|
| 2019 | M1 | 0 | minus 45 | plus 40 | minus 34 | minus 24 | plus 63 |
| | M3 | 0 | minus 35 | plus 29 | minus 26 | minus 27 | plus 59 |
| 2021 | M1 | 0 | plus 145 | minus 135 | minus 14 | plus 7 | minus 3 |
| | M3 | 0 | plus 167 | minus 159 | minus 5 | plus 3 | minus 7 |
| 2022 | M1 | 0 | minus 80 | plus 146 | minus 75 | plus 41 | minus 32 |
| | M3 | 0 | minus 59 | plus 131 | minus 65 | plus 33 | minus 39 |
| 2023 | M1 | 0 | minus 35 | plus 196 | minus 82 | minus 50 | minus 29 |
| | M3 | 0 | minus 11 | plus 191 | minus 85 | minus 58 | minus 37 |
| 2025 | M1 | minus 222 | plus 77 | plus 147 | plus 36 | plus 4 | minus 42 |
| | M3 | minus 193 | plus 89 | plus 122 | plus 36 | minus 5 | minus 50 |
| 2026 | M1 | minus 343 | minus 222 | plus 83 | plus 14 | plus 283 | plus 185 |
| | M3 | minus 261 | minus 248 | plus 38 | plus 13 | plus 281 | plus 178 |

Reading: in the two Reform UK years the error is mostly one lane's level, too big for a shrunk national seat ratio to close. The Conservative overstatement from 2022 to 2025 and the Liberal Democrat understatement in 2021 to 2023 are steady across arms and methods, and M3's ratio for them is close to 1 (below), so the calibration barely touches them. The 2021 sign flip (Labour over, Conservatives under) runs against the other years.

## (c) Are M1's win chances reliable

Ten band table over lane and ward pairs with a forecast: mean win chance, then the share of those pairs where the lane led the ward. C0 shown; C2 is close in every year (`question_c` in the summary).

| Band | 2019 | 2021 | 2022 | 2023 | 2025 | 2026 |
|---|---|---|---|---|---|---|
| 0.0 to 0.1 | 0.02 / 0.01 | 0.02 / 0.02 | 0.02 / 0.01 | 0.01 / 0.02 | 0.03 / 0.07 | 0.03 / 0.02 |
| 0.1 to 0.2 | 0.15 / 0.10 | 0.14 / 0.10 | 0.14 / 0.10 | 0.15 / 0.10 | 0.15 / 0.21 | 0.14 / 0.14 |
| 0.2 to 0.3 | 0.25 / 0.26 | 0.25 / 0.26 | 0.25 / 0.20 | 0.25 / 0.20 | 0.25 / 0.26 | 0.25 / 0.28 |
| 0.3 to 0.4 | 0.35 / 0.29 | 0.35 / 0.36 | 0.35 / 0.29 | 0.35 / 0.29 | 0.35 / 0.28 | 0.35 / 0.39 |
| 0.4 to 0.5 | 0.44 / 0.45 | 0.45 / 0.44 | 0.45 / 0.46 | 0.45 / 0.42 | 0.45 / 0.36 | 0.45 / 0.50 |
| 0.5 to 0.6 | 0.55 / 0.63 | 0.55 / 0.57 | 0.55 / 0.59 | 0.55 / 0.53 | 0.55 / 0.42 | 0.55 / 0.55 |
| 0.6 to 0.7 | 0.65 / 0.70 | 0.65 / 0.64 | 0.65 / 0.73 | 0.65 / 0.73 | 0.65 / 0.47 | 0.65 / 0.63 |
| 0.7 to 0.8 | 0.76 / 0.80 | 0.75 / 0.73 | 0.75 / 0.82 | 0.75 / 0.80 | 0.74 / 0.60 | 0.75 / 0.70 |
| 0.8 to 0.9 | 0.85 / 0.90 | 0.85 / 0.90 | 0.85 / 0.91 | 0.85 / 0.93 | 0.85 / 0.61 | 0.85 / 0.84 |
| 0.9 to 1.0 | 0.97 / 0.98 | 0.96 / 0.95 | 0.96 / 0.97 | 0.96 / 0.96 | 0.94 / 0.87 | 0.95 / 0.91 |

Leader Brier score, M1 then M2 (C0): 2019 0.274, 0.274; 2021 0.279, 0.279; 2022 0.234, 0.237; 2023 0.246, 0.250; 2025 0.713, 0.719; 2026 0.468, 0.471. C2: 0.267, 0.267; 0.279, 0.279; 0.230, 0.230; 0.254, 0.258; 0.658, 0.675; 0.428, 0.428.

Fitted stretch factor per fold (the value applied to that year), C0: 1.00, 1.00, 0.95, 0.95, 1.05, 1.05. C2: 1.00, 1.00, 1.00, 0.95, 1.10, 1.00.

Reading: from 2019 to 2023 and in 2026 the chances are close to reliable, slightly too cautious near 0.7 to 0.9 in 2022 and 2023. **May 2025 is the exception**: chances from 0.5 up came true far less often than stated (0.85 band led 61% of the time), because the ward forecasts put the wrong party first in many wards, not because of their spread. No single stretch factor fixes a year like that, which is why M2 fits about 1 everywhere.

## (d) Sensitivity, reported, not ruled

**Per council.** Per council RMSE five summed over councils, M0, M1, M2, M3:

| Arm | 2019 | 2021 | 2022 | 2023 | 2025 | 2026 |
|---|---|---|---|---|---|---|
| C0 | 134.0, 138.3, 138.3, 138.4 | 169.0, 166.7, 166.7, 169.6 | 252.1, 245.3, 247.8, 244.9 | 162.7, 148.7, 152.1, 151.6 | 303.5, 256.8, 259.6, 237.2 | 490.3, 513.6, 511.2, 462.1 |
| C2 | 134.4, 129.6, 129.6, 128.8 | 170.0, 170.2, 170.2, 175.8 | 255.8, 245.7, 245.7, 240.7 | 160.9, 156.9, 161.0, 158.4 | 277.4, 220.5, 230.6, 214.8 | 427.7, 462.6, 462.6, 447.2 |

Council by council, expected seats (M1) beat leader takes all (M0) in most years under both arms; M3 is lowest in 2022, 2025 and 2026 under C0 and in 2019, 2022 and 2025 under C2. So M0's national lead under C2 partly comes from errors cancelling across councils.

**Split rule in multi seat wards** (leader ceil(m/2), second floor(m/2) when within 5 points). Mean RMSE five over six: C0 M0s 119.7 (M0 120.9), M1s 121.9 (M1 122.0); C2 M0s 100.5 (M0 98.9), M1s 109.1 (M1 109.0). Splits matter little nationally.

## Fit stability across folds

- **M3 seat multipliers** (exp of the shrunk log ratio), C0, range over the six folds: Reform UK 1.33 to 1.48; Labour 0.98 to 1.00; Conservative 0.92 to 0.97; Liberal Democrats 1.00 to 1.02; Green Party 0.83 to 0.96; Others 0.96 to 1.02. C2: Reform UK 1.18 to 1.22; Labour 0.99 to 1.03; Conservative 0.92 to 0.96; Liberal Democrats 1.02 to 1.04; Green Party 0.85 to 1.03; Others 0.90 to 1.03. Every lane except Reform UK and the Green Party is within 10% of 1 in every fold. Reform UK's multiplier rests on two elections (2025 and 2026), and for the 2025 and 2026 folds on only one of them; the Green Party's moves when 2026 leaves the training set.
- **M4 coefficient** beta: 1.14 (2019), 1.06 (2021), 1.00 (2022), 1.01 (2023), 0.65 (2026). About one seat share point per point of national poll change, except when 2026 is held out.

## Timing

Whole run 739 seconds on a heavily loaded machine (load average above 70 from other work): win chances for 51 stretch values, six elections and two arms 664 seconds; all fitting and scoring 74 seconds; reading inputs under a second. Each fit itself (a grid search over 51 values, a ratio, a one coefficient regression) is a fraction of a second; the cost is the 4,000 draw win chances.

## Faults fixed before scoring, and what was dropped

- **Dropped in advance:** M4 and M5 for 2025 (8% of seats had a previous contest of the same ward). Nothing else dropped. 149 wards in 2021 (180 seats) have no forecast and are outside the scored set.
- **Fixed before any score** (found by the self test on random seats, listed in the spec): M4's coefficient was blank because Reform UK's anchor is blank before February 2019. Fixed by an anchor of zero where a lane was not yet polled, and no seats and no fit point for a lane standing in no scored ward.
- No rerun after the score was seen.

## Limits

- **England only, and only the scored set.** Democracy Club's file holds 2,157 seats for May 2019 and 2,366 for May 2023, well short of every seat up those days; the 2026 set is 4,266 of 4,884 seats in the merged file. These are not national totals.
- **Not comparable with the public ranking.** Its seat set and party list are not known, and its scale differs (more seats means larger errors). The figures here compare methods with each other, not with any published score.
- **May 2026 has been scored many times** by earlier versions of this model; only these fixed methods are new to it.
- **Six elections is a small sample for a per lane calibration.** Reform UK stood widely in only two of them, so its multiplier is effectively fitted on one election in the folds that matter most.
- **M4** applies the matched wards' seat shares to all scored seats, which assumes unmatched wards behave alike; 2019 and 2021 have 69% and 63% coverage.
- Win chance is the chance of leading a ward; the split test suggests this approximation costs little nationally.
- The ward model alone (C0 and C2), not the blend with the candidate engine or the published forecast.
