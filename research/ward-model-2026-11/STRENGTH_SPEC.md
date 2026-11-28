# Local strength inputs in the ward model: specification

Written 27 November 2026, before any forecast with a strength input was produced or scored. Research only; nothing on the site reads it. Files in this study are prefixed `strength_` or `STRENGTH_`.

## Question

Turned into seat totals, the ward model gives the Liberal Democrats too few May 2026 wards and misplaces Reform UK and the Greens. A party that concentrates effort wins more wards than its vote share implies. The model knows a party's previous share in a ward (`prev_rel_*`) but not whether it won there, by how much, or how strong it is across the council. **Do local strength inputs, each known before polling day and defined the same way for every lane, improve the ward forecasts themselves?** Turning forecasts into seat totals is a separate study (files prefixed `seats_`) and is not repeated here.

## Benchmark and its reproduction

The benchmark is C2 of `BRIDGE_LEVEL_SPEC.md` (PR 197): the clean model plus 18 standing rate inputs, fitted forward only on `cache/bridge_level_dataset.pkl` with the settings in `cache/fit_meta.pkl`. Both pickles are copied read only from the PR 197 worktree; `fit_meta.pkl` is byte identical to this folder's own copy.

Before any change, `uv run python strength_fit.py --reproduce` fitted C2 alone on the six scheduled cuts. Its offsets equal the PR 197 offsets in `bridge_level_predictions.pkl` exactly (largest absolute difference 0 on every lane), and the ward leaders called are the PR 197 counts:

| Test election | Wards | C2 leaders called |
|---|---|---|
| 2 May 2019 | 1,678 | 1,375 |
| 6 May 2021 | 2,255 | 1,702 |
| 5 May 2022 | 2,533 | 2,136 |
| 4 May 2023 | 1,734 | 1,445 |
| 1 May 2025 | 1,399 | 694 |
| 7 May 2026 | 2,576 | 1,794 |

Source: `strength_fit.py --reproduce`, 27 November 2026, against `results/bridge_level_summary.json` of PR 197. These are C2's published figures, not a score of any strength arm.

## Inputs

Code: `strength_inputs.py`. "Topped the poll" means the largest pooled lane share (all of a lane's candidates' votes over all votes cast for candidates, the dataset's `s_*`), among lanes that stood; a tie goes to the first lane in the order Reform UK, Labour, Conservative, Liberal Democrats, Green Party, Others, the same tie rule as the scorer's `top`. Others is a pooled lane (independents and every smaller party together), so "Others topped the poll" means their combined vote was largest. Every input for a row dated T uses only dataset rows dated strictly before T, for training and test rows alike.

**Ward level (added in L1), per lane k, 30 inputs.** At the ward's previous contest: the latest earlier dataset row with the same GSS code, the contest the existing `prev_*` inputs already use (the code asserts that its previous contest date equals `prev_date` on every row).

| Input | Definition | Missing when |
|---|---|---|
| `prev_top_k` | 1 if lane k topped the poll, else 0 | no previous contest |
| `prev_rank_k` | lane k's rank among lanes that stood, 1 = largest | no previous contest, or k did not stand |
| `prev_margin_k` | lane k's share minus the largest other standing lane's share, in points: its lead if it led, minus its gap to the leader if not | no previous contest, or k did not stand |
| `prev_seats_k` | seats won by lane k over seats filled, from the candidates' `elected` flags in `data/history/dc-historic-results.json` (lane by `dc_lane`) or, for 7 May 2026 rows, `data/results/may-2026/local-and-mayor.merged.json` (lane by `pool_party` of `party_canonical`) | no previous contest, or its record has no elected candidate |
| `by_top_k` | 1 if lane k topped the poll at any by-election in the ward dated after the ward's latest earlier scheduled contest (all earlier by-elections if there is none) and before T; 0 if there was such a by-election and k topped none | no such by-election |

**Elected flags are honest enough to use.** Of the 17,020 dataset rows from Democracy Club, 13,437 records have one elected candidate, 1,419 two, 2,155 three, 5 between four and ten, and 4 none (left missing). "Seats filled" is the count of elected candidates; no seat count is assumed. Post-May 2026 by-elections from the contest files carry no elected flags, so `prev_seats_k` is missing where one of those is the previous contest.

**Council level (added in L2), per lane k, 12 inputs.** Over the wards (GSS codes) of the same council slug whose most recent dataset contest before T is no more than 2,000 days old (about five and a half years, so that a ward last fought in May 2016 still counts at the delayed May 2021 elections; the window is fixed here and not tuned), each at that most recent contest:

| Input | Definition | Missing when |
|---|---|---|
| `cou_top_share_k` | share of those wards where lane k topped the poll | no such ward |
| `cou_top_n_k` | count of those wards where lane k topped the poll | no such ward |

The ward itself counts among its council's wards. Abolished wards keep counting until they age out of the window; a council slug that is new (a new unitary) has no earlier wards, so its inputs are missing at its first election.

**Coverage on the test days** (rows with the input present; source `strength_inputs.build` on `bridge_level_dataset.pkl`, 27 November 2026; counts of wards, not scores):

| Test election | Wards | Previous contest (`prev_top_*`) | Elected flags (`prev_seats_*`) | By-election since last scheduled (`by_top_*`) | Council level (`cou_top_*`) |
|---|---|---|---|---|---|
| 2019 | 1,678 | 1,392 | 1,391 | 50 | 1,622 |
| 2021 | 2,255 | 2,138 | 2,137 | 49 | 2,224 |
| 2022 | 2,533 | 2,265 | 2,265 | 127 | 2,533 |
| 2023 | 1,734 | 1,608 | 1,608 | 66 | 1,734 |
| 2025 | 1,399 | 134 | 134 | 14 | 880 |
| 2026 | 2,576 | 2,440 | 2,439 | 258 | 2,576 |

**May 2025 can gain little from the ward inputs**: 134 of its 1,399 county divisions have a previous contest in the dataset, because most divisions were redrawn or their 2021 contest is not in the dataset. The council inputs reach 880.

## Arms

| Arm | Inputs |
|---|---|
| **L0** | C2 as it is: clean inputs plus 18 standing rates |
| **L1** | L0 plus the 30 ward level inputs |
| **L2** | L1 plus the 12 council level inputs |

Every lane model sees every lane's inputs, as with `stood_*` and `prev_rel_*`; nothing is written for one party. Settings are `fit_meta.pkl`'s per lane best parameters, unchanged; no tuning on any test election. Cuts, the 50 row minimum per lane, the rule that a row is forecast only if every standing lane has a model, and the renormalisation are `bridge_level_fit.py`'s: one fit per scheduled test day on contests dated before it; one per calendar month for by-elections from May 2018 to November 2026 on contests dated before the first of the month (a by-election on a test day uses that day's fit). Each (cut, lane) job fits all three arms. The strength inputs add no missing rows, so all three arms forecast the same wards (the scorer asserts this).

