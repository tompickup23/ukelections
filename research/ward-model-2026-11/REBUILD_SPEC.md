# Checked rebuild of the research inputs, and the six-election baseline on corrected polls: specification

Written 27 November 2026, before `rebuild.py` was run and before any rerun score. Research only; nothing on the site, the engine or the published forecast reads anything in this folder.

## Why

Two faults found on 27 November 2026 sit under every six-election figure in this folder:

1. The polling extract for 13 December 2019 to 4 July 2024 (`data/polling/wikipedia/westminster-2019-12-13-to-2024-07-04.json`, stage A, PR 191) kept 996 of 1,510 national rows on its page and filed the 2020 Brexit Party column under Plaid Cymru. PR 199 (branch `claude/data-polls-2024-page-fix-bc1c91`, commit `ef8f046`, not merged) fixes the extractor; its output keeps 1,496 rows from the same page revision.
2. The inputs to the bridge level study (PR 197) are untracked cache files built by four scripts run by hand in a remembered order, copied between worktrees, with no check on any of them.

This study writes down the build, makes it one checked command, proves the command reproduces the cache PR 197 used, and then reruns PR 197's C0 and C2 once on the corrected polls. **The rerun is a correction of inputs, not a new test.** No method, setting, feature, test set or scoring rule changes.

## The build as it stands

Every path below is relative to `research/ward-model-2026-11/` unless it starts `data/`, which is the repo root.

### Source files

