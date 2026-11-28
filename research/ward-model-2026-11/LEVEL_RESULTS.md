# Party level correction for the ward model (arm C2): results

28 November 2026. **Research only**; nothing on the site, the engine or the published forecast reads anything here. Diagnosis: `LEVEL_DIAGNOSIS.md` (commit `47d4b01`). Specification: `LEVEL_SPEC.md`, committed before any correction was estimated or scored (`7750c9b`). One run of `level_fit.py` (485 lane jobs, 5 council folds each, 2,181 seconds) and one run of `level_score.py`. Nothing was changed after a score was seen. Before the scored run, `level_score.py --dry` was run with no corrections, so that L1 and L2 equalled C2; it reproduced C2's published figures exactly (9,135 May leaders, share error 6.08; 786 by-election leaders, 7.26) and produced no new score.

Every figure below comes from `results/level_summary.json` unless another file is named. "Leaders" means wards (Mays) or contests (by-elections) whose first placed party was called correctly, out of every row in the set; rows C2 cannot forecast count as misses for every arm. Share error is the mean absolute error, in points, over lanes with a forecast or an actual share.

## Verdict

**Neither correction is supported.** Both fail rule 3 (at least as many leaders as C2 in four of six Mays) and rule 8 (more leaders pooled over the five Mays without 2026). L1 also fails rule 5 (by-election leaders) and L2 fails rule 6 (by-election share error).

