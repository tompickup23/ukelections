# Averaging several fits of the ward model's C2 arm: specification

Written 28 November 2026, after the C2 baseline was reproduced and before any averaged forecast was produced or scored. Research only; nothing on the site, the engine or the published forecast reads anything in this folder.

## Question

`REBUILD_RESULTS.md` (verdict, point 5) found that C2, the ward model with standing rates as inputs, called 647 May 2025 leaders on the "PR 199 only" inputs and 703 on the "Both" inputs, although the two input sets differ only in 79 by-election anchors from July to December 2024 and touch no May ward's anchor. Does replacing each lane's single fit with the mean of several fits make C2 more stable between those two input sets, without making it less accurate?

## Why a single fit can move that much

Every lane model is a `HistGradientBoostingRegressor` with the settings in `fit_meta.pkl` and no `early_stopping` argument, so scikit-learn's default (`"auto"`) applies: early stopping is switched on whenever a fit has more than 10,000 training rows, and it holds out a random 10% of the training rows, drawn with the fixed seed, to decide when to stop. Counted from `~/ukelections-research-cache/corrected-2026-11-28/rebuild/corrected/bridge_level_dataset.pkl` (anchored rows dated before the cut where the lane stood), the May 2025 fit has 12,620 Labour rows, 12,821 Conservative and 10,088 Liberal Democrat rows, so those three lanes stop early; the Green (8,612), Others (5,813) and Reform UK (886) fits do not. Adding or removing a handful of training rows reshuffles the whole held-out 10%, which can change the number of boosting rounds. That is one plausible source of the noise; the other is ordinary sensitivity of a tree ensemble to which contests it trained on. The two variants below separate the two.

## Baseline, reproduced before this specification was written

`averaging_fit.py --reproduce` refits C2 alone, with `bridge_level_fit.py`'s data handling, cuts, training rule and settings imported unchanged, on the rebuild cache of each input set (`~/ukelections-research-cache/corrected-2026-11-28/rebuild/<pr199|corrected>/`, the `cache/rebuild/` folder of the checked rebuild, PR 211). It checks every predicted offset against that cache's `bridge_level_predictions.pkl`. `averaging_score.py --reproduce` scores it with `score.score_arm`, as `bridge_level_score.py` does. The figures are in the section "Reproduction" below, added before this file was committed.

## Variants, fixed now

Both variants change only how one lane's offset is produced at one cut. Inputs (C2's 18 standing inputs on top of the clean list), training rows, the 50 row minimum, the cuts, the forecastable-row rule, the anchors, expit and renormalisation are exactly as `bridge_level_fit.py`. Averaging is a plain mean of predicted offsets on the logit offset scale, before expit and renormalising.

- **A1, seed bag.** M = 8 fits on every training row, seeds 20261127 + b for b = 0 to 7. Member 0 is C2's own fit. The members differ only in the seed, which in these fits decides only the early stopping hold out (the binning subsample needs over 200,000 rows). Where a fit has 10,000 rows or fewer, all eight members are identical and A1 equals C2. A1 tests whether the noise is the early stopping draw.
- **A2, council bag.** M = 8 fits. For member b, draw a bootstrap sample of the dataset's councils (all 321, sorted by name, drawn with replacement with `numpy.random.default_rng([20261127, b])`), and weight every training row by the number of times its council was drawn; rows of councils not drawn are left out. The draw is made once per member, so it is the same at every cut, for every lane and for both input sets. The member's seed is 20261127 + b. A member with fewer than 50 rows of positive weight is skipped, and if all eight are skipped the job takes C2's single fit; the number skipped is reported. A2 tests whether averaging over which councils trained the model steadies it.

M = 8, not more, to keep run time reasonable: one C2 fit of all 490 lane jobs takes about four minutes at eight jobs at once, so the two variants together cost about 15 single fits per input set.

## Runs

`averaging_fit.py --polls pr199` and `averaging_fit.py --polls corrected`, each once, producing C2, A1 and A2 together; then `averaging_score.py` once, writing `results/averaging_summary.json`. A fault that stops a run may be fixed without reading a score and is reported. The full run checks again that its C2 offsets equal the rebuild cache exactly.

