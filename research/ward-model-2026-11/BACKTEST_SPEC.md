# Ward model back-test on 2021 to 2023, stage A: specification

Written 27 November 2026, before any forecast for these contests was produced or scored. Research only; nothing on the site reads it.

## Why

The ward model has only been tested on by-elections since May 2024 and on the scheduled elections of 1 May 2025 and 7 May 2026. May 2026 has been scored by more than twenty versions. The 365 day recency weighting (W365, `RECENCY_SPEC.md`) missed its rule by one by-election but called 99 more wards at May 2026. This test asks the same questions of elections neither version has seen.

## Inputs

**Contests.** `cache/dataset.pkl`, written by `prepare.py` in the earlier research worktree and copied unchanged. It holds DC candidate votes for English scheduled ward elections and council by-elections, with the 2021 Census and 2019 deprivation features from the Drive matrix.

**National anchor before 4 July 2024.** Polls from Wikipedia, "Opinion polling for the 2024 United Kingdom general election", revision 1363820081, saved with `action=raw`. `scripts/extract-wikipedia-polls.mjs` is run unchanged on the wikitext cut before the line `==Non-geographical samples==` (sha256 of the full page `c632836c...579ce`, of the cut `c96a65ab...b82b50`). The extract is committed as `data/polling/wikipedia/westminster-2019-12-13-to-2024-07-04.json`.

The cut is needed because run on the whole page the extractor also reads the subsample tables (ethnic minority, Muslim, Jewish, renter, young and GB News voters), whose rows carry Area GB or UK. Two further facts about the extract, found before any forecast:

- It holds 996 polls; the national section has 1,543 rows with a fieldwork date template. Rows whose Area cell is shared with the row above by `rowspan` lose a cell and fail the extractor's GB or UK test. They are dropped, not misread, as far as checked.
- The 2020 table heads the Reform UK column `Brx`, which the extractor does not recognise, so no 2020 poll carries a Reform UK share. The first poll with one ends on 5 January 2021.

`backtest_anchor.py` builds the anchor with `poll_anchor` from `prepare.py` unchanged: the mean of polls whose fieldwork ended in the 14 days to the contest date, needing at least 3 polls that carry each of the five parties, Others the remainder. GB and UK samples are pooled without distinction, which is how `prepare.py` treats the 2025 series. Exact duplicates are dropped. Where the rule finds too few polls the anchor is blank; none is estimated.

What that gives, from `cache/backtest_anchor_report.json`:

- the first contest date with an anchor is 6 May 2021. No contest in 2020 has one;
- 2,015 rows dated in 2024 before 4 July had the July 2024 general election result as anchor, a look ahead. All are replaced with the poll anchor; 4 of them are left blank because their dates (11, 16, 18 April 2024) have too few polls;
- other dates after 1 January 2021 left blank: 10, 17 and 24 August 2023.

Rows from 4 July 2024 on keep their existing anchor. No test row is dated after April 2024.

## Test sets

| Set | Rows | Note |
|---|---|---|
| Scheduled, 6 May 2021 | 2,255 | Cannot be forecast: no contest before it has an anchor, so there is no training row. Reported as such. |
| Scheduled, 5 May 2022 | 2,533 | |
| Scheduled, 4 May 2023 | 1,734 | |
| By-elections, 2020 | 12 | Cannot be forecast: no anchor. |
| By-elections, 2021 | 116 | 67 on 6 May 2021 and any others in May 2021 cannot be forecast (no training row). |
| By-elections, 2022 | 66 | |
| By-elections, 2023 | 83 | 5 on unanchored August dates cannot be forecast. |
| By-elections, January to April 2024 | 50 | 4 on unanchored April dates cannot be forecast. |

Eight scheduled rows on June 2021, 2022 and 2023 dates (and one on 26 May 2022) are not in any set. A row that an arm cannot forecast counts as a miss in that arm's overall figures, as in `score.py`, and the count is reported.

## Forward only fitting

Every forecast uses only contests dated before it.

