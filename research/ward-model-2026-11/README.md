# An all-party ward share model for English local elections: research test

27 November 2026. **Research only.** No page, engine, calibration or published forecast reads anything in this folder, and nothing here changes the 2027 pre-registration (`docs/preregistration-2027.md`).

## The question

The 26 November diagnosis found that most of the local engine's remaining error outside London comes from ward demographics, which the engine uses only at council level. It also found that wards with no previous result are called badly. This note asks whether a model fitted at ward level, using the same features and method for every party, beats the site's forecasts on May 2026 and on the council by-elections since then. It also asks whether such a model would justify a ward term or a sealed third forecast arm for 2027.

## What was counted

**Unit.** A local contest in England: a ward or county division on one polling day.

**Target.** Each lane's full-slate vote share: every candidate's votes summed by party, divided by all votes cast for candidates. There are six lanes: Conservative, Labour, Liberal Democrats, Green Party, Reform UK, and Others (independents and every other party, pooled). Labour and Co-operative candidates count as Labour in training. Joint "Reform UK and ..." descriptions count as Reform UK. The pooling follows the site's yardstick, `scripts/score-may-2026-like-for-like.mjs`.

**Why the targets were rebuilt.** The Drive matrix `ward_contests_v2.csv` carries its own share columns, but in multi-member wards they hold the best candidate per party, not the full slate. On the 2,596 May 2026 rows it shares with the site's results, its shares differ from `local-and-mayor.merged.json` on 1,026 rows, and 986 of those are multi-member wards. The site's yardstick scores the full slate, so I rebuilt the targets from candidate votes:

- training rows from `data/history/dc-historic-results.json`, which holds candidates for 17,020 of the matrix's 17,022 Democracy Club rows;
- May 2026 rows from the yardstick's own `vote_shares`.

The matrix supplies features only.

**Checks on the matrix.** It has 19,618 rows dated 2016 to 2026, all with `local.` ballot ids. By year: 2016: 1,513; 2017: 795; 2018: 2,179; 2019: 1,743; 2020: 12; 2021: 2,373; 2022: 2,602; 2023: 1,820; 2024: 2,212; 2025: 1,730; 2026: 2,639. The source column splits them 17,022 `dc` and 2,596 `may26`. The README's "47 features" is not in the file as stated: it has no national polling column, and `ukip_peak_ward` is absent from the scoring universe. I used 44 numeric features (`prepare.py`, `FEATURES_NUMERIC`):

- 24 Census 2021 ward variables;
- NS-SEC, age and car access (8);
- six neighbour lags;
- GE2024 bridged shares for three parties;
- two MRP priors;
- council UKIP 2013 to 2016.

**Further features.** The model also uses region, by-election flag, each lane's standing flag, the number of lanes standing, and the ward's previous result. The previous result enters as each lane's share in the latest earlier contest with the same GSS code, minus that year's mean share for the lane, with years since that contest. "That year's mean" counts only contests dated before the target contest. A ward whose GSS code changed has no previous result.

**Environment anchor.** Each lane's national share on polling day:

- for 2024 contests, the GE2024 GB result, computed from the 631 DC parliamentary ballots where Labour stood: Labour 34.7%, Conservative 24.4%, Reform UK 14.7%, Liberal Democrats 12.6%, Green 6.6%. This is the August method's own approximation for 2024.
- for 24 April 2025 onwards, the 14-day trailing mean of GB polls in `data/polling/wikipedia/westminster-2025-04-15-to-2026-04-25.json` and `data/polling/timeseries.json`, needing at least three polls in the window.

The repo's series stops on 8 November 2026. For the seven by-elections of 19 November I used the last 14-day window available on the day. This applies to by-election rows only, so training is unaffected; the May 2026 predictions before and after the change are identical.

**Model.** One gradient boosting regressor per lane (scikit-learn `HistGradientBoostingRegressor`), fitted only on contests where the lane stood. The target is logit(ward share) minus logit(national anchor share). Every lane uses:

- the same 61 inputs;
- the same 16-point hyperparameter grid;
- the same selection rule: out-of-fold share MAE from 5-fold `GroupKFold` grouped by council, inside the training window.

