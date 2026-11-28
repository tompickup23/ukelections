# Reform UK ward signals for the ward model: results

28 November 2026. **Research only**; nothing on the site, the engine or the published forecast reads anything here. Diagnosis: `SPREAD_DIAGNOSIS.md` (commit `340cd24`). Specification and pass rules: `SPREAD_SPEC.md`, committed before any candidate forecast existed (`33932b5`). Fit and score scripts committed before their one run (`3e23e57`). Each configuration was fitted once and scored once; nothing was changed after a score was seen.

Every figure below comes from `results/spread_summary.json` (written by `spread_score.py`), except the 2027 counts, which come from `results/spread_2027_count.json` (written by `spread_2027_count.py`), and the diagnosis figures, from `results/spread_diagnosis.json`. "Leaders" means wards (May) or contests (by-elections) whose first placed lane was called first, out of every row in the set; a row an arm cannot forecast counts as a miss. Share error is the mean absolute error, in points, over lanes with a forecast or an actual share. Reform UK's slope is the least squares slope of actual on forecast share where it stood; above 1 means bunched.

**Reproduction.** `spread_fit.py` refitted C2 at all 91 cuts alongside the candidates; its offsets equal the cached corrected C2 offsets exactly (largest absolute difference 0.0), and the scorer reproduced every May and the by-election totals of `REBUILD_RESULTS.md` before scoring anything else.

## Verdict

