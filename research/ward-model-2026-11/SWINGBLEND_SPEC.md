# A fixed blend of the ward model (C2) with the swing from last time: specification

Written 28 November 2026, before any blend or benchmark forecast in this study was scored. Research only; nothing on the site, the engine or the published forecast reads anything in this folder. Every new file in this study is prefixed `swingblend_` or `SWINGBLEND_`; no existing script or result is edited.

## Why

`BACKTEST_B_RESULTS.md` found that, with the July 2024 inputs removed, the ward model (S1c) lost to B2, the ward's last result moved by the national change on the logit scale, in 2019, 2021 and 2022, and that M2, the logit mean of the two, called more leaders than S1c in three of four years. That was on the old polling extract and an older arm (S1c, not C2), and only on 2019 to 2023. This study asks the same question of the current best arm, C2 (standing rates as inputs), on the corrected inputs of `REBUILD_RESULTS.md` ("Both" column), over all six Mays (2019, 2021, 2022, 2023, 2025, 2026) and the by-election set, with the weight fixed now.

## Inputs, read only

| File | What | sha256 |
|---|---|---|
| `cache/rebuild/corrected/bridge_level_predictions.pkl` | C2 forecasts and every row's actual shares, anchor, previous contest and previous anchor; written by `rebuild_fit_score.py --polls corrected` on 28 Nov 2026 | `bb7586ce43bded0159aa7dca8af41fbf1532a26ac7ae3a5337c363d6d8e25d8a` |
| `cache/rebuild/corrected/fit_meta.pkl` | out-of-fold residual spreads for the common Brier mapping | `936d07ee4d9004d1cdd811796f60dbfb1b22a723e7575789b56292c287ac67ad` |

`cache/` here is a symlink to `~/ukelections-research-cache/corrected-2026-11-28/`, the cache of the rebuild worktree. The scorer stops if either hash differs. No model is refitted: C2's forecasts are used exactly as cached.

## Baseline, reproduced before this specification was written

`score.score_arm` over the cached C2 forecasts gives, per May (leaders called of wards, share error in points): 2019 1,375 of 1,678 (6.18); 2021 1,713 of 2,255 (6.04); 2022 2,138 of 2,533 (5.70); 2023 1,442 of 1,734 (5.43); 2025 703 of 1,399 (8.30); 2026 1,764 of 2,576 (5.48); pooled 9,135 of 12,175 (6.08); by-elections 786 of 1,190 (7.26). These equal the "Both" column of `REBUILD_RESULTS.md` and `results/rebuild_bridge_level_summary_corrected.json`. The scorer asserts them before scoring anything else and stops if they differ.

## Coverage, counted before this specification (no score was computed)

Rows by previous contest (latest earlier contest with the same GSS code, `prev_date`), its age at the row's polling day, and whether the benchmark exists (an anchor both at the previous contest and now):

| Set | Under 4 years, benchmark | Under 4 years, no anchor | 4 years or more, benchmark | 4 years or more, no anchor | No previous contest | Rows |
|---|---|---|---|---|---|---|
| May 2019 | 1,339 | 53 | 0 | 0 | 286 | 1,678 |
| May 2021 | 1,508 | 1 | 0 | 629 | 117 | 2,255 |
| May 2022 | 1,641 | 4 | 540 | 80 | 268 | 2,533 |
| May 2023 | 1,416 | 1 | 191 | 0 | 126 | 1,734 |
| May 2025 | 134 | 0 | 0 | 0 | 1,265 | 1,399 |
| May 2026 | 1,414 | 21 | 1,005 | 0 | 136 | 2,576 |
| By-elections | 728 | 43 | 19 | 3 | 397 | 1,190 |

Rows with a previous contest in which at least one lane standing now had no votes last time ("a new lane"): 2019 456; 2021 768; 2022 516; 2023 675; 2025 126; 2026 2,167; by-elections 442. In May 2026 that is Reform UK and the Green Party standing far more widely than four years before. **So the rule for new lanes decides most of May 2026 and has to be fixed now.**

## The benchmark, B2

As `BACKTEST_B_SPEC.md` and `backtest_b_score.benchmarks` define it, unchanged: for each lane standing now, take its share at the previous contest and move it by the change in the national anchor between the two polling days on the logit scale, `expit(logit(prev share) + logit(anchor now) minus logit(anchor then))`, shares floored at 0.3% (`common.logit`); where a lane has no anchor at either date, its change is zero; renormalise over the lanes standing now. B2 exists only where the row has a previous contest and an anchor at both dates. **B2 is reported beside the arms on its own rows, as stage B reported it, and is not part of any rule.** Under that definition a new lane gets its floored previous share, about 0.3% before the national change.

## The blend

For a row with a C2 forecast `m` (shares over the lanes standing now, summing to one):