## Stability measure

For C2 and each variant, at each of the six Mays (2019, 2021, 2022, 2023, 2025, 2026): the number of wards whose called leader differs between the "PR 199 only" and "Both" forecasts, counted ward by ward (a ward forecast in one set and not the other counts as changed). Reported also: the net change in leaders called correctly (C2's is 56 at May 2025, the figure quoted above), and the same count over the 1,190 by-elections.

- **S1.** Pooled over the six Mays, the variant changes at most three quarters as many leaders as C2.
- **S2.** In no May does the variant change more leaders than C2.

A variant is **stable** if S1 and S2 both hold.

## Accuracy rules, on the "Both" inputs, against C2

The four rules of `BRIDGE_LEVEL_SPEC.md`, with C2 as the benchmark. Rule 1 asks for at least as many leaders, not more, because the claim being tested is "no less accurate":

1. Pooled over the six Mays, the variant calls at least as many leaders as C2 (9,135 of 12,175 in `results/rebuild_bridge_level_summary_corrected.json`). **1b, for point 4 below:** the same holds pooled over the five Mays without 2026.
2. Pooled, its share error is no higher than C2's (6.08 points in the same file; compared unrounded).
3. It calls at least as many leaders as C2 in at least four of the six years.
4. In no year does it call fewer leaders than C2 by more than 1% of that year's wards.

**By-elections**, May 2018 to November 2026, 1,190 contests (C2: 786 leaders, share error 7.26, same file):

- B1. It calls no fewer than C2's leaders less 1% of the contests (11.9).
- B2. Its share error is no higher than C2's.

A variant is **no less accurate** if 1, 1b, 2, 3, 4, B1 and B2 all hold, and **supported** only if it is both stable and no less accurate. If both variants are supported, the one with fewer pooled leader changes is named as the new base arm; if they tie, A1, the cheaper.

## May 2026 decides nothing on its own

May 2026 has been scored many times and shaped earlier ideas. It counts in the pooled figures like any other year, but rule 1b requires the pooled result to hold without it, and no verdict is drawn from May 2026 alone. Its figures are reported for completeness. The sealed test is May 2027.

## Reported, not part of the rule

Per year and pooled, for C2, A1 and A2 on both input sets: leaders called, wards forecast and share error; the stability table; members skipped in A2; fit time.

## Limits known in advance

- Two input sets are one pair. Stability between them is a proxy for stability to any small input change, not proof of it.
- The settings in `fit_meta.pkl` were chosen for single fits on contests up to April 2026; averaging may favour different settings. They are not reselected here.
- A2's members train on about two thirds of the councils each, so each member is weaker than C2; averaging must make up for that.
- A2's members also fall below the 10,000 row early stopping threshold more often than C2's, so A2 changes early stopping behaviour as well as the training sample.

## Reproduction

Run 28 November 2026 before this file was committed (`cache/averaging/averaging_repro.log`). On both input sets every C2 offset equals the rebuild cache's `bridge_level_predictions.pkl` exactly: the same missing rows and a largest absolute difference of 0.0 in every lane. Scored with `averaging_score.py --reproduce`:

| | PR 199 only | Both |
|---|---|---|
| May leaders, pooled six (of 12,175) | 9,091, share error 6.09 | 9,135, share error 6.08 |
| May leaders, pooled five without 2026 (of 9,599) | 7,315, 6.33 | 7,371, 6.29 |
| May 2025 (of 1,399) | 647, 8.48 | 703, 8.30 |
| By-elections (of 1,190) | 805, 7.29 | 786, 7.26 |

These match `results/rebuild_bridge_level_summary_pr199.json` and `results/rebuild_bridge_level_summary_corrected.json`. The per-year leader counts also match `REBUILD_RESULTS.md` in every year. Fit time for C2 alone: 264 seconds (Both) and 468 seconds (PR 199 only, on a busier machine).
