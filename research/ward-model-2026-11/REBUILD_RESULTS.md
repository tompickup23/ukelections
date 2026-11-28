# Checked rebuild of the research inputs, and the six-election baseline on corrected polls: results

28 November 2026. **Research only**; nothing on the site, the engine or the published forecast reads anything here. Specification: `REBUILD_SPEC.md`, committed before any build (`8ccb8d1`), with its amendment of 28 November committed before any corrected build, fit or score (`02ddc83`). The builds were committed, with every check passing, before either fit (`62c23d4`). Each corrected configuration was built once, fitted once and scored once. Nothing was changed after a score was seen.

Every figure below comes from three files: `results/bridge_level_summary.json` (old inputs, PR 197, committed 27 Nov), `results/rebuild_bridge_level_summary_pr199.json` and `results/rebuild_bridge_level_summary_corrected.json`. Anchors and blank dates come from `results/rebuild_manifest_<old|pr199|corrected>.json`. "Leaders" means wards (scheduled days) or contests (by-elections) whose first-placed party was called correctly, out of every ward in the dataset on that day. Share error is the mean absolute error, in percentage points, over the lanes with a forecast or an actual share.

The three columns are:

- **Old**: the inputs PR 197 used. Run 1 rebuilt them with nil difference from the PR 197 cache, so they were not refitted.
- **PR 199 only**: the corrected 13 Dec 2019 to 3 Jul 2024 extract (PR 199, commit `ef8f046`), with the bridge file as committed.
- **Both**: the PR 199 extract, plus the 11 sub-national polls removed from the bridge file (amendment rules 1 to 3).

## Verdict

1. **The 69.6% figure moves.** C2 (standing rates as inputs) called 1,794 of 2,576 May 2026 wards (69.6%) on the old inputs. With both corrections it calls **1,764 of 2,576 (68.5%)**, and share error rises from 5.38 to 5.48 points. Both changes are past the movement thresholds fixed in advance (more than 10 wards; more than 0.05 points). Quote 68.5% from now on, and only as a back-test on ground that has been scored many times.
2. **The 70.4% figure is not produced by this pipeline.** No committed results file on any research branch holds it. The nearest figure here is C3 at May 2026: 1,829 of 2,576 (71.0%) old, 1,824 (70.8%) corrected. Whoever quotes 70.4% must first find the file it comes from and check whether that file read the old anchors. Until then, treat it as unsupported.
3. **C2's pooled six-election result barely moves**: 9,146 to 9,135 of 12,175 wards (75.1% to 75.0%), with share error 6.09 to 6.08. C0 moves 8,952 to 8,939, and its share error goes from 6.31 to 6.32.
4. **PR 197's conclusion on C2 stands, and its conclusions on C1 and C3 fall.**
   - C2 still meets all four rules: pooled more leaders; pooled error no higher; at least as many leaders in five of six years (now 2019, 2021, 2022, 2025 and 2026); no year worse by more than 1%.
   - C1 (the by-election level) and C3 (both together) were "not supported" in PR 197. On both sets of corrected inputs they now meet all four rules. C1 calls at least as many leaders as C0 in four years, 2022 now among them. C3's 2023 shortfall shrinks from 18 to 16 wards, which is inside the 17.3-ward limit.
   - These flips rest on margins of one or two wards in a single year. Read them as fragile, not as findings.
5. **The model is sensitive to small input changes.** The PR 199 only and Both configurations differ only in 79 by-election anchors from July to December 2024; no May ward's anchor is touched. Yet C2 at May 2025 calls 647 leaders under one and 703 under the other. A 56-ward swing from that much input change says the May 2025 and 2026 margins carry noise of tens of wards. That is a reason to keep the sealed test at May 2027 as the real decision.
6. **By the rule fixed in advance, the headlines moved, so every earlier result built on the old extract needs a rerun.** That means PRs 191, 193, 197, 202 and 203; none is rerun here. The specific findings for each are under "What this means for earlier PRs" below.

## The three-way table

### May elections, leaders called (share error in brackets)

| Year | Wards | C0 old | C0 PR 199 only | C0 both | C2 old | C2 PR 199 only | C2 both |
|---|---|---|---|---|---|---|---|
| 2019 | 1,678 | 1,362 (6.27) | 1,362 (6.27) | 1,362 (6.27) | 1,375 (6.18) | 1,375 (6.18) | 1,375 (6.18) |
| 2021 | 2,255 | 1,697 (6.11) | 1,696 (6.09) | 1,696 (6.09) | 1,702 (6.17) | 1,713 (6.04) | 1,713 (6.04) |
| 2022 | 2,533 | 2,139 (5.81) | 2,135 (5.81) | 2,135 (5.81) | 2,136 (5.70) | 2,138 (5.70) | 2,138 (5.70) |
| 2023 | 1,734 | 1,445 (5.34) | 1,444 (5.37) | 1,444 (5.37) | 1,445 (5.43) | 1,442 (5.43) | 1,442 (5.43) |
| 2025 | 1,399 | 607 (9.40) | 599 (9.52) | 598 (9.47) | 694 (8.39) | 647 (8.48) | 703 (8.30) |
| 2026 | 2,576 | 1,702 (5.68) | 1,694 (5.67) | 1,704 (5.66) | 1,794 (5.38) | 1,776 (5.41) | 1,764 (5.48) |
| Pooled | 12,175 | 8,952 (6.31) | 8,930 (6.33) | 8,939 (6.32) | 9,146 (6.09) | 9,091 (6.09) | 9,135 (6.08) |

