# Local strength inputs in the ward model: results

Run 27 November 2026 under `STRENGTH_SPEC.md` (committed first, 5213a35). One fit (`strength_fit.py`), one scoring run (`strength_score.py`). Research only. Every figure below is from `results/strength_summary.json` unless stated; counts are dataset wards (scheduled May contests in England) or by-election contests, with leaders by full slate share over six pooled lanes.

## Answer

**Neither arm is supported.** Adding local strength inputs to the ward model (C2, here L0) lowers share error a little but calls slightly fewer ward leaders, and fails rule (a) on three of its four parts.

- **L1** (ward level strength): 9,137 leaders pooled against L0's 9,146 (minus 9 of 12,175 wards); share error 6.03 points against 6.09; at least as many leaders in 3 of 6 years (2021, 2023, 2025); May 2022 worse by 26 wards, more than 1% of its 2,533 (25.3). Not supported.
- **L2** (ward plus council level): 9,128 pooled (minus 18); share error 6.03; 3 of 6 years (2021, 2023, 2025); May 2022 worse by 26. Not supported.
- **Party totals (b):** lowest root mean square of called minus led over the five main parties is L1 in 3 years (2023, 2025, 2026), L0 in 2 (2019, 2022), L2 in 1 (2021). The differences are small against the error that remains (May 2026: 114.3, 111.6, 113.6 wards).
- **Where it helps (c):** the inputs make the model more inertial. Wards keeping last time's leader: plus 42 (L1) and plus 43 (L2) leaders; wards where the leader changed: minus 58 and minus 70. The concentrated parties are not better placed: in wards they did not lead last time, the Liberal Democrats are called first and right in 201 wards under L0, 176 under L1, 175 under L2.
- **By-elections (d):** not paid for there. L1 792 and L2 799 leaders against L0's 793 of 1,190; share error 7.27 and 7.17 against 7.29. Both pass the by-election check.
- **No fault was found or fixed between the fit and reading the score.** Nothing was dropped: elected flags proved usable, so the seats won input is in.

## Before the run

- C2 reproduced exactly from the cached PR 197 dataset before any change: offsets identical on every lane (largest absolute difference 0), leaders 1,375 / 1,702 / 2,136 / 1,445 / 694 / 1,794 (`strength_fit.py --reproduce`). The L0 arm of the main run gives the same six counts again.
- The scorer was dry run once on PR 197's C2 forecasts copied into all three arms, to check it ran; that output was deleted.
- **Fit time: 1,921 seconds** for 91 cuts, 477 lane jobs, three arms (PR 197: 437 seconds for two arms). The machine was heavily loaded by other work during the run (load average 81 over 5 minutes and 72 over 15 at the end, from `uptime`), so most of the gap is contention, not the 42 extra inputs. No figure depends on timing.

## (a) Ward leaders called and share error

| Year | Wards | L0 leaders | L1 | L1 minus L0 | L2 | L2 minus L0 | L0 error (pp) | L1 error | L2 error |
|---|---|---|---|---|---|---|---|---|---|
| 2019 | 1,678 | 1,375 | 1,371 | minus 4 | 1,368 | minus 7 | 6.18 | 6.26 | 6.36 |
| 2021 | 2,255 | 1,702 | 1,711 | plus 9 | 1,716 | plus 14 | 6.17 | 5.82 | 5.78 |
| 2022 | 2,533 | 2,136 | 2,110 | minus 26 | 2,110 | minus 26 | 5.70 | 5.71 | 5.64 |
| 2023 | 1,734 | 1,445 | 1,446 | plus 1 | 1,452 | plus 7 | 5.43 | 5.33 | 5.29 |
| 2025 | 1,399 | 694 | 706 | plus 12 | 698 | plus 4 | 8.39 | 8.45 | 8.57 |
| 2026 | 2,576 | 1,794 | 1,793 | minus 1 | 1,784 | minus 10 | 5.38 | 5.35 | 5.34 |
| **Pooled** | **12,175** | **9,146** | **9,137** | **minus 9** | **9,128** | **minus 18** | **6.09** | **6.03** | **6.03** |