- **Scheduled elections:** one fit per election day, on every anchored contest dated before that day.
- **By-elections:** one fit per calendar month, on every anchored contest dated before the first day of that month, used for every by-election in the month. A by-election held on a scheduled election day uses that day's fit instead.
- A lane is fitted only with at least 50 training rows where it stood, as in `rolling_fit.py` and `recency_fit.py`.

## Arms

Both arms are the pooled ward model unchanged: one `HistGradientBoostingRegressor` per lane, the inputs in `fit_predict.FEATURES`, target logit(share) minus logit(anchor), the settings in `cache/fit_meta.pkl` per lane, seed 20261127, forecast expit(logit(anchor) + offset) over the lanes standing, renormalised.

- **S1:** every training row weighted equally.
- **W365:** each training row weighted 0.5 to the power (age in days / 365), age measured from the row's contest to the fit date (the election day, or the first of the month).

## Benchmarks

On the same rows, from the ward's previous contest: the latest earlier contest in the dataset with the same GSS code, the rule `prepare.py` uses for its lag inputs.

- **Same party as last time (B1):** the leader is the party that led the previous contest. Share error uses the previous shares as they stand.
- **Last time moved by the national change (B2):** for each lane standing now, logit(previous share) plus logit(anchor now) minus logit(anchor at the previous contest), back through expit, renormalised over the lanes standing now. Shares are floored at 0.3% before the logit, as in `common.logit`. Needs an anchor on both dates.

Rows with no previous contest (B1 and B2) or no anchor at the previous contest (B2) are counted and reported separately, not dropped silently. Each comparison of an arm with a benchmark is made on the rows where both have a forecast.

## Scoring

The conventions of `score.py` and `recency_score.py`: leader by full slate share over the six pooled lanes; share error is the mean absolute error over lanes with a forecast or an actual share. One scoring script, `backtest_score.py`, run once, writing `results/backtest_summary.json`.

## Questions and what counts as support

**(a) Does W365 call more leaders than S1?** Supported if, on the scheduled elections pooled, W365 calls more leaders than S1 and its share error is no higher, and W365 calls more leaders than S1 in at least two of the three years. Because 2021 cannot be forecast, that means both 2022 and 2023. By-elections are reported beside this but are not part of the rule.

**(b) Does each arm beat both benchmarks?** For each arm and each scheduled year, supported if it calls more leaders than B1 and more than B2, each on the rows both forecast. Reported per arm and year as holds or not. By-elections are reported by year but are not part of the rule.

**(c) How often is a called leader right, by forecast lead?** Forecast lead is the gap in points between an arm's first and second lanes. For leads under 5, 5 or more, 10 or more and 15 or more, the number of rows and the share where the called leader won, per arm, benchmark and year. Descriptive; no rule.

## Run rule

One run of `backtest_fit.py`, which prints row counts and timings only, and one run of `backtest_score.py`. A fault that stops a run can be fixed without reading a score, and is reported. Any rerun after a score is seen is reported.

## Limits known in advance

- **Ward features are fixed in time.** Every year uses the 2021 Census and the 2019 deprivation index. The inputs `ge24_reform`, `ge24_labour`, `ge24_con`, `nb_ge24_reform`, `mrp_reform` and `mrp_labour` are July 2024 general election results and later MRP estimates, so for 2021 to 2023 they are a look ahead. The model is tested as it is; this flatters both arms against the benchmarks, not one arm against the other.
- **Settings were selected on contests up to April 2026** (`fit_meta.pkl`), which includes nothing tested here but was chosen with knowledge of later elections.
- **Training is thin.** The 2022 forecast learns from May 2021 and the by-elections after it; the 2023 forecast from 2021, 2022 and by-elections. Rows from 2016 to 2020 have no anchor and are not used.
- **May 2021 included elections postponed from 2020**, so it is not in any case a typical year. It cannot be forecast here.
- **The polling extract drops about a third of national rows** for a table format reason, which thins the anchor windows.
- **The ward model alone,** not the blend with the candidate engine. **England only,** and only contests with a code in the Drive feature file.
