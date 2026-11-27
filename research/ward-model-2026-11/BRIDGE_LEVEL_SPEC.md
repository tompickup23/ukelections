# By-election level and standing rates in May forecasts: specification

Written 27 November 2026, before any forecast in this study was produced or scored. Research only; nothing on the site reads it.

**File names.** This folder already holds `BRIDGE_SPEC.md`, `BRIDGE_RESULTS.md`, `bridge_build.py`, `bridge_forecast.py`, `bridge_score.py` and `results/bridge_summary.json` from an earlier, unrelated study (the ward code bridge for unscored May 2026 wards, commit `a75c2dc`). To avoid overwriting them, every file in this study is named `bridge_level_*` or `BRIDGE_LEVEL_*`. The summary is `results/bridge_level_summary.json`, not `results/bridge_summary.json`.

## Question

Does evidence a forecaster had before a May election improve the ward model's scheduled forecasts? Two kinds of evidence: the level by-elections since the previous May had shown, against the model's own forecasts at the time; and how widely each party is standing, from statements of persons nominated.

## The diagnosis, checked from the data

Counts of contests; offset means logit(full slate share) minus logit(national anchor), over contests where Reform UK stood and an anchor exists. From `cache/dataset.pkl` (the November dataset):

| Contests | Rows | Reform UK stood | Anchored where stood | Mean offset |
|---|---|---|---|---|
| Scheduled, 2 May 2024 | 1,901 | 315 (17%) | 315 | minus 0.50 |
| Scheduled, 1 May 2025 | 1,399 | 1,393 (99.6%) | 1,393 | plus 0.18 |
| By-elections, July to December 2024 | 197 | 63 (32%) | 63 | plus 0.08 |
| By-elections, January to June 2025 | 184 | 158 (86%) | 112 | plus 0.08 |

So the figures in the brief reproduce. **Two of them do not mean what they seemed to:**

1. **Of the 112 anchored "first half of 2025" by-elections, 109 are dated 1 May 2025 or later.** Only 3 by-elections between 1 January and 30 April 2025 had an anchor, because the repo holds no polls between 4 July 2024 and 15 April 2025. Before 1 May 2025 a forecaster in this dataset had 55 by-elections in 2025 (Reform UK stood in 49, 89%), almost none usable.
2. **Every contest from July to December 2024 is anchored on the July 2024 general election result** (anchor kind `ge2024_result`), not on polls. Reform UK polled well above its general election share through that period, so a positive offset against that anchor is partly the anchor being stale.

### Fix made before any forecast: poll anchors for 4 July 2024 to 30 April 2025

The page that the committed 2025 to 2026 extract came from, revision 1383556886 of "Opinion polling for the next United Kingdom general election", also carries polls back to July 2024. Run on that revision, `scripts/extract-wikipedia-polls.mjs` reproduces the committed `data/polling/wikipedia/westminster-2025-04-15-to-2026-04-25.json` byte for byte, and for fieldwork ending 5 July 2024 to 14 April 2025 gives 147 polls (108 GB, 28 UK, 11 unmarked), committed here as `bridge_level_polls_2024-07-05_to_2025-04-14.json`. Polls per month by fieldwork end: July 2024 3, August 5, September 8, October 14, November 17, December 12, January 2025 25, February 22, March 27, April (to the 14th) 14. The early months are thin on this page.

`bridge_level_anchor.py` rebuilds the anchor for every row dated 4 July 2024 to 30 April 2025 with stage B's rule unchanged (14 day window, else 21 day, at least 3 polls carrying each lane, GB and UK pooled, no anchor estimated), from the stage A extract, the new extract and the committed 2025 to 2026 file. Rows dated from 1 May 2025 keep the stage B anchor (so 1 May 2025 and 7 May 2026 are anchored exactly as in the rolling test). From `cache/bridge_level_anchor_report.json`: 257 rows rebuilt (197 were on the general election result, 57 blank, 3 already on polls); 246 now anchored (232 on 14 days, 14 on 21 days: 18 July, 22 August and 12 September 2024); 11 left blank (29 August, 3 and 5 September 2024).

**What the rebuilt anchors show**, same measure, from `cache/bridge_level_dataset.pkl`:

