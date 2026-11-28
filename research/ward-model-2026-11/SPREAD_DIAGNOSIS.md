# Reform UK spread where a previous Reform UK result exists: diagnosis

28 November 2026. **Research only**; nothing on the site, the engine or the published forecast reads anything here. Part 1 of the spread study. No model was fitted for it. It reads C2's cached forward only forecasts on the corrected inputs (the "Both" column of `REBUILD_RESULTS.md`, `cache/rebuild/corrected/bridge_level_predictions.pkl`, hash checked) and rebuilds the swing blend M50 of PR 216 from those same forecasts with `swingblend_score.blend` copied unchanged. Script: `spread_diagnose.py`. Every figure below comes from its output, `results/spread_diagnosis.json`, unless another file is named. The script first checks that C2 reproduces `REBUILD_RESULTS.md`: six Mays 9,135 of 12,175 wards (share error 6.08), by-elections 786 of 1,190 contests (7.26).

## The question

`LEVEL_DIAGNOSIS.md` (PR 218) found that C2's Reform UK forecasts are bunched across wards: calibration slope 1.20 over the six Mays, and in wards Reform UK won in May 2026 a forecast lead of 2.93 points against an actual 14.53. The hypothesis tested here: the bunching exists because almost no ward had a previous Reform UK result in the same ward, so the model had nothing ward specific to separate strong from weak Reform UK wards. If so, it should shrink where a previous Reform UK result exists, which is the case that grows in May 2027.

## Answer

1. **Where a previous Reform UK result exists, the bunching largely goes.** Pooled over every row from May 2025 onwards (the Mays of 2025 and 2026 and the 437 by-elections from 1 May 2025), Reform UK's calibration slope is **1.043 on the 510 rows with a previous Reform UK result**, against 1.226 on the 2,283 rows where the ward had a previous contest but Reform UK did not stand in it. Reform UK was called first in 183 of those 510 rows and won 209 (88%); in the other group, called first in 450 and won 669 (67%). Overall leaders called: 370 of 510 (72.5%) against 1,561 of 2,283 (68.4%).
2. **But it does not go entirely, and a level error remains.** In May 2026, on the 407 wards with a previous Reform UK result, the slope is 1.084 and Reform UK is still called first in only 148 of the 179 it won, with a forecast lead of 6.89 points against an actual 16.70 where it won. Its share error in that group is minus 4.04 points, larger than in the rest (minus 2.53). So with a ward signal the spread is close to right and the shortfall becomes mostly a level error.
3. **At by-elections the group with a previous Reform UK result is over spread, not bunched.** At the 90 by-elections from May 2025 with a previous Reform UK result, the slope is 0.901, Reform UK is called first in 33 and won 26, and the forecast lead where it won (8.97) matches the actual (8.87). At the 52 by-elections after 7 May 2026 with a previous Reform UK result (almost all of them a May 2026 result), the slope is 0.903, Reform UK is called first in 14 and won 10, and the forecast lead where it won is 12.16 against an actual 5.21. This is the case closest to May 2027 and it says the model, given a recent Reform UK result, overstates Reform UK where it is strong. It is 52 contests.
4. **The bunching sits in one group: wards that had a previous contest in which Reform UK did not stand.** In May 2026 that is 2,027 of the 2,569 wards where Reform UK stood, and 613 of its 858 wins. There the slope is 1.240, Reform UK is called first in 425 of 613 wins, and the forecast lead where it won is 1.00 against 13.67. Wards with no previous contest at all are not bunched: 135 wards in May 2026, slope 0.969, called first 68 against 66 won. So the fault is not "no ward history"; it is "ward history for the other lanes but none for Reform UK".
5. **The swing blend M50 makes the group with a previous Reform UK result worse at the Mays.** Pooled from May 2025, on the 510 rows with a previous Reform UK result, M50 calls Reform UK first in 157 against C2's 183 (won 209), its Reform UK share error is minus 4.55 against minus 3.16, and it calls 355 leaders against 370. In May 2026 alone: 120 against 148 Reform UK calls, 290 against 303 leaders. A logit swing from a Reform UK share recorded before its 2025 rise carries that low share forward. This argues against a Reform UK only swing blend (option (a) of the brief).

## Size of the group, stated plainly

Rows where Reform UK stood, with a previous Reform UK result under the model's own rule (`prev_rel_ref` present, that is Reform UK stood in the ward's latest earlier contest under the same GSS code):

