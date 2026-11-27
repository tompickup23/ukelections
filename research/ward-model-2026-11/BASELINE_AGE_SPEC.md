# Discounting an old baseline in the site engine: specification

Written 27 November 2026, before any forecast under this rule was produced or scored. Research only.

## The question

`ENGINE_NOTIONAL_RESULTS.md` found that the engine, given a 2021 county result as its base, called the Conservatives first in 50 of 89 county divisions when they led 16. The engine starts from a ward's last result and moves it by a damped national swing; it has no rule that trusts a five year old result less than a one year old one, beyond a heavier 2025 county anchor where a county has one. Does leaning on the engine's own fallback as the base gets older make it more accurate?

## Counted before any forecast

Baseline year of the polling-day forecast's local wards (commit `5e85c84`): 2025: 116; 2024: 1,357; 2023: 62; 2022: 732; 2021: 324; 2018: 2; 2026 (a by-election earlier that year): 7; none (fallback): 365.

## The rule

For a ward with a base result, the forecast before Step 9b becomes

    (1 - w) x engine forecast + w x fallback forecast,   w = min(0.8, k x age)

- **Engine forecast:** the polling-day engine's, before Step 9b.
- **Fallback forecast:** what the same engine gives the same ward when it has no base result (council 2024 general election result, national swing, the county's 2025 result where there is one), before Step 9b. Got by running the engine with ward histories withheld; council and county aggregates unchanged.
- **Age:** years from the base result's date to 7 May 2026.
- **k:** one number for every ward and every party, from the grid 0, 0.04, 0.08, 0.12, 0.16. At five years these give 0, 0.2, 0.4, 0.6, 0.8. k = 0 is the engine as it is.

Both forecasts are restricted to the parties on the ballot already. The blend is renormalised, then the 24 October candidate's stages (Step 9b with the refitted multipliers, Final-C aimed at the local-election target) are replayed over all wards, as in `engine_notional_replay.mjs`.

## Fit and test

May 2026 is the only election the engine has forecast, so k is chosen and scored by whole-council folds.

1. Councils are put in five folds by a fixed rule (SHA-256 of the council slug, first eight hex digits, modulo 5).
2. For each fold, k is the grid value with the lowest share error (all lanes, November scorer) on the wards of the other four folds that have a base result. Ties go to the smaller k.
3. That k is scored on the held-out fold. The five held-out folds together give the out-of-fold result.
4. **Second test, wards the fit never sees:** the 220 bridged wards with their notional results (129 dated 2024, 89 dated 2021, 2 dated 2023), with k chosen on all wards that have a real base result.

Scored for the engine and for the 0.5 and 0.5 blend with the ward model.

## What would count

Supported if all three hold:

1. out of fold, the engine with the rule calls more leaders and has lower share error than the engine without, on wards with a base result;
2. out of fold, the blend calls at least as many leaders as before;
3. on the 220 bridged wards, the blend with the notional result and the rule calls more leaders than the blend with the notional result alone (132). The fallback blend's 143 is shown beside it.

If the folds mostly choose k = 0, the answer is that the engine needs no age discount.

## Run rule

One run of the fit and scoring. A fault that stops the run can be fixed without reading scores. Any rerun after a score is seen is reported.

## Limits known in advance

- May 2026 has been scored by many arms, and the 220 bridged wards were scored earlier today. The folds guard against fitting k to the wards it is scored on; they do not make May 2026 a new election.
- Final-C scales every ward from the national total, so a held-out ward's forecast depends slightly on the other wards. The same replay is used for every k.
- Age and council type go together: nearly all 2021 bases are counties and nearly all 2022 bases are London boroughs. The rule cannot tell an old base from a county.
- The fallback's stage before Final-C is recovered from rounded multipliers recorded in the forecast file.
