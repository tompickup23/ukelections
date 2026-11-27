# Notional previous result for the site engine on the bridged wards: results

27 November 2026. **Research only.** Specification: `ENGINE_NOTIONAL_SPEC.md`, committed before the engine was run with any notional result (commit `2e8d97c`). One scoring run. Every figure below is from `results/engine_notional_summary.json`, written by `engine_notional_score.py`.

## Answer

**The engine got better and the blend got worse.** With a notional previous result the candidate engine calls 121 of the 220 bridged wards, up from 110, and its share error falls from 9.37 to 6.88 points. The 0.5 and 0.5 blend falls from 143 to 132. Under the rule set in advance the blend had to improve, so **the notional result is not supported for the engine on this evidence.**

## The 220 bridged wards

| Forecast | Leaders called | Share error (pp) | Brier |
|---|---|---|---|
| Engine, fallback (before) | 110 (50.0%) | 9.37 | 0.686 |
| Engine, notional result (after) | 121 (55.0%) | 6.88 | 0.605 |
| Ward model, bridged | 140 (63.6%) | 6.05 | 0.539 |
| Blend, before | 143 (65.0%) | 6.54 | 0.495 |
| Blend, after | 132 (60.0%) | 5.90 | 0.510 |

**The strata named in advance**

| Stratum | Wards | Engine before | Engine after | Model | Blend before | Blend after |
|---|---|---|---|---|---|---|
| Wards | 131 | 59 | 79 | 81 | 90 | 81 |
| County divisions | 89 | 51 | 42 | 59 | 53 | 51 |
| One old area | 97 | 53 | 62 | 65 | 76 | 64 |
| Several old areas | 123 | 57 | 59 | 75 | 67 | 68 |

## Why

1. **The fallback and the model erred in opposite directions, and that was the blend's gain.** The fallback called Reform UK first in all 220 wards; the model put Reform UK 6.10 points low and called it first in 77 when it led 110. Blended, the two gave 130 Reform UK calls and 143 right. With a notional result the engine calls Reform UK first in 90, the blend in 80, and the blend loses Reform UK wards it used to get.
2. **In county divisions the notional result is five years old and it misleads the engine.** The county results are dated 2021. The engine then called the Conservatives first in 50 of 89 divisions when they led 16, and put them 11.23 points high. Its leaders called fell from 51 to 42.
3. **In wards the engine improved sharply (59 to 79 of 131)** and matched the model (81). The blend still fell, for the first reason.

Share error improved for the engine and the blend everywhere. The loss is in who is called first, and it is a loss of Reform UK calls.

## All 2,897 wards

| Forecast | Before | After |
|---|---|---|
| Candidate engine | 1,684 (58.1%) | 1,696 (58.5%) |
| Blend | 1,850 (63.9%) | 1,843 (63.6%) |

Final-C scales every ward from the national total, and the 220 wards now carry weight in it. On the other 2,677 wards the engine's called leader changed in 27 and the blend's in 10; leaders called moved from 1,574 to 1,575 and from 1,707 to 1,711.

## Checks

- The polling-day engine, re-run on contests before 7 May 2026 with nothing added, reproduces the published forecast: 2,971 forecasts, largest difference 0.
- The replay of the candidate's stages with nothing replaced reproduces the stored candidate arm: 2,971 wards, largest difference 0.
- All 220 bridged wards were forecast from a notional result; none stayed on the fallback.

## What this means for 2027

1. **Do not feed a notional result to the engine as it stands.** It helps the engine alone and hurts the blend, which is the arm proposed for sealing.
2. **The ward model should carry the bridged wards.** It called 140 of 220 on its own, close to the old blend's 143 and above the new blend's 132.
3. **The engine's handling of an old baseline is the fault to look at,** not the notional result itself: a 2021 county result was taken too much at face value. That is roadmap idea I953 (older baseline, wider uncertainty) and it applies to every county due in 2027 whose last contest was 2021 or 2022.
4. **The blend's weight is not a fixed truth.** It worked on these wards because two errors cancelled. That is a reason to keep the weight fixed in advance and not to tune it here.

## Limits

- May 2026 has been scored many times. Nothing was fitted to these 220 wards, so this is a fair test of the notional result, but 220 wards is a small sample and a gap of 11 is not large.
- The notional result assumes every small area voted as its old ward did.
- The 81 East Surrey and West Surrey wards are still without a boundary and are not covered.