1. **No C2 forecast:** no blend; the row is a miss, as it is for C2. So every blend arm forecasts exactly C2's rows, and the comparison with C2 is always on the same rows.
2. **No benchmark** (no previous contest, or no anchor at the previous contest or now): the blend is C2 alone.
3. **Otherwise**, split the lanes standing now (`m > 0`) into old lanes O (a share above zero at the previous contest) and new lanes N (no votes then). If O is empty, the blend is C2 alone. Else:
   - benchmark for the old lanes: `r_p = expit(logit(prev_p) + change_p)` for p in O, with B2's change rule; then `b_p = r_p / sum over O of r × sum over O of m`. The benchmark decides how the old lanes split, and the model decides how much the new lanes take. Where there is no new lane, `b` is exactly B2.
   - for p in O: `z_p = w × logit(m_p) + (1 minus w) × logit(b_p)`; for p in N: `z_p = logit(m_p)`.
   - shares `expit(z_p)`, renormalised over the lanes standing now.

`w` is the weight on the model. **Named arm: M50, w = 0.5.** Secondary arms, fixed now and not tuned: **M25, w = 0.25** and **M75, w = 0.75**. Also reported, descriptive only and not an arm under the rules: **M00, w = 0** (B2 for old lanes with the model's share for new lanes and for rows with no benchmark), so the benchmark can be seen on every row.

**No age dependence.** The weight does not depend on the age of the previous result. The prior evidence in this folder points nowhere: an age discount on the engine's baseline failed (`BASELINE_AGE_RESULTS.md`), recency weights failed twice (`RECENCY_RESULTS.md`, `BACKTEST_B_RESULTS.md`), and stage B's B2 did no worse in 2022 and 2023, where more previous results are four years old, than in 2019. With nothing to set an age rule from, none is set. The age breakdown below is reported so a later study can.

## Pass rules: M50 against C2

On the six Mays, as `BRIDGE_LEVEL_SPEC.md` (a), with C2 as the benchmark:

1. pooled over the six Mays, M50 calls more leaders than C2;
2. pooled, M50's share error is no higher than C2's;
3. M50 calls at least as many leaders as C2 in at least four of the six years;
4. in no year does M50 call fewer leaders than C2 by more than 1% of that year's wards.

Plus:

5. **By-elections:** on the 1,190 by-elections from May 2018 to November 2026, M50 calls at least as many leaders as C2 and its share error is no higher.
6. **May 2026 decides nothing:** rules 1 and 2 must also hold pooled over the five Mays without 2026 (9,599 wards).

**M50 is supported only if all six hold.** M25 and M75 are scored by the same six rules and reported. If M50 fails and a secondary arm passes, that is not support for adopting it, since it would be a weight picked after scoring; it becomes a named arm for the next sealed test, nothing more. If M50 passes, the rule to adopt is M50's, whatever the secondary arms score.

Leaders called is the count of wards (contests) whose first-placed lane by full-slate share was called first, out of every row in the set; share error is the mean absolute error, in points, over lanes with a forecast or an actual share (`score.score_arm`, unchanged).

## Reported whatever the result

- Per May, pooled six, pooled five without 2026, and by-elections: leaders called, share error and common-mapping Brier for C2, M25, M50, M75, M00, and B2 on its own rows (with the number of rows it forecasts).
- Head to head on the rows B2 forecasts: C2, M50 and B2, leaders called.
- **Age breakdown**, per May, pooled six and by-elections: rows with a previous contest under four years old (fewer than 1,461 days before polling day), four years or older, and no previous contest; leaders called and share error for C2, M50 and M00 in each. Within the two "previous contest" groups, rows without a benchmark are also counted, since the blend equals C2 there.
- **Leaders by party**: for C2, M50 and M00, per May, pooled six and by-elections, wards called first by each lane against wards won by each lane. C2's known fault at May 2026 is calling Reform UK and Labour first too rarely and the Liberal Democrats and Greens too often; this shows whether the blend moves those counts towards the actual ones.
- Signed bias per lane (forecast minus actual share) for the same arms and sets.

## Run rule

One scoring script, `swingblend_score.py`, run once, writing `results/swingblend_summary.json` and printing the tables. No fit. A fault that stops the run may be fixed without reading a score and is reported. Any rerun after a score is seen is reported, with the reason. Nothing is changed after a score is seen.

## Limits known in advance

- **May 2025 and May 2026 have been scored many times** by earlier arms in this folder; rule 6 stops May 2026 alone deciding, but neither year is clean ground for the idea. The sealed test at May 2027 is the real one.
- **May 2025 has a benchmark for only 134 of 1,399 wards** (county divisions redrawn before 2025, so no previous contest under the same GSS code); the blend is C2 there almost everywhere.
- **The previous contest can be a by-election**, and in a multi-member ward a by-election share is from a single-seat contest. B2's definition takes it as it is.
- **Others is pooled**, so "stood last time" for Others means some independent or minor party stood, not the same one.
- **C2 is the ward model alone**, not the blend with the candidate engine. England only, and only contests with a code in the Drive feature file.