### The same as percentages of wards

| Year | C0 old | C0 PR 199 only | C0 both | C2 old | C2 PR 199 only | C2 both |
|---|---|---|---|---|---|---|
| 2019 | 81.2% | 81.2% | 81.2% | 81.9% | 81.9% | 81.9% |
| 2021 | 75.3% | 75.2% | 75.2% | 75.5% | 76.0% | 76.0% |
| 2022 | 84.4% | 84.3% | 84.3% | 84.3% | 84.4% | 84.4% |
| 2023 | 83.3% | 83.3% | 83.3% | 83.3% | 83.2% | 83.2% |
| 2025 | 43.4% | 42.8% | 42.7% | 49.6% | 46.2% | 50.2% |
| 2026 | 66.1% | 65.8% | 66.1% | 69.6% | 68.9% | 68.5% |
| Pooled | 73.5% | 73.3% | 73.4% | 75.1% | 74.7% | 75.0% |

May 2021 has 149 wards that no arm can forecast, in all three columns, because Reform UK stood there and its lane had too few earlier anchored rows to fit. They count as misses. Every other May ward is forecast in every column.

### C1 and C3 (produced by the same script; this rerun is about C0 and C2)

| Year | C1 old | C1 PR 199 only | C1 both | C3 old | C3 PR 199 only | C3 both |
|---|---|---|---|---|---|---|
| 2019 | 1,361 | 1,361 | 1,361 | 1,377 | 1,377 | 1,377 |
| 2021 | 1,697 | 1,696 | 1,696 | 1,702 | 1,713 | 1,713 |
| 2022 | 2,133 | 2,136 | 2,136 | 2,128 | 2,123 | 2,123 |
| 2023 | 1,433 | 1,435 | 1,435 | 1,427 | 1,428 | 1,428 |
| 2025 | 643 | 614 | 614 | 705 | 698 | 711 |
| 2026 | 1,756 | 1,759 | 1,760 | 1,829 | 1,827 | 1,824 |
| Pooled | 9,023 (6.24) | 9,001 (6.25) | 9,002 (6.24) | 9,168 (6.08) | 9,166 (6.08) | 9,176 (6.07) |

### PR 197's four rules, each arm against C0

| Arm | Old | PR 199 only | Both |
|---|---|---|---|
| C1 | not supported (three of six years) | supported | supported |
| C2 | supported | supported | supported |
| C3 | not supported (2023 worse by 18 wards, limit 17.3) | supported | supported (2023 worse by 16) |

### By-elections, May 2018 to November 2026 (1,190 contests)

| | Old | PR 199 only | Both |
|---|---|---|---|
| Forecastable | 1,153 | 1,167 | 1,149 |
| No anchor | 32 | 18 | 36 |
| Standing lane without a model | 5 | 5 | 5 |
| C0 leaders | 779 (65.5%), share error 7.38 | 787 (66.1%), 7.37 | 781 (65.6%), 7.37 |
| C2 leaders | 793 (66.6%), share error 7.29 | 805 (67.6%), 7.29 | 786 (66.1%), 7.26 |

By-election percentages are of all 1,190 contests. C1 forecasts are identical to C0's at by-elections, by design, and C3's are identical to C2's.

## What changed in the inputs

### The area check, every polling file

| File | Polls | GB | UK | No area |
|---|---|---|---|---|
| PR 192, 8 Jun to 31 Dec 2017 | 60 | 51 | 9 | 0 |
| PR 192, 1 Jan 2018 to 2 May 2019 | 207 | 186 | 21 | 0 |
| PR 192, 3 May to 12 Dec 2019 | 189 | 175 | 14 | 0 |
| Old extract, 13 Dec 2019 to 4 Jul 2024 | 996 | 608 | 388 | 0 |
| PR 199 extract, 13 Dec 2019 to 3 Jul 2024 | 1,496 | 1,082 | 414 | 0 |
| Bridge file, 5 Jul 2024 to 14 Apr 2025 | 147 | 108 | 28 | **11** |
| 2025 to 2026 file | 290 | 263 | 27 | 0 |
| `data/polling/timeseries.json` (2026) | 269 | no area field | | |

- **The only sub-national polls in any file are the 11 in the bridge file.** That is 6 Welsh and 5 London, listed in the amendment. The hand-over note's "7 Welsh, 4 London" was a miscount.
- **`timeseries.json` cannot be checked by area.** Applying the P3 test instead (Plaid Cymru above 3%, SNP above 8%), none of its 269 polls is flagged.
- **UK-sample polls stay pooled, as the specification says.** After duplicates and multi-row poll rows are dropped, stage B loads 458 UK samples among 1,938 polls in both corrected builds.

