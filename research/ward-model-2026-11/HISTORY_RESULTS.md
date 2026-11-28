# The ward model's dataset extended with the 2027 councils' missing history: results

28 November 2026. **Research only.** Nothing on the site, the engine, the publisher or any published forecast reads this folder. Specification: `HISTORY_SPEC.md`, committed before any build (`fdd68a3`). The extended dataset was built with every check passing and committed before the fit (`2dda01d`); the scorer and the dry run wrapper were committed before any score (`3a02193`). C2 was fitted once and scored once. Nothing was changed after the score was seen.

Files: `results/history_manifest.json` (build and checks), `results/history_results.json` (both scorings), `results/history_change_decomposition.json` and `results/history_added_2023_by_party.json` (descriptive breakdowns made after the score, changing nothing), `results/history_groups.json` (Reform UK groups). "Leaders" means wards (May elections) or contests (by-elections) whose first placed lane was called correctly, out of every ward in the set. Share error is the mean absolute error over lanes with a forecast or an actual share, in percentage points.

## Verdict

**(a) fails.** On the original 12,175 May wards the extended C2 calls **9,104 leaders against base C2's 9,135**, with share error **6.15 against 6.08**. Rules 1, 2, 4 and 5 fail; rules 3 and 6 pass. **Under the specification the 2027 dry run is not rerun**, and PR 219's dry run stands as the only one.

| Rule | Result | Figures |
|---|---|---|
| 1. Pooled six years, at least as many leaders | **fails** | 9,104 against 9,135 |
| 2. Pooled share error no higher | **fails** | 6.15 against 6.08 |
| 3. At least as many leaders in four of six years | passes | 2019, 2021, 2022, 2025 |
| 4. No year worse by more than 1% of its wards | **fails** | May 2026: 43 fewer, limit 25.8 |
| 5. Rules 1 and 2 without May 2026 | **fails** (share error) | 7,383 against 7,371 leaders; error 6.35 against 6.29 |
| 6. By-elections: leaders within 1%, error no higher | passes | 809 against 786; error 6.81 against 7.26 |

## (a) The original rows, per year

| Year | Wards | Base C2 | Extended C2 | Difference | Share error, base | Share error, extended |
|---|---|---|---|---|---|---|
| 2019 | 1,678 | 1,375 | 1,375 | 0 | 6.18 | 6.18 |
| 2021 | 2,255 | 1,713 | 1,713 | 0 | 6.04 | 6.04 |
| 2022 | 2,533 | 2,138 | 2,138 | 0 | 5.70 | 5.70 |
| 2023 | 1,734 | 1,442 | 1,425 | -17 | 5.43 | 5.85 |
| 2025 | 1,399 | 703 | 732 | +29 | 8.30 | 8.21 |
| 2026 | 2,576 | 1,764 | 1,721 | -43 | 5.48 | 5.59 |
| Pooled six | 12,175 | 9,135 | 9,104 | -31 | 6.08 | 6.15 |
| Pooled five, without 2026 | 9,599 | 7,371 | 7,383 | +12 | 6.29 | 6.35 |
| By-elections, May 2018 to Nov 2026 | 1,190 | 786 | 809 | +23 | 7.26 | 6.81 |

Base C2 rescored gave the committed figures exactly (9,135 and 6.08; 786 and 7.26), so the comparison is like for like. 2019 to 2022 cannot move: nothing added is dated before their cuts, and their inputs did not change.

**Reform UK, pooled six years:** called first in 979 wards against base 1,088 (it led 1,409); signed share error -3.85 against -2.97. In May 2026: 495 against 641 (led 858), signed error -4.00 against -2.79. At by-elections: 117 against 147 (led 145). **The extension made Reform UK's under calling worse.**

## Why it failed, as far as the outputs show

These breakdowns were made after the score. They explain; they change nothing.

1. **May 2026 (-43) is a training effect.** Every May 2026 ward's own inputs moved only through the standing rates (2,528 wards) or lags (48 wards). The 2026 standing rates barely changed: Reform UK's national rate went from 0.9973 to 0.9974, Labour's from 0.9576 to 0.9592. What changed is what the model learnt from: 2,681 more May 2023 rows, mostly district councils, almost all without a previous result and with Reform UK absent, and May 2023's own standing rates changed sharply with them (Reform UK 0.109 to 0.083, Labour 0.964 to 0.850, Green Party 0.704 to 0.563, Liberal Democrats 0.784 to 0.689). C2 uses these rates as inputs, so the relation it learns between standing rates and shares shifted. Among wards whose only change was the standing inputs, base C2 called 1,733 and extended C2 1,692; 268 leaders changed (`results/history_change_decomposition.json`).
2. **May 2025 (+29) is a training effect in the other direction.** No May 2025 ward's own inputs changed except three; 257 leaders changed and the net was +29. With May 2026's -43, this is the same sensitivity `REBUILD_RESULTS.md` found (C2 at May 2025 moved by 56 wards from 79 by-election anchors): **the May 2025 and 2026 margins carry noise of tens of wards**, and this extension moved them by that much in opposite directions.
3. **May 2023 (-17): 11 of the 17 come from the 35 code reissues (rule C).** The 28 reissued rows in May 2023 lost their previous result (the pre-redraw ward, which C2 had used) and were scored 21 right under base and 10 under extended. The rule was right on boundaries and wrong for the forecast: an old-boundary result still carries most of a ward's party pattern. On the 26 May 2023 wards whose lags changed, 20 against 9; on the other 1,708, 1,422 against 1,416.
4. **Where history was added, it helped.** On the 294 original rows that gained (or, for the reissues, lost) a previous contest, leaders went from 153 to 171 and share error from 9.30 to 7.87. At by-elections, +23 leaders and -0.45 points. The ward history is useful; adding 2,681 history-less training rows on one day, with that day's standing rates, cost more than it gave.