| Input | What it is | Source and edition | Where it lives |
|---|---|---|---|
| `cache/drive07/ward_contests_v2.csv` | features for 19,618 contests 2016 to 2026, one row per contest | Drive, `doge:DOGE/Elections & Demographics/07 Models (Reform propensity)/`, file dated 9 Aug 2026; sha256 `23baa080...99f6d` (`fetch_inputs.sh`) | this Mac only (gitignored cache; `fetch_inputs.sh` copies it with rclone) |
| `cache/drive07/universe_features_v2.csv` | the same features for 8,175 areas by GSS code | same Drive folder; sha256 `592a5e96...97404` | this Mac only |
| `data/history/dc-historic-results.json` | Democracy Club candidate votes by ballot, 2016 onwards | built by `scripts/ingest-dc-historic-results.mjs`; the Mac copy is dated 20 Sep 2026, 64,215,517 bytes | gitignored; this Mac only (symlink to the main checkout's copy) |
| `data/results/may-2026/local-and-mayor.merged.json` | May 2026 actuals | tracked | repo |
| `data/transparency/may-2026-postaudit-2026-05-10.json` | the May 2026 yardstick ward list | tracked | repo |
| `data/contests/local-byelections/*.json` | council by-elections after 7 May 2026 | tracked, as at merge base `7d2de83` (PR 180) | repo |
| `data/polling/timeseries.json` | site polling series, 2026 | tracked | repo |
| `data/polling/wikipedia/westminster-2025-04-15-to-2026-04-25.json` | polls 15 Apr 2025 to 25 Apr 2026 | Wikipedia "Opinion polling for the next United Kingdom general election", revision 1383556886 | repo |
| `bridge_level_polls_2024-07-05_to_2025-04-14.json` | polls 5 Jul 2024 to 14 Apr 2025 | same page and revision | this folder (PR 197) |
| `cache/pr192/westminster-2017-06-08-to-2017-12-31.json`, `...-2018-01-01-to-2019-05-02.json`, `...-2019-05-03-to-2019-12-12.json` | polls 8 Jun 2017 to 12 Dec 2019 | Wikipedia "Opinion polling for the 2019 United Kingdom general election", revision 1374586459; PR 192, branch `claude/data-polls-2017-2019-9876e6`, commit `6ad3327` | read with `git show` into the gitignored cache |
| **old**: `data/polling/wikipedia/westminster-2019-12-13-to-2024-07-04.json` | polls 13 Dec 2019 to 4 Jul 2024, 996 rows | Wikipedia "Opinion polling for the 2024 United Kingdom general election", revision 1363820081, stage A extract | repo (this branch) |
| **corrected**: `cache/pr199/westminster-2019-12-13-to-2024-07-03.json` | the same window, 1,496 rows | same page and revision, PR 199 extractor, commit `ef8f046` | read with `git show` into the gitignored cache |
| `cache/fit_meta.pkl` | the frozen per-lane model settings (`best_params`) and out-of-fold residual spreads | written by `fit_predict.py` on 27 Nov 2026 02:04; sha256 `936d07ee...c67ad` | gitignored cache, copied from the research worktree |

### Intermediate files and the order that makes them

1. `prepare.py` reads the first seven rows above (polls only from the 2025 to 2026 Wikipedia file and `timeseries.json`) and writes `cache/dataset.pkl` and `cache/dataset_meta.pkl`: one row per contest, full-slate shares for six lanes, the anchor (14 day poll mean; every 2024 row on the July 2024 general election result), ward lag features.
2. `backtest_b_anchor.py` reads `cache/dataset.pkl`, the three PR 192 files and the 2019 to 2024 extract, and rewrites the anchor of every row dated before 4 July 2024 (14 day window, else 21 day; at least 3 polls carrying each lane; Reform UK lane from the first Brexit Party poll, 23 Feb 2019; GB and UK samples pooled; exact duplicates and multi-row poll rows dropped). Adds each row's previous contest in the same GSS area. Writes `cache/backtest_b_dataset.pkl` and `cache/backtest_b_anchor_report.json`.
3. `bridge_level_anchor.py` reads `cache/backtest_b_dataset.pkl`, the 2019 to 2024 extract, the bridge level extract and the 2025 to 2026 file, and rewrites the anchor of every row dated 4 July 2024 to 30 April 2025 by the same rule. Writes `cache/bridge_level_dataset.pkl` and `cache/bridge_level_anchor_report.json`.
4. `bridge_level_fit.py` reads `cache/bridge_level_dataset.pkl` and `cache/fit_meta.pkl` and writes `cache/bridge_level_predictions.pkl` and `cache/bridge_level_levels.pkl`.
5. `bridge_level_score.py` reads those and writes `results/bridge_level_summary.json`.

The 2019 to 2024 extract enters at steps 2 and 3 only. Ward features never depend on an anchor (`prev_rel_*` are differences from the year's mean share), so changing the extract changes anchors, which rows are anchored (and so which rows train and which are forecastable), and nothing else.

How UK samples are handled, now and in the rerun: steps 2 and 3 pool GB and UK samples without distinction (`backtest_b_anchor.load_polls` keeps every row's area and never filters on it), as `prepare.py` does with the 2025 series. The rebuild keeps that, asserts it (the number of polls loaded equals the number in the files less duplicates and multi-row rows, whatever the area), and reports polls by area.

## What `rebuild.py` does

One command, `uv run python rebuild.py --polls corrected` (or `--polls old`), runs steps 1 to 3 by importing the three scripts and calling them unchanged, with their cache directory pointed at `cache/rebuild/<polls>/` and, for `--polls corrected`, the 2019 to 2024 file in steps 2 and 3 swapped for the PR 199 file. Nothing else in any script is altered. It then runs the checks below, writes `cache/rebuild/<polls>/rebuild_manifest.json`, copies the manifest to `results/rebuild_manifest_<polls>.json`, and exits non-zero with a message naming the failed check if any check fails. With `--polls old --reproduce`, a failure of check P3 (the known Plaid Cymru fault) is recorded as expected and the build continues so that it can be compared with the cache; any other failure still stops it.

`rebuild_fit_score.py` then runs steps 4 and 5 unchanged on `cache/rebuild/corrected/`, writing `results/rebuild_bridge_level_summary.json`, so the committed PR 197 summary is not overwritten.

## Checks, with thresholds fixed now

**I. Inputs.** I1: every source file above is present (the rebuild stops on the first missing one and names it). I2: the two Drive files match the sha256 in `fetch_inputs.sh`; the three PR 192 files and the PR 199 file match their `git show` bytes from the named commits; `fit_meta.pkl` matches `936d07ee...c67ad`. Every input's sha256, size and source is written to the manifest.

**P. Polling.**
- P1, per contest date: polls in the 14 and 21 day windows, polls carrying each lane, the window used, and the anchor per lane, written to `cache/rebuild/<polls>/polls_by_date.csv`. Fails if any anchored date has fewer than 3 polls carrying any lane it anchors (that would be an anchor the rule should not have produced).
- P2, a table of contest dates with no anchor, written to the manifest with the row count on each. Reported, not failed: a date with too few polls has no anchor. Fails only if one of the six scheduled test days (2 May 2019, 6 May 2021, 5 May 2022, 4 May 2023, 1 May 2025, 7 May 2026) has no anchor.
- P3, no party column filed under another party: in every poll file, no Plaid Cymru share above 0.03 (Plaid Cymru's GB or UK share has not reached 3%); in the 2019 to 2024 file, at least 100 polls dated 2020 carry a Brexit Party share, and Deltapoll's poll ending 30 Dec 2020 reads Brexit Party 0.03 and Plaid Cymru 0.00, as the page does. **Expected to fail on the old extract** (2020 Plaid Cymru up to 0.06; no Brexit Party key).
- P4, UK samples: polls loaded equals polls in the files less exact duplicates and multi-row poll rows, so no area is filtered; polls by area reported.
- P5, polls not the general election: every row dated 4 July 2024 to 30 April 2025 has anchor kind `polls_*_bridge_level` or none; none is `ge2024_result`; and no anchored row in that range has an anchor equal (to 4 decimal places in every lane) to the July 2024 GB result.

**R. Rows.** R1: row counts per year and per contest type (scheduled, by-election) in each of the three datasets, against the reference cache (below), with every difference listed. Fails on any difference in rows (which ballots are in the dataset must not depend on polls). R2: in the corrected build, every column other than `anchor_kind`, `a_*`, `prev_anchor_kind` and `prev_a_*` must be identical to the reference; anchor differences are listed by date.

**S. Shares and time.** S1: the six lane shares of every row sum to 1 within 0.001. S2: forward only, on the six scheduled cuts and every sixth monthly by-election cut, rebuilt with the training and test rule of `bridge_level_fit.py`: every training row is dated before the cut, no test ballot is in its own training set, and every test row is dated on or after the cut. S3: every row's previous contest (`prev_date`) is dated before the row.

## Reference: the last build

The cache PR 197 used, copied read only from `research-ward-model-all-party-b40f30/research/ward-model-2026-11/cache/` into `cache/reference/`: `dataset.pkl` (sha256 `c2fa5e52...408b`), `backtest_b_dataset.pkl` (`a000174b...0a81`, identical to the copy under `~/ukelections-research-cache/backtest-2026-11-27/`), `bridge_level_dataset.pkl` (`5c602f69...b2ad6`), and their reports.

## Run 1: reproduce

`rebuild.py --polls old --reproduce`. Pass condition: the three rebuilt datasets equal the reference: same rows in the same order, identical object columns, and the largest absolute difference in every numeric column nil (0.0, NaN in the same places). Any difference is explained before run 2.

## Run 2: corrected polls

`rebuild.py --polls corrected`. Reported: how the anchors move at each of the six May elections and at by-election dates (polls in window, old and corrected, and the anchor per lane), and the anchored row counts by year.

## Run 3: the baseline, once

`rebuild_fit_score.py` on the corrected dataset. **Unchanged:** the model (`HistGradientBoostingRegressor`, seed 20261127), its settings from `fit_meta.pkl` (not reselected), the clean inputs (stage B's S1c) and C2's 18 standing inputs, `MIN_ROWS` 50, the cuts, the test sets (the six scheduled days; by-elections May 2018 to November 2026), the forecastable-row rule, and `bridge_level_score.py`. C1 and C3 are produced by the same script and reported, but this rerun is about C0 and C2.

`REBUILD_RESULTS.md` will give, for C0 and C2, ward leaders called and share error (mean absolute error over all lanes, percentage points) per election and pooled, old (committed `results/bridge_level_summary.json`) against corrected; whether C2 still meets the four rules of PR 197 (pooled more leaders; pooled error no higher; at least as many leaders in four of six years; no year worse by more than 1% of its wards); by-elections likewise.

**What counts as moving.** A headline moves if leaders called change by more than 10 wards in any year or pooled, or share error by more than 0.05 points. Any earlier result built on the old extract (PRs 191, 193, 197, 202, 203) is then named as needing a rerun; none is rerun here.

## Amendment, 28 November 2026 (before any corrected build, fit or score)

Written after run 1 and before run 2. Nothing below has been run when this is committed. It changes the inputs of runs 2 and 3, not the method: the model, its settings, the cuts, the test sets, the forecastable-row rule and the scoring are as above.

**Why.** Check P3 on run 1 also failed on PR 197's `bridge_level_polls_2024-07-05_to_2025-04-14.json`: 11 polls there have no area (`area` null). They are not national samples. Six are Welsh polls (each carries a Plaid Cymru share of 13 to 27%) and five are London polls (Savanta for QMUL or Centre for London). All 11 were pooled into the Great Britain anchor. The hand-over note counted them as seven Welsh and four London; reading the file gives six and five, and the total of 11 is unchanged.

| Fieldwork end | Pollster | Client | Area |
|---|---|---|---|
| 24 Aug 2024 | Survation | YesCymru | Wales |
| 10 Sep 2024 | YouGov | Barn Cymru | Wales |
| 13 Sep 2024 | YouGov | ITV Cymru Wales / Cardiff University | Wales |
| 30 Sep 2024 | More in Common | none given | Wales |
| 4 Nov 2024 | Survation | Reform UK | Wales |
| 10 Dec 2024 | YouGov | Cardiff University | Wales |
| 8 Jul 2024 | Savanta | QMUL | London |
| 7 Nov 2024 | Savanta | Centre for London | London |
| 11 Nov 2024 | Savanta | QMUL | London |
| 21 Dec 2024 | Savanta | QMUL | London |
| 23 Dec 2024 | Savanta | QMUL | London |

**Rule 1. Sub-national polls are excluded from the Great Britain anchor.** The 11 polls above are dropped before any anchor is computed.

**Rule 2. Blank, not filled.** Any contest date whose anchor then rests on fewer than three polls carrying any lane it anchors, in the 14 day window and then the 21 day window, is left blank (no anchor, so the row neither trains nor is forecast). It is not filled from a longer window, a neighbouring date, the July 2024 general election result or any estimate. This is the existing rule, stated again because removing polls can only blank dates, never anchor new ones.

**Rule 3. The area check runs on every polling file the rebuild reads**, not only the bridge file: the three PR 192 files, the 2019 to 2024 extract (old or PR 199), the bridge file and the 2025 to 2026 file. A poll is kept only if its `area` is `GB` or `UK`; every other value, null included, is excluded and listed by file in the manifest (new check P6, which fails if any excluded poll is still loaded). `data/polling/timeseries.json`, which `prepare.py` reads for 2026, has no area field, so it cannot be checked by area; P6 reports that and applies the P3 test to it (no Plaid Cymru share above 0.03, no SNP share above 0.08) as the nearest available check.

**UK samples stay pooled.** The question of taking UK-sample polls out of the Great Britain series (the rule the site uses for its general election series) was raised and not adopted here: the owner's decision for this rebuild names only the sub-national polls, and the specification pools GB and UK samples on purpose. A GB-only rerun would need its own pre-registered amendment, and an area field in `timeseries.json` first.

**Runs.** Two configurations, each built once, fitted once and scored once:

- `rebuild.py --polls pr199`: the PR 199 extract only, the bridge file as committed (the specification's original run 2). P3 is expected to fail on the bridge file alone; any P3 fault in another file still stops the build.
- `rebuild.py --polls corrected`: the PR 199 extract and rules 1 to 3. Every check must pass.

The "old inputs" column of the results is the committed PR 197 summary, `results/bridge_level_summary.json`; run 1 showed the rebuild reproduces its dataset exactly, so it is not refitted. `rebuild_fit_score.py --polls <pr199|corrected>` writes `results/rebuild_bridge_level_summary_<polls>.json`. `REBUILD_RESULTS.md` reports the three side by side, with the contest dates and rows that went blank in each.