A forecast is expit(logit(anchor) + predicted offset) for every lane standing, renormalised to sum to one. Standing comes from the nomination list. The model is single family (no SVR ensemble), to keep one procedure across six lanes.

**Training window.** 3,926 contests dated before 7 May 2026 that have an anchor: 2,212 from 2024, 1,673 from 2025 and 41 from January to April 2026. Contests from 2016 to 2023 enter only as previous results. Nothing dated on or after 7 May 2026 enters the fit.

| Lane | Training rows | Councils | Out-of-fold share MAE (pp) | Out-of-fold bias (pp) |
|---|---|---|---|---|
| Reform UK | 2,074 | 249 | 5.30 | -1.59 |
| Labour | 3,764 | 296 | 6.16 | -0.84 |
| Conservative | 3,851 | 302 | 6.42 | -0.81 |
| Liberal Democrats | 3,301 | 279 | 7.69 | -2.37 |
| Green Party | 2,997 | 283 | 5.65 | -1.67 |
| Others | 1,815 | 246 | 10.50 | -4.52 |

Source: `results/summary.json`, `fit.lanes`.

**Scoring conventions.** These follow the site's yardstick:

- the 2,897 local wards in `data/transparency/may-2026-postaudit-2026-05-10.json`;
- results from `data/results/may-2026/local-and-mayor.merged.json`;
- five parties plus Others pooled, with the leader taken by full-slate share;
- a ward an arm cannot forecast counts as a miss in the overall figure;
- per-party error taken over wards where the party has a forecast or an actual share.

Two checks show the scorer is the yardstick's: it reproduces the polling-day forecast's 1,623 of 2,897, and the candidate engine's 1,684 of 2,897.

**Brier score.** Multi-class over the six lanes; lower is better.

- **Common mapping** (all arms): the same mapping turns every arm's shares into leader probabilities. It adds independent normal noise to each lane's logit, using the per-lane standard deviation of the model's out-of-fold training residuals, over 4,000 draws with a fixed seed.
- **Native** (published and site arms): the arm's own `win_probability`.
- **Last time:** all probability on the previous leader.

**Blend.** The weight was fixed in `common.py` before any scoring ran:

- on May 2026, 0.5 × candidate engine share + 0.5 × model share, renormalised;
- on by-elections, where no candidate engine exists, the same 0.5 weight with the site's by-election forecast.

The blend was not tuned.

## Results: May 2026

**How many wards the model can score.** The model scores 2,596 of the 2,897 wards. The other 301 have no row in the Drive matrix, mostly the new 2026 unitaries, whose ballots never matched a GSS code. On the overall basis those 301 count as misses for the model and the blend. All five arms have a forecast for 2,532 wards, which is the fair comparison.

**Wards with the leader called**

| Arm | All 2,897 | Model-scorable 2,596 | All arms 2,532 |
|---|---|---|---|
| Polling-day forecast (5e85c84) | 1,623 (56.0%) | 1,503 (57.9%) | 1,462 (57.7%) |
| Same party as last time | 1,309 (45.2%) | 1,309 (50.4%) | 1,309 (51.7%) |
| Candidate engine, 24 October | 1,684 (58.1%) | 1,566 (60.3%) | 1,525 (60.2%) |
| This model | 1,574 (54.3%) | 1,574 (60.6%) | 1,548 (61.1%) |
| Blend, 0.5 / 0.5 | 1,707 (58.9%) | 1,707 (65.8%) | 1,666 (65.8%) |

**Share error and Brier, the 2,532 wards every arm scores**

| Arm | Share MAE, all lanes (pp) | Brier, common mapping | Brier, native |
|---|---|---|---|
| Polling-day forecast | 7.15 | 0.544 | 0.570 |
| Same party as last time | 13.21 | 0.812 | 0.966 |
| Candidate engine | 6.96 | 0.528 | none published |
| This model | 5.92 | 0.531 | none |
| Blend | 5.63 | 0.467 | none |

**Per-party MAE / signed bias (pp, forecast minus actual), the 2,532 wards**