## (b) The added test rows, descriptive

| Set | Rows | C2 leaders | C2 share error | B1 or B2 available |
|---|---|---|---|---|
| Added, 4 May 2023 (baselines file) | 2,677 | 1,416 (52.9%) | 13.15 | none (no 2019 contest added) |
| Added, 7 May 2026 (bridged wards) | 97 | 62 (63.9%) | 7.70 | none (no earlier contest under the 2026 code) |
| The 28 code reissue rows, May 2023 | 28 | base 21, extended 10 | base 8.19, extended 13.26 | |

The 4 added June 2023 contests (15 and 22 June) are not on a test day, so they train only.

**The added 2023 rows are called badly, as wards without a previous result were in every earlier study.** Against the 1,734 original May 2023 wards (extended C2 82.2% right, error 5.85; nearly all have a previous result), C2 on the added rows over calls the Conservatives (first in 1,600, led 904), under calls the Liberal Democrats (147 against 532), the Greens (20 against 181) and Others (103 against 392; Others' signed error -11.34 points). Per lane error is 12 to 16 points against 5 to 8 (`results/history_added_2023_by_party.json`). No benchmark exists on these rows, so whether another method would do better on them is not shown.

## Reform UK groups of the 2027 wards (PR 220)

PR 220 (`SPREAD_DIAGNOSIS.md`, branch `claude/research-reform-spread-1f459d`) found that C2's Reform UK bunching sits in wards whose previous contest had no Reform UK candidate, and projected from the baselines file that 1,955 of the 3,696 verified 2027 wards (52.9%) fall in that group. Counted here from the dry run's own built frame (`v2027_forecast.build`, no fit, no forecast), on the base dataset and the extended one, over the 3,696 verified wards (`results/history_groups.json`):

| Group (model's own rule: latest earlier contest, same code) | Base dataset (PR 219) | Extended dataset | PR 220 projection |
|---|---|---|---|
| Previous result with Reform UK | 1,204 (32.6%) | 1,327 (35.9%) | 1,279 |
| Previous result without Reform UK | 193 (5.2%) | 1,904 (51.5%) | 1,955 |
| No previous result (includes the 438 wards on new boundaries) | 2,299 (62.2%) | 465 (12.6%) | 462 |

Of the 1,834 wards that gain a previous result, 1,711 join the group without Reform UK and 123 the group with it. **So the extension moves the bulk of the 2027 wards into exactly the group where PR 220 found C2 most bunched** (May 2026 slope 1.240; Reform UK first in 425 of 613 wins there). The (a) result agrees: with the extension, Reform UK's first places fell further short. These counts are a property of the dataset, not a forecast; no 2027 forecast was rerun.

## What this means

- **The extended dataset is not adopted.** The 2027 dry run stays on the corrected dataset (PR 219). Its finding that 1,861 wards have no history still stands, and so does the fact that the history exists (as pooled shares) and can be added.
- **The history is not the problem; the rows it arrives in are.** Adding 2,681 training rows on one day without a previous result of their own, and with that day's standing rates, changed the model. Two follow-ups would each be a new specification, not a change to this one: (1) add the 2023 contests **as previous results only** (lags and M50's benchmark for later rows), not as training rows; (2) drop rule C (or keep the old-boundary result as the previous contest). Either is testable on the same scoring.
- **Any gain or loss of tens of wards at May 2025 or May 2026 is within this model's demonstrated noise.** That argues for the sealed test of May 2027 as the decision, and for fit averaging (a parallel study) before more tests of this kind.

## The run

- `history_build.py`: about 3 minutes. Every check passed: I1, I2, H0 (the same code with nothing added reproduces the corrected dataset exactly), P1, P2, R1 (exactly 2,681 rows in 2023 and 97 in 2026 added), R2 (only lag, previous contest and, on the 35 rows of rule C, code and feature columns changed; anchors identical), S1, S2, S3.
- Rows added: A, 2,681 (2,677 on 4 May, 2 on 15 June, 2 on 22 June 2023), 7 left out for want of a feature row, 15 carrying a joint "Reform UK" description moved to Reform UK; B, 97; C, 35 rows relabelled (one to one).
- `history_fit.py`: 91 cuts, 490 lane jobs, 1,024 seconds. **The first attempt was killed by a restart of the Mac** before it wrote any prediction (log kept as `cache/history_fit_attempt1_killed_by_restart.log`); it was started again unchanged, and no output of the first attempt existed or was read.
- `history_score.py`: once.
- `history_v2027.py` was written before the score and **not run**, because (a) failed. `history_groups.py` builds the dry run's frame only, for the Reform UK counts above.
