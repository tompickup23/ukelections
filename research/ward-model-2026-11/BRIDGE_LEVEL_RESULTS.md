# By-election level and standing rates in May forecasts: results

27 November 2026. **Research only.** Specification: `BRIDGE_LEVEL_SPEC.md`, committed before any forecast was produced (commit `77f85d6`). One run of `bridge_level_fit.py` and one of `bridge_level_score.py`. Every figure below is from `results/bridge_level_summary.json`; counts are wards (scheduled) or contests (by-elections) whose leader was called correctly, out of every ward in the dataset on that day. Share error is the mean absolute error in points over lanes with a forecast or an actual share.

## Answer

1. **C2, standing rates as inputs, is supported under rule (a).** Pooled over the six Mays it called 9,146 leaders against C0's 8,952 (+194 of 12,175 wards), with share error 6.09 against 6.31, at least as many leaders in five of six years, and no year worse by more than 1%. **But 179 of the 194 extra wards come from May 2025 (+87) and May 2026 (+92),** the two years that prompted the idea. Over 2019 to 2023 it is +15 wards (+13, +5, minus 3, 0), and its share error is higher than C0's in 2021 and 2023.
2. **C1, the by-election level, is not supported.** It gains pooled (9,023 against 8,952, share error 6.24 against 6.31), but calls at least as many leaders as C0 only in 2021 (where it changes nothing), 2025 and 2026. It loses in 2019 (1), 2022 (6) and 2023 (12).
3. **C3, both together, is not supported.** It has the best pooled count, 9,168, and the best share error, 6.08, but in 2023 it calls 18 fewer leaders than C0, more than the 1% limit (17.3 of 1,734 wards).
4. **May 2025 improves under every arm:** C0 607 of 1,399, C1 643, C2 694, C3 705. Reform UK signed bias goes from minus 7.81 points (C0) to minus 5.88, minus 4.51 and minus 3.17; Reform UK called first goes from 270 to 357, 445 and 492, against 551 wards it led.
5. **The by-election level points the same way as the May error in 20 of 29 cells with evidence** (7 cells had no by-election). For Reform UK it agreed in all 4 cells with evidence; Green Party and Others 4 of 5; Conservative and Liberal Democrats 3 of 5; Labour 2 of 5. That is better than a coin toss for most lanes and not reliable for Labour. No per-party rule is drawn from it.
6. **C2 does not pay for its May gain at by-elections:** 793 of 1,190 by-elections against C0's 779, share error 7.29 against 7.38. C1 left every by-election forecast unchanged, as designed.

Under the rule fixed in advance, C2 passes. Since nearly all of its margin is in 2025 and 2026, on which the idea was formed and which have been scored many times, it is a candidate to carry into a sealed test at May 2027, not a settled finding.

## The run