1. **Neither candidate is supported.** Both fail rule 7, the measure this study is about: neither brings Reform UK's first places closer to the wards it won.
2. **S1 (the ward's GE2024 shares as inputs, from the August 2024 cut) passes rules 1 to 6 and fails rule 7.** It is the better model on every general measure: six Mays 9,160 of 12,175 wards against C2's 9,135 (share error 6.02 against 6.08); five Mays without 2026, 7,378 against 7,371 (6.26 against 6.29); by-elections 812 of 1,190 contests against 786 (6.92 against 7.26), with common Brier 0.408 against 0.430. It is at least as good as C2 in all six years (equal by construction in 2019 to 2023; plus 7 wards in 2025, plus 18 in 2026). **But it makes the Reform UK shortfall worse, not better.** Pooled from May 2025 its Reform UK slope moves from 1.145 to 1.124, and Reform UK is called first in 1,094 rows against C2's 1,231, with 1,539 won: the gap widens from 308 to 445. Almost all of that is May 2025, where S1 calls Reform UK first in 318 wards against C2's 447 (won 551) and its Reform UK share error falls from minus 4.22 to minus 6.10 points.
3. **S2 (the council's Reform UK offset at its last ordinary election) fails rules 1, 2, 4, 5 and 7.** Six Mays 9,119 against 9,135; May 2025 worse by 14 wards (limit 13.99, 1% of 1,399); May 2023 worse by 12. Reform UK slope 1.136, called first 1,227 against 1,539 won (gap 312). By-elections 792 against 786 (7.25 against 7.26).
4. **The hypothesis survives in its measured form and fails in its hoped for form.** The diagnosis showed that where a previous Reform UK result exists, the bunching largely goes (slope 1.043 on 510 rows from May 2025, against 1.226 where the ward's previous contest had no Reform UK candidate). Neither added signal reproduces that effect in the bunched group: there S1's slope is 1.230 and S2's 1.219, against C2's 1.226. A constituency level 2024 share and a council level share do not separate strong from weak Reform UK wards within a council the way the ward's own Reform UK result does.

## The rules

| Rule | C2 | S1 | S1 holds | S2 | S2 holds |
|---|---|---|---|---|---|
| 1. Six Mays, more leaders | 9,135 | 9,160 | Yes | 9,119 | No |
| 2. Six Mays, share error no higher | 6.08 | 6.02 | Yes | 6.09 | No |
| 3. At least as many leaders in four of six years | | all six | Yes | 2019, 2021, 2022, 2026 | Yes |
| 4. No year worse by more than 1% | | none worse | Yes | 2025, minus 14 of 1,399 | No |
| 5. Five Mays without 2026, more leaders and error no higher | 7,371, 6.29 | 7,378, 6.26 | Yes | 7,347, 6.31 | No |
| 6. By-elections, leaders no fewer and error no higher | 786, 7.26 | 812, 6.92 | Yes | 792, 7.25 | Yes |
| 7. From May 2025, Reform UK slope nearer 1 and called first nearer won | 1.145; 1,231 / 1,539 | 1.124; 1,094 / 1,539 | No | 1.136; 1,227 / 1,539 | No |

As the specification stated in advance, S1 equals C2 before August 2024, so rule 3 holds on 2019 to 2023 by construction and S1 is decided on May 2025, May 2026 and the by-elections from August 2024.

## Every arm, every set

Leaders called (share error).

| Set | Rows | C2 | S1 | S2 |
|---|---|---|---|---|
| May 2019 | 1,678 | 1,375 (6.18) | 1,375 (6.18) | 1,375 (6.18) |
| May 2021 | 2,255 | 1,713 (6.04) | 1,713 (6.04) | 1,713 (6.04) |
| May 2022 | 2,533 | 2,138 (5.70) | 2,138 (5.70) | 2,140 (5.72) |
| May 2023 | 1,734 | 1,442 (5.43) | 1,442 (5.43) | 1,430 (5.44) |
| May 2025 | 1,399 | 703 (8.30) | 710 (8.13) | 689 (8.34) |
| May 2026 | 2,576 | 1,764 (5.48) | 1,782 (5.34) | 1,772 (5.48) |
| Six Mays | 12,175 | 9,135 (6.08) | 9,160 (6.02) | 9,119 (6.09) |
| Five Mays, no 2026 | 9,599 | 7,371 (6.29) | 7,378 (6.26) | 7,347 (6.31) |
| By-elections, all | 1,190 | 786 (7.26) | 812 (6.92) | 792 (7.25) |
| By-elections before May 2025 | 753 | 511 (7.53) | 524 (7.31) | 513 (7.51) |
| By-elections from May 2025 | 437 | 275 (6.90) | 288 (6.39) | 279 (6.89) |
| By-elections after 7 May 2026 | 107 | 68 (6.66) | 73 (6.15) | 65 (6.62) |

## Reform UK's spread, from May 2025

Slope; Reform UK share error in points; called first / won; forecast lead / actual lead where it won.

| Set | Arm | Slope | Share error | Called first / won | Lead where won |
|---|---|---|---|---|---|
| Mays 2025 and 2026 (3,975) | C2 | 1.186 | minus 3.29 | 1,088 / 1,409 | 1.99 / 14.10 |
| | S1 | 1.162 | minus 4.05 | 954 / 1,409 | 1.60 / 14.10 |
| | S2 | 1.175 | minus 3.37 | 1,078 / 1,409 | 2.04 / 14.10 |
| By-elections from May 2025 (437) | C2 | 0.895 | minus 0.99 | 143 / 130 | 5.90 / 13.20 |
| | S1 | 0.904 | minus 1.20 | 140 / 130 | 5.51 / 13.20 |
| | S2 | 0.893 | minus 0.99 | 149 / 130 | 5.96 / 13.20 |
| Pooled (4,412) | C2 | 1.145 | minus 3.08 | 1,231 / 1,539 | 2.32 / 14.02 |
| | S1 | 1.124 | minus 3.78 | 1,094 / 1,539 | 1.93 / 14.02 |
| | S2 | 1.136 | minus 3.15 | 1,227 / 1,539 | 2.37 / 14.02 |

**Within the diagnosis's groups, pooled from May 2025** (leaders; Reform UK slope; called first / won):

| Group | Rows | C2 | S1 | S2 |
|---|---|---|---|---|
| Previous Reform UK result | 510 | 370; 1.043; 183 / 209 | 375; 1.029; 184 / 209 | 370; 1.037; 180 / 209 |
| Previous contest, Reform UK absent | 2,283 | 1,561; 1.226; 450 / 669 | 1,571; 1.230; 437 / 669 | 1,569; 1.219; 462 / 669 |
| No previous contest | 1,583 | 788; 1.033; 598 / 661 | 811; 0.953; 473 / 661 | 777; 1.002; 585 / 661 |

S1's loss of Reform UK first places is in the wards with no previous contest (598 to 473), nearly all of them May 2025 county divisions (316 against 442 in May 2025 alone). At the 52 by-elections after 7 May 2026 with a previous Reform UK result, all three arms remain over spread (slopes 0.903, 0.902, 0.900; called first 14, 13 and 13 against 10 won).

**Party called first against won, May 2026** (wards): Reform UK 641 / 636 / 650 against 858; Labour 360 / 375 / 345 against 447; Conservative 411 / 388 / 413 against 386; Liberal Democrats 532 / 560 / 535 against 445; Green 379 / 379 / 374 against 295; Others 253 / 238 / 259 against 145 (C2 / S1 / S2).

## What a later session should take from this

- **S1 is a strong general improvement that fails this study's own test.** Its by-election gain (26 contests and 0.34 points of share error, every by-election set better) is far larger than the swing blend M50's (PR 216: 788 contests, 7.25) or the per lane levels' (PR 218: 785 and 789), all on the same corrected inputs. Its six May gain is not: 9,160 against M50's 9,169. It was not built to win on those measures and is not adoptable from this study, whose pass rule 7 it fails. If it is wanted, it needs its own specification, with Reform UK's May 2025 level written in as a rule, and the May 2027 sealed test as its decision.
- **The Reform UK shortfall in the bunched group is not fixed by coarse Reform UK signals.** What works in the data is the ward's own previous Reform UK result. That arrives on its own in May 2027 for about a third of the wards (below) and cannot be manufactured for the rest from constituency or council figures.
- **Two cautions from the diagnosis still apply.** Where a previous Reform UK result exists, the remaining May shortfall is a level (minus 4.04 points in May 2026), and at the by-elections after May 2026 the same group is over spread. May 2027 could go either way for these wards.

## What this means for May 2027

Counted by `spread_2027_count.py` from `data/identity/wards-2027.json` (the wards listed for 6 May 2027) and `data/identity/wards-2027-baselines.json` (each ward's own last ordinary result on the same boundaries, same ONS code). "Reform UK stood" means a Reform UK share above zero in that baseline. Every one of the 1,391 baselines dated 7 May 2026 was found in `data/results/may-2026/local-and-mayor.merged.json`, and the merged file agrees on whether Reform UK stood in all 1,391. These are counts of wards, not scores; seats are given separately and labelled.

| Baseline | Verified councils, wards | All councils, wards | All councils, seats up in 2027 |
|---|---|---|---|
| 7 May 2026, same ward, Reform UK stood | 1,033 | 1,391 | 1,719 |
| 7 May 2026, same ward, Reform UK absent | 0 | 0 | 0 |
| 2023 or 2024, Reform UK stood | 128 | 176 | 355 |
| 2023 or 2024, Reform UK absent | 2,073 | 2,826 | 5,156 |
| No baseline | 462 | 473 | 677 |
| Total | 3,696 | 4,866 | |

Seats up are summed from each ward's `seats_up` and count only wards with seats up. "Verified" and "unverified" are the blocks in `wards-2027.json`; the unverified block's councils are not yet confirmed as polling in 2027.

**Against the model's own rule.** The model's previous result is the ward's latest earlier contest, which can be a by-election held after the baseline. Of the 2,073 verified wards whose baseline had no Reform UK candidate, 119 have a later by-election in which Reform UK stood; of the 124 verified wards with a 2023 Reform UK baseline, 1 has a later by-election without it. Applying that, in the 3,696 verified wards:

- **1,279 (34.6%) would have a previous Reform UK result** (1,033 + 123 + 4 + 119), the group where the bunching largely goes;
- **1,955 (52.9%) would have a previous contest without Reform UK** (1,927 + 27 + 1), the bunched group, almost all all-out councils last elected in May 2023;
- **462 (12.5%) have no baseline**, mostly the 438 wards on new boundaries.

Over all 4,866 listed wards the same arithmetic gives 1,734 (35.6%), 2,659 (54.6%) and 473 (9.7%).

**So the finding applies to about a third of the May 2027 wards.** For the larger half, the model is in the same position as in May 2026: a ward history for the other lanes and nothing for Reform UK, which is where its forecasts were most bunched (slope 1.240 and 425 Reform UK first places against 613 won in May 2026). Neither signal tested here changes that. Until something does, the 2027 Reform UK ward totals from C2 should be read as likely to understate Reform UK first places in the all-out councils last elected in 2023, and the sealed test should report the three groups separately.
