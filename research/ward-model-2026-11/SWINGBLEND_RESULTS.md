# A fixed blend of the ward model (C2) with the swing from last time: results

28 November 2026. **Research only**; nothing on the site, the engine or the published forecast reads anything here. Specification: `SWINGBLEND_SPEC.md`, committed before any blend or benchmark forecast was scored (`df3e064`). The scorer was committed before its one run (`swingblend_score.py`). One run, no rerun, nothing changed after a score was seen. No model was refitted: C2's cached forecasts on the corrected inputs were used as written.

Every figure below comes from `results/swingblend_summary.json`, written by `swingblend_score.py`. "Leaders" means wards (May) or contests (by-elections) whose first-placed lane was called first, out of every row in the set; a row an arm cannot forecast counts as a miss. Share error is the mean absolute error, in percentage points, over lanes with a forecast or an actual share.

## Verdict

1. **The named blend, M50, is supported: it meets all six rules fixed in advance.** Pooled over the six Mays it calls 9,169 of 12,175 leaders against C2's 9,135, with share error 5.95 against 6.08. It calls at least as many leaders as C2 in four of six years (2019, 2021, 2022, 2025), no year is worse by more than 1% of its wards, it calls 788 of 1,190 by-elections against 786 with share error 7.25 against 7.26, and without May 2026 it still gains (7,423 against 7,371 of 9,599; 6.06 against 6.29).
2. **The support is narrow, and a later session should read it that way.** Rule 3 holds with exactly four years, one of them May 2025 by a single ward. The by-election gain is 2 contests and 0.01 points. `REBUILD_RESULTS.md` showed C2's May 2025 count moving by 56 wards on a small input change, so a pooled margin of 34 wards is inside the noise that study found.
3. **The gain comes from 2019 to 2022, and May 2026 goes the wrong way.** M50 calls 14, 13 and 27 more leaders than C2 in 2019, 2021 and 2022, and 3 and 18 fewer in 2023 and 2026. At May 2026 it makes C2's known fault worse, not better: Reform UK called first 641 to 624 and Labour 360 to 344 (they led 858 and 447), Liberal Democrats 532 to 550 and Greens 379 to 402 (they led 445 and 295).
4. **Neither secondary weight passes.** M25 fails rules 4 and 5 (May 2026 worse by 33 wards, beyond the 25.8 limit; by-elections 785 and 7.31). M75 fails rule 3 (at least as many leaders in only three years). As the specification says, neither would be adoptable even if it had passed.
5. **The benchmark alone (B2, stage B definition) is far behind on the six Mays,** 7,099 leaders on the 9,188 rows it covers, because under that definition a lane that did not stand last time starts from 0.3%. That sinks Reform UK in 2025 and 2026 (B2 calls it first in 96 wards; it led 1,409). On the five Mays without 2026, on the rows both cover, B2 beats C2 (5,740 against 5,692 of 6,676), which agrees with stage B; M50 edges B2 there (5,744).

**The rule a later session should adopt, if it adopts this one.** For each ward with a C2 forecast `m`: if the ward has a previous contest under the same GSS code, an anchor at that contest and an anchor now, split the lanes standing now into old lanes (votes last time) and new lanes (none). For each old lane take `r = expit(logit(previous share) + logit(anchor now) minus logit(anchor then))` (change zero where either anchor is missing for that lane), scale the `r` so they sum to the model's total share for the old lanes, and set `z = 0.5 × logit(m) + 0.5 × logit(scaled r)`; for new lanes `z = logit(m)`; shares are `expit(z)` renormalised over the lanes standing. Everywhere else the forecast is C2 alone. Shares are floored at 0.3% before any logit. The code is `swingblend_score.blend` with `w = 0.5`.

**What this does not license.** It does not say the blend fixes May 2026's party mix; it does the opposite. Given the margins, it should go into the May 2027 sealed test as a named arm beside C2, not replace C2 on the strength of these figures.

## The rules, M50 against C2

| Rule | C2 | M50 | Holds |
|---|---|---|---|
| 1. Pooled six Mays, more leaders | 9,135 | 9,169 | Yes |
| 2. Pooled six Mays, share error no higher | 6.08 | 5.95 | Yes |
| 3. At least as many leaders in four of six years | | 2019, 2021, 2022, 2025 | Yes (exactly four) |
| 4. No year worse by more than 1% of its wards | | worst 2026, minus 18 of 2,576 (limit 25.8) | Yes |
| 5. By-elections, leaders at least as many and error no higher | 786, 7.26 | 788, 7.25 | Yes |
| 6. Five Mays without 2026, rules 1 and 2 | 7,371, 6.29 | 7,423, 6.06 | Yes |

Secondary arms against C2: M25 9,153 pooled (6.01), years at least as many 2019, 2021, 2022, 2023, 2025, May 2026 minus 33, by-elections 785 (7.31): fails rules 4 and 5. M75 9,163 (5.97), years 2019, 2021, 2022 only, by-elections 788 (7.23): fails rule 3.

