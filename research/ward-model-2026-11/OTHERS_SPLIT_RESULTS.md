# Others split and a short-memory by-election correction: results

27 November 2026. **Research only.** Specification: `OTHERS_SPLIT_SPEC.md`, committed before any score was produced (commit `45a65ae`). One scoring run. Every figure is from `results/split_summary.json`, written by `split_score.py`.

## Answer

**Neither change is worth adopting.** Splitting Others into independents and minor parties did not help. The short-memory correction passed the rule set in advance, but by three contests in 652, and it made the Reform UK over-call worse overall. The pooled model from `TWO_LAYER_RESULTS.md` stays as it is.

## Results

| Version | By-elections, all 652 | Share error (pp) | The 107 after May 2026 | May 2025 (1,399) | May 2026 (2,576) |
|---|---|---|---|---|---|
| S1, pooled (the yardstick) | 428 | 6.86 | 65 | 517 | 1,559 |
| R1, Others split | 422 | 6.87 | 65 | 504 | 1,563 |
| R2, short-memory correction | 431 | 6.77 | 65 | 517 | 1,559 |
| R3, both | 427 | 6.77 | 65 | 504 | 1,563 |

R2 and R3 leave scheduled contests untouched by construction, so their May columns repeat S1 and R1.

**Against the rules set in advance:**

- **R1, not supported.** It called six fewer by-election leaders than S1 and its share error was no better. At May 2026 it called four more wards and at May 2025 thirteen fewer. The split reconciles exactly (Independent plus Minor equals Others on all 19,723 rows), so this is a result, not a fault in the data.
- **R2, supported on the rule, but not a real gain.** Three more leaders in 652 and 0.09 points of share error, with no change on the 107. That is inside the noise of a test this size.
- **R3, not supported.** It did not beat R2.

## The Others lane

The split was meant to cut the Others error. It did not at by-elections (8.39 points against 8.32) and did at May 2026 (8.11 against 8.60). In wards where an independent stood, R1 called 134 of 210 by-elections against S1's 135, and 267 of 518 May 2026 wards against 271. R1 calls Others first less often (32 by-elections against 50, when Others led 42), which removes false calls and misses real ones in about equal measure.

## The Reform UK over-call

The short-memory correction was also meant to bring Reform UK's called leads down after May 2026. On the 107 it called Reform UK first in 36 contests against S1's 38; Reform UK led 22. Over all 652 it called Reform UK first in 181 against S1's 154; Reform UK led 139. A correction that follows recent errors chases the last few rounds and overshoots when the direction turns. **The over-call is not fixed.**

## What this means

1. **Keep the pooled six-lane model unchanged.** Three further specifications have now failed to beat it clearly, on top of the two in `TWO_LAYER_RESULTS.md`.
2. **Stop adding terms to this model.** The inputs it has are close to used up. The larger gains left are outside it: wards it cannot score for want of a ward code, who is standing once nominations close, and the blend with the engine.
3. **The Reform UK over-call at by-elections needs a different kind of evidence,** such as whether a new entrant is standing. That is what the frozen variant in PR 183 tests.

## Limits

As in `TWO_LAYER_RESULTS.md`. In addition: both new lanes use the settings selected in November for Others and the Others national anchor, and R3 applies the correction to the six pooled lanes, not the seven.