| Arm | Reform UK | Labour | Conservative | Lib Dem | Green | Others |
|---|---|---|---|---|---|---|
| Polling-day | 8.96 / +3.25 | 6.01 / +1.46 | 7.04 / +2.64 | 5.76 / -1.63 | 7.68 / -5.26 | 7.36 / -1.93 |
| Last time | 23.89 / -23.78 | 16.53 / +16.18 | 11.06 / +9.93 | 5.85 / +2.38 | 9.43 / -7.25 | 10.53 / +4.88 |
| Candidate | 8.89 / +3.58 | 6.09 / -0.68 | 6.74 / +0.76 | 5.65 / -0.88 | 7.07 / -2.16 | 7.29 / -2.07 |
| Model | 8.15 / -6.21 | 5.32 / +0.77 | 5.04 / +1.45 | 4.18 / +0.29 | 5.59 / +2.06 | 8.47 / +4.48 |
| Blend | 7.06 / -1.31 | 5.17 / +0.04 | 5.35 / +1.11 | 4.52 / -0.29 | 5.40 / -0.05 | 6.78 / +1.19 |

**Leads called / actual leads, the 2,532 wards**

| Arm | Reform UK | Labour | Conservative | Lib Dem | Green | Others |
|---|---|---|---|---|---|---|
| Polling-day | 889 / 821 | 605 / 440 | 495 / 386 | 275 / 450 | 148 / 292 | 120 / 143 |
| Candidate | 964 / 821 | 323 / 440 | 421 / 386 | 343 / 450 | 363 / 292 | 118 / 143 |
| Model | 287 / 821 | 622 / 440 | 544 / 386 | 486 / 450 | 352 / 292 | 241 / 143 |
| Blend | 492 / 821 | 546 / 440 | 536 / 386 | 451 / 450 | 321 / 292 | 186 / 143 |

**Strata (model-scorable wards, wards with the leader called)**

| Stratum | Wards | Polling-day | Candidate | Model | Blend |
|---|---|---|---|---|---|
| Has a previous result in the same GSS area | 2,459 | 58.0% | 59.9% | 61.0% | 65.6% |
| No previous result | 137 | 55.5% | 68.6% | 54.0% | 67.9% |
| London | 636 | 70.1% | 58.7% | 72.0% | 73.1% |
| Outside London | 1,960 | 53.9% | 60.9% | 56.9% | 63.4% |

Source for every May 2026 figure: `results/summary.json` → `may_2026`, also in `data/transparency/ward-model-research-2026-11.json`.

## Results: council by-elections after 7 May 2026

**The contests.** These are English council by-elections polled from 11 June to 19 November 2026. Results come from `data/contests/local-byelections/*.json`, whose counts the nightly generator restores from `data/history/byelection-appends.json` where a row is hand verified.

Of 135 English contests dated after 7 May:

- 107 are scored;
- 17 had not been declared;
- 11 have a GSS code that is not in the Drive scoring universe (mostly county divisions on a newer vintage).

The model is frozen. Only its inputs move on: the May 2026 results become previous results.

| Arm | Leaders called (107) | Share MAE (pp) | Brier, common | Brier, native |
|---|---|---|---|---|
| Site by-election forecast | 58 | 7.54 | 0.611 | 0.575 |
| Same party as last time | 55 | 11.05 | 0.663 | 0.972 |
| This model | 70 | 6.69 | 0.493 | none |
| Blend with site, 0.5 / 0.5 | 67 | 6.49 | 0.505 | none |

All four arms have a forecast for 103 of the 107 contests. On those 103 the leaders called are: site 58, last time 52, model 67, blend 67.

**Per-party bias (pp) and leads called / expected / actual, all 107**

| Arm | Reform UK | Labour | Conservative | Lib Dem | Green | Others |
|---|---|---|---|---|---|---|
| Site, bias | +3.18 | -3.65 | -2.26 | -1.00 | +5.19 | -2.46 |
| Site, leads | 30 / 29.6 / 22 | 16 / 15.5 / 23 | 13 / 16.9 / 25 | 20 / 17.3 / 19 | 20 / 18.6 / 15 | 4 / 5.0 / 3 |
| Model, bias | +0.98 | -3.98 | +0.90 | -2.96 | +4.19 | +1.39 |
| Model, leads | 30 / 27.1 / 22 | 11 / 13.0 / 23 | 24 / 25.2 / 25 | 19 / 15.3 / 19 | 21 / 19.1 / 15 | 2 / 7.3 / 3 |

