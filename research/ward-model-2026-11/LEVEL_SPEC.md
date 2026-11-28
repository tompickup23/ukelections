# Party level correction for the ward model (arm C2): specification

Written 28 November 2026, after the diagnosis (`LEVEL_DIAGNOSIS.md`, commit `47d4b01`) and before any forecast in this study was produced or scored. Research only; nothing on the site reads it.

## Question

Does a per lane correction, estimated only from what was known before each polling day, make C2 call first place better by party, at the six test Mays and at by-elections, without double counting a level C2 has already learned?

## What the diagnosis decided

- Renormalising cannot change first place, and no within ward stretch helps, so neither is tested.
- Labour's shortfall, and the excess of the Liberal Democrats, Greens and Others at May 2026, are level errors. Reform UK's is a between ward spread (calibration slope 1.20 over the six Mays) with a level error in 2025.
- A level carried forward from a contest C2 has already trained on double counts (`OOT_CENSUS_REGION_RESULTS.md`), and a level from the forward by-election residuals has been tested (C1 and C3 of `BRIDGE_LEVEL_SPEC.md`). Neither is repeated.

So both corrections are estimated from **out of fold residuals inside C2's own training window**: what C2, fitted as it is, still gets wrong about the latest twelve months when a council is held out. A level C2 has learned leaves no such residual, so nothing is counted twice. What remains is the part of the recent level (or spread) C2's regularised fit does not absorb.

## Base

C2 exactly as in the corrected rebuild: its cached forward only offsets in `cache/rebuild/corrected/bridge_level_predictions.pkl` (`off_c2_*`), the same 91 cuts, the same rows forecast, the same anchors. C2 is not refitted. Dataset: `cache/rebuild/corrected/bridge_level_dataset.pkl`, with `bridge_level_fit.standing_inputs` applied, as in the fit.

## Out of fold residuals (one run, shared by both arms)

For every cut c of `bridge_level_fit.py` (each test May; the first of each month for by-elections) and every lane k that C2 fitted at c and that stands in at least one of c's test rows:

1. **Training rows** T: as C2, every anchored row dated before c where lane k stood.
2. **Window** W: the rows of T dated on or after c minus 372 days. 372 days, not 365, so that the window before each test May contains the previous May in every year (1 May 2025 is 371 days before 7 May 2026).
3. If W has fewer than 30 rows, the lane gets no correction at c (level 0, slope 1) and no fold is fitted.
4. Otherwise, split T into 5 folds by council with scikit-learn's `GroupKFold(n_splits=5)` (the grouping the model's settings were chosen with). For each fold, fit C2's lane model (same settings from `fit_meta.pkl`, same 73 inputs, seed 20261127, the same rule that zero fills a column with no value) on T without that fold, and predict the fold's rows that are in W. Every row of W then has an out of fold prediction p_i of its offset.
5. Residual r_i = y_i minus p_i, where y_i = logit(actual share) minus logit(anchor), shares floored at 0.3% as `common.logit`. Positive means C2 is low.

Stored per (cut, lane): n = |W|, mean residual, mean p, and the least squares slope b of y on p over W.

## Arms

**C2, benchmark.** As cached.

**L1, out of fold level.** For lane k at cut c:

L = (mean of r over W) times n / (n + 100).

Every forecast at c gets offset C2 + L for each standing lane k, then expit(logit anchor plus offset) and renormalising, exactly as C2.

**L2, out of fold level and spread.** As L1, plus a per lane spread term:

b* = 1 + (b minus 1) times n / (n + 400), then limited to the range 0.5 to 2.0;

offset = C2 + L + (b* minus 1) times (C2 minus m), where m is the mean of p over W.

So a lane whose recent out of fold forecasts are too bunched (b above 1) is spread about its recent mean, and one too spread is pulled in. This is not the stretch `SEATS_RESULTS.md` rejected (M2): that was one factor for every lane, chosen by leader Brier over other elections; this is a factor per lane from residuals inside the training window.

Fixed in advance, not tuned: 372 days, 30 rows, 5 council folds, shrinkage 100 for the level and 400 for the slope, the slope range, no recency weights inside the window, every contest type pooled in the window.

## Scoring

`level_score.py`, run once, with `score.score_arm` and the conventions of `bridge_level_score.py`: leader by full slate share over six pooled lanes; share error over lanes with a forecast or an actual share; a row C2 cannot forecast counts as a miss for every arm (all arms forecast exactly C2's rows). Sets: each of the six Mays (12,175 wards); the six pooled; the five without 2026; all by-elections May 2018 to November 2026 (1,190); the by-elections after 7 May 2026; by-elections by half year (descriptive). Seats: method M0 of `SEATS_SPEC.md` (every seat in a ward to the forecast leader) over the scored set in `results/seats_actual_wards.csv`, RMSE five per May and the mean of the six. Output `results/level_summary.json`.

## Pass rules

Each of L1 and L2 against C2. **Supported** only if all eight hold:

1. Pooled over the six Mays, more leaders than C2.
2. Pooled over the six Mays, share error no higher than C2.
3. At least as many leaders as C2 in at least four of the six Mays.
4. In no May fewer leaders than C2 by more than 1% of that May's wards.
5. All 1,190 by-elections: at least as many leaders as C2.
6. All 1,190 by-elections: share error no higher than C2.
7. National seat totals, M0: mean RMSE five over the six Mays no higher than C2's.
8. **May 2026 decides nothing:** rule 1 also holds pooled over the five Mays without 2026.

If both are supported, the one to adopt is the one with more leaders pooled over the six Mays; on a tie, L1, the simpler. Reported, not ruled: the by-elections after 7 May 2026 (leaders, share error, Reform UK and Labour called first against led), per lane signed bias per set, called first against won per lane, wards gained and lost against C2, and the levels and slopes per cut.

## Run rule

One run of `level_fit.py`, which prints row counts, timings and the levels and slopes it estimates (these come from training rows only and are not scores), then one run of `level_score.py`. A fault that stops a run may be fixed without reading a score and is reported. Any rerun after a score is seen is reported, and does not replace the first.

## Limits known in advance

- **May 2026 has been scored many times**, and the diagnosis leans on it. Rule 8 stops it deciding the verdict, but it is not a clean hold out for the idea.
- Out of fold residuals by council show only the part of a recent level the fit does not absorb from other councils on the same day. If C2 absorbs nearly all of it, both arms will be close to C2, which is a valid result.
- The window pools May and by-election rows. Before a test May the window is dominated by the previous May; before a by-election cut it includes the latest May.
- Settings in `fit_meta.pkl` were chosen on contests up to April 2026.
- The ward model alone, not the blend with the candidate engine.
