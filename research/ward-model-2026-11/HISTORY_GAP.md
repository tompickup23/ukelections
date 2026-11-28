# The ward model's missing history for the 2027 councils: the gap, measured

28 November 2026. **Research only.** Nothing on the site, the engine, the publisher or any published forecast reads this folder. This note counts; it fits nothing, scores nothing and changes no dataset. Script: `history_gap.py`. Every figure below comes from `results/history_gap.json`, which the script writes. A "contest" is one ward or county division on one polling day; "ordinary" means not a by-election. Ward counts are wards, not seats.

## Verdict

1. **The 2023 results the model lacks are not on this Mac in any raw form.** 1,804 of the 1,861 history-less 2027 wards could be given a previous result by a contest that exists locally but is missing from the dataset. **All 1,804 of those contests are 2023 ordinary contests whose only local copy is the pooled six-lane shares in the committed baselines file** `data/identity/wards-2027-baselines.json` (source `dc2027`). None of the raw ward results sources on this Mac (the Democracy Club history file, the Drive ward results file, the May 2026 results file) holds them: **zero** of the 1,861 wards can be given a previous result from a source with candidate votes.
2. **The file they came from is on vps-main only.** The baselines were built from `dc-historic-results-2027.json` (snapshot `dc-historic-results-2027-955d88d58a38`, sha256 of its results array `955d88d5...aa1616`), which `docs/wards-2027-method.md` says was built on vps-main on 16 November 2026 and copied read only for the build. It is not under `~/ukelections-research-cache/`, `~/ukelections-research-cache/from-worktree-wards-2027-baselines-2026-11-28/`, `/Users/tompickup/ukelections/data/history/`, any worktree's `.cache/wards-2027/`, or anywhere else under the home folder to eight folders deep (outside `Library`). Under the task's rule, **the extension stops here and is reported**; vps-main was not read.
3. **2019 is missing too, and not recoverable locally.** The 2019 ordinary contests of the councils elected whole in 2023 are in no local source. The raw sources hold 1,758 ordinary 2019 contests, of which the dataset already has 1,678; the 80 others have no ward code. Andrew Teale's 2019 archive (`leap-2019-05-02.csv`), which the baselines build read, is not on this Mac; the baselines file keeps 2019 results for 28 wards only (`fallback_2019`, context).
4. **Two smaller findings correct the dry run's write up.**
   - **35 history-less wards already have their last contest in the dataset, under an earlier ward code.** ONS reissued the codes (for example Chesterfield, East Hertfordshire, West Suffolk, Castle Point and three Chelmsford wards), so the same-code rule in `prepare.py` does not link them. This is a code continuity question, not missing data.
   - **226 of the 323 bridged wards' May 2026 contests are in the dataset, under the pre-2026 ward code with that old ward's features**, as rows of the May 2026 test set. The dry run trained on every anchored row before 28 November 2026, so these did train it, under the wrong code. The other 97 are not in the dataset at all (their code has no feature row). `V2027_RESULTS.md` item 10 says none trained the model; that is not right for 226 of them.

## Sources read

| Source | What it is | Where |
|---|---|---|
| Corrected dataset | `cache/rebuild/corrected/bridge_level_dataset.pkl`, sha256 `3393cfdb...e53a8` (`REBUILD_RESULTS.md`, "Both") | research cache |
| Drive matrix and feature rows | `cache/drive07/ward_contests_v2.csv`, `cache/drive07/universe_features_v2.csv` (6,793 wards, 1,382 county divisions) | research cache |
| Raw source 1 | `data/history/dc-historic-results.json`, snapshot `dc-historic-results-5b431020aea0`, retrieved 25 April 2026, candidate votes | main checkout, gitignored |
| Raw source 2 | `ward_results_2016-2026_candidates.csv`, Drive library `01 Election results (ward, 2016-2026)`, sha256 `ddeb3ebb...cf4e3`, candidate votes, England | `~/ukelections-research-cache/drive01/` |
| Raw source 3 | `data/results/may-2026/local-and-mayor.merged.json`, May 2026, candidate votes | repo |
| Derived source 4 | `data/identity/wards-2027-baselines.json` (sha256 `414b844f...99534`): each 2027 ward's last ordinary result as pooled six-lane shares, with ballot id, date, total votes, candidate row count and source; no candidate votes | repo |
| Ward codes | the matrix's own codes; `data/identity/wards-may-2026.json`; the baselines file's ballot to code pairs. **No code is matched by ward name.** | repo |
| History-less wards | `data/forecasts/research/wards-2027-dryrun.json` (PR 219): forecast wards with no previous contest | PR 219 branch |

