# National seat totals from ward forecasts: specification

Written 27 November 2026, before any seat total in this study was scored. Research only; nothing on the site reads it.

## Question

The ward model forecasts each party lane's vote share in a ward. A public ranking of forecasters scores national seat totals instead: the root mean square error, over parties, of seats forecast against seats won. Which way of turning the ward forecasts into seat totals does best, out of sample, across six May elections?

Forecasts are the cached forward only forecasts of the by-election level study (`BRIDGE_LEVEL_SPEC.md`, `cache/bridge_level_predictions.pkl`): **C0**, the clean pooled model, and **C2**, the same with standing rate inputs. Each was fitted only on contests before its polling day. Six lanes: Reform UK, Labour, Conservative, Liberal Democrats, Green Party, Others.

## Step 1: actual seats and coverage (done before this specification, no score read)

`seats_build.py` writes `results/seats_actual_wards.csv` (one row per scored ward) and `results/seats_coverage.json`. It reads forecasts only to see which rows have one.

- **Seats won and seats up.** 2019 to 2025: candidates with `elected` true in `data/history/dc-historic-results.json` (Democracy Club results), counted by lane with `common.dc_lane`; seats up is the number elected. Every dataset ward in these years has at least one elected candidate, so no seat count is derived or assumed. 7 May 2026: `winners` in `data/results/may-2026/local-and-mayor.merged.json`, lanes by `party_canonical` pooled with `common.pool_party`; a ward is used only where `winner_count` equals the number of winners (all 2,576 do).
- **Scored set.** A ward is scored if it is a scheduled contest in the dataset with a forecast (the same rows for C0 and C2) and known seats. Every method is scored on exactly this set.

| Election | Source ballots | Source seats | Dataset wards | Scored wards | Scored seats | Multi seat wards | of which split between lanes |
|---|---|---|---|---|---|---|---|
| 2 May 2019 | 1,758 | 2,157 | 1,678 | 1,678 | 2,077 | 281 | 53 (19%) |
| 6 May 2021 | 2,287 | 2,695 | 2,255 | 2,106 | 2,480 | 247 | 57 (23%) |
| 5 May 2022 | 2,536 | 4,085 | 2,533 | 2,533 | 4,081 | 972 | 124 (13%) |
| 4 May 2023 | 1,734 | 2,366 | 1,734 | 1,734 | 2,366 | 398 | 83 (21%) |
| 1 May 2025 | 1,400 | 1,638 | 1,399 | 1,399 | 1,637 | 181 | 53 (29%) |
| 7 May 2026 | 2,877 | 4,884 | 2,576 | 2,576 | 4,266 | 987 | 214 (22%) |