- **Fit:** 91 cuts (six scheduled days and 85 by-election months), 477 lane jobs, C0 and C2 fitted in each, eight at a time. Fitting took 437 seconds; the whole script 7 minutes 21 seconds on this Mac. Scoring ran once.
- **Nothing failed in either run and nothing was changed after the specification was committed.**
- **Fixed before any forecast, and in the specification:** anchors for 4 July 2024 to 30 April 2025 were rebuilt from polls. The stage B dataset had July to December 2024 on the July 2024 general election result and January to mid April 2025 blank, because the repo held no polls for that window. A new extract from the same Wikipedia revision as the committed 2025 to 2026 file (which the repo's extractor reproduces byte for byte) gave 147 polls; 246 of 257 rows are now anchored on polls. File names use `bridge_level_` because `BRIDGE_SPEC.md` and `bridge_*.py` already belong to the earlier ward code bridge study.
- **Unforecastable rows:** May 2021, 149 wards where Reform UK stood, for every arm (Reform UK had too few earlier anchored rows to fit). By-elections: 32 without anchor, 5 with a standing lane lacking a model, of 1,190.
- **C0 reproduces stage B's S1c** exactly for 2019 to 2023 (1,362, 1,697, 2,139, 1,445), as it should: only rows from July 2024 changed.

## The diagnosis, rechecked

The figures in the brief reproduce from `cache/dataset.pkl`, but two do not mean what they seemed to (details in the specification):

- 109 of the 112 anchored "first half of 2025" by-elections are dated 1 May 2025 or later. Before polling day only 3 by-elections in 2025 had an anchor.
- July to December 2024 by-elections were anchored on the general election result. Against poll anchors, Reform UK's raw by-election offset before May 2025 was negative (minus 0.28 for July to December 2024, minus 0.33 for January to April 2025), not plus 0.08.

The model residual is a different thing, and it did point the right way: the C0 model's own by-election forecasts for Reform UK sat lower still, so its weighted mean residual over the 111 by-elections before May 2025 was plus 0.139 (logit), against plus 0.482 at May 2025 (table under question c).

## Question (a): each arm against C0

Leaders called; every arm forecasts the same rows.

| Year | Wards | C0 | C1 | C2 | C3 |
|---|---|---|---|---|---|
| 2019 | 1,678 | 1,362 | 1,361 | 1,375 | 1,377 |
| 2021 | 2,255 | 1,697 | 1,697 | 1,702 | 1,702 |
| 2022 | 2,533 | 2,139 | 2,133 | 2,136 | 2,128 |
| 2023 | 1,734 | 1,445 | 1,433 | 1,445 | 1,427 |
| 2025 | 1,399 | 607 | 643 | 694 | 705 |
| 2026 | 2,576 | 1,702 | 1,756 | 1,794 | 1,829 |
| Pooled | 12,175 | 8,952 | 9,023 | 9,146 | 9,168 |

Share error (points):

| Year | C0 | C1 | C2 | C3 |
|---|---|---|---|---|
| 2019 | 6.27 | 6.35 | 6.18 | 6.24 |
| 2021 | 6.11 | 6.11 | 6.17 | 6.17 |
| 2022 | 5.81 | 5.89 | 5.70 | 5.93 |
| 2023 | 5.34 | 5.53 | 5.43 | 5.65 |
| 2025 | 9.40 | 8.83 | 8.39 | 8.06 |
| 2026 | 5.68 | 5.48 | 5.38 | 5.23 |
| Pooled | 6.31 | 6.24 | 6.09 | 6.08 |

| Rule part | C1 | C2 | C3 |
|---|---|---|---|
| 1. Pooled: more leaders than C0 | Yes (+71) | Yes (+194) | Yes (+216) |
| 2. Pooled: share error no higher | Yes | Yes | Yes |
| 3. At least as many leaders in four of six years | No (2021, 2025, 2026) | Yes (all but 2022) | Yes (2019, 2021, 2025, 2026) |
| 4. No year worse by more than 1% of wards | Yes | Yes | No (2023, minus 18 against a limit of 17.3) |
| **Supported** | **No** | **Yes** | **No** |

In 2021 C1 and C3 add nothing to C0 and C2: no anchored by-election fell between 7 May 2020 and 6 May 2021, as the specification expected.

## Question (b): May 2025

| Arm | Leaders, of 1,399 | Reform UK signed bias (pp) | Reform UK called first | Reform UK led |
|---|---|---|---|---|
| C0 | 607 | minus 7.81 | 270 | 551 |
| C1 | 643 | minus 5.88 | 357 | 551 |
| C2 | 694 | minus 4.51 | 445 | 551 |
| C3 | 705 | minus 3.17 | 492 | 551 |

For scale, the rolling test's full model S1 called 517 (`TWO_LAYER_RESULTS.md`; different inputs and a 2024 anchor on the general election result, so not a like for like benchmark). Every arm still overcalls the Conservatives in 2025 (C0 535 called first against 278 led; C3 441).

## Question (c): does the by-election level point the right way?

Each cell: C0's weighted mean by-election residual over the window before that May (logit, before shrinkage), with the number of by-elections; then C0's mean residual at that May, with the number of wards; then the verdict. "None" marks no by-election evidence; in 2019 and 2021 Reform UK stood in no anchored contest before May (in 2021 it stood in May, but its wards could not be forecast).

| Lane | 2019 | 2021 | 2022 | 2023 | 2025 | 2026 |
|---|---|---|---|---|---|---|
| Reform UK | none stood | none | minus 0.12 (3); minus 0.18 (97); same | minus 0.74 (5); minus 0.46 (190); same | plus 0.14 (111); plus 0.48 (1,393); same | plus 0.07 (213); plus 0.12 (2,569); same |
| Labour | minus 0.09 (56); plus 0.23 (1,613); opposite | none; minus 0.23 (2,070) | minus 0.41 (57); minus 0.11 (2,414); same | minus 0.18 (65); minus 0.02 (1,673); same | minus 0.02 (236); plus 0.16 (1,318); opposite | minus 0.14 (193); plus 0.10 (2,469); opposite |
| Conservative | plus 0.03 (57); plus 0.20 (1,668); same | none; plus 0.18 (2,096) | minus 0.08 (61); minus 0.03 (2,482); same | plus 0.22 (64); minus 0.10 (1,707); opposite | plus 0.03 (244); minus 0.13 (1,395); opposite | minus 0.10 (213); minus 0.06 (2,508); same |
| Liberal Democrats | plus 0.17 (45); plus 0.20 (1,220); same | none; plus 0.07 (1,703) | plus 0.17 (52); minus 0.17 (1,902); opposite | plus 0.01 (52); minus 0.04 (1,357); opposite | minus 0.13 (228); minus 0.61 (1,273); same | minus 0.18 (191); minus 0.32 (2,200); same |
| Green Party | minus 0.16 (31); plus 0.58 (1,007); opposite | none; minus 0.19 (1,426) | minus 0.22 (37); minus 0.52 (1,585); same | minus 0.11 (42); minus 0.04 (1,221); same | minus 0.30 (198); minus 0.64 (1,102); same | minus 0.08 (172); minus 0.26 (2,471); same |
| Others | plus 0.14 (36); plus 0.33 (929); same | none; plus 0.05 (928) | minus 0.12 (28); plus 0.01 (900); opposite | plus 0.26 (40); plus 0.22 (710); same | plus 0.30 (131); plus 0.19 (584); same | minus 0.24 (116); minus 0.47 (1,049); same |

| Lane | Same sign | Opposite | No by-election evidence |
|---|---|---|---|
| Reform UK | 4 | 0 | 2 |
| Labour | 2 | 3 | 1 |
| Conservative | 3 | 2 | 1 |
| Liberal Democrats | 3 | 2 | 1 |
| Green Party | 4 | 1 | 1 |
| Others | 4 | 1 | 1 |
| All | 20 | 9 | 7 |

Where the sign agreed, the May error was usually larger than the by-election level, so a shrunk level corrects part of the error at most. The Reform UK cells in 2022 and 2023 rest on 3 and 5 by-elections. Labour's level was wrong in sign in three of five years. This is why C1 helps in 2025 and 2026 and hurts slightly in 2019, 2022 and 2023.

## Question (d): by-elections

C1 changed no by-election forecast (0 differing in every set). C2 against C0, leaders called and share error:

| Set | Contests (forecast) | C0 | C2 | C0 share error | C2 share error |
|---|---|---|---|---|---|
| Window before May 2019 | 61 (57) | 42 | 44 | 6.30 | 6.27 |
| Window before May 2021 | 0 | | | | |
| Window before May 2022 | 61 (61) | 49 | 49 | 7.51 | 7.29 |
| Window before May 2023 | 67 (67) | 53 | 52 | 6.84 | 6.96 |
| Window before May 2025 | 267 (256) | 159 | 160 | 8.47 | 8.30 |
| Window before May 2026 | 217 (217) | 135 | 139 | 7.04 | 6.94 |
| Outside the windows | 517 (495) | 341 | 349 | 7.14 | 7.09 |
| All, May 2018 to November 2026 | 1,190 (1,153) | 779 | 793 | 7.38 | 7.29 |

## What this means for 2027

1. **Standing rates are worth carrying forward as inputs,** and cheap: they come from statements of persons nominated, published weeks before polling day. Their evidence is almost all from the two Mays where the field changed most (Reform UK from 17% of wards in May 2024 to over 99% in 2025). Over 2019 to 2023, when fields barely changed, they did roughly nothing.
2. **The by-election level is not supported as a correction,** for every lane under one rule. It helped in both cycles with a large national shift and slightly hurt in the three quiet ones.
3. **Test both again sealed at May 2027** before either goes near a published forecast: C2 as the candidate, C0 as the benchmark, C3 reported.

## Limits

- **May 2026 has been scored by many earlier versions, and the diagnosis behind this study was made on May 2025.** Neither year is a clean hold out for the idea, only for the fixed numbers. Most of C2's margin is in those two years.
- **Standing data is taken from results files,** which is what a forecaster would have had from statements of persons nominated, less withdrawals and candidates recorded nowhere.
- **Standing rates are over the wards in this dataset,** England only and only contests with a code in the Drive feature file. On a by-election day the national rate is over a handful of contests.
- **The previous scheduled rate is known for only 178 of the 1,504 May 2025 test rows,** because most county divisions were redrawn and carry new codes.
- **Settings in `fit_meta.pkl` were chosen on contests up to April 2026,** with the six future inputs present, and were not reselected for C2.
- **Polls for July to September 2024 are thin** on the revision used (16 polls), so 11 rows stay unanchored and three dates use the 21 day window.
- **Features are fixed in time** (2021 Census, 2019 deprivation index). **The ward model alone,** not the blend with the candidate engine.
