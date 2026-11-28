# Live by-election forecasts from the ward model: specification

Written 27 November 2026, before any live forecast was produced. Research only: nothing on the site, the publisher or any cron reads this folder.

## Purpose

The research ward model has a back-test record on council by-elections (70 of 107 leaders called after 7 May 2026, 793 of 1,190 under C2 from 2018 to 2026; see `BRIDGE_LEVEL_RESULTS.md`), but every one of those forecasts was produced after the contest had polled. This specification fixes, in advance, how the same model writes a forecast for each upcoming council by-election before polling day, so that it can earn a live record on the by-election forecaster scoreboard (`data/scoreboard/byelection-forecasts.json` on `main`), where an entry counts as live only if it was captured before 07:00 UK time on polling day.

## Model version

**C2, the standing rate version, which passed its pre-set rule in `BRIDGE_LEVEL_SPEC.md`.** Nothing is retuned.

- One `HistGradientBoostingRegressor` per lane, built by `rolling_fit.make`, seed 20261127, settings taken from `cache/fit_meta.pkl` (`lanes[<party>].best_params`) exactly as `bridge_level_fit.py` takes them.
- Inputs: `bridge_level_fit.FEATS["c2"]`, that is stage B's clean list (`backtest_b_fit.CLEAN`: `fit_predict.FEATURES` without the six inputs drawn from the 2024 general election and the MRP) plus the 18 standing rate inputs of `bridge_level_fit.standing_inputs`.
- Target: logit(full slate ward share) minus logit(national anchor share), shares floored at 0.3% (`common.logit`).
- A lane is fitted only with at least 50 training rows where it stood (`bridge_level_fit.MIN_ROWS`). A column with no non-missing value in the training rows is filled with zero before fitting, as `bridge_level_fit.fit_cut` does.
- Forecast: expit(logit(anchor) + predicted offset) for each standing lane, renormalised over the standing lanes to sum to one.

The model version string written with every forecast is `ward-model-2026-11/C2`, with the commit of the code that produced it.

## Lanes and pooling

Six lanes: Reform UK, Labour, Conservative, Liberal Democrats, Green Party, Others. A candidate's lane is `common.pool_party` applied to the `party` label in the contest file, the same call `prepare.py` makes for by-election rows. Any party outside the five main lanes, and every independent, is in Others: Restore Britain, the SNP, Plaid Cymru, residents' groups and independents alike. One rule for every party.

## Training data

**Every contest dated before the run date with a result and a national anchor, by-elections included.**

- The base is `cache/bridge_level_dataset.pkl`, the dataset C2 was tested on (sha256 recorded in each run), copied read only from the research worktree.
- Its 107 post-May by-election rows (`set == "byelection"`), which `prepare.py` built from the contest files of the day, are dropped and rebuilt from the contest files on `origin/main` at run time with the same code path, so that every by-election declared since then joins the training data. A contest is a training row if it is in England, polled after 7 May 2026 and before the run date, has status `concluded` and result shares, and its ward code is in the feature file; the same tests `prepare.py` applies.
- Training rows for lane k: every anchored row dated before the run date where lane k stood (as `bridge_level_fit.py`, with the run date in place of the first of the month).

## Rows for upcoming contests

Built exactly as `prepare.py` builds by-election rows:

- **Ward features** from `cache/drive07/universe_features_v2.csv`, matched on the contest's `ward_gss`; region from the same file.
- **Standing (`stood_*`)** from the published candidate list in the contest file (`field.candidates`), each pooled by `common.pool_party`. `n_standing` is the number of lanes standing.
- **Ward lags** (`prev_rel_*`, `prev_gap_years`, `has_prev`): the latest earlier contest in the dataset with the same ward code, as `prepare.py`.
- **Standing rates**: `bridge_level_fit.standing_inputs` over the whole dataset including the upcoming rows, so `nat_stand_k` is the share of rows on the same polling day where lane k stands (the upcoming contests that pass the tests below), `cou_stand_k` the same within the council, and `prev_nat_stand_k` the national rate on the date of the ward's latest earlier scheduled contest.
- `is_by` is true.

