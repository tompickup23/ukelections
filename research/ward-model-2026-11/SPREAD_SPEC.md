# Reform UK ward signals for the ward model: specification

Written 28 November 2026, after the diagnosis (`SPREAD_DIAGNOSIS.md`, committed) and **before any forecast of either candidate was produced or scored**. Research only; nothing on the site reads it. Files in this study are prefixed `spread_` or `SPREAD_`.

## Question

`SPREAD_DIAGNOSIS.md` found that C2's Reform UK bunching sits in wards that had a previous contest in which Reform UK did not stand (slope 1.226 on 2,283 rows pooled from May 2025), and largely goes where a previous Reform UK result exists (1.043 on 510 rows). In the bunched group the model has a ward history for the other lanes and no Reform UK specific ward signal. **Does adding a Reform UK ward or council signal that is known before the cut, as an input to every lane's fit, reduce the bunching without costing leaders or share error?**

The diagnosis rules out a Reform UK only swing blend (option (a) of the brief): M50 already applies that swing to the rows with a previous Reform UK result and moves them the wrong way at the Mays. Option (c) as written (UKIP 2013 to 2016 and Brexit era ward signals) is not available: `ukip_council_1316` is already an input, and the ward level `ukip_peak_ward` is absent from the Drive scoring universe, so every by-election after May 2026 would lack it. The two candidates are therefore:

## Benchmark and its reproduction

The benchmark is C2 on the corrected inputs: `bridge_level_fit.FEATS["c2"]` (73 inputs), fitted forward only on `cache/rebuild/corrected/bridge_level_dataset.pkl` (sha256 `3393cfdb...`) with the settings in `cache/rebuild/corrected/fit_meta.pkl` (sha256 `936d07ee...`). Its cached forecasts are `cache/rebuild/corrected/bridge_level_predictions.pkl` (sha256 `bb7586ce...`); full hashes are in `spread_diagnose.py`.

Before any candidate is scored, `spread_fit.py` refits C2 at every cut with the same code path the candidates use and checks that its offsets equal the cached `off_c2_*` on every forecast row (largest absolute difference no more than 1e-9). If they do not, the run stops and nothing is scored.

## Candidates

Everything not named here is C2's: the cuts (each scheduled test day; the first of each month for by-elections, on contests dated before it), the lane settings, the 50 row minimum per lane, the forward only rule, the renormalisation and the forecastable rows.

**S1, GE2024 ward inputs.** C2's 73 inputs plus four: `ge24_reform`, `ge24_labour`, `ge24_con` (the ward's 4 July 2024 general election shares, bridged from constituency to ward by LSOA composition in the Drive matrix) and `nb_ge24_reform` (the same Reform UK share averaged over the eight nearest neighbours). They are added **only at cuts dated 1 August 2024 or later**: the by-election months from August 2024 and the May 2025 and May 2026 cuts. At earlier cuts the inputs did not yet exist, and S1's forecasts are C2's cached forecasts, not refitted. At the cuts where they are added, every training row carries its ward's value, which is known on the cut date. The two MRP priors (`mrp_reform`, `mrp_labour`) are not added: they are local authority estimates whose date the Drive README does not give, so they may postdate May 2025. Missing values (about 1% of by-elections) stay missing.

**S2, council Reform UK inputs.** C2's 73 inputs plus three, at every cut. For a row in council `c` (the dataset's `council` slug) on date `D`, let `D'` be the latest scheduled polling date (not a by-election) before `D` on which council `c` has dataset rows where Reform UK stood and on which a national anchor exists. Then:

| Input | Definition | Missing when |
|---|---|---|
| `cou_ref_prev_off` | logit(mean Reform UK share over council `c`'s rows on `D'` where it stood) minus logit(Reform UK anchor on `D'`) | no such `D'` |
| `cou_ref_prev_stand` | share of council `c`'s dataset rows on `D'` where Reform UK stood | no such `D'` |
| `cou_ref_prev_age` | years from `D'` to `D` | no such `D'` |

`D' < D` strictly, the same rule the existing `prev_*` inputs follow (so a by-election uses results dated before its own polling day, as `prev_rel_*` does). Logits use `common.logit`. A new council slug has no `D'`. The adjoining ward version of the brief's option (b) is not built: the dataset spans several ward code vintages and there is no committed adjacency for them.

## Run

`spread_fit.py` fits C2 (reproduction), S1 (cuts from 1 August 2024) and S2 (every cut) once, in one run, and writes `cache/spread/spread_predictions.pkl`. `spread_score.py` scores them once and writes `results/spread_summary.json`. Both scripts are committed before the run. Nothing is changed after a score is seen; there is no second run of either candidate.

## Scoring

The conventions of `bridge_level_score.py` and `score.py`: leaders over every row in a set, a row an arm cannot forecast counts as a miss; share error is the mean absolute error over lanes with a forecast or an actual share; Brier on the common mapping. Reform UK's calibration slope, called first and won counts, and lead where won are computed as in `spread_diagnose.reform_block`.

## Pass rules, each candidate against C2

All seven must hold for a candidate to be **supported**.

1. Pooled six Mays: more leaders than C2 (9,135 of 12,175).
2. Pooled six Mays: share error no higher than C2's (6.08).
3. At least as many leaders as C2 in at least four of the six years.
4. No year worse than C2 by more than 1% of that year's wards.
5. Pooled five Mays without 2026: more leaders than C2 (7,371 of 9,599) and share error no higher (6.29).
6. By-elections, all 1,190: leaders at least as many as C2 (786) and share error no higher (7.26).
7. Reform UK spread, pooled over every row from May 2025 (the Mays of 2025 and 2026 and the by-elections from 1 May 2025; 4,412 rows): the calibration slope closer to 1 than C2's (1.145), **and** Reform UK called first closer to won than C2's (1,231 called against 1,539 won, a gap of 308).

**Rules 1 to 4 are the four rules of `BRIDGE_LEVEL_SPEC.md`.** Rule 6 is how "a candidate that helps the Mays and hurts the by-elections is not supported" is enforced. Rule 7's figures for C2 are from `results/spread_diagnosis.json`, `pooled_from_2025-05-01`.

**Stated in advance about S1.** Its forecasts before August 2024 are C2's, so in 2019, 2021, 2022 and 2023 it equals C2 and rule 3 is met on those four years by construction. S1 is therefore decided on May 2025, May 2026 and the by-elections from August 2024. Rule 5 then needs S1 to gain at May 2025, since it equals C2 in the other four of those five years.

**Reported, not rules.** For each candidate: every set of `bridge_level_score.py`; rule 7's measures separately for the Mays from 2025 and the by-elections from May 2025; the same measures within the diagnosis's three groups (previous Reform UK result, absent, no previous contest); the by-elections after 7 May 2026; and the party called first against won at May 2026.

**If both pass**, both are reported as supported and the one with more pooled six May leaders is named; no combined arm is fitted in this study. **If neither passes**, that is the result. May 2026 alone decides nothing. A supported candidate would go into the May 2027 sealed test as a named arm beside C2, not replace C2.

## What this does not test

A per lane level, a stretch, a swing blend, the by-election level and the other routes listed as already failed in the brief. The section "What this means for May 2027" in the results counts how many 2027 wards have a previous Reform UK result in the same ward; it is a count from `data/identity/wards-2027.json` and `data/identity/wards-2027-baselines.json`, not a score.