Source ballots and seats: scheduled English local ballots that day in the Democracy Club file (2019 to 2025) or in the merged May 2026 file. **These are not all seats up nationally.** The Democracy Club file is incomplete for 2019 and 2023 in particular (both years had far more seats up than it holds); totals here are totals over the scored set, not national totals. In 2021, 149 wards (180 seats) have known seats but no forecast (a standing lane without a fitted model, stage B's rule) and are left out. In 2026, 301 ballots in the merged file are not in the dataset (mostly wards with no code in the Drive feature file).

No year is dropped from M0 to M3.

**Previous contest of the same ward (for M4).** The latest earlier scheduled Democracy Club contest with the same council and ward slug, with at least one elected candidate and a national anchor on its date. Seats up covered (share of scored seats): 2019 1,426 (69%), 2021 1,568 (63%), 2022 3,220 (79%), 2023 2,072 (88%), **2025 134 (8%)**, 2026 4,114 (96%). 2021 loses 587 wards whose previous contest (May 2017) has no anchor; 2025's county divisions were mostly redrawn after 2021, so their slugs do not match.

## Methods

Each of M0 to M3 is applied to C0 and to C2. Let s_ik be ward i's forecast share for lane k (renormalised over lanes with a forecast) and m_i its seats up.

- **M0, benchmark.** Every seat in a ward to the forecast leader.
- **M1, expected seats.** Seats for lane k = sum over wards of m_i times p_ik, where p_ik is the chance lane k leads ward i, from `score.Mapper`'s rule: logit share plus the lane's `oof_logit_resid_sd` from `fit_meta.pkl` times a standard normal draw, the lane with the highest draw leads; 4,000 draws, seed 7, the same draws for every ward (vectorised in `seats_score.win_chances`, identical in result to `Mapper`). Lanes with no forecast cannot lead.
- **M2, spread correction.** One stretch factor lambda for every lane: x' = mean_k + lambda (logit s_ik minus mean_k), where mean_k is lane k's mean forecast logit share over that election's scored wards where it has a forecast (forecasts only, no actual). Shares are then renormalised and p_ik computed as in M1. Lambda is chosen from 0.50 to 3.00 in steps of 0.05 to minimise the mean multi class Brier score of the ward leader (by vote share) over every scored ward of the other five elections; ties go to the value nearest 1.
- **M3, per lane seat calibration, on M2 (fixed in advance, whatever M2 scores).** For the election being scored, using the lambda fitted for it, r_k = 0.5 times log((A_k + 1) / (X_k + 1)), where A_k and X_k are lane k's actual and M2 expected seats summed over the other five elections. Each ward's M2 expected seats are multiplied by exp(r_k) and renormalised so the ward's seats still sum to m_i. The same rule for every lane; the factor 0.5 is the shrinkage, fixed, not tuned.
- **M4, top down, no ward forecast.** Over the scored wards with a previous contest (above), d_k = seat weighted mean of lane k's share of the previous contest's seats, and delta_k = lane k's national anchor on polling day minus the seat weighted mean of its anchor on the previous contest's date (anchors: the dataset's poll anchor, `a_*`). Forecast seat share = max(0, d_k + beta delta_k), renormalised over lanes, times the scored set's seats. Beta is one coefficient for every lane, least squares through the origin of (actual seat share in the matched wards minus d_k) on delta_k, over the lane-year points of the other eligible elections. Rules fixed now:
  - **Eligible elections:** those where wards with a previous contest carry at least 60% of scored seats: 2019, 2021, 2022, 2023 and 2026. **2025 is dropped for M4 and M5** (8% coverage), rather than approximated. So for each scored year beta is fitted on the other four eligible years. Applying the matched wards' seat share to all scored seats assumes the unmatched wards behave alike; that is stated as a limit.
  - A lane that stood in no scored ward that day (known from nominations; Reform UK in 2019) gets no seats and its lane-year point is left out of the fit.
  - A lane not yet polled on the previous contest's date has an anchor of zero there. This affects only Reform UK before February 2019, whose previous seats are also zero.
  - M4 uses no ward forecast, so it is the same for C0 and C2.
- **M5.** The simple mean of M3 and M4 national seat totals, in M4's eligible years.

Leave one election out throughout: lambda, the calibration ratios and beta for an election are fitted only on the other elections. All constants above are fixed now.

## Scoring

For each method, arm and election: national seat totals over the scored set against seats won. **RMSE five** = square root of the mean over Reform UK, Labour, Conservative, Liberal Democrats and Green Party of (forecast seats minus actual seats) squared. **RMSE six** adds Others. One script, `seats_score.py`, run once, writing `results/seats_summary.json`.

## Questions and what counts

**(a) Score per election and mean,** for each method, C0 and C2. A method is **supported** if, on RMSE five, its mean is lower than M0's and M1's means over the same years, and it is lower than M1 in at least four of those years. For M2 and M3 the years are all six; for M4 and M5 they are the five eligible years, and the four of five requirement applies. Judged separately for C0 and C2.

**(b) Which parties drive the error:** per lane signed seat error (forecast minus actual) per election, for M1 and for the best supported method (lowest mean RMSE five among supported methods; if none is supported, the lowest of M2 to M5 is shown and labelled unsupported).

**(c) Are M1's win chances reliable:** per election and arm, a ten band table over lane-ward pairs with a forecast: number of pairs, mean win chance, share where the lane led. Plus the leader Brier score of M1 and M2, M1's expected leaders and actual leaders per lane, and the fitted lambda per fold.

**(d) Sensitivity, reported, not ruled.**
- Per council: for M0 to M3, per council RMSE five, summed over councils, per election.
- Split rule: splits are common (13% to 29% of multi seat wards above), so: in a ward with two or more seats, if the gap between the first and second lane's share is under 5 points, the leader takes ceil(m/2) seats and the second floor(m/2); otherwise the leader takes all. **M0s** applies it to the forecast shares; **M1s** applies it in each of M1's draws and averages. RMSE five per election and mean.

Fit stability reported: lambda, calibration multipliers per lane and beta for every fold.

## Run rule

One run of `seats_score.py`. Before it, the script was checked with `--selftest`, which replaces every actual seat count and ward leader with random values and writes to a scratch file; no real score was produced or read. Faults found that way and fixed before this specification are listed below. A fault that stops the real run may be fixed without reading a score and is reported; any rerun after a score is seen is reported.

**Faults fixed before any score:** the self test showed beta blank in every fold, because Reform UK's anchor is blank before February 2019. Fixed by the two M4 rules above (zero anchor where the lane was not yet polled; no seats and no fit point for a lane standing nowhere, which also stops Reform UK's 14% anchor in May 2019 giving it seats it did not stand for).

## Limits known in advance

- England only, and only the scored set: Democracy Club's coverage of 2019 and 2023 is partial, so these are not national totals and **scores here are not directly comparable with the public ranking**, whose seat set and party list are not known.
- **May 2026 has been scored by many earlier versions** of this model; it is not a clean hold out for the model, only for these fixed methods.
- Six elections is a small sample for a per lane calibration; Reform UK's ratio for 2025 and 2026 rests mostly on the other of the two.
- Win chance is the chance of leading the ward; in multi seat wards m times that chance is an approximation, which (d) tests.
- The ward model alone, not the blend with the candidate engine or the published forecast.