## Questions and what counts

Leader by full slate share over the six pooled lanes; a ward an arm cannot forecast counts as a miss; share error is the mean absolute error in points over lanes with a forecast or an actual share (`score.score_arm`, as PR 197).

**(a) Ward forecasts, L1 and L2 each against L0.** Leaders called and share error per year and pooled over the six years (12,175 wards). An arm is **supported** only if all four hold:
1. more leaders called pooled than L0;
2. pooled share error no higher than L0's (to the 0.01 point the scorer rounds to);
3. at least as many leaders as L0 in at least four of the six years;
4. no year with fewer leaders than L0 by more than 1% of that year's wards.

**(b) Party totals.** For each arm, year and lane, over the wards every arm forecast: wards called first minus wards the lane actually led; and the root mean square of that difference over Reform UK, Labour, Conservative, Liberal Democrats and Green Party. This is the proxy for national seat totals. Reported for all six years, with the count of years in which each arm has the lowest root mean square (ties reported as ties). A report, not a rule.

**(c) Where it helps.** Pooled over the six years: leaders called by ward history (same leader as at the previous contest, leader changed, no previous contest), overall and per year; per lane, for wards it led last time and wards it did not, wards called first, called first and led, share error and signed bias. Per year for the Liberal Democrats, Green Party and Others lanes: wards led, wards called first, called first and led, and signed bias, as a check that concentrated parties are better placed. A report, not a per-party rule.

**(d) By-elections.** The same arms on every by-election in the dataset from May 2018 to November 2026 (1,190 contests, 1,153 forecastable), all together and by calendar year: leaders called and share error. A May gain counts as **not paid for** by-elections if, on all by-elections together, the arm calls no fewer leaders than L0 minus 1% of the contests and its share error is no more than 0.10 points above L0's. Reported beside (a); it does not change the (a) verdict but is stated with it.

## Run

1. Commit this specification, `strength_inputs.py`, `strength_fit.py` and `strength_score.py`.
2. `uv run python strength_fit.py` once (writes `cache/strength_predictions.pkl`, `cache/strength_run.pkl`, gitignored), then `uv run python strength_score.py` once (writes `results/strength_summary.json`).
3. Write `STRENGTH_RESULTS.md`: answer first, a table per question, the year by year table, limits.

Any fault found and fixed after the fit but before the score is read is reported in the results. The scorer was dry run once on PR 197's C2 forecasts copied into all three arms, to check it runs; that output was deleted and carries no strength arm figure.

## Limits known before the run

England only. New or redrawn wards have no previous contest, so the ward level inputs are missing for them (most of May 2025). The model settings were chosen on contests up to April 2026. May 2026 has been scored many times in this research programme, so a May 2026 gain is weaker evidence than one in the earlier years. Others is a pooled lane, so its strength inputs mix independents and small parties.
