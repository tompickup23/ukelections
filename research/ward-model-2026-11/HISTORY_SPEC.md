# The ward model's dataset extended with the 2027 councils' missing history: specification

Written 28 November 2026, after `HISTORY_GAP.md` and before any extended dataset was built, fitted or scored. **Research only.** Nothing on the site, the engine, the publisher or any published forecast reads this folder. Every new file is prefixed `history_` or `HISTORY_`; no existing script or result is edited.

## Purpose and decision

`HISTORY_GAP.md` found that 1,804 of the 1,861 2027 wards with no history in the dry run (PR 219) would gain a previous result from 2023 ordinary contests missing from the dataset, and that the only local copy of those contests is the pooled shares in the committed baselines file. The coordinating session decided on 28 November 2026 to use that file as the source of the 2023 rows, not to read vps-main, and to leave 2019 out. This study adds those rows (and the other rows below), checks the extended dataset, fits C2 once, scores it once in two ways, and reruns the 2027 dry run only if the first way passes.

## Base and settings, unchanged

- Base: the corrected rebuild (`REBUILD_RESULTS.md`, "Both"). Stage 1 output `cache/rebuild/corrected/dataset.pkl`, sha256 `c2fa5e5272b0fcb68d8679eeb97188e576ea8b791998a2daf072905190f2408b`; final `cache/rebuild/corrected/bridge_level_dataset.pkl`, sha256 `3393cfdba3437f46ad2f2b8485e1621b8a38d4c5605ee33c4c4cd9be38de53a8`. `cache/` is a symlink to `~/ukelections-research-cache/corrected-2026-11-28/`.
- Polling files: exactly the six the corrected build read after its area rule (`results/rebuild_manifest_corrected.json`, `area_check.files_read`), byte for byte.
- Model: C2 of `BRIDGE_LEVEL_SPEC.md`, `HistGradientBoostingRegressor`, seed 20261127, settings `cache/fit_meta.pkl` (sha256 `936d07ee...c67ad`), not reselected; `MIN_ROWS` 50; the six scheduled cuts and the monthly by-election cuts from May 2018 to November 2026; the forecastable-row rule; C2's 18 standing inputs from `bridge_level_fit.standing_inputs`, computed over the extended dataset. `bridge_level_fit.py` and `bridge_level_score.py` are run unchanged, pointed at `cache/history/`, as `rebuild_fit_score.py` points them at a rebuild folder. They also produce C0, C1 and C3; only C2 is judged.

## Source of the added 2023 rows

**`data/identity/wards-2027-baselines.json`, sha256 `414b844f34ca30c592d974342f0a7b9ea58062a3bd0687ce24ce150742399534`** (written by `scripts/build-wards-2027.mjs` on 27 November 2026 from the Democracy Club export `dc-historic-results-2027-955d88d58a38`, which is on vps-main only). The build stops if the hash differs.

**Evidence it is fit for this use** (`results/history_gap.json`, `baselines_reproduce_dataset_targets`): on the 1,607 contests that both the file and the dataset hold (1,294 from May 2026, 313 from the Drive ward results file), the file's pooled shares equal the dataset's targets to within 0.0000012 in every lane, and "pooled share above nil" equals the dataset's standing flag in all 1,607. The file's `dc2027` contests themselves cannot be compared with anything, since none is in the dataset.

## Rows added

### A. 2023 ordinary contests from the baselines file

Every ward record in the file (verified and unverified blocks) with `method` `same_ward`, `baseline.source` `dc2027`, whose `baseline.ballot_paper_id` is not already in the dataset: 2,688 contests (2,686 dated 4 May 2023, one 15 June, one 22 June). Each becomes one row:

| Column | Rule | Same as |
|---|---|---|
| `ballot_paper_id`, `date`, `council` | the baseline's ballot id and date; the record's `council_slug` | matrix rows |
| `gss` | the record's `gss_code` | |
| features (`prepare.FEATURES_NUMERIC`) | the feature file row for `gss` (`universe_features_v2.csv`), by `prepare.fnum` | post-May by-election rows in `prepare.py`. On the 16,537 matrix rows whose code is in the feature file, the matrix's features equal the feature file's in all 44 columns (checked before this specification) |
| `region` | the feature file's `region_name` | post-May by-election rows |
| `is_by`, `source`, `set` | false; `history_baselines_dc2027`; blank | 2023 matrix rows (blank `set`, as every pre-2024 row) |
| `s_*` | lane shares from the record's party labelled `shares` (below) | full slate targets |
| `stood_*` | lane share above nil | candidate standing flags |
| `d`, `region_code`, `n_standing` | as `prepare.py` | |
| anchors, `prev_*` columns | rebuilt by `backtest_b_anchor.main` (stage B rule, 14 day then 21 day, at least 3 polls per lane) | every row before 4 July 2024 |
| ward lags (`prev_rel_*`, `prev_gap_years`, `has_prev`) | recomputed for every row by the lag block of `prepare.main`, copied verbatim into `history_build.py` | every row |

