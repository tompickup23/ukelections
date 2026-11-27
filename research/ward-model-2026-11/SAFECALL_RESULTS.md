# An honest confidence measure and a "safe call" label: results

27 November 2026. **Research only.** Specification: `SAFECALL_SPEC.md`, committed before any test score (commit `a240062`). One scoring run of `safecall_score.py`. Every figure below is from `results/safecall_summary.json` unless marked otherwise. A contest is a ward at a scheduled election or a council by-election; "labelled" is contests at or above the safe threshold; "right" is labelled contests whose called leader topped the actual full-slate share.

## Answer

1. **The pre-set rule was not met.** On 7 May 2026 the blend's safe label was right in 54 of the 57 contests it labelled (94.7%, 95% interval 85.6% to 98.2%), so it is honest, but it labelled only 57 of 2,596 contests (2.2%), far under the 15% required.
2. **The label is safe but too rare, because the mapping learned from a bad year.** Before May 2026 the ward model called only 45.0% of 1,924 leaders right, mostly because it missed Reform UK at the 1 May 2025 elections. Fitted on that, the mapping only reaches 90% at a forecast lead of about 37 points, and below the top it says lower chances than happened: blend contests mapped to 0.5 to 0.6 were right 89.3% of the time.
3. **Ward model alone, May 2026:** 172 of 2,596 labelled safe (6.6%), 154 right (89.5%, 84.1% to 93.3%). Close to its word, still too rare.
4. **By-elections after May 2026:** the label was almost never given: 1 of 107 for the model (right), 2 of 103 for the site and model blend (both right). Nothing can be concluded from that.
5. **Brier:** the primary mapping scores worse than the scheduled-sigma method (`Mapper`) on every test set, and for the blend worse even than one flat rate. As a probability it is not an improvement; only its top step is usable.

## The mapping and thresholds (training only)

Isotonic regression of "called leader right" on forecast lead in points, fitted on 1,924 forward-only S1 forecasts dated before 7 May 2026 (525 by-elections, 1,399 wards on 1 May 2025).

| Level | Threshold (mapped probability) | Equivalent lead (pp) | Training contests labelled | Right |
|---|---|---|---|---|
| 80% | 0.6905 | 33.87 | 103 (5.4%) | 87 (84.5%) |
| 90% (safe call) | 0.8929 | 36.89 | 61 (3.2%) | 58 (95.1%) |
| 95% | 0.8929 | 36.89 | 61 (3.2%) | 58 (95.1%) |

The 90% and 95% labels coincide: the isotonic curve steps from 0.66 straight to 0.89, and the training tail at that step was already right 95.1% of the time. The thresholds were seen in a training-only dry run before the scoring run, as the specification allows. The secondary logistic mapping (lead, previous result, by-election) gave coefficients of 0.0505 per lead point, 0.99 for a previous result and 0.85 for a by-election, on the logit scale.

## Safe call table, test sets (primary isotonic mapping)

| Set and arm | Contests | 90%: labelled (share) | Right | Rate right (95% interval) | 80%: labelled (share) | Right | Rate right (95% interval) |
|---|---|---|---|---|---|---|---|
| May 2026, blend (verdict) | 2,596 | 57 (2.2%) | 54 | 94.7% (85.6 to 98.2) | 78 (3.0%) | 74 | 94.9% (87.5 to 98.0) |
| May 2026, model | 2,596 | 172 (6.6%) | 154 | 89.5% (84.1 to 93.3) | 215 (8.3%) | 188 | 87.4% (82.4 to 91.2) |
| May 2026 scheduled only, blend | 2,576 | 56 (2.2%) | 53 | 94.6% (85.4 to 98.2) | 77 (3.0%) | 73 | 94.8% (87.4 to 98.0) |
| May 2026 scheduled only, model | 2,576 | 171 (6.6%) | 153 | 89.5% (84.0 to 93.2) | 213 (8.3%) | 186 | 87.3% (82.2 to 91.1) |
| By-elections after May, model | 107 | 1 (0.9%) | 1 | 100% (20.7 to 100) | 1 (0.9%) | 1 | 100% (20.7 to 100) |
| By-elections after May, site and model blend | 103 | 2 (1.9%) | 2 | 100% (34.2 to 100) | 3 (2.9%) | 3 | 100% (43.9 to 100) |

All 2,596 May 2026 contests had a candidate engine forecast, so the blend and model sets are the same contests. Overall on May 2026 the model called 1,574 leaders right and the blend 1,707.

**Rule check (blend, May 2026):** rate right 94.7% against at least 87%: met. Coverage 2.2% against at least 15%: not met. **Not supported.**

## Reliability tables, May 2026 (primary mapping; bands of mapped probability)

| Band | Model: contests | Mean mapped | Rate right | Blend: contests | Mean mapped | Rate right |
|---|---|---|---|---|---|---|
| 0.0 to 0.1 | 2 | 0.061 | 50.0% | 3 | 0.049 | 33.3% |
| 0.1 to 0.2 | 0 | | | 2 | 0.125 | 50.0% |
| 0.2 to 0.3 | 273 | 0.275 | 43.6% | 411 | 0.275 | 48.7% |
| 0.3 to 0.4 | 1,177 | 0.355 | 51.7% | 1,409 | 0.351 | 60.5% |
| 0.4 to 0.5 | 426 | 0.454 | 62.7% | 375 | 0.453 | 78.4% |
| 0.5 to 0.6 | 391 | 0.541 | 78.8% | 242 | 0.541 | 89.3% |
| 0.6 to 0.7 | 154 | 0.663 | 75.3% | 96 | 0.661 | 91.7% |
| 0.7 to 0.8 | 1 | 0.771 | 100% | 1 | 0.745 | 100% |
| 0.8 to 0.9 | 75 | 0.893 | 86.7% | 29 | 0.893 | 96.6% |
| 0.9 to 1.0 | 97 | 1.000 | 91.8% | 28 | 1.000 | 92.9% |

