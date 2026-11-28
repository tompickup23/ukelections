# Recency weights in the ward model's training: results

27 November 2026. **Research only.** Specification: `RECENCY_SPEC.md`, committed before any forecast under these weights was produced (commit `48d7e16`). One run of the fit and one of the scorer. Every figure below is from `results/recency_summary.json`, written by `recency_score.py`.

## Answer

**W365 fails its own test, by one by-election.** It passes three of the four rules set in advance and misses the first: it called 427 of the 652 by-elections where the unweighted model called 428. Under the specification it is not supported.

**The scheduled election result is the largest of the day.** At 7 May 2026 the weighted model called 99 more wards than the unweighted one, and the blend with the candidate engine called 65 more. That is a lead for the May 2027 sealed test, not a result.

## Against the rules set in advance

| Rule | Benchmark (S1) | W365 | Holds |
|---|---|---|---|
| 1. By-elections: leaders called at least 428 of 652 | 428 | 427 | No |
| 1. By-elections: share error no higher than 6.86 | 6.86 | 6.83 | Yes |
| 2. 1 May 2025: more than 517 of 1,399 | 517 | 520 | Yes |
| 3. 7 May 2026: more than 1,559 of 2,576 | 1,559 | 1,658 | Yes |
| 3. 7 May 2026: Reform UK bias nearer zero than -6.34 | -6.34 | -4.75 | Yes |
| 4. May 2026 blend: at least 1,707 of 2,596 | 1,707 | 1,772 | Yes |

W180 fails rule 1 (419 by-elections, share error 6.90) and rule 2 (512). The specification says a pass by W180 alone would be a lead only; it did not pass.

## By-elections, rolling

| Version | Leaders called, all 652 | Share error (pp) | Brier | Before May 2026 (545) | After May 2026 (107) |
|---|---|---|---|---|---|
| S1, unweighted | 428 (65.6%) | 6.86 | 0.474 | 363 | 65 |
| W365 | 427 (65.5%) | 6.83 | 0.471 | 358 | 69 |
| W180 | 419 (64.3%) | 6.90 | 0.477 | 356 | 63 |

- **No real change at by-elections.** W365 loses five before May 2026 and gains four after it. Share error and Brier improve slightly.
- **The Reform UK over-call after May 2026 gets a little worse.** Reform UK led 22 of the 107. S1 called it first in 38, W365 in 40, W180 in 43. Reform UK bias: +2.12, +2.79, +3.05 points.

## Scheduled elections

| Version | 1 May 2025 (1,399) | 7 May 2026 (2,576) | Share error 2026 (pp) | Reform UK bias 2026 (pp) | Reform UK called first / led |
|---|---|---|---|---|---|
| S1, unweighted | 517 (37.0%) | 1,559 (60.5%) | 5.96 | -6.34 | 298 / 858 |
| W365 | 520 (37.2%) | 1,658 (64.4%) | 5.53 | -4.75 | 423 / 858 |
| W180 | 512 (36.6%) | 1,724 (66.9%) | 5.29 | -3.18 | 569 / 858 |

- **The gain is outside London, as the diagnosis predicted.** Outside London (1,940 wards): 1,101, 1,193, 1,257, with Reform UK bias -8.44, -6.49, -4.71. In London (636 wards): 458, 465, 467.
- **May 2025 does not move.** Reform UK was called first in 12, 14 and 11 wards of the 551 it led. Weighting recent rows cannot help when no recent scheduled election under the current party system is in training. Only by-elections lay between May 2024 and May 2025, and the model treats them as a different kind of contest.

## The blend, 2,596 May 2026 wards with a candidate engine forecast

| Arm | Leaders called | Share error (pp) | Brier | Reform UK bias (pp) | Reform UK called first / led |
|---|---|---|---|---|---|
| Candidate engine | 1,566 (60.3%) | 7.02 | 0.530 | +3.41 | 1,028 / 862 |
| Blend with S1 | 1,707 (65.8%) | 5.67 | 0.470 | -1.44 | 536 / 862 |
| Blend with W365 | 1,772 (68.3%) | 5.53 | 0.450 | -0.65 | 662 / 862 |
| Blend with W180 | 1,806 (69.6%) | 5.46 | 0.439 | +0.13 | 787 / 862 |

## Reading

1. **The diagnosis was right about scheduled elections.** Old rows were holding the Reform UK level down outside London, and weighting them down recovers 92 of the 99 wards gained there.
2. **The same weights do nothing for by-elections,** where the level was already right, and they add to the Reform UK over-call after May 2026.
3. **The shorter the half-life, the better May 2026 and the worse by-elections.** That is the pattern of a fit to one election. May 2026 has now been scored by more than twenty arms, and the diagnosis was made on it. The by-election set is the cleaner evidence and it says no change.
4. **May 2025 is the check on that,** and it gives almost nothing: three wards.

## What this means for the 2027 model

- **Do not adopt the weights on this evidence.** The rule was set in advance and W365 missed it.
- **Carry W365 into the May 2027 sealed test as a named arm,** beside S1, with the half-life fixed at 365 days now. May 2027 is the first scheduled election this change has not seen.
- **A version that weights only when forecasting a scheduled election** would pass all four rules on these figures by construction. It is not proposed as a result for that reason. It can be a second sealed arm.
- **The by-election Reform UK over-call is still open.** Nothing tested today reduces it.

## Limits

- **May 2026 has been scored by many arms and the diagnosis was made on it.** The 99 ward gain is not an out of sample estimate.
- **Rule 1 failed by one contest in 652.** That is inside the noise of the set. The rule stands as written all the same.
- **Hyperparameters were selected without weights,** on contests up to April 2026.
- **The blend weight of 0.5 was not retuned.**
- **England only, and only wards with a code in the Drive feature file.** The 26 November 2026 by-elections are not included.
- **Ecological.** The model predicts places, not people.
