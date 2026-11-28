# Recency weights in the ward model's training: specification

Written 27 November 2026, before any forecast under these weights was produced or scored. Research only.

## The question

Three tests on 27 November moved the blend only by moving Reform UK calls, and the ward model called Reform UK first in 380 of the 980 May 2026 wards it led. Where is the model's Reform UK level off, and does weighting recent contests more in training correct it?

## Diagnosis, from forecasts already scored

From `cache/rolling_predictions.pkl`, the pooled model refitted on each polling day (S1 in `TWO_LAYER_RESULTS.md`), wards where Reform UK stood. Nothing new is fitted here.

| Contests | Wards | Reform UK actual (%) | Forecast (%) | Bias (pp) | Called first / led |
|---|---|---|---|---|---|
| By-elections, second half of 2024 | 63 | 18.33 | 11.95 | -6.38 | 0 / 8 |
| By-elections, first half of 2025 | 112 | 30.53 | 25.03 | -5.50 | 34 / 42 |
| By-elections, second half of 2025 | 137 | 29.68 | 30.81 | +1.12 | 59 / 49 |
| By-elections, first half of 2026 | 81 | 26.06 | 26.72 | +0.66 | 31 / 22 |
| By-elections, second half of 2026 | 87 | 25.48 | 27.39 | +1.91 | 30 / 18 |
| Scheduled, 1 May 2025 | 1,393 | 30.98 | 16.24 | -14.75 | 12 / 551 |
| Scheduled, 7 May 2026 | 2,569 | 26.56 | 20.22 | -6.34 | 298 / 858 |

At May 2026 the bias is 0.04 points in London and between -9.62 and -12.04 in the North East, North West, West Midlands and Yorkshire.

**Reading.** The level is about right at by-elections once a year of results under the current party system is in training. It is low at the scheduled elections, outside London. The model has no input for time. Every training row counts the same, so for a northern metropolitan ward in May 2026 the scheduled results of May 2024, when Reform UK stood in few wards and polled under its national figure, weigh as much as anything since.

## The change

Each training row gets a weight of 0.5 to the power (age in days / half-life), where age is the days from the row's contest to the day being forecast. Everything else is S1 unchanged: one pooled model per lane, the same inputs, settings and seed, refitted on each polling day from contests dated before it. The weights apply to all six lanes alike.

- **W365:** half-life 365 days. The primary version. The figure was used earlier today for another purpose and is not tuned here.
- **W180:** half-life 180 days. Reported beside it; not the primary.

## Test

The rolling test of `TWO_LAYER_SPEC.md`: 652 by-elections on 120 polling days, and the scheduled elections of 1 May 2025 (1,399 wards) and 7 May 2026 (2,576). S1 is the benchmark on the same rows. Also the 0.5 and 0.5 blend with the candidate engine on the 2,596 May 2026 wards the model scores.

## What would count

W365 is supported if all four hold:

1. by-elections: at least as many leaders called as S1 (428 of 652) and share error no higher (6.86);
2. 1 May 2025: more leaders called than S1 (517);
3. 7 May 2026: more leaders called than S1 (1,559), and Reform UK bias nearer zero than -6.34;
4. the May 2026 blend calls at least 1,707.

W180 is reported against the same four. If only W180 passes, that is a lead for a later test, not a result.

## Run rule

One run of the fit and one of the scorer. A fault that stops the run can be fixed without reading scores. Any rerun after a score is seen is reported.

## Limits known in advance

- May 2026 has been scored by many arms. May 2025 has been scored twice (base and S1). The by-election set is the cleanest.
- Hyperparameters were selected on contests up to April 2026 without weights.
- The diagnosis above was made on the same contests the test scores. The change is one pre-set number, not a fit to them.