## National anchor on the run date

`prepare.poll_anchor(polls, run_date, carry_forward=True)`, unchanged: the mean of GB Westminster polls in the 14 days ending on the latest poll with a date on or before the run date, provided that poll is no more than 21 days before the run date; at least 3 polls carrying each of the five main parties; Others is the remainder, floored at 1%. No anchor is estimated or interpolated. The polls are loaded by `prepare.load_polls`, from:

1. `data/polling/wikipedia/westminster-2025-04-15-to-2026-04-25.json` (committed; identical on `origin/main`), and
2. `data/polling/timeseries.json`: by default the copy on `origin/main`. Because the nightly publisher refreshes polls without committing them, the copy on `main` can be weeks old; the run may instead be given the same file from the publisher's checkout on vps-main (`/root/ukelections-polling-publisher/data/polling/timeseries.json`). Whichever is used is copied into `live/inputs/` and its sha256, `generated_at` and latest poll date are written with every forecast.

The same anchor applies to every upcoming contest in a run. Rebuilt training by-elections are anchored as `prepare.py` anchors them, on their own polling day with carry forward, from the same poll files.

## Win chance

From the model's lane spreads: for each lane, `oof_logit_resid_sd` in `cache/fit_meta.pkl` (out of fold residual spread on the logit scale from the model's original fit: Reform UK 0.415, Labour 0.548, Conservative 0.549, Liberal Democrats 0.827, Green Party 0.736, Others 1.287). 20,000 draws with a fixed seed: each standing lane's logit share is shifted by an independent normal draw with that spread, the shares renormalised, and the win chance of a lane is the fraction of draws in which it leads. These spreads were measured on scheduled and by-election contests before May 2026 and the draws treat lanes as independent, so the win chance is **not calibrated**; it is reported, and the scoreboard scores the called leader.

## When a contest gets no forecast

A contest polling after the run date gets a record with no forecast and a stated reason, in this order of tests:

1. `outside_england`: the feature file covers English wards only (territory not `ENG`).
2. `no_ward_code_in_feature_file`: `ward_gss` is missing or not in `universe_features_v2.csv` (for example the new East Surrey and West Surrey wards, whose codes are placeholders).
3. `no_published_candidate_list`: `field.sopn_published` is not true or the candidate list is empty. A partial list from before the statement of persons nominated is never used.
4. `no_polling_anchor`: the anchor rule above fails on the run date.
5. `standing_lane_without_model`: a lane standing in the contest has fewer than 50 training rows (`bridge_level_fit`'s rule).

Missing feature values in a row are left missing, as in training; the gradient boosting model handles them natively. Nothing is imputed.

## Freezing

**A forecast is frozen at the time it is written and never revised after polls open.** Polls open at 07:00 Europe/London on polling day. A run before then replaces the contest's record (forecast or skip) with the new one and its new `captured_at`. A run at or after then must leave the record exactly as it stands; the runner refuses any change to it, and a test locks the rule. A contest whose polls have opened without a record never gets one.

Runs dated in the past (`live_check.py`) are for checking the code path only. They write to `results/`, never to `live/`, and are never offered to the scoreboard as live.

## Reproduction check before the first live run

`live_check.py` runs the same code path as of the first of October and the first of November 2026 for the by-elections polling in each month, with two anchors: (a) each contest's own polling day, which is how the cached C2 back-test anchored them, and should reproduce `cache/bridge_level_predictions.pkl` (`c2_*`) for the same contests, and (b) the live rule, the run date. Differences are reported, not tuned away.

## Limits known in advance

- The features are fixed in time (2021 Census, 2019 deprivation index), England only.
- The anchor is national; it carries no regional or by-election specific swing.
- The standing rates on a by-election day are taken over a handful of contests, as in training.
- The base dataset's scheduled rows and their anchors are fixed at the C2 study; only post-May by-elections are rebuilt.
- The ward model alone, not the blend with the candidate engine.