Council type is the ONS district code prefix of the council's coded wards (E06 unitary, E07 district, E08 metropolitan borough, E09 London borough); a council whose wards are county divisions (E58) is "county". A council with no coded ward is "unknown": East Surrey and West Surrey (81 contests in 2026) and a few others.

**What cannot be counted.** A contest that is in no local source is invisible to this count. In particular, 2023 contests of councils outside the 2027 list (no baseline record) and 2019 contests of the 2023 councils are not counted, because nothing on this Mac lists them.

## 1. Ordinary English contests, 2016 to 2026: in a source, in the dataset, or missing

22,108 ordinary contests are in at least one local source. 18,429 are in the dataset; 3,679 are not. No contest is in the Drive matrix but dropped by `prepare.py` (the "in matrix, dropped" group is empty), so every missing contest is missing because it is **not in the Drive matrix**. What then decides whether it could be added is its ward code and feature row:

| Year | In dataset | Missing: code and feature row found | Missing: code, no feature row | Missing: no ward code match | Missing: votes held as |
|---|---|---|---|---|---|
| 2016 | 1,497 | 0 | 0 | 222 | candidate votes |
| 2017 | 721 | 0 | 0 | 64 | candidate votes |
| 2018 | 2,119 | 0 | 0 | 276 | candidate votes |
| 2019 | 1,678 | 0 | 0 | 80 | candidate votes |
| 2021 | 2,257 | 0 | 0 | 32 | candidate votes |
| 2022 | 2,536 | 0 | 0 | 3 | candidate votes |
| **2023** | **1,737** | **2,681** | **7** | **0** | **pooled shares only** (baselines file, source `dc2027`) |
| 2024 | 1,902 | 0 | 0 | 4 | candidate votes |
| 2025 | 1,406 | 0 | 0 | 8 | candidate votes |
| 2026 | 2,576 | 0 | 301 | 1 | candidate votes |
| **All** | **18,429** | **2,681** | **308** | **690** | |

Why each group is missing:

- **2023, 2,688 contests (2,681 + 7): not in the Drive matrix, and not in any raw local source.** The Drive matrix holds 1,820 contests dated 2023; the raw sources hold 1,737 ordinary 2023 contests in 96 councils, all already in the dataset. The 2,688 come from the baselines file only, which took them from the vps-main export. By council type: district 1,934, unitary 690, metropolitan borough 64. 2,681 have a code with a feature row; 7 have a code with none.
- **2026, 301 contests: code found, no feature row.** County divisions 89, metropolitan borough wards 85, unitary wards 46, and East Surrey and West Surrey 81. These are wards and divisions drawn for May 2026, whose codes are newer than the feature file. Of them, 97 are bridged 2027 wards (section 3); features for those exist through the dry run's bridge (`cache/v2027/bridge.pkl`), not the feature file.
- **2016 to 2025 except 2023, 689 contests, and 1 in 2026: no ward code match.** In both raw Democracy Club sources with candidate votes, but not in the matrix, and no file gives their ward code (2018 has 154 London borough wards among its 276; the rest include City of London, Isles of Scilly and scattered wards). They would need a code by name, which this note does not do, so none can give a previous result to a history-less 2027 ward by code.

By year and council type, the missing contests are:

| Year | District | Unitary | Metropolitan borough | London borough | County | Unknown |
|---|---|---|---|---|---|---|
| 2016 | 120 | 44 | 58 | 0 | 0 | 0 |
| 2017 | 0 | 23 | 0 | 0 | 7 | 34 |
| 2018 | 90 | 12 | 20 | 154 | 0 | 0 |
| 2019 | 46 | 14 | 20 | 0 | 0 | 0 |
| 2021 | 14 | 3 | 9 | 0 | 6 | 0 |
| 2022 | 1 | 1 | 0 | 0 | 0 | 1 |
| 2023 | 1,934 | 690 | 64 | 0 | 0 | 0 |
| 2024 | 1 | 0 | 0 | 0 | 0 | 3 |
| 2025 | 0 | 0 | 0 | 6 | 0 | 2 |
| 2026 | 0 | 46 | 85 | 0 | 89 | 82 |

## 2. The 1,861 history-less 2027 wards

The dry run forecast 3,258 wards; 1,861 have no earlier contest with the same code in its training data (1,855 direct, 6 bridged). Their records in the baselines file:

| Baseline | Wards |
|---|---|
| Same ward, 2023 ordinary, source `dc2027` (vps-main export) | 1,804 (1,802 on 4 May, 1 on 15 June, 1 on 22 June) |
| Same ward, 2023 or 2024 ordinary, source `dc` (Drive file), already in the dataset under an earlier code | 35 (28 from 2023, 7 Castle Point wards from 2024) |
| Notional (Bradford, Idle and Thackley) | 1 |
| No baseline (the council's 2023 result for the ward is on hand in neither Democracy Club file; uncontested or missing) | 21 |
| **All** | **1,861** |

How many each missing group would give a previous result to, matching on the ward code only:

| Group | History-less wards given a previous result |
|---|---|
| 2023, code and feature row, pooled shares only | 1,799 |
| 2023, code but no feature row, pooled shares only | 5 |
| Any group | 1,804 |
| Any group held with candidate votes in a raw source | **0** |
| 2019, any group | 0 |
| 2026, any group | 0 (the 6 history-less bridged wards have no May 2026 ballot) |

The remaining 57 are the 35 wards under an earlier code, the 1 notional ward and the 21 with no baseline.

## 3. The bridged wards' own May 2026 contests

329 wards were bridged in the dry run. 323 have a May 2026 ballot (found with the dry run's own join, `v2027_forecast.may26_ballot`); 6 do not.

- **226 are in the dataset, under the pre-2026 code.** For example `barnsley/central`, code `E05016568` in 2027, is in the dataset as ballot `local.barnsley.central.2026-05-07` with code `E05000976` and that old ward's features. All 226 are May 2026 test rows with an anchor.
- **97 are not in the dataset.** Their code has no feature row.

## 4. Can the baselines file stand in for the export?

Not decided here; it is a question for the owner (below). One check bears on it. Where the baselines file and the dataset hold the same contest (1,607 contests: 1,294 from May 2026, 313 from the Drive file), the baselines file's pooled shares equal the dataset's targets to within 0.0000012 in every lane, and a lane with a share above nil matches the dataset's standing flag in all 1,607. So the file's convention is the dataset's. What it cannot show is the `dc2027` path itself: none of its 2,688 `dc2027` contests is in the dataset, so there is nothing to compare them with. It also holds only each 2027 ward's latest ordinary result (no 2019 contest, no contest of a council outside the 2027 list), and no candidate votes, so a candidate level check (for example joint party descriptions) cannot be made.

## What would unblock the extension

One of these, for the owner to decide:

1. **Copy `dc-historic-results-2027.json` from vps-main to this Mac** (gitignored, `data/history/`), with its results hash checked against `955d88d5...aa1616`. Then 2023 rows can be built from candidate votes exactly as `prepare.py` builds Democracy Club rows, for every council in the export, not only each ward's latest result.
2. **Use the committed baselines file as the source of the 2023 rows**, accepting pooled shares and no candidate votes, for the 2,681 contests with a code and feature row, plus the 35 code reissues if a code continuity rule is pre-registered. This adds no 2019 contests.
3. For 2019 under either option: **fetch Andrew Teale's 2019 archive** (CC BY-SA; the baselines build read it on 27 November 2026), which needs a ward code join that this note has not designed.

The 97 bridged May 2026 contests (features from the dry run's bridge) and the 226 rows under old codes are independent of the export and could be handled in the same specification.
