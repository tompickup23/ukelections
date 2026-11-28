# Ward Census correction and regional level, out of time: pre-registration

Written 28 November 2026, before any forecast in this study was produced or scored. Research only; nothing on the site, the engine or the published forecast reads anything here. This file is committed on its own before the scoring script exists, so git history shows the order.

## Question

Do two inputs, each fitted only on results a forecaster had before the contest, improve the research ward model's arm C2 (standing rates) out of time?

- **A, a ward Census 2021 correction.** On 26 November a ridge correction on ward Census features, councils held out whole, lifted the candidate engine from 872 to 984 of 1,378 non-London May 2026 ward leaders (Reports repo, `Website_Audits/UKE_Ward_Accuracy_And_Homepage_2026-11-26.md`, section 4, script `demo_cv.mjs`). It was fitted on the election it was scored on, so it is a diagnostic only. This study fits it on an earlier election and scores it on later contests.
- **B, a regional party level** (idea I974). See "What regional data exists" below: no usable regional polling exists on disk, so B is a proxy built from the previous May's results, and is labelled as one throughout.

## Base forecasts, fixed

Every arm starts from the forward only C2 forecasts of the checked rebuild (PR 211, corrected inputs): `cache/rebuild/corrected/bridge_level_predictions.pkl`, sha256 `bb7586ce43bded0159aa7dca8af41fbf1532a26ac7ae3a5337c363d6d8e25d8a`, written by `rebuild_fit_score.py --polls corrected` with `fit_meta.pkl` sha256 `936d07ee4d9004d1cdd811796f60dbfb1b22a723e7575789b56292c287ac67ad`. C2 is not refitted. Its scheduled forecasts come from one fit per May on contests dated before polling day; its by-election forecasts from one fit per calendar month on contests dated before the first of the month (`BRIDGE_LEVEL_SPEC.md`). So every C2 residual used below is itself out of time for the row it belongs to.

## What regional data exists

Checked before writing this file:

- `data/polling/timeseries.json` has no area field (PR 211).
- The only sub-national polls in any repo polling file are 6 Welsh and 5 London polls in the July 2024 to April 2025 bridge file (PR 211), and `data/polling/wikipedia/london-westminster-2025-10-25-to-2026-04-25.json`, which holds 3 London polls, all from one pollster (Savanta), with fieldwork ending 25 October 2025 to 25 April 2026.
- No regional crosstabs are in the repo. No poll covers any English region other than London, and none covers any date after 25 April 2026.

So a regional polling level cannot be built for either test set. B is therefore the proxy the brief allows: each region's deviation from the national level in the previous scheduled May's results, against C2's own forecasts.

## Arms

All four arms forecast exactly the same rows as C2.

**C2, baseline.** The rebuild's C2 shares as they stand.