### Anchors

- **Scheduled days.** The six May anchors are unchanged in all three builds, except May 2023. There the PR 199 extract finds 14 polls in the 14-day window against 10. Labour moves from 43.8 to 43.6, Conservative from 29.1 to 28.6 and Reform UK from 5.4 to 5.7. The sub-national exclusion touches no scheduled day.
- **PR 199 extract (old to PR 199 only).** Anchors change on 3,903 rows across 73 contest dates: all 1,820 May 2023 wards, 2,075 rows in 2024 and 8 in 2020. It anchors 14 by-election rows on 8 dates that were blank before (2020, August 2023, April 2024), and blanks none.
- **Sub-national exclusion (PR 199 only to both).** Anchors change on 79 by-election contests across 14 dates from July to December 2024. 18 of them, on 3 dates, go blank: 12 Sep 2024 (9 contests), 16 Sep 2024 (1) and 19 Sep 2024 (8). Each now has only 2 polls in the 21-day window. On the 11 dates still anchored, Reform UK's anchor falls on 9 dates, by up to 1.5 points (3 Oct 2024: 19.7 to 18.2), and rises on one (21 Nov 2024: 18.0 to 18.7). Labour's rises by up to 3.3 points (24 Sep 2024: 27.8 to 31.0), because the Welsh polls carried a high Reform UK share and a low Labour share; it falls on three dates in November, where the London polls had a high Labour share (14 Nov 2024: 30.0 to 28.2).

### Blank contest dates

| | Old | PR 199 only | Both |
|---|---|---|---|
| Dates without an anchor | 20 | 12 | 15 |
| Rows without an anchor | 2,303 | 2,289 | 2,307 |

In every build, 2,268 of those rows are the May 2016 and May 2017 elections, which fall before the poll series starts. No date was filled; check P1 confirms that every anchored date rests on at least three polls for every lane it anchors.

### Checks

Every check in the specification passed on both corrected builds: I1, I2, P1 to P6, R1, R2 (only anchor columns change), S1, S2 and S3. Two failures on the PR 199 only build were expected under the amendment, and both are confined to the bridge file: P3 (the 6 Welsh polls' Plaid Cymru shares) and P6 (11 polls with no area, reported but not removed in that mode). After the code change for the amendment, run 1 still reproduces the PR 197 cache with nil difference.

## What this means for earlier PRs

Under the specification's rule, a headline that moves names every earlier result built on the old extract as needing a rerun. The headline did move: C2 at May 2026 by 30 wards and 0.10 points, C2 pooled by 11 wards, C0 pooled by 13 wards. None of these PRs is rerun here.

- **PR 191 (back-test stage A)** read the old extract, with its Brexit Party column filed under Plaid Cymru. It needs a rerun.
- **PR 193 (back-test stage B).** C0 here reproduces its S1c model. For 2019 to 2023 it moves by at most 4 wards a year (1,362, 1,696, 2,135 and 1,444 against 1,362, 1,697, 2,139 and 1,445), and its share error by at most 0.03 points. Both are inside the thresholds, so its 2019 to 2023 figures look likely to stand. Its comparisons with W365 and the logit swing were not rerun, so they are not confirmed.
- **PR 197 (by-election level and standing rates).** The C2 conclusion stands. C1 and C3 flip from not supported to supported, on margins of one or two wards. Its point that nearly all of C2's margin comes from 2025 and 2026 still holds: corrected, 165 of C2's 196 extra wards come from those two years.
- **PR 202 (local strength inputs)** and **PR 203 (seat totals)** were built on the PR 197 dataset. They need a rerun. On the size of the movement seen here, a failed test is unlikely to pass, but that is not established until they are rerun.

## What remains provisional

- **Any figure scored on May 2025 or May 2026.** Those elections shaped the ideas being tested and have been scored many times. The sealed test at May 2027 is the real one.
- **The 70.4% blend figure,** until its source file is found and checked.
- **A GB-only rerun.** It was not done, and was not part of this pass. It needs its own pre-registered amendment, and first an area field in `data/polling/timeseries.json`, which has none.
- **The reruns of PRs 191, 193, 197, 202 and 203 named above.**

## The run

- **Builds:** `uv run python rebuild.py --polls pr199` and `--polls corrected`, about 35 seconds each. Logs are in `cache/rebuild_<mode>.log`.
- **Fits and scores:** `uv run python rebuild_fit_score.py --polls pr199`, then `--polls corrected`. Each covers 91 cuts; the fits had 491 and 490 lane jobs and took 663 and 448 seconds. Logs are in `cache/fit_<mode>.log`.
- **Unchanged:** the model, its settings (`fit_meta.pkl`, sha256 `936d07ee...c67ad`), the seed, the cuts, the test sets and the scoring script.