| Contests | Reform UK stood | Anchored where stood | Mean offset |
|---|---|---|---|
| Scheduled, 2 May 2024 (stage B poll anchor) | 315 | 315 | minus 0.27 |
| Scheduled, 1 May 2025 | 1,393 | 1,393 | plus 0.18 |
| By-elections, July to December 2024 | 63 | 59 | minus 0.28 |
| By-elections, 1 January to 30 April 2025 | 49 | 49 | minus 0.33 |
| By-elections, 3 May 2024 to 30 April 2025 | 115 | 111 | minus 0.31 |
| By-elections, 2 May 2025 to 6 May 2026 | 213 | 213 | minus 0.04 |

**Against poll anchors, Reform UK's raw by-election offset before May 2025 was negative, not positive.** The plus 0.08 was mostly the stale anchor. This is a raw offset, not a model residual: the model's own by-election forecasts may sit lower still, and C1 uses residuals. But the premise that by-elections had already shown May 2025's level does not survive the anchor fix in raw form. The test runs as specified regardless.

Standing rates on scheduled days, share of dataset wards where the lane stood (Reform UK, Labour, Conservative, Liberal Democrats, Green Party, Others): 2019 0.000, 0.961, 0.994, 0.727, 0.600, 0.554; 2021 0.066, 0.983, 0.995, 0.807, 0.675, 0.442; 2022 0.038, 0.953, 0.980, 0.751, 0.626, 0.355; 2023 0.110, 0.965, 0.984, 0.783, 0.704, 0.409; 2024 0.166, 0.981, 0.976, 0.779, 0.740, 0.475; 2025 0.996, 0.942, 0.997, 0.910, 0.788, 0.417; 2026 0.997, 0.958, 0.974, 0.854, 0.959, 0.407.

## Dataset and test elections

`cache/bridge_level_dataset.pkl`: the stage B dataset with the anchors above. All six years are refitted on it with the clean inputs, so all six are one method:

| Test election | Wards in dataset |
|---|---|
| 2 May 2019 | 1,678 |
| 6 May 2021 | 2,255 |
| 5 May 2022 | 2,533 |
| 4 May 2023 | 1,734 |
| 1 May 2025 | 1,399 |
| 7 May 2026 | 2,576 |

## Fitting, the same for every arm and lane