## Every arm, every set

Leaders called (share error in points). B2 forecasts fewer rows; the number it forecasts is in brackets after its count.

| Set | Rows | C2 | M25 | M50 | M75 | M00 | B2 |
|---|---|---|---|---|---|---|---|
| May 2019 | 1,678 | 1,375 (6.18) | 1,383 (6.01) | 1,389 (5.94) | 1,388 (5.99) | 1,375 (6.20) | 1,163 [1,339] (6.67) |
| May 2021 | 2,255 | 1,713 (6.04) | 1,726 (5.89) | 1,726 (5.85) | 1,720 (5.90) | 1,735 (6.03) | 1,274 [1,508] (5.98) |
| May 2022 | 2,533 | 2,138 (5.70) | 2,164 (5.20) | 2,165 (5.27) | 2,152 (5.44) | 2,163 (5.24) | 1,908 [2,181] (5.14) |
| May 2023 | 1,734 | 1,442 (5.43) | 1,446 (5.24) | 1,439 (5.22) | 1,438 (5.28) | 1,451 (5.35) | 1,380 [1,607] (5.77) |
| May 2025 | 1,399 | 703 (8.30) | 703 (8.31) | 704 (8.30) | 702 (8.30) | 702 (8.31) | 91 [134] (9.90) |
| May 2026 | 2,576 | 1,764 (5.48) | 1,731 (5.83) | 1,746 (5.63) | 1,763 (5.51) | 1,683 (6.08) | 1,283 [2,419] (11.48) |
| Pooled six | 12,175 | 9,135 (6.08) | 9,153 (6.01) | 9,169 (5.95) | 9,163 (5.97) | 9,109 (6.15) | 7,099 [9,188] (7.70) |
| Pooled five, no 2026 | 9,599 | 7,371 (6.29) | 7,422 (6.07) | 7,423 (6.06) | 7,400 (6.14) | 7,426 (6.17) | 5,816 [6,769] (5.92) |
| By-elections | 1,190 | 786 (7.26) | 785 (7.31) | 788 (7.25) | 788 (7.23) | 785 (7.41) | 558 [747] (8.43) |

C2, M25, M50, M75 and M00 forecast the same rows: every May row except 149 in May 2021 (Reform UK stood and its lane had no model), and 1,149 of 1,190 by-elections. M00 (weight zero on the model where a benchmark exists) is descriptive only.

Common-mapping Brier, pooled six Mays: C2 0.3401, M25 0.3387, M50 0.3361, M75 0.3364, M00 0.3440. By-elections: C2 0.4303, M50 0.4278.

**On the rows B2 forecasts** (leaders, C2 / M50 / B2): 2019 1,163 / 1,177 / 1,163 of 1,339; 2021 1,177 / 1,190 / 1,198 of 1,415; 2022 1,883 / 1,910 / 1,908 of 2,181; 2023 1,372 / 1,369 / 1,380 of 1,607; 2025 97 / 98 / 91 of 134; 2026 1,664 / 1,646 / 1,283 of 2,419; by-elections 575 / 577 / 555 of 744.

## Age of the previous result

Leaders called (share error) for C2, M50 and M00. "Without benchmark" counts rows in the group with a previous contest but no anchor at it or now, where every blend equals C2.

| Set | Group | Rows | Without benchmark | C2 | M50 | M00 |
|---|---|---|---|---|---|---|
| Pooled six | under 4 years | 7,532 | 80 | 6,113 (5.13) | 6,142 (4.93) | 6,097 (5.19) |
| Pooled six | 4 years or more | 2,445 | 709 | 1,826 (6.15) | 1,831 (6.10) | 1,816 (6.31) |
| Pooled six | none | 2,198 | 2,198 | 1,196 (8.96) | 1,196 (8.96) | 1,196 (8.96) |
| Five, no 2026 | under 4 years | 6,097 | 59 | 5,129 (5.11) | 5,172 (4.78) | 5,173 (4.93) |
| Five, no 2026 | 4 years or more | 1,440 | 709 | 1,129 (6.57) | 1,138 (6.42) | 1,140 (6.47) |
| May 2022 | 4 years or more | 620 | 80 | 532 (5.90) | 546 (5.55) | 547 (5.57) |
| May 2023 | 4 years or more | 191 | 0 | 139 (8.35) | 134 (8.40) | 135 (8.71) |
| May 2026 | under 4 years | 1,435 | 21 | 984 (5.19) | 970 (5.43) | 924 (5.99) |
| May 2026 | 4 years or more | 1,005 | 0 | 697 (5.73) | 693 (5.78) | 676 (6.14) |
| By-elections | under 4 years | 771 | 43 | 571 (6.03) | 573 (6.01) | 570 (6.24) |
| By-elections | 4 years or more | 22 | 3 | 19 (4.86) | 19 (4.92) | 19 (5.30) |
| By-elections | none | 397 | 397 | 196 (9.76) | 196 (9.76) | 196 (9.76) |