**Left out and counted:** a record whose `gss_code` has no feature file row (7 contests, `HISTORY_GAP.md`); a contest whose shares do not sum to 1 within 0.001.

**Inputs an existing row takes from candidate votes that the pooled shares cannot supply, with the rule used instead (condition 2 of the decision):**

1. **Lane of a joint party description.** Existing Democracy Club rows use the Electoral Commission id (`common.dc_lane`), which puts a joint "Reform UK" description in Reform UK. The file's `pooled` block puts it in Others. Rule: lanes are rebuilt from the file's party labelled `shares`: a label equal to one of the five main lane names goes to that lane; a label containing "Reform UK" goes to Reform UK; a label containing "Labour and Co-operative" goes to Labour (the file has already folded it); every other label goes to Others. Rows affected, counted before this specification: 15 contests carry "Reform Derby and Reform UK". "Reform Derby" on its own (4 contests) is a separate registered party and stays in Others, as `dc_lane` would put it.
2. **Standing with no votes.** A candidate recorded with nil votes stands under `slate_shares` but has no share in the file. Rule: a lane stands if its share is above nil. Rows affected: unknown for the added rows; nil among the 1,607 contests compared.
3. **Uncontested wards.** The file holds no record for them; nor does the dataset (`slate_shares` returns nothing without votes). Nothing to do.

Nothing else a row uses comes from candidate votes: the target, the standing flags, `n_standing`, the lags and the standing inputs derive from lane shares and flags.

### B. The bridged wards' own May 2026 contests not in the dataset

The 97 bridged 2027 wards (`HISTORY_GAP.md`, section 3) whose May 2026 ballot, found by the dry run's join `v2027_forecast.may26_ballot`, is not in the dataset. Each becomes one row dated 7 May 2026 with the ward's 2026 code; targets and standing flags by `v2027_forecast.may26_slate` (the yardstick's pooled `vote_shares`, standing from candidates' `party_canonical`, as `prepare.py` builds May 2026 rows); features by the dry run's bridge rule (`V2027_SPEC.md`: the population weighted mean of the parent wards' feature file values from `cache/v2027/bridge.pkl`, sha256 `7e951349...80c4`; total residents the summed population; region the largest parent's); anchor copied from the dataset's other 7 May 2026 rows (stage 1 anchor, untouched by stages 2 and 3); `source` `history_bridge_may26`; `set` blank. They are May 2026 test rows, scored only in (b). The 6 bridged wards with no May 2026 ballot get no row.

### C. The 35 code reissues

For each 2027 ward whose `same_ward` baseline ballot is in the dataset under a different code (35 wards, `HISTORY_GAP.md`), the dataset row of that ballot (only that row) takes the 2027 code and that code's feature file values and region, because the baseline file places the contest on the 2027 ward and the earlier code is the ward that existed before the council's 2023 (or, for Castle Point, 2024) redraw. Earlier rows under the old code keep it. Applied only if the pairs are one to one; otherwise none is applied and the reason is reported. 28 of these rows are May 2023 test rows and 7 are 2024 training rows; they stay in the original test set with their new inputs.

### Not changed

The 226 bridged wards' May 2026 rows already in the dataset under the pre-2026 code keep that code and those features (they are original May 2026 test rows; correcting them is a separate change). No 2019 contest is added. No row is estimated or filled.

## Checks of the extended dataset (`REBUILD_SPEC.md`, rerun where they apply)

`history_build.py` writes `cache/history/` and `results/history_manifest.json`, and stops naming the failed check.

- **I1, I2.** Every input present; hashes as above; the six polling files equal the corrected build's.
- **H0, reproduction.** The same code run with nothing added reproduces `cache/rebuild/corrected/bridge_level_dataset.pkl` exactly (same rows and order, nil difference in every column). This shows the copied lag block and the two anchor steps are the build that made the base.
- **P1.** Every anchored contest date rests on at least 3 polls carrying every lane it anchors (window counts as `rebuild.window_count`). **P2.** All six scheduled days anchored; dates without an anchor listed. P3 to P6 concern the polling files, which are byte identical to the corrected build's, so they carry over and are not rerun.
- **R1.** Row counts by year and contest type, extended against base: the difference must equal the rows added (A and B), and nothing else.
- **R2.** On every base row, the only columns that may differ are the ward lag columns (`prev_rel_*`, `prev_gap_years`, `has_prev`) and stage B's previous contest columns (`prev_date`, `prev_anchor_kind`, `prev_s_*`, `prev_a_*`), plus, on the 35 rows of C only, `gss`, features, `region` and `region_code`. Anchor columns must be identical. Differences are counted by column.
- **S1.** Lane shares sum to 1 within 0.001 on every row. **S2.** Forward only folds on the six scheduled cuts and every sixth monthly cut. **S3.** Every previous contest is dated before its row.