- **Every gain is at May 2026, the year that must not decide.** L1 calls 17 more May 2026 leaders than C2 and L2 34 more. Over the other five Mays, L1 calls 5 fewer and L2 10 fewer.
- **The out of fold levels are close to nil.** At almost every cut and lane the level is under 0.05 on the logit scale (`level_fit.py` log in the summary's `corrections_per_cut`). C2 absorbs nearly all of a recent level from the other councils voting on the same day. What is left is too small to move first place except where many wards are close, which was May 2026.
- **The by-election over-call of Reform UK is not fixed.** After 7 May 2026, C2 calls Reform UK first in 30 contests against 22 led; L1 in 32 and L2 in 33.
- **No rule should be adopted from this study.**

## Pass rules against C2

| Rule | L1 | L2 |
|---|---|---|
| 1. Pooled six Mays, more leaders | yes (9,147 against 9,135) | yes (9,159) |
| 2. Pooled six Mays, share error no higher | yes (6.06 against 6.08) | yes (6.04) |
| 3. At least as many leaders in four of six Mays | **no** (2021, 2022, 2026 only) | **no** (2021, 2026 only) |
| 4. No May worse by more than 1% of its wards | yes | yes |
| 5. By-election leaders no fewer (1,190) | **no** (785 against 786) | yes (789) |
| 6. By-election share error no higher | yes (7.26 against 7.26) | **no** (7.28 against 7.26) |
| 7. Seat RMSE five, mean of six Mays, no higher | yes (97.80 against 100.18) | yes (97.38) |
| 8. Pooled five Mays without 2026, more leaders | **no** (7,366 against 7,371) | **no** (7,361) |
| **Supported** | **no** | **no** |

## Leaders called, share error in brackets

| Set | Rows | C2 | L1 | L2 | L1 gained / lost | L2 gained / lost |
|---|---|---|---|---|---|---|
| May 2019 | 1,678 | 1,375 (6.18) | 1,372 (6.19) | 1,373 (6.17) | 6 / 9 | 9 / 11 |
| May 2021 | 2,255 | 1,713 (6.04) | 1,713 (6.04) | 1,713 (6.04) | 0 / 0 | 0 / 0 |
| May 2022 | 2,533 | 2,138 (5.70) | 2,138 (5.71) | 2,136 (5.70) | 7 / 7 | 8 / 10 |
| May 2023 | 1,734 | 1,442 (5.43) | 1,441 (5.43) | 1,439 (5.42) | 5 / 6 | 7 / 10 |
| May 2025 | 1,399 | 703 (8.30) | 702 (8.31) | 700 (8.33) | 4 / 5 | 6 / 9 |
| May 2026 | 2,576 | 1,764 (5.48) | 1,781 (5.39) | 1,798 (5.30) | 35 / 18 | 58 / 24 |
| Six Mays pooled | 12,175 | 9,135 (6.08) | 9,147 (6.06) | 9,159 (6.04) | 57 / 45 | 88 / 64 |
| Five Mays, without 2026 | 9,599 | 7,371 (6.29) | 7,366 (6.30) | 7,361 (6.30) | 22 / 27 | 30 / 40 |
| By-elections, all | 1,190 | 786 (7.26) | 785 (7.26) | 789 (7.28) | 8 / 9 | 13 / 10 |
| By-elections after 7 May 2026 | 107 | 68 (6.66) | 67 (6.65) | 68 (6.63) | 0 / 1 | 2 / 2 |

May 2021 is unchanged by design: no anchored row falls in the 372 days before it (the 2020 elections were postponed), so every lane's window had under 30 rows and got no correction. Per half year by-election figures are in the summary under `byelections_<year>H<n>`; no half year moves by more than two contests.

## By party: signed share error, and called first against led

| Set | Arm | Reform UK | Labour | Conservative | Lib Dem | Green | Others |
|---|---|---|---|---|---|---|---|
| May 2025 | C2 | minus 4.22 (447 / 551) | minus 0.37 (98 / 77) | plus 2.71 (485 / 278) | plus 3.59 (337 / 340) | plus 2.04 (31 / 71) | minus 7.23 (1 / 82) |
| | L1 | minus 4.31 (447 / 551) | minus 0.56 (94 / 77) | plus 2.68 (490 / 278) | plus 3.26 (332 / 340) | plus 2.46 (34 / 71) | minus 6.61 (2 / 82) |
| | L2 | minus 4.29 (444 / 551) | minus 0.58 (97 / 77) | plus 2.76 (496 / 278) | plus 3.27 (325 / 340) | plus 2.51 (34 / 71) | minus 6.92 (3 / 82) |
| May 2026 | C2 | minus 2.79 (641 / 858) | minus 2.68 (360 / 447) | minus 0.03 (411 / 386) | plus 1.58 (532 / 445) | plus 2.21 (379 / 295) | plus 4.69 (253 / 145) |
| | L1 | minus 2.28 (669 / 858) | minus 2.27 (371 / 447) | plus 0.11 (417 / 386) | plus 0.53 (496 / 445) | plus 1.70 (365 / 295) | plus 5.55 (258 / 145) |
| | L2 | minus 2.05 (698 / 858) | minus 2.22 (364 / 447) | plus 0.35 (432 / 386) | plus 0.49 (483 / 445) | plus 1.33 (344 / 295) | plus 5.24 (255 / 145) |
| By-elections after 7 May 2026 | C2 | plus 1.63 (30 / 22) | minus 3.30 (13 / 23) | plus 1.23 (28 / 25) | minus 1.75 (17 / 19) | plus 1.95 (17 / 15) | minus 0.14 (2 / 3) |
| | L1 | plus 1.81 (32 / 22) | minus 3.06 (13 / 23) | plus 1.25 (28 / 25) | minus 1.99 (16 / 19) | plus 1.85 (17 / 15) | minus 0.47 (1 / 3) |
| | L2 | plus 1.78 (33 / 22) | minus 3.15 (11 / 23) | plus 1.33 (30 / 25) | minus 1.92 (15 / 19) | plus 1.85 (17 / 15) | minus 0.54 (1 / 3) |

At May 2026 both corrections move four lanes the right way. The out of fold levels before 7 May 2026 (positive means C2 was low, so the lane is raised) were minus 0.124 logit for the Liberal Democrats and minus 0.055 for the Greens, both lowered, and L2's slope pulled the Greens in further (0.875). Labour's was plus 0.018, the right sign but too small to matter, and Others' plus 0.087 raised a lane that was already high. At May 2025 the windows pointed nowhere useful. At the later by-elections the levels are tiny and Reform UK's over-call grows slightly.

## National seat totals, M0

RMSE five, seats (`SEATS_SPEC.md` method M0 over the scored set in `results/seats_actual_wards.csv`).

| Arm | 2019 | 2021 | 2022 | 2023 | 2025 | 2026 | Mean |
|---|---|---|---|---|---|---|---|
| C2 | 59.4 | 89.5 | 67.6 | 82.4 | 121.6 | 180.6 | 100.18 |
| L1 | 59.5 | 89.5 | 70.3 | 86.9 | 123.6 | 157.0 | 97.80 |
| L2 | 72.2 | 89.5 | 70.0 | 81.4 | 128.5 | 142.7 | 97.38 |

Both means are lower only because of May 2026; each arm is worse than C2 in three or four of the other five Mays. May 2026 M0 seats for Reform UK: C2 883, L1 918, L2 956, against 1,210 won.

## What the diagnosis implies should be tried next

C2 already learns the level of any day it has trained on, so a level taken from inside its training window has almost nothing to add, and a level carried from outside it double counts. Reform UK's shortfall is a spread across wards, so the next test should give the model a way to spread Reform UK, such as a Reform UK lane input interacting the national Reform UK anchor with the ward's previous Reform UK share, inside the fit rather than as a correction after it. Labour's level gap at and after May 2026 shows in no residual available before polling day, so it needs new pre-polling evidence, not another level.

## Limits

- **May 2026 has been scored many times**, and the diagnosis leaned on it. Here it decided nothing, by rule 8.
- The windows pool May and by-election rows.
- The ward model alone, not the blend with the candidate engine.
- Settings in `fit_meta.pkl` were chosen on contests up to April 2026.

## The run

- `uv run python level_fit.py`: 91 cuts, 485 lane jobs, 5 (cut, lane) pairs with a window under 30 rows (the five May 2021 lanes), 2,181 seconds. Output `cache/level/level_corrections.pkl`.
- `uv run python level_score.py`: output `results/level_summary.json`.
- Inputs: the corrected rebuild's cache (`cache/rebuild/corrected/`, from `~/ukelections-research-cache/corrected-2026-11-28/rebuild/corrected/`), unchanged.