Every year and group is in the summary file. **No age rule follows from this.** The blend gains most on recent results before 2026, but at May 2026 it loses on recent results too (984 to 970), so age does not separate where it helps from where it hurts; the year does. In May 2021 all 629 older previous results have no anchor (May 2016 and 2017, before the poll series), so the blend never touches them.

## Leaders called first, against leaders won

Called first by C2 / M50 / M00, then won.

| Set | Reform UK | Labour | Conservative | Lib Dem | Green | Others |
|---|---|---|---|---|---|---|
| May 2019 | none stood (lane had no model) | 713 / 745 / 771, 671 | 593 / 549 / 508, 523 | 251 / 250 / 245, 274 | 28 / 30 / 34, 42 | 93 / 104 / 120, 168 |
| May 2021 | 0 / 0 / 0, 0 | 799 / 769 / 719, 702 | 901 / 940 / 1,002, 1,055 | 269 / 264 / 255, 303 | 65 / 60 / 56, 70 | 72 / 73 / 74, 125 |
| May 2022 | 0 / 0 / 0, 0 | 1,309 / 1,335 / 1,344, 1,297 | 720 / 691 / 679, 624 | 366 / 364 / 370, 413 | 67 / 59 / 48, 72 | 71 / 84 / 92, 127 |
| May 2023 | 0 / 0 / 0, 0 | 834 / 857 / 880, 831 | 484 / 477 / 455, 364 | 304 / 290 / 278, 349 | 58 / 55 / 54, 90 | 54 / 55 / 67, 100 |
| May 2025 | 447 / 450 / 450, 551 | 98 / 99 / 100, 77 | 485 / 481 / 478, 278 | 337 / 337 / 339, 340 | 31 / 31 / 31, 71 | 1 / 1 / 1, 82 |
| May 2026 | 641 / 624 / 613, 858 | 360 / 344 / 322, 447 | 411 / 410 / 406, 386 | 532 / 550 / 549, 445 | 379 / 402 / 434, 295 | 253 / 246 / 252, 145 |
| Pooled six | 1,088 / 1,074 / 1,063, 1,409 | 4,113 / 4,149 / 4,136, 4,025 | 3,594 / 3,548 / 3,528, 3,230 | 2,059 / 2,055 / 2,036, 2,124 | 628 / 637 / 657, 640 | 544 / 563 / 606, 747 |
| By-elections | 147 / 153 / 154, 145 | 360 / 361 / 373, 334 | 286 / 284 / 282, 282 | 229 / 228 / 224, 272 | 59 / 50 / 44, 71 | 68 / 73 / 72, 86 |

Before 2026 the blend moves Conservative calls towards the count won in all four years (2019 593 to 549 against 523; 2021 901 to 940 against 1,055; 2022 720 to 691 against 624; 2023 484 to 477 against 364) and lifts Others towards what they won. At May 2026 every one of C2's four known faults grows. A likely reason, not tested here: in May 2026 most previous results are from 2022 or 2024, when Reform UK stood in few wards and the Greens in fewer than now. For the old lanes the benchmark carries that older pattern of Liberal Democrat and Green strength, while the new-lane rule leaves Reform UK at the model's own share, which is already low (C2 signed bias minus 2.79 points).

Signed bias per lane (forecast minus actual, points), May 2026: C2 Reform UK minus 2.79, Labour minus 2.68, Liberal Democrats plus 1.58, Green plus 2.21; M50 minus 3.02, minus 2.96, plus 1.94, plus 2.80. Every set and arm is in the summary file.

## The run

- `uv run python swingblend_score.py`, once. It checked both input hashes, reproduced C2's "Both" figures on all eight sets of `REBUILD_RESULTS.md` before scoring anything else, then scored every arm.
- Before the run, and without scoring, I checked that the blend forecasts exactly C2's 13,175 rows, that weight one returns C2 to rounding (largest difference 2.2e-16), and that weight zero equals B2 on the 5,061 rows with a benchmark and no new lane (largest difference 2.2e-16).
- Nothing failed and nothing was rerun.

## Limits

- **May 2025 and May 2026 have been scored many times.** Rule 6 stops May 2026 deciding alone. Even so, the result rests on 2019 to 2022, which are the years with the most benchmark cover.
- **May 2025 has a benchmark for 134 of 1,399 wards**, so that year says almost nothing about the blend.
- **Margins are small against the input noise** `REBUILD_RESULTS.md` found (tens of wards at May 2025 and 2026).
- **The previous contest can be a by-election**, and "Others" is pooled, so "stood last time" for Others means any independent or minor party.
- **C2 is the ward model alone**, not the blend with the candidate engine. England only, and only contests with a code in the Drive feature file.
- **The polls are those of the corrected rebuild**: GB and UK samples pooled, with sub-national polls excluded.
