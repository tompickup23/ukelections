# Calibrated confidence and a safe call rule for ward forecasts: results

27 November 2026. **Research only.** Nothing on the site reads this. Specification: `SAFECALL_SPEC.md`, committed before any test score was computed (commit `190f141`), with the thresholds already fixed in it. One scoring run of `safecall_score.py`. Every figure below is from `results/safecall_summary.json`, written by that run. "Right" means the party with the largest forecast share also had the largest actual full-slate share, over the six pooled lanes of `score.py`.

## Answer

**The pre-set rule is not met.** For the blend on May 2026, wards labelled safe were right 285 of 312 times, 91.3% (95% interval 87.7% to 94.0%), which passes the accuracy test of 87%. But 312 wards are 10.8% of the site's 2,897 local wards, short of the 15% (435 wards) the rule needs. The label is honest for the blend but covers too little.

**For the model alone the label is not honest.** Wards labelled safe were right 467 of 570 times, 81.9% (78.6% to 84.9%), well short of the 90% it was set to mean.

**Why the two differ.** The mapping was fitted on the model's own forecasts before May 2026 and applied to the blend unchanged, as the specification said. Averaging two forecasts shrinks the lead, and the blend is also more accurate, so the same lead means more for the blend than for the model. On May 2026 the mapping is too cautious for the blend in every band from 0.4 to 0.9, by up to 14 points, and roughly right for the model except at the top. The assumption that the blend's leads mean the same as the model's is therefore false, in the safe direction.

**The threshold chosen on training data:** mapped probability at least 0.7523, which is a forecast lead of at least 25.05 points. In training, 2,611 forecasts met it and 90.8% were right.

## The training set and its warning

6,430 forward-only forecasts dated before 7 May 2026: 1,924 from the rolling ward model (525 by-elections, 1,399 wards on 1 May 2025) and 4,506 from the 2022 and 2023 back-test (PR 191). Right overall: 71.45%; rolling 44.96%, back-test 82.76%.

| Target | Mapped probability at least | Lead at least (pp) | Training forecasts | Right in training |
|---|---|---|---|---|
| 80% | 0.6296 | 12.82 | 4,325 | 82.38% |
| 90% (safe call) | 0.7523 | 25.05 | 2,611 | 90.81% |
| 95% | 0.8889 | 33.14 | 1,672 | 95.51% |

Inside the safe group the two sources disagree: back-test 93.83% right (2,529 forecasts), rolling 62.75% (510). The rolling source alone reaches no target with at least 100 forecasts. So the pooled threshold leans on a settled party system, and May 2026 was not one. That is the main reason the model's label fails.

## The safe call table

Primary mapping, thresholds from training. Intervals are 95% Wilson intervals.

**May 2026, 2,596 forecastable wards (2,576 scheduled and 20 same-day by-elections)**

| Forecast | Target | Labelled | Share of 2,596 | Share of 2,897 | Right | Share right | 95% interval |
|---|---|---|---|---|---|---|---|
| Model | 80% | 1,164 | 44.8% | 40.2% | 859 | 73.8% | 71.2% to 76.2% |
| Model | 90% | 570 | 22.0% | 19.7% | 467 | 81.9% | 78.6% to 84.9% |
| Model | 95% | 223 | 8.6% | 7.7% | 195 | 87.4% | 82.5% to 91.2% |
| Blend | 80% | 792 | 30.5% | 27.3% | 671 | 84.7% | 82.1% to 87.1% |
| Blend | 90% | 312 | 12.0% | 10.8% | 285 | 91.3% | 87.7% to 94.0% |
| Blend | 95% | 85 | 3.3% | 2.9% | 81 | 95.3% | 88.5% to 98.2% |

All wards, for comparison: model right 1,574 of 2,596 (60.6%), blend 1,707 of 2,596 (65.8%).

**107 council by-elections after 7 May 2026** (blend: 0.5 site forecast plus 0.5 model; 103 have both)

| Forecast | Target | Labelled | Right | Share right | 95% interval |
|---|---|---|---|---|---|
| Model | 80% | 41 | 31 | 75.6% | 60.7% to 86.2% |
| Model | 90% | 10 | 8 | 80.0% | 49.0% to 94.3% |
| Model | 95% | 1 | 1 | 100% | 20.7% to 100% |
| Blend | 80% | 41 | 28 | 68.3% | 53.0% to 80.4% |
| Blend | 90% | 14 | 10 | 71.4% | 45.4% to 88.3% |
| Blend | 95% | 3 | 3 | 100% | 43.9% to 100% |

Too few to judge, as the specification said. Neither forecast's safe label beats 80% on them.

## Reliability

Mapped probability against share right, ten bands, primary mapping. No forecast had a mapped probability below 0.34, the first step of the fit.

**May 2026**

| Band | Model: wards | Model: mean probability | Model: right | Blend: wards | Blend: mean probability | Blend: right |
|---|---|---|---|---|---|---|
| 0.3 to 0.4 | 178 | 35.2% | 45.5% | 253 | 35.1% | 46.6% |
| 0.4 to 0.5 | 475 | 43.5% | 42.5% | 672 | 43.5% | 51.6% |
| 0.5 to 0.6 | 779 | 54.6% | 55.5% | 879 | 54.0% | 65.0% |
| 0.6 to 0.7 | 445 | 65.1% | 62.9% | 396 | 65.0% | 78.8% |
| 0.7 to 0.8 | 380 | 75.7% | 78.2% | 234 | 75.7% | 89.3% |
| 0.8 to 0.9 | 129 | 86.1% | 76.0% | 87 | 86.1% | 90.8% |
| 0.9 to 1.0 | 210 | 95.1% | 87.6% | 75 | 94.6% | 94.7% |

