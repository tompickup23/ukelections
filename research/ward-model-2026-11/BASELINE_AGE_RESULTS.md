# Discounting an old baseline in the site engine: results

27 November 2026. **Research only.** Specification: `BASELINE_AGE_SPEC.md`, committed before any forecast under the rule was produced (commit `9aed2dc`). One run of the fit and scoring. Every figure below is from `results/baseline_age_summary.json`, written by `baseline_age_score.py`.

## Answer

**Not supported.** The rule needed three things. Two held and one did not: the engine with the rule called fewer leaders than without, though its share error fell. The blend gained 16 wards out of fold, but for the same reason as before: the rule pushes the engine towards Reform UK, and the ward model runs Reform UK low. It did not fix the fault it was aimed at.

## The three tests

| Test set in advance | Before | With the rule | Result |
|---|---|---|---|
| 1. Engine, out of fold, 2,532 wards with a base: leaders called | 1,525 | 1,506 | Fails |
| 1. Engine, same wards: share error (pp) | 6.96 | 6.87 | Holds |
| 2. Blend, out of fold, same wards: leaders called | 1,666 | 1,682 | Holds |
| 3. Blend on the 220 bridged wards, notional result: leaders called | 132 | 134 | Holds |

On the third, the fallback blend's 143 is still the best figure for those wards.

**All five folds chose k = 0.04,** the smallest step above zero: a weight of 0.08 on the fallback at two years and 0.2 at five. Training share error by k was close to 6.96, 6.87, 6.92, 7.10 and 7.43 in every fold.

## Why it does not do what was wanted

**The 324 wards with a 2021 base, out of fold**

| Forecast | Leaders called | Share error (pp) | Conservative called first / led |
|---|---|---|---|
| Engine before | 142 | 7.47 | 159 / 52 |
| Engine with the rule | 141 | 7.04 | 142 / 52 |
| Blend before | 197 | 5.47 | 106 / 52 |
| Blend with the rule | 197 | 5.35 | 94 / 52 |

The Conservative over-call barely moves and no extra leader is called. The fault is real and it is larger than the bridged wards showed: on a 2021 base the engine calls the Conservatives first three times as often as they led. A discount this small cannot correct it, and the folds would not choose a larger one because it costs accuracy elsewhere.

**Where the blend's gain came from.** Across the 2,532 wards the engine with the rule called Reform UK first in 1,045 wards, up from 964, when Reform UK led 821. The blend called Reform UK first in 528, up from 492. Fourteen of the blend's 16 extra wards are in the 1,338 wards with a 2024 base (841 to 855), where the base is two years old and age is not the issue. This is the same cancelling of errors found in `ENGINE_NOTIONAL_RESULTS.md`.

**Descriptive only, in sample:** larger k keeps lifting the blend (1,684, 1,696, 1,690 at 0.08, 0.12, 0.16) while the engine alone falls to 1,373. That pattern says the blend wants more Reform UK from its engine half, not an age rule.

## All 2,897 wards at k = 0.04

| Forecast | Leaders called |
|---|---|
| Engine before | 1,684 |
| Engine with the rule, bridged wards on the fallback | 1,665 |
| Blend before | 1,850 (63.9%) |
| Blend with the rule, bridged wards on the fallback | 1,867 (64.4%) |
| Blend with the rule, bridged wards on a notional result | 1,856 |

The 1,867 is in sample for k and is not a result to quote.

## Checks

- With every ward's own history withheld (Democracy Club and the supplementary archive), all 2,971 forecasts are on the fallback. On the 371 wards already on the fallback the recovered stage agrees with the published one to within 0.002.
- k = 0 reproduces the stored candidate arm exactly.

One fault was fixed before any score was read: the first withheld run left 454 wards on a base from the supplementary archive, so that archive was withheld too.

## What this means for 2027

1. **Do not add an age discount to the engine.** It fails its own test and does not fix the 2021 problem.
2. **The 2021 base is a named fault, now measured.** On 324 wards the engine called the Conservatives first in 159 and they led 52. Councils whose last vote was 2021 need more than a damped national swing; the ward model already does better there (blend 197 of 324 against the engine's 142).
3. **The one error that keeps deciding results is the ward model's Reform UK level.** It called Reform UK first in 380 of the 980 wards it led. Three tests today moved the blend only by moving Reform UK calls. That is the place to look next, with the model, not the engine.
4. **The blend weight stays fixed at 0.5.** Every gain seen here came from two errors offsetting.

## Limits

- May 2026 has been scored many times, and this was its only election for the engine. The folds stop k being fitted to the wards it is scored on; they do not make the election new.
- Age and council type go together: nearly all 2021 bases are counties. The rule cannot tell an old base from a county.
- Final-C scales every ward from the national total, so held-out wards are not fully independent of the rest.
