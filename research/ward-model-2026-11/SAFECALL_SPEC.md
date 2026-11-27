# An honest confidence measure and a "safe call" label: specification

Written 27 November 2026, before either test set was scored under this method. Research only. Nothing here is read by the site.

## The question

The published May 2026 ward forecasts carried a confidence label and win probabilities that told readers little. Counts of wards, from the brief for this test: "high" was right in 761 of 1,317 wards (57.8%), "medium" 57.7%, "low" 44.1%; a quoted chance of 90% or better was right in 376 of 475 wards (79.2%). The forecast lead, by contrast, is informative. Can a simple mapping from forecast lead to the probability that the called leader wins, fitted only on forecasts made before May 2026, produce a "safe call" label that is right about as often as it says, near 90%, on contests it has never seen?

## Forecasts used

- **Ward model:** S1, the pooled ward model refitted on each polling day from contests dated before it (`TWO_LAYER_SPEC.md`), columns `s1_*` in `cache/recency_predictions.pkl` (sha256 `84a9a2ed...0f91`). S1 is used, not W365, because W365 was not supported (`RECENCY_RESULTS.md`).
- **Blend, May 2026:** 0.5 times the candidate engine (`cache/arms/candidate-2026-10-24.json`, sha256 `b508238f...8d62fa8`) plus 0.5 times S1, renormalised, built with `blend`, `pooled`, `top` and `BLEND_WEIGHT_MODEL` exactly as `rolling_score.py` does.
- **Blend, by-elections after May 2026:** the candidate engine has no forecast for these. As in `score.py`, the by-election blend is 0.5 times the site's own by-election forecast (`site_forecast`) plus 0.5 times S1. Reported, but it is not the arm the verdict rests on.

Missing lane values count as zero, as in `rolling_score.arm_from`. Shares are over the six pooled lanes (Reform UK, Labour, Conservative, Liberal Democrats, Green Party, Others).

## Definitions

- **Called leader:** the lane with the largest forecast share.
- **Forecast lead:** called leader's forecast share minus the second largest forecast share, in percentage points.
- **Right:** the called leader is the lane with the largest actual full-slate share (`s_*`).
- A contest with no forecast is never labelled safe but stays in the denominator of coverage.

## Training and test data

- **Training (primary):** every forward-only S1 forecast in `cache/recency_predictions.pkl` dated before 7 May 2026: rows with `set == "train"`, which are 525 council by-elections from 23 May 2024 to 23 April 2026 and 1,399 scheduled wards polled on 1 May 2025 (1,924 contests).
- **Test set A, May 2026:** every contest polled on 7 May 2026 (`set == "may26"`): 2,576 scheduled wards and 20 by-elections held that day, 2,596 contests. The model alone is scored on all 2,596; the blend on those of them with a candidate engine forecast. A scheduled-wards-only version (2,576) is reported as a check.
- **Test set B:** the 107 council by-elections after 7 May 2026 (`set == "byelection"`).
- Nothing is fitted, tuned or chosen on either test set.
- **Back-test file (sensitivity only).** `cache/backtest_predictions.pkl` in the `data-wards-2027-baselines-fa98a8` worktree (another session's folder, read only; sha256 `d51d1085...706bebd` at the time of writing) holds forward-only S1 and W365 forecasts for May 2022, May 2023 and by-elections from 2021 to April 2024, with the same columns as this folder's cache. Its rows with an S1 forecast dated before 23 May 2024 (the first date in this folder's training set, so no contest is counted twice) are pooled with the primary training rows to fit a second mapping, reported as a sensitivity check. **It does not set the primary mapping, the thresholds or the verdict.** It is not used as primary because it was produced in another session by a different fit script, and I have not checked that run myself.

## The mapping

- **Primary:** isotonic regression (increasing) of "right" (0 or 1) on forecast lead in points, fitted on the primary training rows, values outside the training range clipped to its ends (scikit-learn `IsotonicRegression`, `out_of_bounds="clip"`). One rule for every party: party does not enter the mapping.
- **Secondary, reported but not the verdict:** logistic regression of "right" on forecast lead (points), whether the ward has a previous result (`has_prev`) and whether the contest is a by-election (`is_by`). These two further inputs are fixed here; parties standing is not used. Unpenalised (scikit-learn `LogisticRegression`, `C=1e6`).
- **Applied to the blend:** there are no blend forecasts before May 2026 to train on. The primary handling is to apply the mapping fitted on the model alone to the blend's lead. This assumes a point of blend lead means what a point of model lead meant before May 2026. It is reported as an assumption and checked by the test itself: if the blend's safe label is right less often than the model's at the same threshold, the assumption fails.

## Safe call rule

- A contest is **safe at level L** when its mapped probability is at least t(L).
- t(L) is the lowest value of the mapped probability, among the values the training rows take, such that the training contests at or above it had their called leader right at least L of the time. Levels: **90% (the safe call)**, 80% and 95%.
- If no value reaches a level on training, that level has no label and is reported as such.
- On each test set, for each arm, report: contests labelled, share of all contests in the set, contests right, rate right, and a 95% Wilson interval for the rate.
- The thresholds are also reported as the equivalent forecast lead in points, for reading.

## What would count

The safe call is **supported** if, on test set A for the blend, the 90% label is right in at least 87% of the contests it labels **and** covers at least 15% of the contests in the set. Anything else is not supported. The model alone, set B and the secondary and back-test mappings are reported beside it and do not change the verdict.

## Also reported

- **Reliability table:** ten bands of mapped probability (0 to 0.1, ..., 0.9 to 1.0) on each test set and arm: contests, mean mapped probability, rate right.
- **Brier score** on the binary event "the called leader wins", for: the primary isotonic mapping; the secondary logistic mapping; the scheduled-sigma method in `score.py` (`Mapper`, with the per-lane sigmas in `cache/fit_meta.pkl`, sha256 `936d07ee...7ac67ad`), taking its probability for the called leader; and a flat rate (the training rate right for every contest).
- **Checks:** the safe call at 90%, by party called, by region, and with and without a previous result, on each test set and arm.

## How this relates to the site's calibration

`data/calibration/confidence.json` (fitted by `scripts/calibrate-confidence.mjs`) bins the published engine's margin between first and second, after an out-of-fold party bias correction, into six bins and quotes the realised hit rate in each, made monotone by pooling adjacent violators. It was **fitted on 7 May 2026** (`fitted_on: local.2026-05-07`). Under the site rule it can never be applied to May 2026, so it is not scored on set A. Its top bin quotes 81.25%, so it can never label a contest at 90%. Its quoted probabilities are applied to the model's and blend's lead on set B, where it was not fitted, as a Brier comparison only; it was fitted to a different forecaster's margin, so this is descriptive. The method here is the same idea (monotone mapping of lead to hit rate) with two differences: it is fitted on contests before the test election, and it is fitted on this model's lead, not the engine's.

## Run rule

One scoring run of the test sets. Faults that stop the run, or found before any test score is read, are fixed and reported. Any rerun after a test score is seen is reported. A dry run that fits on training data and prints only training figures is allowed before the scoring run.

## Limits known in advance

- May 2026 has been scored by many versions of the model and engine; the blend weight and S1 were chosen with May 2026 results visible. Set B (107 contests) is the cleaner set and small.
- The blend assumption above.
- England only in practice (a few Welsh contests appear in training; region is missing for some).
- Training mixes by-elections (525) and one scheduled day (1,399); one scheduled day is a thin base for the high-lead tail.
