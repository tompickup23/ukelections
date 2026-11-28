# The ward model's forecast for 6 May 2027, as an unpublished dry run: specification

Written 28 November 2026, before any 2027 forecast, coverage count or anchor on the run date was computed. **Research only, unpublished, a dry run.** Nothing on the site, the publisher or any cron reads this folder or the output file. This study does not change `docs/preregistration-2027.md`, and it is not vintage 1 of anything named there. Every new file is prefixed `v2027_` or `V2027_`; no existing script or result is edited.

## Purpose

`docs/preregistration-2027.md` names forecast U1 (the site's local engine) and a sealed comparator U2 for the English council elections of 6 May 2027. The research ward model (C2, and the swing blend M50 of PR 216) back-tests better than the engine on wards, but it has never produced a forecast for 2027. This dry run produces one, with seat totals and council control, so that the owner can decide in January 2027 whether the ward model joins or replaces U1. There is nothing to score yet, so this specification exists to stop choices being made after seeing outputs. Any change after the first run is reported as a rerun with its reason.

## Run date and training cut

- **Run date: 28 November 2026**, the day the run is made. The capture time (UTC) is written into the output.
- **Training rows: every anchored contest dated before the run date**, as `live_forecast.fit_and_predict` selects them: for lane k, every row with an anchor, dated before the run date, where lane k stood. Scheduled elections and by-elections alike.
- **Base dataset: the corrected rebuild**, `cache/rebuild/corrected/bridge_level_dataset.pkl`, sha256 `3393cfdba3437f46ad2f2b8485e1621b8a38d4c5605ee33c4c4cd9be38de53a8` (written by `rebuild.py --polls corrected`, 28 November 2026; `REBUILD_RESULTS.md`, "Both" column). `cache/` is a symlink to `~/ukelections-research-cache/corrected-2026-11-28/`. The live runner's own base (`cache/bridge_level_dataset.pkl` in its worktree) predates the input correction and is not used.
- As in `LIVE_SPEC.md`, the base's 107 post-May by-election rows are dropped and rebuilt from the contest files under `data/contests/local-byelections/` at `origin/main` commit `ed3271588327cc0673dd8bcc141186a3cbbbdaba`, by `live_forecast.contest_row` and the same tests (England, polled after 7 May 2026 and before the run date, status `concluded`, result shares present, ward code in the feature file).
- Settings and lane spreads: `cache/fit_meta.pkl`, sha256 `936d07ee4d9004d1cdd811796f60dbfb1b22a723e7575789b56292c287ac67ad`. Seed 20261127. `MIN_ROWS` 50. Nothing is retuned.
- The script stops if any hash above differs.

## National anchor

The 14 day rule of `LIVE_SPEC.md`, unchanged: `prepare.poll_anchor(polls, 2026-11-28, carry_forward=True)`, the mean of polls in the 14 days ending on the latest poll dated on or before the run date, provided that poll is no more than 21 days before it; at least 3 polls carrying each of the five main parties; Others the remainder, floored at 1%. Polls are loaded by `prepare.load_polls` from:

1. `data/polling/wikipedia/westminster-2025-04-15-to-2026-04-25.json`, sha256 `1da7b7a373f1dee1de3fd55ce2b3e494f0a60db9ff40e56785cfa8fd014dc461`, and
2. `research/ward-model-2026-11/live/inputs/timeseries-9588dc90eb62.json`, sha256 `9588dc90eb625e01e860116d2c813526ab3374bfdfeb0725bb58bda40cf194ae`, the publisher's `data/polling/timeseries.json` as copied for the live runner's first run (committed in `25c5a0d`, `generated_at` 27 November 2026 04:30 UTC). The copy on `origin/main` ends on 6 November, more than 21 days before the run date, so it cannot anchor this run; this copy is the freshest committed file and no server is read.

**The anchor is the polls on the run date, not a projection to May 2027.** No trend, no regression to a past result. The same anchor applies to every ward. If the rule fails, the run stops and no forecast is written; nothing is estimated.

## Wards

The list is `data/identity/wards-2027.json` (sha256 `d1fd913b0fc3dd7b7fd75c5dbf51d57fdeef9ec0594a9a245359af105f905e0b`), **block `verified` only**: 3,696 wards in 158 councils. The 1,170 wards of the 65 unverified councils are counted in the coverage table and given no forecast, because their 2027 election is not verified.

## How a ward maps to features (the route)

Tested in this order; each ward takes the first that applies, and every route is counted:

1. **direct**: the ward's `gss_code` is in `cache/drive07/universe_features_v2.csv` (sha256 `592a5e96...97404`). Features and region from that row.
2. **bridge**: the ward has a `gss_code` that is not in the feature file but is in `data/geography/wd26-bgc.geojson`. The method of `BRIDGE_SPEC.md`, steps 2 to 4, run afresh for these codes by `v2027_bridge.py` (matching on the code, so no name match is needed): each 2021 LSOA belongs to the ward whose boundary contains its population weighted centroid (a ward containing none takes the nearest); each LSOA's old ward is its 2025 ward (`lsoa21_to_ward_wd25.csv`); features are the 2024 population weighted mean of the old wards' values in the feature file; total residents is the summed LSOA population; region is the largest old ward's. Lookup files: `~/ukelections-research-cache/from-worktree-all-party-2026-11-28/drive03/`. A ward none of whose old wards is in the feature file gets no forecast (reason `bridge_no_parent_features`).
3. **none**, with one reason each: `unverified_council`; `new_ward_no_ons_code` (wards drawn by a 2027 Electoral Changes Order, which have no ONS code; their boundary files cannot be redistributed, so no bridge is attempted); `code_not_in_boundary_file`; `bridge_no_parent_features`.

The seven `altered_2027` wards (small parish transfers) keep their May 2026 code and route like any other.

## Rows for the 2027 contests

One row per ward with a route, dated 2027-05-06, `is_by` false, council the ward's `council_slug`, set `v2027`, built as `live_forecast.contest_row` builds a row, with no result.

- **Ward lags** (`prev_rel_*`, `prev_gap_years`, `has_prev`). Direct wards: `live_forecast.ward_lags`, the latest earlier contest in the dataset with the same ward code (by-elections included, as `prepare.py`). Bridged wards: the ward's own 7 May 2026 contest on the same boundary, read from `data/results/may-2026/local-and-mayor.merged.json` as ballot `local.<council_slug>.<ward_slug>.2026-05-07` (full slate `vote_shares` pooled by `common.pool_party`), relative to the 2026 year mean as `ward_lags` computes it; if that ballot is absent, `has_prev` is 0. Bridged wards' May 2026 rows do **not** join the training data (they are not in the base dataset; adding them would change the model C2 was tested as).
- **Standing rates**: `bridge_level_fit.standing_inputs` over the whole frame including the 2027 rows, so `nat_stand_k` is the share of 2027 rows where lane k is assumed to stand and `cou_stand_k` the same within the council. For bridged wards `prev_nat_stand_k` is set to the national rate on 2026-05-07, the date of their last scheduled contest, since their code has no earlier row in the dataset.
- Missing feature values stay missing; nothing is imputed.

## Standing rule before nominations close

Nominations for 6 May 2027 close in April 2027. Until then **every forecast assumes, by this rule, which lanes stand**, and every ward record says so:

> **Reform UK, Labour, Conservative, Liberal Democrats and Green Party stand in every ward. Others stand where any candidate outside those five stood at the ward's last scheduled election** (direct wards: the latest earlier scheduled row with the same code in the dataset; bridged wards: the 7 May 2026 contest above). **A ward with no earlier scheduled election: Others do not stand.**

Evidence, computed from the corrected dataset before this specification and before any 2027 row existed (the same rule applied to each May election using only contests before it). Errors are lane-ward pairs: "assumed, did not stand" and "stood, not assumed".

| Election | Wards | Wards with the whole slate right | Reform UK | Labour | Conservative | Liberal Democrats | Green Party | Others |
|---|---|---|---|---|---|---|---|---|
| 7 May 2026 | 2,576 | 1,425 | 7 / 0 | 107 / 0 | 68 / 0 | 376 / 0 | 105 / 0 | 377 / 382 |
| 1 May 2025 | 1,399 | 602 | 6 / 0 | 81 / 0 | 4 / 0 | 126 / 0 | 297 / 0 | 15 / 558 |

Alternatives checked at the same time on May 2026 (wards with the whole slate right): the five main lanes from the ward's last scheduled election plus Reform UK and the Greens everywhere, 1,393; the same with Reform UK only everywhere, 1,118; the last scheduled election alone, 212; the last scheduled election plus Reform UK and the Greens where they stood anywhere in the council at its latest scheduled election, 827. The adopted rule has the fewest errors in both years. **Its known error is Others** (wrong in 759 of 2,576 May 2026 wards) **and the Liberal Democrats** (assumed in 376 May 2026 wards they did not contest). The rule is replaced by the statements of persons nominated when they are published; that is not part of this dry run.

## The two arms

- **C2**, as `LIVE_SPEC.md`: one `HistGradientBoostingRegressor` per lane on `bridge_level_fit.FEATS["c2"]`, target logit(ward share) minus logit(anchor), forecast expit(logit(anchor) + offset) for each standing lane, renormalised over the standing lanes. Fitted by `live_forecast.fit_and_predict` unchanged, once for all 2027 rows.
- **M50**, the blend of `SWINGBLEND_SPEC.md` (PR 216, branch `claude/research-swing-blend-0e4f46`), w = 0.5, applied to the C2 forecast exactly as `swingblend_score.blend` does: where the ward has a previous contest with an anchor at both dates, old lanes (standing now, share above zero last time) take the logit mean of C2 and the swing benchmark (previous share moved by the change in the national anchor on the logit scale, rescaled to C2's total for the old lanes); new lanes keep C2's share; no benchmark means M50 equals C2. Previous contest: direct wards, the latest earlier contest with the same code in the dataset (as the dataset's `prev_date`, `prev_s_*` and `prev_a_*` columns define it: the latest earlier row with a result and the same code, by-elections included), with its anchor; bridged wards, the May 2026 contest above with the May 2026 anchor. The previous anchor is the row's own `a_*` in the dataset; a previous contest with no anchor gives no benchmark.

M50 is reported beside C2, not instead of it. Neither is preferred by this dry run.

## Win chance

The live runner's method (`live_forecast.win_chances`): for each ward and arm, each standing lane's logit share is shifted by an independent normal draw with that lane's `oof_logit_resid_sd` from `fit_meta.pkl`; 20,000 draws; the win chance is the fraction of draws a lane leads. One generator per arm, seed 20261127, wards taken in order of their `id`. For C2 the logit shares are logit(anchor) + offset, as the runner; for M50 they are the logits of M50's renormalised shares. **Not calibrated**, as `LIVE_SPEC.md` says.

## Seats

Over wards with a forecast **and** known seats up (`seats_up` not null) only:

- **M0**: every seat up in a ward to its forecast leader (`SEATS_SPEC.md` M0).
- **Expected seats**: seats for lane k = sum over wards of seats up times lane k's win chance (the principle of `SEATS_SPEC.md` M1, with the live runner's draws in place of its 4,000 draws with seed 7).

Every total is reported with the number of verified seats up not covered beside it (the sum of `seats_up` over wards without a forecast) and the number of wards whose seats up are blank. No uncovered seat is filled.

## Council control

Per council in the verified block, with `CONTROL_SPEC.md`'s rules where they apply:

- A council is callable only if **every** listed ward has a forecast and a known `seats_up`. Otherwise it is listed as not callable with the reason (wards without a forecast; wards with blank seats up).
- Chamber size T is `total_seats.value` in `data/identity/councils-2027.json` (sha256 `6796bf5b...a303e`). Blank T: not callable.
- **All out** (the ward seats up sum to T): seats after the election are the forecast seats.
- **Otherwise (thirds, or seats up below T)**: seats not up are N = C minus D, where C is the council's current composition (`control.seat_counts` in `councils-2027.json`, pooled to lanes by label: a label containing "Reform" is Reform UK, "Labour" Labour, "Conservative" Conservative, "Liberal Democrat" Liberal Democrats, "Green" Green Party, every other label Others), and D the lane of each seat up at the time it was last filled:
  - `seats_up_basis` `elected_2023_same_ward`: the winners of the ballot named in `seats_up_note`, from the Democracy Club ward results file (`~/ukelections-research-cache/drive01/ward_results_2016-2026_candidates.csv`, sha256 `ddeb3ebb...cf4e3`, `elected` flags, lane by `common.dc_lane`); the number of winners must equal the ward's seats up.
  - `order_retirement_2027` (councils elected all out in May 2026 under an order that retires one councillor per ward in 2027): the winner(s) with the fewest votes in the ward's 7 May 2026 contest in `local-and-mayor.merged.json`, as `CONTROL_SPEC.md` rule 4, as many as the ward's seats up.
  - any other basis, or a ballot not found: unresolved.
  
  Not callable if C is missing, C's total differs from T, any ward's D is unresolved, or N is negative in any lane.
- **Control**: a lane with more than T/2 seats; otherwise no overall control. Reported under M0 seats for each arm. Expected seats are not used for control. Largest lane also reported.

Known limits, reported and not corrected: by-elections and defections since a seat was filled change who defends it; the composition is as sourced in `councils-2027.json`, not on polling day; Others pools every independent and local party, so an Others majority does not mean one group holds the council.

## Plausibility, descriptive only

For wards that had a 7 May 2026 contest (direct wards: a 2026-05-07 row with the same code in the dataset; bridged wards: their May 2026 ballot), compare each arm's mean lane shares and first places with the May 2026 result in the same wards. List the ten councils where C2 and M50 disagree on the most first places (ties broken by the share of the council's forecast wards). **Nothing is changed in response.**

## Outputs

- `data/forecasts/research/wards-2027-dryrun.json`: per ward, council, ward, `gss_code`, seats up, route, standing assumption, the six lane shares for each arm, leader and win chance per lane for each arm, or the reason for no forecast; plus an `inputs` block (code commit, dataset sha256, polls file sha256 and latest poll date, contest files commit, capture time). Marked research, unpublished, dry run. No page reads `data/forecasts/`; the PR checks this.
- `results/v2027_results.json` and `V2027_RESULTS.md`: coverage, seats, control, plausibility, and what vintage 1 needs. The write-up's first paragraph says this is a dry run on incomplete coverage and not a prediction of the election.

## Run rule

`v2027_bridge.py` (bridge, counts only), `v2027_forecast.py` (coverage table, then the fit and both arms), `v2027_aggregate.py` (seats, control, plausibility). The coverage table is written and committed before the forecast is run. A fault that stops a run may be fixed before any output is read and is reported. Any rerun after an output is seen is reported with its reason, and nothing is retuned.

## Limits known in advance

- The anchor is the polls of late November 2026, five months before polling day.
- C2 is the ward model alone, not the blend with the candidate engine, England only, features fixed in time (2021 Census, 2019 deprivation).
- Reform UK's ward shares bunch: `LEVEL_DIAGNOSIS.md` (PR 218) finds the Reform UK fault at May 2026 is spread, not level. A parallel study (`spread_` files) is testing a change; this dry run uses C2 as tested.
- The 438 wards of the ten councils redrawn for 2027 get no forecast, so those councils cannot be called.
