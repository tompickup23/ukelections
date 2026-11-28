# Calibrated confidence and a safe call rule for ward forecasts: specification

27 November 2026. **Research only.** Nothing on the site, the engine or the published forecasts reads this folder. This file is committed before any score on either test set is computed. One scoring run follows it. Files added by this work carry the prefix `safecall_`.

## The question

The May 2026 ward forecasts published a confidence label and a win probability per party. Neither told readers how often the forecast would be right. This test asks whether a mapping from a forecast's lead to the probability that the called leader wins, fitted only on forecasts made before 7 May 2026, gives honest probabilities on May 2026, and whether a "safe call" label can be right about nine times in ten while covering a useful share of wards.

## Units and terms

- **Unit.** A local contest in England: a ward or county division on one polling day.
- **Forecast shares.** Six pooled lanes as in `common.py`: Reform UK, Labour, Conservative, Liberal Democrats, Green Party, Others. Missing or NaN shares count as zero; shares are renormalised to sum to one.
- **Called leader.** The lane with the largest forecast share.
- **Lead.** Forecast share of the called leader minus the second largest forecast share, in percentage points (0 to 100). A lane with no candidate has share zero.
- **Right.** The called leader is the lane with the largest actual full-slate share (`s_*`), as in `score.py`.

## Data

All forecasts are forward-only: each was made by a model fitted only on contests dated before the contest it forecasts.

**Training set (fit the mapping and choose thresholds).** Every forecast dated before 7 May 2026, from two sources:

1. `cache/recency_predictions.pkl`, columns `s1_*` (the pooled ward model, rolling), rows dated before `2026-05-07` with a forecast: 525 council by-elections from May 2024 to April 2026 and 1,399 wards on 1 May 2025 (1,924 rows).
2. `cache/backtest_predictions.pkl` (PR 191, `backtest_fit.py`, stage A), columns `s1_*`, rows with a forecast: wards on 5 May 2022 and 4 May 2023 and by-elections from 2021 to April 2024 (4,506 rows). Used read only, as written by that branch.

Rows are pooled with equal weight per row. Counts are confirmed by the script and reported.

**Why both sources.** The rolling set is the same model in the current party system, but 1,399 of its 1,924 rows are one election (1 May 2025) at which the model was trained without any earlier scheduled election in that party system. The back-test is the same method in a settled party system. Neither alone describes May 2026, so the primary fit pools them, and each alone is reported as a sensitivity.

**Test set A.** The 2,596 contests in `recency_predictions.pkl` with `set == "may26"` (2,576 scheduled wards and 20 by-elections on 7 May 2026). All 2,596 are among the site's 2,897 local wards in `data/transparency/may-2026-postaudit-2026-05-10.json`. The 20 same-day by-elections are kept so that the model and the blend are scored on the same rows as the earlier blend work (`RECENCY_RESULTS.md`).

**Test set B.** The 107 council by-elections after 7 May 2026 (`set == "byelection"`).

Nothing is fitted on either test set.

## The mapping

**Primary.** Isotonic regression (scikit-learn `IsotonicRegression`, increasing, `out_of_bounds="clip"`, `y_min=0`, `y_max=1`) of right (1 or 0) on lead, on the pooled training set. One mapping for every party.

**Secondary, reported only.** Logistic regression (unpenalised as far as scikit-learn allows: `C=1e6`) of right on three inputs fixed now: lead, whether the ward has a previous result (`has_prev`), and whether the contest is a by-election (`is_by`). No rule is judged on it.

**Sensitivities, reported only.** The primary isotonic mapping fitted on the rolling source alone and on the back-test alone, each with its own thresholds chosen the same way.

## The two forecasts scored

1. **Model.** The ward model alone, `s1_*` in `recency_predictions.pkl`.
2. **Blend.** On test set A: `blend(candidate, model, BLEND_WEIGHT_MODEL)` from `score.py`, that is 0.5 times the 24 October 2026 candidate engine (`cache/arms/candidate-2026-10-24.json`, pooled as in `score.py`) plus 0.5 times the model, renormalised. On test set B, where no candidate engine exists: 0.5 times the site's by-election forecast (`site_forecast`) plus 0.5 times the model, as in `score.py`'s `blend_site`. A contest without both inputs has no blend forecast.

**The blend mapping is an assumption, not a fitted calibration.** No blend forecasts exist before May 2026, so there is nothing to fit on. The mapping fitted on the model's training forecasts is applied unchanged to the blend's lead. Whether the blend's leads mean the same as the model's is exactly what test set A checks; the result is reported as a check on that assumption.

