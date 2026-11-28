# Ward model back-test on 2018 to 2023, stage B: specification

Written 27 November 2026, before any stage B forecast was produced or scored. Research only; nothing on the site reads it.

**Stage B depends on PR 192** (branch `claude/data-polls-2017-2019-9876e6`, not merged), which extends `scripts/extract-wikipedia-polls.mjs` to the 2017 and 2019 polling pages and commits three extracts. They are read from that branch with `git show` into `cache/pr192/` (gitignored) and are not copied into this branch.

## Why

Stage A (`BACKTEST_SPEC.md`, `BACKTEST_RESULTS.md`) could not forecast May 2021, trained 2022 and 2023 on one and two years, and its model used six inputs from July 2024 or later. Stage B extends the anchors back to June 2017, adds May 2018 and May 2019, and adds clean arms without the future inputs.

## Polls and anchors

Extracts, all from `scripts/extract-wikipedia-polls.mjs`:

| File | Page, revision | Polls |
|---|---|---|
| `westminster-2017-06-08-to-2017-12-31.json` (PR 192) | Opinion polling for the 2019 United Kingdom general election, 1374586459 | 60 |
| `westminster-2018-01-01-to-2019-05-02.json` (PR 192) | same | 207 |
| `westminster-2019-05-03-to-2019-12-12.json` (PR 192) | same | 189 |
| `westminster-2019-12-13-to-2024-07-04.json` (stage A) | Opinion polling for the 2024 United Kingdom general election, 1363820081 | 996 |

**The PR 192 extractor does not close stage A's gap.** Run on the same saved 2024 page, both on the national section and on the whole page, its output is byte identical to the unchanged extractor's. The 2020 `Brx` column is still not read, so no 2020 poll carries a Reform UK share, and the 547 national rows stage A lost are still lost. There are no polls between 12 December 2019 and 25 January 2020 in either extract.

`backtest_b_anchor.py` builds the anchor for every contest dated from 8 June 2017 to 3 July 2024 (rows from 4 July 2024 keep the anchor in `cache/dataset.pkl`; no test row is dated after April 2024):

- **Window.** The mean of polls whose fieldwork ended in the 14 days to the contest date, needing at least 3 polls carrying each lane, as `prepare.poll_anchor`. **Change from stage A:** where the 14 day window fails for any lane, the same test is applied to a 21 day window; where that fails, the anchor is blank. This was set after seeing which dates had an anchor and before any forecast. The reason: on 2 May 2019 the 14 day window holds 4 polls but only 2 carry a Green Party share, because YouGov folds the Greens into a combined cell; without the fallback May 2019 cannot be forecast at all, and B2 would not exist for the 1,342 May 2021 wards last contested in May 2019. A longer window of real polls is not an estimate. Rows are tagged `polls_14d_stage_b` or `polls_21d_stage_b`.
- **Reform UK lane.** Before the first kept poll with a Brexit Party share (4 March 2019) the lane has no anchor: a party in that lane stood nowhere in the data before August 2019 (checked: no row with a Reform UK lane candidate lacks a lane anchor). From that date the lane's share is Reform UK where a poll gives it, otherwise the Brexit Party, and the lane needs at least 3 polls like the others. Others is the remainder after the lanes anchored.
- **UKIP and Change UK are in Others** throughout.
- GB and UK samples are pooled without distinction. Exact duplicates are dropped. The 14 rows the extractor marks as one of several rows of the same poll (`row_of_multi_row_poll`: alternative question versions, such as a prompt naming Change UK) are dropped, since nothing marks which is the headline figure.

**Ward results map the same way.** `common.dc_lane` lanes a candidate by Electoral Commission id first: PP7931 is Reform UK, and DC records Brexit Party candidates under PP7931 with today's name, so they fall in the Reform UK lane (2 local candidates in 2019, the first in August 2019). UKIP (PP85) falls in Others in every year. Results and anchors therefore agree.

What that gives, from `cache/backtest_b_anchor_report.json`: 12,760 of the 12,784 rows from 8 June 2017 to 3 July 2024 have an anchor, 1,709 of them on the 21 day window (dates in August, September and November 2017, November 2018, March to May 2019 including 2 May, 10 August 2023 and 11 April 2024). Contest dates with no anchor: 8 June and 17 August 2017; 4 January 2018; 10 January and 14 March 2019; 23 and 30 January, 13 and 27 February, 12 and 19 March 2020; 17 and 24 August 2023; 16 and 18 April 2024. 2,015 rows dated in 2024 before 4 July had the July 2024 general election result as anchor and now have the poll anchor; 3 are left blank.

## Test sets