- **Model.** `HistGradientBoostingRegressor`, one per lane, settings from `fit_meta.pkl` (not reselected), seed 20261127. Target logit(share) minus logit(anchor). Training rows: every anchored contest dated before the cut where the lane stood; a lane is fitted only with at least 50 such rows.
- **Clean inputs.** Stage B's S1c list: `fit_predict.FEATURES` without `ge24_reform`, `ge24_labour`, `ge24_con`, `nb_ge24_reform`, `mrp_reform`, `mrp_labour`.
- **Cuts.** One fit on each of the six scheduled days, on contests dated before it. One fit per calendar month from May 2018 to November 2026 for by-elections, on contests dated before the first of the month; a by-election on one of the six scheduled days uses that day's fit.
- **Forecast.** expit(logit(anchor) + offset) per standing lane, renormalised. A row is forecast only if every lane standing in it has a fitted model (stage B's rule). Every arm forecasts exactly the same rows, since the lane fitting rule does not depend on the arm.
- **Jobs.** Each (cut, lane) pair is one job fitting C0 and C2, eight jobs at a time, single threaded.

## Arms

**C0, benchmark: the clean pooled model as it is.** In every year the benchmark is C0 on the same rows as the arm.

**C1, by-election level.** For a scheduled election on day T, let P be the first Thursday of May in the year before (2019: 3 May 2018; 2021: 7 May 2020; 2022: 6 May 2021; 2023: 5 May 2022; 2025: 2 May 2024; 2026: 1 May 2025). The window is by-elections dated after P and before T, both exclusive (by-elections held on P itself are left out, since their results arrive with P's scheduled results, which this arm does not use; those on T are not yet known). A by-election contributes to lane k if it has a C0 forecast from its own forward only cut (monthly, as above) and lane k stood. Its residual is e = logit(actual share) minus logit(anchor) minus C0's predicted offset, on the logit scale before renormalisation (shares floored at 0.3%, as `common.logit`). Weight w = 0.5 to the power (days from the by-election to T, divided by 90). The level is

L_k = (sum of w times e, divided by sum of w) times n / (n + 20), where n is the sum of the weights,

as S2 in `rolling_fit.py` defined n; a plain count would let year-old contests earn shrinkage credit that the half-life denies them. L_k is zero for a lane with no contributing by-election. C1's forecast adds L_k to C0's offset for each standing lane, then renormalises. **Expected in advance: no anchored by-election falls between 7 May 2020 and 6 May 2021, so C1 equals C0 in 2021.**

**C2, standing rate inputs.** C0's inputs plus 18, for each of the six lanes k:

- `nat_stand_k`: the share of dataset rows dated the same day (scheduled and by-elections, anchored or not) where lane k stood;
- `cou_stand_k`: the same share within the row's council on that day;
- `prev_nat_stand_k`: `nat_stand_k` on the date of the ward's latest earlier scheduled contest in the dataset (same ward code, dated before the row). Blank where there is none. No look ahead: that date is always earlier.

Every lane's model gets all 18. Refitted forward only on the same cuts as C0.

**C3: C2 with C1 applied on top.** The level is computed exactly as for C1, but from C2's forward only by-election residuals, since C3's base forecast is C2.

Fixed in advance, not tuned: half-life 90 days; shrinkage 20; window from the previous first Thursday of May; 50 rows per lane; the settings in `fit_meta.pkl`.

## Scoring

As stage B, with `score.score_arm`: leader by full slate share over six pooled lanes; share error over lanes with a forecast or an actual share, in points; a row no arm can forecast counts as a miss for every arm. One scoring script, `bridge_level_score.py`, run once, writing `results/bridge_level_summary.json`.

## Questions and what counts

**(a) Each of C1, C2 and C3 against C0,** leaders called and share error, per year and pooled over the six. An arm is **supported** only if all four hold:

1. pooled over the six years, it calls more leaders than C0;
2. pooled, its share error is no higher than C0's;
3. it calls at least as many leaders as C0 in at least four of the six years;
4. in no year does it call fewer leaders than C0 by more than 1% of that year's wards.

**(b) May 2025 on its own,** for each arm: leaders called, Reform UK signed bias (forecast minus actual share, points, over wards where it stood or scored), Reform UK called first against led. Reported, not part of the rule.

**(c) Does the by-election level point the right way?** For each lane and each of the six years: the C0 level before shrinkage (the weighted mean residual), its number of contributing by-elections and weight sum; and C0's mean residual at that May (same definition, over the forecast wards where the lane stood) with its number of wards. A cell counts as same sign if both are non-zero with the same sign; cells with no contributing by-election are counted apart. Thirty six cells. Descriptive: it says whether C1 is safe for every lane or only some, and **no per-party rule is drawn from it.**

**(d) By-elections.** C1 leaves by-elections unchanged by construction. C2 against C0 on every by-election with a forecast from May 2018 to November 2026, per window (the six C1 windows and the rest) and pooled: leaders called and share error, so that a gain at May is not bought with a loss at by-elections. Descriptive.

## Run rule

One run of `bridge_level_fit.py`, printing row counts and timings only, and one run of `bridge_level_score.py`. A fault that stops a run may be fixed without reading a score and is reported. Any rerun after a score is seen is reported.

## Limits known in advance

- **May 2026 has been scored by many earlier versions,** and the diagnosis behind this study was made on May 2025. Neither year is a clean hold out for the idea, only for these fixed numbers.
- **Standing data is taken from results files** (who has votes recorded), which is what a forecaster would have had from statements of persons nominated, less any candidate who withdrew or was nominated and recorded nowhere.
- **Standing rates are over the wards in this dataset,** England only and only contests with a code in the Drive feature file, not every ward voting that day.
- **Settings in `fit_meta.pkl` were chosen on contests up to April 2026,** with the six future inputs present.
- **Polls for July to September 2024 are thin** on the revision used (16 in three months), so 11 rows stay unanchored and three dates use the 21 day window.
- **Features are fixed in time** (2021 Census, 2019 deprivation index), as in stage B.
- **The ward model alone,** not the blend with the candidate engine.