## The safe call rule

On the training set, with the primary mapping, consider every distinct fitted probability value `t`. The **safe threshold** is the lowest `t` such that, among training rows with mapped probability at least `t`, the called leader was right in at least 90% of rows, and there are at least 100 such rows. A forecast is labelled **safe** when its mapped probability is at least the safe threshold. Because the mapping is monotone in lead, this is the same as a lead cutoff, which is also reported.

The same procedure gives thresholds for **80%** and **95%**. If no `t` meets a target with at least 100 rows, that target has no threshold and this is reported.

On each test set, for each forecast and each target (80%, 90%, 95%), report: contests labelled, share of the test set (for set A both of the 2,596 forecastable contests and of the site's 2,897 local wards), number right, share right, and a 95% Wilson interval.

## What counts

Fixed now, judged once:

1. **Safe call label supported** if, for the **blend on test set A** with the **primary** mapping and the **90% threshold**: share right is at least 87%, **and** contests labelled safe are at least 15% of the site's 2,897 local wards (at least 435).
2. Reported beside it, not judged: the same for the model alone on set A, and both forecasts on set B (107 contests are too few to judge).

## Reliability

For each forecast on each test set, with the primary mapping:

- **Calibration table** in ten bands of mapped probability, `[0, 0.1)` up to `[0.9, 1.0]`: contests, mean mapped probability, share right.
- **Brier score** for the binary event "the called leader wins", with (a) the primary mapping, (b) the secondary logistic mapping, and (c) the current scheduled-sigma method in `score.py` (`Mapper`, with the per-lane out-of-fold sigmas in `cache/fit_meta.pkl`), taking its probability for the called leader. Also (d) a flat baseline: the training share right applied to every contest.
- Mean calibration error: the contest-weighted mean of |mean mapped probability minus share right| over the ten bands.

## Checks

For the safe label at 90%, on test set A, for model and blend: the safe table split by **party called**, by **region**, and by **has a previous result or not**. These are checks that "safe" is safe everywhere, not separate claims. The same one rule applies to every party; party splits are reported only to see whether the rule is kinder to one.

## How this relates to `data/calibration/confidence.json`

That file maps the published engine's predicted margin to a winner probability in six bins. It was fitted on May 2026 (`fitted_on: local.2026-05-07`) using out-of-fold predictions. The site rule is that a calibration is never applied to the election it was fitted on, so it cannot be tested on test set A and is not scored here. This work differs in three ways: it calibrates the research ward model and the blend, not the engine; it is fitted only on forecasts made before May 2026, so May 2026 is a genuine test; and its bins come from isotonic regression rather than fixed margin bins. If this work is ever used on the site it would sit beside or replace that file for whichever forecast is published, and would be refitted on all elections up to the one before the forecast.

## Faults

Any fault found and fixed before the test score is read is reported in the results with what changed. The script prints training-only output first; a dry run on training data only is allowed before the scoring run.

**Found in the training-only dry run, fixed before this commit.** The training set holds two exact ties (lead 0.000), one right and one wrong. The isotonic fit put the wrong one on a step of its own with probability 0.0, so any tied forecast would have been given no chance at all. The mapped probability is now floored at the smallest positive fitted value (the next step up). The thresholds are unchanged by this, since they sit far above the floor. The dry run also showed, before any test score, that the rolling source alone reaches no target (80%, 90% or 95%) with at least 100 rows, and that the logistic `has_prev` input largely separates the two sources (21% of rolling rows have a previous result, 91% of back-test rows). Neither changes the specification.

## Limits known in advance

- May 2026 has been scored by many versions of these forecasts, and lead-by-accuracy figures for the blend on May 2026 were known when this specification was written. Test set A is therefore not clean; test set B is clean but small.
- The blend mapping is an assumption (above).
- England only, and only contests with a ward code in the Drive feature file.

## Thresholds fixed on training data, before the test run

From the training-only dry run of `safecall_score.py` (6,430 rows: 1,924 rolling, 4,506 back-test; 71.45% right overall):

| Target | Mapped probability at least | Lead at least (pp) | Training rows | Share right in training |
|---|---|---|---|---|
| 80% | 0.6296 | 12.82 | 4,325 | 82.38% |
| 90% (safe call) | 0.7523 | 25.05 | 2,611 | 90.81% |
| 95% | 0.8889 | 33.14 | 1,672 | 95.51% |

Within the 90% group the two sources disagree sharply: back-test 93.83% right (2,529 rows), rolling 62.75% right (510 rows). That is a warning carried into the results, not a reason to change the rule.
