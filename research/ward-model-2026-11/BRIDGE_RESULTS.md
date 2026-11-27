# Ward code bridge for the unscored May 2026 wards: results

27 November 2026. **Research only.** Specification: `BRIDGE_SPEC.md`, committed before any forecast for these wards existed (commit `a75c2dc`). One scoring run. Every figure is from `results/bridge_summary.json`, written by `bridge_score.py`.

## Answer

**The bridge works.** 220 of the 301 wards the model could not forecast now have one, and on those wards the model calls 140 leaders against the candidate engine's 110. On all 2,897 May 2026 wards the blend rises from 1,707 (58.9%) to 1,850 (63.9%). The 81 wards still unscored are East Surrey and West Surrey, where no boundary is on file.

## The bridged wards

| Arm | Leaders called, 220 wards | Share error (pp) | Brier |
|---|---|---|---|
| Candidate engine, 24 October | 110 (50.0%) | 9.37 | 0.686 |
| November model, through the bridge | 140 (63.6%) | 6.05 | 0.539 |
| Blend, 0.5 and 0.5 | 143 (65.0%) | 6.54 | 0.495 |

**Against the rule set in advance:** the model and the blend each call more leaders than the candidate engine on the same wards. **Supported.**

For scale, on the 2,596 wards scored directly the model calls 60.6% and the blend 65.8%. The bridged wards come out at the same level, which is the evidence that the bridge's approximation does little harm.

**Why the engine does badly here.** With no previous result to start from, it called Reform UK first in all 220 wards. Reform UK led 110.

## All 2,897 wards

| Arm | Before the bridge | After |
|---|---|---|
| November model | 1,574 (54.3%) | 1,714 (59.2%) |
| Blend, 0.5 and 0.5 | 1,707 (58.9%) | 1,850 (63.9%) |
| Candidate engine | 1,684 (58.1%) | unchanged |
| Polling day forecast | 1,623 (56.0%) | unchanged |

A ward with no forecast counts as a miss. 81 still have none.

## By kind of ward

| Group | Wards | Engine | Model | Blend |
|---|---|---|---|---|
| District and unitary wards | 131 | 59 | 81 | 90 |
| County divisions (Essex, Norfolk, Suffolk) | 89 | 51 | 59 | 53 |
| Cut from one old area | 97 | 53 | 65 | 76 |
| Cut from several old areas | 123 | 57 | 75 | 67 |

In two groups the blend is below the model alone. The engine has no baseline in these wards, so it pulls the blend towards Reform UK everywhere. The bridge's notional previous result would give the engine a baseline too; that was not tested here.

The model still runs low on Reform UK in district wards (10.21 points) and called it first in 18 of the 59 it led there. That is the same shortfall as on the wards scored directly, from training on 2024 and 2025 alone.

## What the bridge does

1. Matches each ward to one boundary by name inside its own council or county, with the site's own rule.
2. Assigns each 2021 small area to the new ward that contains its population-weighted centroid. One ward contained none and took its nearest.
3. Finds the old ward or division each small area sat in, and weights by population.
4. Builds the new ward's inputs and its notional previous result as population-weighted means over those old areas.

All 220 had full feature cover. 219 had a previous result for at least 90% of their population. 97 were cut from a single old area.

The refitted model reproduces the 2,596 stored November forecasts exactly (largest difference zero), so the model is unchanged.

## What this means for 2027

1. **Use this bridge for the 2027 wards with new boundaries.** The 2027 ward list (PR 184) has 438 wards that need boundaries; the method is the same once a boundary is on file.
2. **Feed the notional previous result to the engine as well.** It is the engine's missing baseline (roadmap R935).
3. **East Surrey and West Surrey need boundaries** from the Local Government Boundary Commission or Ordnance Survey before anything can forecast them properly.

## Limits

- **Every small area is assumed to carry its old ward's values.** A ward cut from parts of several old wards gets a blur of them.
- **The names are matched, not the codes.** A match is made only when the name is unique inside the council or county.
- **May 2026 is not a clean test of the model** (see `README.md`). It is a fair test of the bridge, because these 220 wards had no forecast from the model before today and nothing was fitted to them.
- **Population weights are 2024 estimates;** the census inputs are 2021.