"Expected" is the sum of common-mapping leader probabilities. Source: `results/summary.json` → `byelections`.

**The August finding, all parties.** The August report found Reform UK over-called at summer by-elections. It holds here for leads:

- the model called Reform first in 30 contests and expected 27.1; Reform led 22;
- the site's forecast also called Reform first in 30.

In share, though, the model's Reform bias is small (+0.98pp). The larger share errors are Labour under-forecast by about 4pp and Green over-forecast by about 4pp, and both arms make them. Labour led 23 contests; the model called 11 and the site 16. Nothing here was corrected using these contests.

**The site arm is not a snapshot.** It is the forecast as it stands in each contest file. The files say plainly that most are "graded against the current rebuild" because no published snapshot was kept, so that arm has had more information than it would have had on the day.

## What this shows

1. **On the wards it can score, the ward model alone is at least as good as both site forecasts.** On the 2,532 wards every arm scores, it calls 61.1% of leaders against 60.2% for the candidate engine and 57.7% for the polling-day forecast. Its share MAE is 5.92pp, against 6.96 and 7.15. It is clearly better in London (72.0% against 58.7% for the candidate engine) and on Labour, Conservative, Lib Dem and Green shares. Its Brier score (0.531) is no better than the candidate engine's (0.528).
2. **It under-forecasts Reform UK by 6.2pp and calls far too few Reform leads** (287 against 821 actual). The engine errs the other way (964 called). Their errors largely cancel.
3. **The blend is the strongest arm on every May 2026 measure**, with the weight fixed in advance: 65.8% of leaders on the common wards, MAE 5.63pp, Brier 0.467. That is 141 more wards than the candidate engine on the same 2,532. On all 2,897 it scores 58.9%, because the 301 wards the model cannot score count as misses.
4. **On the cleaner test, the by-elections, the frozen model calls 70 of 107 leaders against 58 for the site's by-election forecast.** Its MAE is 6.69pp against 7.54, and its Brier 0.493 against 0.611. This is the result least exposed to tuning, but 107 contests is a small sample: a 12-contest gap is suggestive, not decisive.

## What this does not show

- **It is not a clean out-of-sample May 2026 test of the features.** The feature set (neighbour lags, NS-SEC, car access) was built in August with May 2026 results already known, and the August report chose it partly on May 2026 performance. My own design choices were made after reading the May 2026 file formats and the 26 November diagnosis, though not after seeing any model scores. The training rows, the model and the blend weight were fixed before the one May 2026 scoring run. Read the May 2026 figures as an upper bound and the by-election figures as the fairer test.
- **One mid-course change.** After the first scoring run, seven by-elections of 19 November had no forecast because the polling series had ended. I gave them the last available 14-day polling window and refitted (same training rows, same seed; the May 2026 predictions are identical to the last decimal). In that first run, the model called 63 of the 100 contests it could score, and the other arms' figures were already visible.
- **Ecological.** It predicts places, not people. Nothing here supports a claim about how any group votes.
- **England only.** There are no Welsh or Scottish rows.
- **The environment anchor is crude.** It is GB Westminster polling, not a local-election equivalent. For 2024 rows it is the GE2024 result two months after those contests, which is the August method's approximation. The logit-offset form assumes a uniform national swing in log odds.
- **301 of 2,897 May wards could not be scored**, nor could 11 of the 118 declared English by-elections. The model's overall figure is weaker than its subset figure for that reason alone.
- **No uncertainty bands are published.** The Brier mapping is one choice, applied equally to every arm.

## Recommendation for the 2027 pre-registration

**Do not add a ward term to the engine now.** The pre-registered engine and protocol stay as they are. A ward term fitted on these results would be tuned on May 2026, the round it would be graded against.

**Do register a sealed third arm, the 0.5 / 0.5 blend of the pre-registered engine and this ward model, before 2027 nominations close.** The reasons:

- it was the best arm on every May 2026 measure;
- the model alone beat the site's by-election forecast on 107 contests that no part of the fit saw;
- the two components err in opposite directions on Reform UK.

A sealed arm costs nothing if it loses. To make it a real test:

1. Freeze this exact code, the training window (here ending 6 May 2026; extended to include May 2026 and by-elections up to the freeze date, then frozen) and the 0.5 weight. Hash them into the pre-registration.
2. Fix how the arm handles wards the model cannot score (fall back to the engine) before any 2027 result exists. Here those wards counted as misses, and a fallback was not pre-stated, so it is not scored.
3. Keep scoring it on by-elections each month from the freeze. That gives a running out-of-sample record before May 2027.
4. The Drive matrix should be regenerated with full-slate targets, or this folder's rebuild kept, and the new 2026 unitaries need GSS matching so the arm covers every ward.

## Reproduce

From a clean clone:

1. Symlink `data/history/dc-historic-results.json` and `node_modules` from the main checkout.
2. Have rclone access to the `doge:` remote, or an existing `cache/drive07`.
3. Run:

```bash
research/ward-model-2026-11/run.sh
```

`run.sh` fetches the Drive inputs (read only, hash checked) and writes the candidate engine's per-ward output with `node scripts/replay-may-2026-candidate.mjs --write-predictions=...`, failing if that touches a tracked file. It then runs `prepare.py`, `fit_predict.py` (about 25 minutes on a loaded laptop), `score.py` and `write_transparency.py`.

## Inputs

Neither Drive file is committed; both are copied into the gitignored `cache/`. The Drive folder is internal and single-party. Only its neutral feature columns are used here: none of its Reform scores, win probabilities, battleground lists or briefings enter this folder.

| Input | Bytes | sha256 |
|---|---|---|
| Drive `DOGE/Elections & Demographics/07 Models (Reform propensity)/ward_contests_v2.csv` (9 Aug 2026) | 17,549,121 | `23baa08041a06683d2a54638afb07fd38586e1e5b61f041d253fbaeb8bc99f6d` |
| Drive same folder `universe_features_v2.csv` (9 Aug 2026) | 6,349,494 | `592a5e96f447a719c61db231c93e14babacbc9d0a344c83041cf1a03b3f97404` |
| Drive same folder `README.txt` (method notes only) | 2,412 | `c20ae9c4fa52def0e13afc3980bae28ce12087ed34dc9f53490a1715647f051f` |
| Drive same folder `REPORT.md` (method notes only) | 16,309 | `5bc013c37844c7740c8e7c6b566dba03db384fbbc1e2c8fc915e1235be89df80` |
| `data/history/dc-historic-results.json` (gitignored, snapshot `dc-historic-results-5b431020aea0`, retrieved 25 Apr 2026) | 64,215,517 | `9b01794873e6125d2c505c8ec98123788b3042b84d9b5b59d9ecd143df5f0b16` |
| `data/results/may-2026/local-and-mayor.merged.json` | 20,585,597 | `99ff664e6de1d2a71c5d178bb27ecbaec3b29b1548d9c10088c6a8ef4f622e74` |
| `data/transparency/may-2026-postaudit-2026-05-10.json` | 6,710,350 | `479328b5aeda5856b66b7d553091c6f8db0f0131054eddac2d2934bc03cbbd02` |
| Candidate engine output written by the replay (cache) | 844,340 | `b508238f9806220a13112ecafd536926a6b36423e8c463e748f58e2a99d62fa8` |
| Polling-day forecast, `git show 5e85c84:data/predictions/may-2026/local-and-mayor.json` | n/a | `566868149ccbdf67015bcf8d70656f2f34a300b16bf3b964cd9835f8e00139e5` (checked by `score.py`) |

Other tracked inputs are read at the commit this branch is cut from (`7d2de83`):

- `data/polling/wikipedia/westminster-2025-04-15-to-2026-04-25.json`
- `data/polling/timeseries.json`
- `data/contests/local-byelections/*.json`

## Files

- `common.py`: paths, lanes, party pooling, the fixed blend weight
- `prepare.py`: targets, features, anchor, ward lags
- `fit_predict.py`: per-lane fit and forecast
- `score.py`: every arm on both tests
- `write_transparency.py`: summary tables to `data/transparency/ward-model-research-2026-11.json`
- `results/summary.json`: full tables, training metadata, skipped contests
- `results/model_ward_shares.csv`: this model's six-lane shares for each scored May 2026 ward and by-election
