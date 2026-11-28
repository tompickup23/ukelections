# Others split and a short-memory by-election correction: specification

Written 27 November 2026, before any score from this work was produced or read. Research only. It follows `TWO_LAYER_SPEC.md` and uses the same rolling test, data, scorer and run rule. The yardstick to beat is S1 from `TWO_LAYER_RESULTS.md`: the pooled model, 428 of 652 by-election leaders called, share error 6.86 points, 65 of the 107 after May 2026; 517 of 1,399 at May 2025 and 1,559 of 2,576 at May 2026.

## Why

- The pooled Others lane has the largest error of the six (10.50 points out of fold in November). It mixes independents, who can hold a ward for years, with minor parties that rarely lead one.
- Reform UK is called first too often at by-elections after May 2026 (38 called, 22 led under S1).

## The three specifications

- **R1, Others split.** S1 with seven lanes in place of six: Independent (candidates whose party is recorded as "Independent" in the source) and Minor (every other candidate outside the five parties). Each has its own previous-result input, its own standing flag and its own model. Both use the Others national anchor. The count of lanes standing is over seven. Everything else is S1: same inputs, same settings (both new lanes take the settings November selected for Others), refitted on every polling day. For scoring, Independent and Minor are added back together as Others, so the six-lane measures are unchanged.
- **R2, short-memory correction on S1.** For a by-election on day T and each lane, add to the S1 forecast, on the logit scale, the mean of S1's own error for that lane at earlier by-elections, weighted by 0.5 to the power of (age in days / 90) and multiplied by n / (n + 20), where n is the sum of weights. Then renormalise. Scheduled contests are untouched. This is the offset idea that failed in `TWO_LAYER_RESULTS.md`, changed in two ways: it corrects the pooled model's own current error, and it forgets in three months, not a year.
- **R3, both.** R2's correction applied to R1.

None of the numbers (90 days, 20) is tuned. Not more than these three are scored.

## What would count

- R1 is supported if it beats S1 on leaders called and share error over the 652 by-elections, is not worse on the 107, and is not worse on leaders called at May 2025 and May 2026.
- R2 is supported if it beats S1 on leaders called and share error over the 652 and is not worse on the 107. It is also reported whether it brings Reform UK's called leads on the 107 closer to the 22 it led.
- R3 is supported if it beats the better of R1 and R2 on the same terms.

Anything else is reported as not supported.
