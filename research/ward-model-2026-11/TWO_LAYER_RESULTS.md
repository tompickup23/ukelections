# Two-layer ward model and rolling test: results

27 November 2026. **Research only.** Specification: `TWO_LAYER_SPEC.md`, committed before any score was produced (commit `3f6958b`). One scoring run, as the specification requires. Every figure below is from `results/rolling_summary.json`, written by `rolling_score.py`.

## Answer

**Keeping by-elections apart from scheduled contests made the forecast worse, not better.** The one pooled model, refitted on each polling day, beat both two-layer versions on every by-election measure, and a base model that never sees a by-election was much worse at the May 2026 scheduled elections. Under the rules set in advance, the by-election layer is not supported and keeping the types apart is not supported. Separate uncertainty for by-elections is supported, by a small margin.

## What was scored

- 652 council by-elections on 120 polling days, 23 May 2024 to 19 November 2026. Each forecast used only contests dated before its polling day.
- 1,399 scheduled contests on 1 May 2025 and 2,576 on 7 May 2026.

**The scorer agrees with November.** On the 107 by-elections after 7 May 2026 it reproduces the November frozen model's 70 leaders called and 6.69 point share error, and the site forecast's 58 and 7.54. On the 2,596 May 2026 wards the pooled model matches the November model exactly (1,574), as it should: same training rows, same settings.

## By-elections, rolling

| Version | Leaders called, all 652 | Share error (pp) | Brier | Leaders called, the 107 after May 2026 |
|---|---|---|---|---|
| S1, pooled | 428 (65.6%) | 6.86 | 0.474 | 65 |
| Layer off (base only) | 390 (59.8%) | 7.92 | 0.550 | 63 |
| S2, base plus party offsets | 396 (60.7%) | 7.46 | 0.525 | 56 |
| S3, base plus ridge layer | 400 (61.3%) | 7.47 | 0.520 | 58 |
| November frozen model | not scored | | | 70 |
| Site by-election forecast | not scored | | | 58 |

**Against the rules set in advance:**

- *The layer is supported if S2 or S3 beats layer off on leaders and share error over the 652, and is not worse on the 107.* Both beat layer off over the 652. Both are worse on the 107 (56 and 58 against 63). **Not supported.**
- *Keeping the types apart is supported if the better of S2 and S3 beats S1.* S1 leads by 28 contests and 0.6 points of share error. **Not supported.**

**Why the layer failed after May 2026.** The offsets are learned from earlier by-elections, where the base model ran low on Reform UK (bias -7.22 points before May 2026). After May 2026 the base model had the May results in training and no longer ran low (bias +1.42), but the layer went on adding the old correction. S2 then put Reform UK 7.80 points high and called it first in 56 contests when it led 22.

## Scheduled elections

| Version | 1 May 2025 (1,399) | 7 May 2026 (2,576) |
|---|---|---|
| Base, scheduled contests only | 510 (36.5%) | 1,421 (55.2%) |
| S1, pooled with by-elections | 517 (37.0%) | 1,559 (60.5%) |

- **By-elections in training are worth 138 wards at May 2026.** They are the only contests between two May elections, so they carry the current party levels. Without them the base model put Reform UK 8.32 points low; with them, 6.34.
- **May 2025 is a warning.** A model trained on 2024 alone called Reform UK first in 12 to 15 wards when it led 551. The national polling anchor did not carry a change of that size. The model needs a recent election under the current party system in its training, which for 2027 means May 2026.

**The blend, 2,596 May 2026 wards with a candidate engine forecast**

| Arm | Leaders called | Share error (pp) |
|---|---|---|
| Candidate engine | 1,566 (60.3%) | 7.02 |
| Blend with pooled model, 0.5 and 0.5 | 1,707 (65.8%) | 5.67 |
| Blend with base model | 1,583 (61.0%) | 5.96 |

The blend with the pooled model is the November result again. The base model makes a weaker partner.

## Refitting after May 2026 did not help by-elections

On the 107 by-elections after May 2026, the pooled model refitted with May 2026 in training called 65 leaders with 6.22 points of share error. The November model, frozen before May 2026, called 70 with 6.69. Share error improved and leaders called did not. The refitted model called Reform UK first in 38 contests; it led 22. On 107 contests a gap of five is not decisive either way.

## Uncertainty

On the 580 by-elections where at least one lane had a by-election standard deviation, the S2 forecast's Brier score was 0.544 with by-election standard deviations and 0.554 with the scheduled ones. **Supported, narrowly.** By-elections are less predictable for Reform UK in particular: 0.652 on the logit scale against 0.415 at scheduled contests. Conservative: 0.629 against 0.549.

## Carry-over, descriptive

Each lane's by-election offset on the day before a May election, beside the base model's mean error at that election (logit scale):

| Lane | Before May 2025 | At May 2025 | Before May 2026 | At May 2026 |
|---|---|---|---|---|
| Reform UK | +0.525 | +0.823 | +0.453 | +0.388 |
| Labour | -0.407 | -0.403 | -0.336 | -0.133 |
| Conservative | +0.116 | -0.459 | -0.064 | -0.118 |
| Liberal Democrats | +0.104 | -0.313 | +0.083 | -0.128 |
| Green Party | -0.017 | -0.808 | -0.231 | -0.321 |
| Others | +0.157 | +0.312 | -0.021 | -0.876 |

For Reform UK and Labour the by-elections pointed the right way in both cycles. For the other lanes they did not do so reliably. Twelve points; no factor is fitted from them.

## What this means for the 2027 model

1. **Keep one pooled model with the by-election input.** Do not build the two-layer version.
2. **Train on everything up to the lock date,** by-elections included. They are worth more as training rows than as a separate signal.
3. **Use wider uncertainty for by-elections,** from by-election errors.
4. **The Reform UK over-call at by-elections after May 2026 is not fixed** by anything here (38 called, 22 led). It matches the fault found on 26 November in the site's own by-election forecast.

## Limits

- **Hyperparameters were selected on contests up to April 2026,** so the folds before then carry a small look ahead.
- **The 2024 anchor is the general election result,** which a forecaster would not have had before 4 July 2024. Fifteen of the 652 by-elections, on seven polling days, fall before it.
- **England only, and only wards with a code in the Drive feature file.** The 26 November 2026 by-elections are not included.
- **May 2026 has now been scored by more than twenty arms.** The rolling by-election figures are the cleaner evidence.
- **Ecological.** The model predicts places, not people.