| Set | Reform UK stood | With a previous Reform UK result | Any earlier Reform UK result in the ward (sensitivity) |
|---|---|---|---|
| May 2019 | 0 | 0 | 0 |
| May 2021 | 149 | 0 | 0 |
| May 2022 | 97 | 23 | 23 |
| May 2023 | 190 | 33 | 49 |
| May 2025 | 1,393 | 13 | 13 |
| May 2026 | 2,569 | 407 | 477 |
| By-elections before 1 May 2025 | 142 | 18 | 22 |
| By-elections from 1 May 2025 | 414 | 90 | 92 |
| of which after 7 May 2026 | 107 | 52 | 52 |
| Pooled from May 2025 | 4,376 | 510 | 582 |

Before 2026 the group is tiny: 56 May wards in 2022 and 2023 (Reform UK was never first in any of them), 13 in May 2025 and 18 by-elections. The 510 rows from May 2025 are 407 May 2026 wards, 13 May 2025 wards and 90 by-elections. **Nothing before May 2026 can test this question**, and the May 2026 group is one election day. The sensitivity column counts any earlier Reform UK result in the ward, not only in its latest contest; it adds 72 rows pooled from May 2025, so the model's single contest rule loses little.

## Every group, C2

Leaders are rows whose first placed lane was called first. Reform UK figures are over the rows of the group where Reform UK stood and was forecast. Slope is the least squares slope of actual Reform UK share on forecast share; above 1, the forecasts are more bunched than the outcomes. Share error is forecast minus actual, in points. Lead is Reform UK's forecast share minus the best other lane's, against the same from the result, in rows it won.

"Prev" has a previous Reform UK result; "absent" had a previous contest but Reform UK did not stand in it; "none" had no previous contest under the same code.

| Set | Group | Rows | Leaders | All lane share error | Reform UK slope | Reform UK share error | Called first / won | Lead where won, forecast / actual |
|---|---|---|---|---|---|---|---|---|
| May 2025 | prev | 13 | 11 | 3.71 | 1.088 | minus 2.13 | 2 / 4 | 0.50 / 9.32 |
| May 2025 | absent | 121 | 86 | 5.17 | 1.300 | minus 4.36 | 3 / 22 | minus 6.79 / 7.85 |
| May 2025 | none | 1,259 | 602 | 8.68 | 1.119 | minus 4.23 | 442 / 525 | 0.84 / 13.69 |
| May 2026 | prev | 407 | 303 | 4.91 | 1.084 | minus 4.04 | 148 / 179 | 6.89 / 16.70 |
| May 2026 | absent | 2,027 | 1,372 | 5.52 | 1.240 | minus 2.53 | 425 / 613 | 1.00 / 13.67 |
| May 2026 | none | 135 | 83 | 6.59 | 0.969 | minus 2.98 | 68 / 66 | 10.13 / 16.71 |
| May 2026 | all | 2,576 | 1,764 | 5.48 | 1.195 | minus 2.79 | 641 / 858 | 2.93 / 14.53 |
| By-elections from 1 May 2025 | prev | 90 | 56 | 5.58 | 0.901 | plus 0.69 | 33 / 26 | 8.97 / 8.87 |
| By-elections from 1 May 2025 | absent | 135 | 103 | 5.40 | 0.976 | minus 3.23 | 22 / 34 | 0.73 / 12.28 |
| By-elections from 1 May 2025 | none | 189 | 103 | 8.41 | 0.922 | minus 0.19 | 88 / 70 | 7.27 / 15.26 |
| By-elections after 7 May 2026 | prev | 52 | 34 | 5.79 | 0.903 | plus 1.68 | 14 / 10 | 12.16 / 5.21 |
| By-elections after 7 May 2026 | all | 107 | 68 | 6.66 | 0.924 | plus 1.63 | 30 / 22 | 7.34 / 8.71 |
| Pooled from May 2025 | prev | 510 | 370 | 5.00 | 1.043 | minus 3.16 | 183 / 209 | 7.03 / 15.58 |
| Pooled from May 2025 | absent | 2,283 | 1,561 | 5.49 | 1.226 | minus 2.67 | 450 / 669 | 0.73 / 13.41 |
| Pooled from May 2025 | none | 1,583 | 788 | 8.47 | 1.033 | minus 3.64 | 598 / 661 | 2.45 / 14.16 |
| Pooled from May 2025 | all | 4,412 | 2,742 | 6.50 | 1.145 | minus 3.08 | 1,231 / 1,539 | 2.32 / 14.02 |
| Pooled six Mays | prev | 476 | 359 | 4.84 | 1.135 | minus 3.33 | 150 / 183 | 6.75 / 16.54 |
| Pooled six Mays | absent | 2,499 | 1,636 | 5.41 | 1.235 | minus 2.28 | 428 / 635 | 0.73 / 13.47 |
| Pooled six Mays | none | 1,423 | 702 | 8.46 | 1.108 | minus 4.00 | 510 / 591 | 1.88 / 14.03 |

