# Two-layer ward model and rolling test: specification

Written 27 November 2026, before any score from this work was produced or read. Research only. Nothing here is read by the site, the engine or a published forecast, and nothing changes `docs/preregistration-2027.md`.

## The question

The November model (this folder's `README.md`) treats a council by-election as a scheduled contest with one yes or no input and the same uncertainty. By-elections differ: since 2021, median turnout is 28.2% against 33.0%, and Liberal Democrats lead 22.8% of them against 18.1% of scheduled contests (counted 27 November 2026 from the local contests in `data/history/dc-historic-results.json`). Does a model that keeps the two apart forecast by-elections better, without changing the forecast for scheduled elections?

## Data

`cache/dataset.pkl` exactly as built for the November model. It is not rebuilt, so the by-elections of 26 November 2026 are not in it. Only contests with a national anchor are used. Counted before any fit:

- scheduled contests: 1,901 on 2 May 2024, 1,399 on 1 May 2025, 2,576 on 7 May 2026;
- by-elections dated after 2 May 2024: 652 on 120 polling days, 23 May 2024 to 19 November 2026. 107 of them are the English by-elections after 7 May 2026 that the November model was scored on.

## Rolling test

Every forecast for a contest on day T uses only contests dated before T. A contest is scored once, then becomes training data for later days.

Scored sets:

1. **By-elections, rolling:** all 652. Reported in full and for the 107 after 7 May 2026.
2. **Scheduled, 1 May 2025:** forecast from scheduled contests of 2024 only.
3. **Scheduled, 7 May 2026:** forecast from scheduled contests of 2024 and 2025. Already scored many times by other arms, so not a clean test.

## The three specifications

All use the November model's method: one gradient boosting regressor per lane, target logit(share) minus logit(national anchor), forecast renormalised over the lanes standing. Hyperparameters are the ones the November model selected for each lane and are not reselected. That selection used contests up to April 2026, which is a small look ahead for the earlier folds.

- **S1, pooled.** The November method refitted on each polling day: scheduled contests and by-elections in one training set, with the by-election yes or no input.
- **S2, base plus party offsets.** Base model: the same inputs without the by-election input, fitted on scheduled contests only. By-election layer: for each lane, the mean of the base model's error at earlier by-elections where the lane stood, on the logit scale, weighted by 0.5 to the power of (age in days / 365), then multiplied by n / (n + 20), where n is the sum of weights. Each earlier error comes from the base model as it stood on that contest's day.
- **S3, base plus ridge layer.** The same base. Layer: for each lane, ridge regression (penalty 10, standardised inputs, the same weights) of the base model's error on five inputs: the base forecast on the logit scale, years since the ward's previous contest, whether it has one, the number of lanes standing, and months since the last May election day. Used when the lane has at least 40 earlier by-elections; otherwise S2's offset.

**Layer off.** The base model's forecast for a by-election with no layer is reported as a diagnostic. For scheduled contests the layer is always off, so S2 and S3 give the base forecast there by construction.

Not more than these three are scored. None of the numbers above (365 days, 20, 10, 40) is tuned.

## Uncertainty

Leader probabilities come from the November scorer's mapping: independent normal noise on each lane's logit, 4,000 draws, fixed seed. Two sets of standard deviations are compared on by-elections:

- **scheduled:** the November model's out of fold standard deviations per lane;
- **by-election:** for each polling day, the weighted standard deviation of each lane's error at earlier by-elections after the layer is applied, with the same weights. Used once a lane has 40 earlier by-elections.

## Measures

Leaders called, share error over all lanes (MAE), signed bias per lane, multi-class Brier score. Comparators on the 107: the November frozen model (70 called), the site's by-election forecast (58) and "same party as last time" (55), as recorded in `README.md`. On May 2026 the base model is also blended 0.5 and 0.5 with the candidate engine, as in November.

## Carry-over, descriptive only

For May 2025 and May 2026: each lane's S2 offset on the day before, beside the base model's mean error for that lane at the May election. Twelve points. No shrinkage factor is fitted from them.

## What would count

- The by-election layer is supported if S2 or S3 beats layer off on both leaders called and share error over the 652, and is not worse on the 107.
- Keeping the types apart is supported if the better of S2 and S3 beats S1 on the same terms.
- Separate uncertainty is supported if the by-election standard deviations give a lower Brier score on by-elections than the scheduled ones.

Anything else is reported as not supported.

## Run rule

One scoring run. A fault that stops the run can be fixed without reading scores. Any rerun after a score has been seen is reported, with what was visible at the time.

## Out of scope here

Splitting the Others lane, a measured entry level for a new party, a single-seat adjustment, ward code bridging for the 301 unscored May 2026 wards, and party by party recalibration of leads. Each is recorded in the estate ideas register (I953 to I957).