**C2+B, regional level proxy.** For a target contest, let M be the latest date in {2 May 2019, 6 May 2021, 5 May 2022, 4 May 2023, 1 May 2025, 7 May 2026} strictly before the contest date (the scheduled days that have C2 forecasts; May 2024 has none). Over M's scheduled wards with a C2 forecast, for each lane k that stood, the logit residual is e = logit(actual share) minus logit(anchor) minus C2's predicted offset (shares floored at 0.3%, `common.logit`). For each region r (the dataset's `region` column) the regional deviation is

D(r, k) = (mean of e over M's wards in r where k stood, minus the mean of e over all M's wards where k stood) times n / (n + 20),

with n the number of M's wards in r where k stood, and shrinkage 20 as in `BRIDGE_LEVEL_SPEC.md`. D is zero for a region or lane with no such ward, and for a row with no region. The national mean is removed on purpose: the national level comes from polls through the anchor, and a carried forward national residual is the by-election level idea already tested (C1). C2+B adds D(r, k) to C2's offset for every standing lane, then renormalises.

**C2+A, ward Census correction.** For each of the six lanes, a ridge regression of the share residual (actual share minus C2 forecast share, as fractions, zero where the lane did not stand) on these inputs, the 26 November diagnostic's set as far as the dataset carries it:

- the 12 Census features of `demo_cv.mjs`, from the dataset's `d_` columns: White British, Asian, Black, Muslim, degree, no qualifications, retired, full time students, owned outright, social rented, private rented (all as fractions), and the mean IMD decile divided by 10;
- C2's own forecast shares for Reform UK, Labour, Conservative, Liberal Democrats and Green Party;
- a London flag (region is London) and a no previous result flag (`has_prev` false).

The diagnostic's metropolitan flag is left out because the dataset has no council type column. Intercept unpenalised, penalty lambda 1 on the unscaled inputs, as `demo_cv.mjs` defaults. A missing Census value is set to the fitting set's mean. The fitting set is the scheduled wards of one election, M as defined for B, with a C2 forecast. The correction is applied by adding the predicted residual to C2's share for each standing lane, setting a lane that did not stand to zero, flooring at zero and renormalising, as `demo_cv.mjs` does.

**C2+A+B.** B applied to C2 first; then A's correction, fitted as for C2+A on C2's own residuals at M (not refitted on B adjusted residuals), added to the B adjusted shares, floored and renormalised.

Fixed in advance, not tuned: lambda 1, shrinkage 20, the feature list, one fitting election (the latest May before the contest), no by-elections in either fit.

## Test sets

1. **Primary: council by-elections after 7 May 2026 with a declared result.** The 107 contests from 11 June to 19 November 2026 in the corrected dataset, every one with a C2 forecast. Their ballot ids are the same 107 that PR 185 scored (`results/model_ward_shares.csv`), checked by id before this file was written; no score was read. For all of them M is 7 May 2026, so A and B are fitted on May 2026 results only, which a forecaster had in hand by June. The 26 November contests (PR 208) are not in this dataset, which was built before them, and are not added.
2. **Secondary forward check: May 2026 scheduled wards.** The 2,576 scheduled wards of 7 May 2026 in the dataset. M is 1 May 2025, so A and B are fitted on May 2025 results only, and the Census correction is never scored on the election it was fitted on.

## Measures

- **Primary: leading party called.** A contest counts as called if the arm's first lane by share is the actual first lane by full slate share, six pooled lanes, `score.score_arm`. Every row in both sets has a forecast in every arm.
- **Secondary: mean absolute share error,** points, over lanes with a forecast or an actual share, `score.score_arm`.
- **Descriptive, not in the rule:** per party signed bias; and on May 2026, the national seat total error by method M0 (leader takes every seat, RMSE over the five named parties) from `seats_score.py`'s committed actual seats (`results/seats_actual_wards.csv` on main, PR 203), on the wards that file covers.

## Paired comparison and intervals

For each arm against C2, on each test set: the difference in leaders called (arm minus C2), and a 95% percentile interval from a paired bootstrap, 10,000 resamples, seed 20261128. By-elections are resampled by contest. May 2026 wards are resampled by council (all a council's wards together), since wards in one council share errors. The same resampling gives an interval for the share error difference.

## Pass rule, chosen before any score

This follows the folder's existing form (an arm must call more leaders without a higher share error and without a clear loss anywhere), with an interval added. For each of A and B, judged as C2+A and C2+B against C2:

- **Supported** if all of: (1) on the May 2026 forward check, the lower end of the 95% interval for the leader difference is above zero; (2) on the 107 by-elections, the leader difference is zero or more; (3) share error is no higher than C2's on both sets.
- **Not supported** if any of: the May 2026 leader difference is zero or less; the by-election interval lies wholly below zero; share error is higher than C2's on both sets.
- **Inconclusive** otherwise.

With 107 contests, an interval that excludes zero needs a gain of roughly eight or more net contests, so the by-election set alone is not asked to show significance; if its interval does exclude zero it is reported. C2+A+B is reported against C2 and against the better single arm by the same measures; it is not separately judged unless both A and B are supported.

## Run rule

One script, `oot_census_region.py`, written after this file is committed, run once, writing `results/oot_census_region_summary.json`. A fault that stops the run may be fixed without reading a score and is reported. Any rerun after a score is seen is reported, with both results.

## Limits known in advance

- **May 2026 and May 2025 have been scored many times,** and the 26 November diagnostic chose A's feature set on May 2026. The by-election set is the cleaner test, but small.
- **The C2 by-election forecasts after May 2026 were fitted with May 2026 in training,** while A and B are fitted on May 2026 residuals of a model that had not seen May 2026. Some of what A and B correct may already be learned by C2, which would shrink any gain. That is how a forecaster would have had to apply them, so it is part of the test.
- **C2 already uses ward Census features** inside its gradient boosting model. A tests whether a linear correction on its residuals adds anything.
- **B is a proxy for regional polling, not regional polling.** It carries the previous May's regional pattern forward a year (forward check) or one to six months (by-elections).
- **England only,** apart from the few Welsh rows in the dataset, which get their own region level.