"Pooled six Mays, absent" includes 145 May 2021 wards no arm forecasts (Reform UK stood and its lane had no model); they count as misses in leaders and are left out of the Reform UK figures. Every per year row, the by-elections before May 2025 and the rows where Reform UK did not stand are in the JSON.

## The same groups, M50

| Set | Group | Leaders (C2) | M50 leaders | M50 Reform UK slope | M50 Reform UK share error | M50 called first / won | M50 lead where won |
|---|---|---|---|---|---|---|---|
| May 2026 | prev | 303 | 290 | 1.107 | minus 5.86 | 120 / 179 | 2.84 / 16.70 |
| May 2026 | absent | 1,372 | 1,368 | 1.237 | minus 2.46 | 436 / 613 | 1.59 / 13.67 |
| By-elections from 1 May 2025 | prev | 56 | 56 | 0.823 | plus 0.95 | 35 / 26 | 8.52 / 8.87 |
| By-elections after 7 May 2026 | prev | 34 | 33 | 0.860 | plus 2.21 | 16 / 10 | 14.05 / 5.21 |
| Pooled from May 2025 | prev | 370 | 355 | 1.013 | minus 4.55 | 157 / 209 | 3.54 / 15.58 |
| Pooled from May 2025 | all | 2,742 | 2,726 | 1.143 | minus 3.20 | 1,222 / 1,539 | 2.13 / 14.02 |

M50 equals C2 where a ward has no previous contest, by construction.

## How the inputs treat a lane with no previous result

C2 has 73 inputs (`backtest_b_fit.CLEAN` plus the 18 standing inputs of `bridge_level_fit.standing_inputs`). The previous result enters through 14 of them: `has_prev`, `prev_gap_years`, `prev_rel_<lane>` for six lanes and `prev_nat_stand_<lane>` for six lanes.

- `prev_rel_<lane>` is the lane's share at the latest earlier contest under the same GSS code, minus that year's mean share for the lane over contests dated before the target (`prepare.py`, lines 279 to 303). It is **missing (NaN) both when the ward has no earlier contest and when the lane did not stand in it**. The two cases are told apart only by `has_prev`.
- scikit-learn's `HistGradientBoostingRegressor` sends missing values to whichever side of each split fitted the training rows better, so "Reform UK did not stand here last time" is one learned branch, not a value.
- `prev_nat_stand_<lane>` (C2 only) is the lane's national standing rate on the ward's previous scheduled polling day, so the model can tell "Reform UK stood almost nowhere then" from "Reform UK stood widely but not here". It says nothing about how strong Reform UK is in this ward.
- No input carries a Reform UK specific ward signal when `prev_rel_ref` is missing. The ward's GE2024 Reform UK share (`ge24_reform`, bridged from constituency to ward by LSOA, and its neighbour lag `nb_ge24_reform`) is in the dataset but is one of the six inputs `backtest_b_fit` drops for every cut, because it postdates the tests before July 2024. `ukip_council_1316` (council level, 2013 to 2016) is already an input. The ward level UKIP peak (`ukip_peak_ward`) is in the Drive matrix but not in its scoring universe, so the by-elections after May 2026 would have none.

**What the model trained on.** Reform UK stood in 2,568 anchored training rows before the May 2026 cut: 219 with a previous Reform UK result, 772 in wards whose previous contest it did not stand in, and the rest with no previous contest. Before the May 2025 cut: 886 rows, 171 with a previous Reform UK result. Source: `results/spread_diagnosis.json`, `inputs_for_a_lane_without_previous_result`. So at both cuts the Reform UK lane learned how a previous Reform UK result maps to the next one from about 200 rows, most of them small shares before 2025.

## What this decides for part 2

- **A Reform UK only swing blend is ruled out by this evidence.** M50 already contains it for the rows with a previous Reform UK result, and it moves those rows the wrong way at the Mays (finding 5).
- **The fault to address is the "absent" group: a ward history for the other lanes and nothing for Reform UK.** Two ward or council signals that are dated before the cut and are not inputs today can supply it: the ward's GE2024 Reform UK share (and the other two GE2024 shares and the neighbour lag), usable only at cuts after 4 July 2024; and the council's Reform UK share at its latest earlier ordinary election where Reform UK stood, against that day's anchor. Both are specified in `SPREAD_SPEC.md`.
- **May 2026 alone decides nothing**, and the by-elections after May 2026 point the other way from the Mays (findings 2 and 3). The pass rules in the specification therefore require the by-elections not to get worse, and judge the Reform UK spread pooled over Mays and by-elections from May 2025.