Mean calibration error (ward-weighted gap between mean probability and share right): model 3.0 points with this mapping against 6.6 with the scheduled-sigma method in `score.py`; blend 10.4 against 5.4.

**Brier score for "the called leader wins"** (lower is better)

| Test set, forecast | This mapping (isotonic) | Logistic, three inputs | Scheduled sigma (`score.py`) | Flat training rate |
|---|---|---|---|---|
| May 2026, model | **0.2204** | 0.2393 | 0.2256 | 0.2504 |
| May 2026, blend | 0.2152 | 0.2140 | **0.2118** | 0.2284 |
| By-elections, model | 0.2180 | 0.2578 | **0.2122** | 0.2499 |
| By-elections, blend | 0.2349 | 0.2773 | **0.2223** | 0.2314 |

- For the model on May 2026 the new mapping is the best calibrated and has the lowest Brier score.
- For the blend the scheduled-sigma method is better, because it reads the blend's shares rather than borrowing the model's lead history.
- The logistic version does worse on the model. Its "has a previous result" input mostly sorted the training rows by source (21% of rolling rows had one, 91% of back-test rows), so it learned the gap between two eras, not between two kinds of ward.

## Where "safe" fails

Safe label at the 90% threshold, May 2026. These are checks on one rule for every party, not claims about parties.

**By party called**

| Party called | Model: labelled | Model: right | Blend: labelled | Blend: right |
|---|---|---|---|---|
| Conservative | 121 | 89.3% | 39 | 94.9% |
| Green Party | 137 | 80.3% | 107 | 85.0% |
| Labour | 30 | 76.7% | 11 | 90.9% |
| Liberal Democrats | 146 | 95.9% | 80 | 98.8% |
| Others | 126 | 63.5% | 54 | 87.0% |
| Reform UK | 10 | 60.0% | 21 | 100% |

**By region**

| Region | Model: labelled | Model: right | Blend: labelled | Blend: right |
|---|---|---|---|---|
| East Midlands | 1 | 100% | 0 | |
| East of England | 113 | 77.9% | 67 | 94.0% |
| London | 147 | 95.9% | 78 | 96.2% |
| North East | 13 | 76.9% | 5 | 100% |
| North West | 94 | 62.8% | 38 | 78.9% |
| South East | 116 | 86.2% | 60 | 91.7% |
| South West | 8 | 87.5% | 4 | 75.0% |
| West Midlands | 40 | 75.0% | 36 | 94.4% |
| Yorkshire and The Humber | 29 | 75.9% | 16 | 75.0% |

**By previous result**

| | Model: labelled | Model: right | Blend: labelled | Blend: right |
|---|---|---|---|---|
| Has a previous result | 557 | 82.1% | 303 | 91.1% |
| No previous result | 13 | 76.9% | 9 | 100% |

What the checks show:

1. **The model's safe calls fail where the pooled "Others" lane is called** (63.5% of 126) and in the North West (62.8% of 94). The blend repairs most of the first (87.0%) but not the second (78.9% of 38).
2. **The model's few Reform UK safe calls are weak (6 of 10); the blend's are all right (21 of 21).** The candidate engine carries the Reform UK level the model missed. Neither difference rests on many wards.
3. **"Safe" is mainly a London, Liberal Democrat and Conservative label.** London supplies a quarter of the blend's safe calls at 96%.
4. **Wards without a previous result are almost never labelled safe.** The leads there are small, which is the honest outcome.

## Sensitivities, reported only

Fitted on one source alone, with the same threshold procedure:

- **Rolling source only:** no threshold. No group of at least 100 training forecasts reached even 80% right.
- **Back-test only:** safe threshold at a 12.82 point lead. On May 2026 the model's safe calls were then right 68.7% (1,128 of 1,643) and the blend's 79.8% (976 of 1,223). The settled-system mapping is far too confident for 2026.

## How this relates to `data/calibration/confidence.json`

The site file maps the published engine's margin to a winner probability and was fitted on May 2026, so under the site rule it cannot be tested on May 2026 and was not scored. This work is fitted only on earlier forecasts, so May 2026 is a real test for it. The result agrees with that file in spirit: in it no margin bin reaches 90% (the top bin, 20 points and over, is 81.25%). A ward forecast, on either method, earns a nine-in-ten claim only above a lead of about 25 points, and even then only for the blend.

## Limits

- **May 2026 has been scored by many versions of these forecasts,** and lead-against-accuracy figures for the blend on May 2026 were known when the specification was written. Test set A is not clean. Test set B is clean but small.
- **The blend mapping is an assumption, and it proved wrong in the cautious direction.** A mapping fitted on blend forecasts would cover more wards, but there are no pre-May 2026 blend forecasts to fit one on. The first clean chance is to fit on May 2026 blend forecasts and test on May 2027.
- **The training set mixes two eras,** and the threshold depends on how many rows each contributes. Equal weight per row was fixed in advance; another weighting would move the threshold.
- **England only,** and only wards with a code in the Drive feature file: 2,596 of the site's 2,897 local wards on May 2026.

## Faults fixed before the test score was read

One, found in the training-only dry run and recorded in the specification before its commit: an exact tie in training made the first isotonic step 0.0, so a tied forecast would have been given no chance. The mapped probability is floored at the next step up (0.3402). The thresholds did not change.

## What this means

- **Do not put a "safe call" label on the site from this.** The pre-set rule failed on coverage, and the model alone is not safe at its own threshold.
- **The honest claim available today:** for the blend, a lead of 25 points or more was right about nine times in ten on May 2026, for about one ward in nine.
- **For May 2027:** fit the mapping on May 2026 forecasts of whichever forecast is published (the blend, if adopted), freeze it, and test it on May 2027. Report the 2027 safe label as the first clean test.