Share error: mean absolute error in points over lanes with a forecast or an actual share. In 2021, 149 wards cannot be forecast by any arm (a standing lane without a model) and count as misses for all three.

| Rule | L1 | L2 |
|---|---|---|
| 1. More leaders pooled | no (9,137 v 9,146) | no (9,128 v 9,146) |
| 2. Pooled share error no higher | yes (6.03 v 6.09) | yes (6.03 v 6.09) |
| 3. At least as many in four of six years | no (3) | no (3) |
| 4. No year worse by more than 1% | no (2022, minus 26 > 25.3) | no (2022, minus 26 > 25.3) |
| **Supported** | **no** | **no** |

## (b) Party totals: wards called first minus wards led

Over the wards every arm forecast (all wards except 2021's 149). Positive means the lane is called first in more wards than it led.

| Year | Arm | Reform UK | Labour | Conservative | Liberal Democrats | Green Party | Others | RMS, five main parties |
|---|---|---|---|---|---|---|---|---|
| 2019 | wards led | 0 | 671 | 523 | 274 | 42 | 168 | |
| | L0 | 0 | plus 42 | plus 70 | minus 23 | minus 14 | minus 75 | **38.4** |
| | L1 | 0 | plus 96 | plus 37 | minus 36 | minus 14 | minus 83 | 49.1 |
| | L2 | 0 | plus 110 | plus 27 | minus 33 | minus 18 | minus 86 | 53.4 |
| 2021 | wards led | 0 | 662 | 982 | 275 | 69 | 118 | |
| | L0 | 0 | plus 146 | minus 92 | minus 1 | minus 7 | minus 46 | 77.2 |
| | L1 | 0 | plus 109 | minus 74 | plus 5 | minus 1 | minus 39 | 59.0 |
| | L2 | 0 | plus 110 | minus 71 | plus 2 | minus 2 | minus 39 | **58.6** |
| 2022 | wards led | 0 | 1,297 | 624 | 413 | 72 | 127 | |
| | L0 | 0 | minus 2 | plus 102 | minus 42 | minus 3 | minus 55 | **49.4** |
| | L1 | 0 | minus 33 | plus 148 | minus 54 | minus 5 | minus 56 | 72.0 |
| | L2 | 0 | minus 27 | plus 149 | minus 62 | minus 3 | minus 57 | 73.2 |
| 2023 | wards led | 0 | 831 | 364 | 349 | 90 | 100 | |
| | L0 | 0 | plus 3 | plus 126 | minus 52 | minus 33 | minus 44 | 62.7 |
| | L1 | 0 | plus 36 | plus 90 | minus 43 | minus 35 | minus 48 | **49.9** |
| | L2 | 0 | plus 32 | plus 93 | minus 42 | minus 37 | minus 46 | 50.6 |
| 2025 | wards led | 551 | 77 | 278 | 340 | 71 | 82 | |
| | L0 | minus 106 | plus 24 | plus 173 | plus 26 | minus 36 | minus 81 | 93.5 |
| | L1 | minus 101 | plus 33 | plus 168 | plus 18 | minus 37 | minus 81 | **90.8** |
| | L2 | minus 118 | plus 16 | plus 154 | plus 70 | minus 41 | minus 81 | 94.3 |
| 2026 | wards led | 858 | 447 | 386 | 445 | 295 | 145 | |
| | L0 | minus 197 | minus 101 | plus 44 | plus 91 | plus 78 | plus 85 | 114.3 |
| | L1 | minus 186 | minus 109 | plus 32 | plus 90 | plus 82 | plus 91 | **111.6** |
| | L2 | minus 186 | minus 114 | plus 33 | plus 90 | plus 88 | plus 89 | 113.6 |

Lowest RMS: L1 in 3 years, L0 in 2, L2 in 1; no ties. **On this dataset the ward model does not under-call the Liberal Democrats in May 2026**: every arm calls them first in about 90 more wards than they led. The 361 ward shortfall in the brief belongs to the site's published forecast, not to this research model, so it is not something these inputs could fix here. The persistent errors are Reform UK under-called (2025 and 2026) and the Conservatives over-called (2022, 2023, 2025); the strength inputs move neither by much.

## (c) Where it helps

**By ward history, pooled over six years** (leaders called; "previous contest" is the ward's latest earlier dataset contest):

| Wards | Count | L0 | L1 | L2 |
|---|---|---|---|---|
| Same leader as last time | 7,382 | 6,749 | 6,791 (plus 42) | 6,792 (plus 43) |
| Leader changed | 2,595 | 1,203 | 1,145 (minus 58) | 1,133 (minus 70) |
| No previous contest | 2,198 | 1,194 | 1,201 (plus 7) | 1,203 (plus 9) |

The loss in changed wards falls mostly on 2022 (L0 199, L1 151, L2 154 of 437) and 2019 (82, 69, 65 of 217); the gain in held wards is spread across 2019, 2021 and 2022. May 2025 has 1,265 of its 1,399 wards with no previous contest, which is why ward level inputs barely touch it.

**Per lane, pooled, wards called first and right (called first and led)**:

| Lane | Led last time: wards / lane led | L0 | L1 | L2 | Did not lead last time: wards / lane led | L0 | L1 | L2 |
|---|---|---|---|---|---|---|---|---|
| Reform UK | 36 / 31 | 27 | 26 | 26 | 9,941 / 787 | 477 | 476 | 472 |
| Labour | 4,303 / 3,231 | 2,956 | 2,982 | 2,981 | 5,674 / 465 | 213 | 188 | 190 |
| Conservative | 3,289 / 2,259 | 2,018 | 2,025 | 2,028 | 6,688 / 392 | 102 | 95 | 92 |
| Liberal Democrats | 1,484 / 1,298 | 1,238 | 1,245 | 1,245 | 8,493 / 377 | 201 | 176 | 175 |
| Green Party | 269 / 225 | 225 | 225 | 224 | 9,708 / 333 | 161 | 163 | 160 |
| Others | 596 / 338 | 285 | 288 | 288 | 9,381 / 241 | 49 | 47 | 44 |

**Concentrated lanes by year** (wards led; then called first / called first and right / signed share bias in points, per arm):

| Lane | Year | Led | L0 | L1 | L2 |
|---|---|---|---|---|---|
| Liberal Democrats | 2019 | 274 | 251 / 209 / 0.08 | 238 / 200 / minus 0.38 | 241 / 201 / minus 0.29 |
| | 2021 | 303 | 274 / 218 / minus 0.52 | 280 / 219 / minus 0.37 | 277 / 221 / minus 0.49 |
| | 2022 | 413 | 371 / 325 / 0.04 | 359 / 315 / minus 0.28 | 351 / 312 / minus 0.37 |
| | 2023 | 349 | 297 / 271 / minus 0.37 | 306 / 275 / minus 0.41 | 307 / 275 / minus 0.27 |
| | 2025 | 340 | 366 / 194 / 3.69 | 358 / 196 / 3.84 | 410 / 204 / 4.51 |
| | 2026 | 445 | 536 / 405 / 1.66 | 535 / 399 / 1.74 | 535 / 400 / 1.41 |
| Green Party | 2019 | 42 | 28 / 27 / minus 3.92 | 28 / 26 / minus 3.98 | 24 / 23 / minus 3.89 |
| | 2021 | 70 | 62 / 43 / 0.92 | 68 / 44 / 1.00 | 67 / 43 / 0.99 |
| | 2022 | 72 | 69 / 52 / 3.45 | 67 / 51 / 3.24 | 69 / 52 / 3.25 |
| | 2023 | 90 | 57 / 49 / minus 1.65 | 55 / 48 / minus 1.73 | 53 / 47 / minus 1.68 |
| | 2025 | 71 | 35 / 17 / 2.91 | 34 / 17 / 3.04 | 30 / 18 / 2.57 |
| | 2026 | 295 | 373 / 208 / 1.81 | 377 / 212 / 1.90 | 383 / 212 / 2.23 |
| Others | 2019 | 168 | 93 / 65 / minus 2.79 | 85 / 62 / minus 3.19 | 82 / 62 / minus 3.68 |
| | 2021 | 125 | 72 / 58 / minus 2.40 | 79 / 62 / minus 2.14 | 79 / 63 / minus 1.88 |
| | 2022 | 127 | 72 / 62 / minus 2.66 | 71 / 62 / minus 2.91 | 70 / 60 / minus 2.77 |
| | 2023 | 100 | 56 / 46 / minus 4.12 | 52 / 44 / minus 4.22 | 54 / 45 / minus 4.17 |
| | 2025 | 82 | 1 / 1 / minus 7.20 | 1 / 1 / minus 7.20 | 1 / 1 / minus 7.96 |
| | 2026 | 145 | 230 / 117 / 3.57 | 236 / 118 / 3.53 | 234 / 115 / 3.63 |

Wards led here are over all wards in the year (2021 includes the 149 unforecastable wards, so it differs from the (b) table). The strength inputs make no consistent difference for the concentrated lanes: within a year they move called first and right by a few wards either way. The one large move, L2 calling the Liberal Democrats first in 44 more wards in May 2025, brings 10 more right and raises their share bias to 4.51 points.

## (d) By-elections

| Contests | Count | Forecast | L0 leaders | L1 | L2 | L0 error (pp) | L1 | L2 |
|---|---|---|---|---|---|---|---|---|
| All, May 2018 to Nov 2026 | 1,190 | 1,153 | 793 | 792 | 799 | 7.29 | 7.27 | 7.17 |
| 2018 (from May) | 46 | 44 | 35 | 36 | 35 | 6.20 | 5.83 | 5.58 |
| 2019 | 65 | 60 | 50 | 51 | 51 | 6.17 | 6.04 | 5.84 |
| 2020 | 12 | 0 | 0 | 0 | 0 | none | none | none |
| 2021 | 116 | 115 | 97 | 98 | 97 | 6.11 | 6.13 | 6.00 |
| 2022 | 66 | 66 | 51 | 50 | 51 | 7.46 | 7.75 | 7.59 |
| 2023 | 83 | 80 | 69 | 67 | 66 | 6.31 | 6.31 | 6.43 |
| 2024 | 310 | 296 | 175 | 177 | 180 | 8.74 | 8.65 | 8.75 |
| 2025 | 324 | 324 | 216 | 209 | 214 | 7.28 | 7.29 | 7.08 |
| 2026 | 168 | 168 | 100 | 104 | 105 | 6.68 | 6.64 | 6.46 |

Check (leaders no fewer than L0 minus 11.9, error no more than 0.10 points above L0): L1 passes, L2 passes. L2 is the best arm on by-elections (plus 6 leaders, minus 0.12 points), but the margin is small for 1,190 contests and was not a rule.

## Limits

- England only, and only the wards in the dataset (the Drive ward matrix plus May 2026 and later contest files).
- New or redrawn wards have no previous contest, so the ward level inputs are missing for them: 1,265 of the 1,399 May 2025 divisions. New unitary councils have no council level inputs at their first election.
- The council inputs count abolished wards until they are more than 2,000 days old, and Others is a pooled lane, so "Others topped the poll" means the combined independent and small party vote.
- Model settings were chosen on contests up to April 2026 and not retuned for the wider input set; a model with 42 more inputs might want different settings, but tuning on the test elections was ruled out.
- May 2026 has been scored many times in this programme, so its figures are weaker evidence than the earlier years.
- The party totals proxy counts wards, not seats: multi-member wards count once.