## Scoring, both ways fixed now

`history_score.py` reads `cache/history/bridge_level_predictions.pkl` (extended C2) and `cache/rebuild/corrected/bridge_level_predictions.pkl` (sha256 `bb7586ce...25d8a`, base C2) and scores both with `score.score_arm`, as `bridge_level_score.py` does. It first checks that base C2 rescored gives the committed figures (pooled six 9,135 leaders, share error 6.08; by-elections 786, 7.26; `results/rebuild_bridge_level_summary_corrected.json`) and stops if not.

### (a) The original rows: the pass rule

The original rows are the base predictions' 12,175 scheduled May wards (2019, 2021, 2022, 2023, 2025, 2026) and 1,190 by-elections (May 2018 to November 2026), by ballot id. Extended C2 against base C2 on exactly those rows. Share error is `share_mae_pp_all_lanes` as `score_arm` reports it (two decimals), as in PR 197. **(a) passes only if all of these hold:**

1. pooled over the six years, extended C2 calls **at least as many** leaders as base C2;
2. pooled, its share error is no higher;
3. it calls at least as many leaders in at least four of the six years;
4. in no year does it call fewer leaders by more than 1% of that year's wards;
5. rules 1 and 2 also hold pooled over the five years without May 2026;
6. by-elections: it calls at least the base's leaders less 1% of 1,190 (that is, at least 775 against 786) and its share error is no higher than 7.26.

### (b) The added test rows: descriptive

The added rows that fall in a test set: the 2,688 (less any left out) dated 4 May 2023 and the 97 dated 7 May 2026, reported separately. For each: rows, rows forecast, C2 leaders called and share error; beside them, on the rows each covers, the benchmarks of `backtest_b_score.benchmarks`: B1 (the previous contest's shares, "same party as last time") and B2 (the previous contest moved by the logit change in the national anchor over the lanes standing now, "swing from last time"), with C2 on the same rows. Most added 2023 rows have no previous contest (2019 is not added), so B1 and B2 cover few of them; that is reported, not filled. Also reported: the 35 rows of C, both arms. Nothing here decides anything.

## The 2027 dry run, only if (a) passes

`history_v2027.py` runs `v2027_forecast.py` and `v2027_aggregate.py` unchanged except that the base dataset is `cache/history/bridge_level_dataset.pkl` (its hash replacing the base's in the hash check) and the outputs go to new files: `data/forecasts/research/wards-2027-dryrun-history.json`, `results/history_v2027_coverage.json`, `results/history_v2027_results.json`. Same run date (28 November 2026), polls file, contest files commit, ward list, standing rule, seed and win chance draws. `HISTORY_RESULTS.md` reports beside PR 219's figures:

- forecast wards with an earlier contest in the training data;
- wards where M50's swing benchmark is available;
- the standing rule's error on May 2026, recomputed on the extended dataset by the rule of `V2027_SPEC.md` (five main lanes everywhere; Others where they stood at the ward's latest earlier scheduled contest; the code is first checked to reproduce PR 219's table on the base: 1,425 of 2,576 wards with the whole slate right). The added May 2026 rows are reported apart so the 2,576 stay comparable;
- national seats by lane under M0, with seats not covered;
- councils callable, and control calls that changed, per arm;
- **Reform UK groups** (PR 220, `SPREAD_DIAGNOSIS.md` and `SPREAD_RESULTS.md`, branch `claude/research-reform-spread-1f459d`): of the 3,696 verified 2027 wards, how many have a previous result in the model's own sense (latest earlier contest with the same code) **with** a Reform UK candidate, **without** one, or **none**, under the base dataset and the extended one, from the dry run's own built frame (`prev_rel_ref` present; `has_prev` 1 and `prev_rel_ref` blank; `has_prev` 0 or no forecast route). PR 220's 1,955 (52.9%) "without" is a projection from the baselines file, not this count, and both are quoted.

The first paragraph of the write up says it is an unpublished dry run and not a prediction. No page reads the new file. If (a) fails, the dry run is not rerun, and the write up says which rule failed and why that is thought to be.

## Run rule

`history_build.py` once (a fault that stops it may be fixed before any fit; reported). The manifest is committed before the fit. `history_fit.py` once (runs the two scripts unchanged on `cache/history/`). `history_score.py` once. Nothing is changed after a score is seen; any rerun is reported with its reason.

## Limits known in advance

- The added 2023 rows come from a derived file, not candidate votes; the agreement check covers other sources' contests, not these.
- The extended model is judged on May 2023 rows whose inputs changed (28 rows of C) and on later rows whose lags changed, which is the point of the change; but May 2023 also gains 2,688 rows of training context for later cuts only, not for itself (they are dated on the cut).
- May 2025 and May 2026 have been scored many times; the sealed test is May 2027.
- No 2019 contests, so 2023 rows mostly have no previous result of their own, and B1 and B2 cover few of them.