Every band below the top with more than five contests is under-confident, by 7 to 35 points for the blend and 4 to 25 for the model. The top band (mapped 1.0) overstates: 91.8% and 92.9% right, not 100%. The by-election tables are in the JSON; with 107 and 103 contests their bands are too thin to read beyond the same pattern (model, 0.4 to 0.5: 25 contests, 76.0% right).

## Brier score, event "the called leader wins"

| Set and arm | Isotonic (primary) | Logistic (secondary) | Mapper, scheduled sigma | Flat training rate | Site `confidence.json` |
|---|---|---|---|---|---|
| May 2026, model | 0.2487 | 0.2233 | 0.2256 | 0.2633 | not admissible |
| May 2026, blend | 0.2773 | 0.2292 | **0.2118** | 0.2684 | not admissible |
| By-elections, model | 0.2654 | 0.2343 | **0.2122** | 0.2634 | 0.2193 |
| By-elections, site and model blend | 0.2845 | 0.2420 | **0.2223** | 0.2677 | 0.2358 |

Lower is better. `Mapper` is best on three of the four; the logistic mapping is best for the model on May 2026. The site's calibration was fitted on 7 May 2026, so under the site rule it is not scored there; on the by-elections it beats both mappings fitted here but not `Mapper`, and its top bin (81.25%) means it can never label anything at 90%.

## Where safe was not safe

- **Ward model, May 2026, 18 misses of 172:** called Others, Labour won (6); called Others, Reform UK won (5); called Green Party, Reform UK won (4); called Green Party, Labour won (2); called Conservative, Reform UK won (1). (From a descriptive listing after the run, not in the JSON.)
- By region (model): North West 27 of 35 right, Yorkshire and The Humber 12 of 17, against 29 of 30 in the East of England, 40 of 41 in London and 30 of 31 in the South East.
- By party called (model): Others 40 of 51 right, Green Party 68 of 74, Conservative 20 of 21, Liberal Democrats 24 of 24, Labour 2 of 2. Reform UK was never called safe by the model.
- **Blend, May 2026, 3 misses of 57** (descriptive listing): Blackburn with Darwen, Shear Brow and Corporation Park, and Bradford, City (both called Others, Labour won); Camden, Highgate (called Green Party, Labour won). By party called: Green Party 31 of 32, Others 17 of 19, Liberal Democrats 4 of 4, Labour 1 of 1, Reform UK 1 of 1.
- **No contest without a previous result was labelled safe** in any test set, so the label is untested there.
- The secondary logistic label was right in only 6 of 8 by-elections for the model (75.0%) and 7 of 10 for the site and model blend (70.0%).

## Sensitivity: mapping refitted with the back-test rows added

Adding 4,506 forward-only S1 forecasts from the back-test file (May 2022, May 2023 and by-elections from 2021 to April 2024; rate right 71.5% over all 6,430 training contests) moves the 90% threshold to a mapped 0.7831, a lead of 25.05 points. Not the verdict.

| Set and arm | 90%: labelled (share) | Right | Rate right (95% interval) |
|---|---|---|---|
| May 2026, blend | 227 (8.7%) | 211 | 93.0% (88.9 to 95.6) |
| May 2026, model | 448 (17.3%) | 375 | 83.7% (80.0 to 86.8) |
| By-elections, model | 7 (6.5%) | 6 | 85.7% (48.7 to 97.4) |
| By-elections, site and model blend | 10 (9.7%) | 8 | 80.0% (49.0 to 94.3) |

Even on the larger training base the blend label stays under 15% coverage, and the model's falls under 87%.

## Reading

The lead is informative, as the brief said: the scoring run's own data reproduces the brief's blend figure of 542 right among the 617 May 2026 contests with a lead of 15 points or more (87.8%; descriptive listing after the run). A 15 point rule would have met the pre-set rule on May 2026, but that figure was found by looking at May 2026 and is not a test. A mapping fitted on the forecasts that existed before May 2026 could not find it, because those forecasts include the 2025 Reform UK miss, when large leads for other parties were overturned. The safe label it produced kept its word on both test sets but would show on about 1 in 45 May 2026 wards for the blend.

## Faults and deviations

- No fault stopped the run and nothing was changed after a test score was seen. One training-only dry run preceded the scoring run.
- Found after scoring, not changed: for the by-election site and model blend, the 4 contests with no site forecast were left out of that arm's denominator (103), where the specification says a contest with no forecast stays in it. Against 107 the 90% coverage is 2 of 107 (1.9%). The verdict arm is unaffected.
- scikit-learn's isotonic `predict` interpolates linearly between the fitted steps, so test leads between two training points get intermediate values (the one contest in the 0.7 to 0.8 band). This is the library's behaviour, kept as specified.

## Limits

- May 2026 has been scored by many versions of the model and engine; S1 and the blend weight were chosen with May 2026 results visible.
- The blend assumption: the mapping was trained on model leads and applied to blend leads. The blend's reliability table shows it was more under-confident than the model's, so a point of blend lead was worth more than a point of model lead; the assumption does not hold well, in the safe direction.
- The by-election test set is small, and the safe label barely appeared in it.
- Training holds one scheduled election day (1 May 2025), an unusual one for this model.
- England only in practice; a few Welsh contests are in training and region is missing for some contests.
- I did not rerun or check the back-test file's fit; it is another session's output, used only for the sensitivity table.