| Set | Rows | Note |
|---|---|---|
| Scheduled, 3 May 2018 | 2,115 | **Thin.** Training is the 38 anchored contests from June 2017 to April 2018; only the Conservative lane has 50. Expected to be unforecastable under the rule below; reported separately whatever happens. |
| Scheduled, 2 May 2019 | 1,678 | Anchor on the 21 day window. |
| Scheduled, 6 May 2021 | 2,255 | |
| Scheduled, 5 May 2022 | 2,533 | |
| Scheduled, 4 May 2023 | 1,734 | |
| By-elections, 2018 | 60 | 1 without anchor. |
| By-elections, 2019 | 65 | 3 without anchor. |
| By-elections, 2020 | 12 | None has an anchor. |
| By-elections, 2021 to April 2024 | 315 | 6 without anchor. |

Scheduled rows on other dates (four in 2018, eight in 2021 to 2023) are not in any set.

## Forward only fitting

As stage A: one fit per scheduled election day on every anchored contest dated before it; one fit per calendar month for by-elections on every anchored contest dated before the first of the month, with by-elections on a scheduled day using that day's fit. A lane is fitted only with at least 50 training rows where it stood.

**Change from stage A: a row is forecast only if every lane standing in it has a fitted model.** Stage A renormalised over the lanes that had one; with only the Conservative lane fitted for May 2018, that would put the Conservatives at 100% everywhere. Rows that fail are counted per set.

## Arms

| Arm | What |
|---|---|
| S1 | Stage A's S1: all inputs in `fit_predict.FEATURES`, settings from `fit_meta.pkl`, rows weighted equally |
| W365 | S1 with each row weighted 0.5 to the power (age in days / 365), age to the fit date |
| S1c | S1 without the six inputs from July 2024 or later: `ge24_reform`, `ge24_labour`, `ge24_con`, `nb_ge24_reform`, `mrp_reform`, `mrp_labour`. Same settings |
| W365c | W365 without the same six |
| B1 | Same party as last time, as stage A |
| B2 | Last time moved by the national change, as stage A, over the lanes standing now. Where a lane has no anchor at the previous contest (the Reform UK lane before March 2019), its national change is taken as zero, so its previous share stands unmoved |
| M2 | For each lane standing, the mean of logit(S1c) and logit(B2) (shares floored at 0.3%), back through expit, renormalised. Where B2 does not exist, M2 is S1c |

All four model arms are fitted on the same rows in the same job, seed 20261127. The settings in `fit_meta.pkl` are not reselected for S1c and W365c.

## Scoring

As stage A: leader by full slate share over six pooled lanes; share error over lanes with a forecast or an actual share; a row an arm cannot forecast counts as a miss in its overall figures; each comparison of two arms is on the rows both forecast. One scoring script, `backtest_b_score.py`, run once, writing `results/backtest_b_summary.json`.

## Questions and what counts as support

**(a) W365c against S1c.** Supported if, on the scheduled elections of 2019, 2021, 2022 and 2023 pooled, W365c calls more leaders than S1c and its share error is no higher, and W365c calls more leaders than S1c in at least three of the four years.

**(b) The clean model against the swing benchmark, and the mix.** Per scheduled year, 2019, 2021, 2022 and 2023: does S1c call more leaders than B2 on the rows both forecast; does M2 call more than S1c (on all rows S1c forecasts, which M2 also forecasts); does M2 call more than B2 on the rows both forecast. Each is supported only if it holds in all four years. 2018 and the by-elections are reported, not part of the rule.

**(c) What the six future inputs are worth.** S1 against S1c per year, scheduled and by-elections: leaders called on common rows and share error. Descriptive.

**(d) Lead bands.** For S1c and M2 per year: rows and share where the called leader won, for forecast leads under 5, 5 or more, 10 or more and 15 or more points. Descriptive.

**(e) Where B2 does not exist.** On rows with an S1c forecast and a B1 forecast but no B2, per year: leaders called by S1c and by B1. Descriptive.

**Stage A comparison.** The 2022 and 2023 figures for S1 and W365 will differ from stage A because training now reaches back to 2017 (and the 21 day fallback adds anchored rows). Both are shown.

## Run rule

One run of `backtest_b_fit.py`, printing row counts and timings only, and one run of `backtest_b_score.py`. A fault that stops a run can be fixed without reading a score and is reported. Any rerun after a score is seen is reported.

## Limits known in advance

- **Features are fixed in time:** 2021 Census and 2019 deprivation index for every year. S1c removes the July 2024 inputs but the Census is still from after 2018 and 2019.
- **The other lag inputs** (`prev_rel_*`, `prev_gap_years`) are built from earlier results only and are not a look ahead.
- **Settings were selected on contests up to April 2026,** with the six future inputs present.
- **No contest from 2020 is anchored,** and none before June 2017, so training has a gap from late 2019 to May 2021.
- **Poll coverage is thin before 2020:** 456 polls over two and a half years on the 2019 page against 996 on the 2024 page, and the 21 day window carries 1,709 rows.
- **May 2021 included elections postponed from 2020.**
- **The ward model alone,** not the blend. **England only,** and only contests with a code in the Drive feature file.
