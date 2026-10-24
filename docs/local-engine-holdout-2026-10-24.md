# Local engine: May 2026 diagnosis, hold-out protocol and one candidate (24 October 2026)

Status: working note. Nothing here changes a published forecast. The candidate engine is off unless `UKE_CANDIDATE_ENGINE=2026-10-24` is set.

## 1. Hold-out protocol

This section was written and committed before any candidate parameter was fitted. Its commit is the first on this branch; the fits and scores come in later commits.

**Yardstick.** `scripts/score-may-2026-like-for-like.mjs` (ukelections PR 130): local wards only (2,897), the five major parties kept and every other party pooled as Others, the leader by full-slate vote share, with "Labour Co-operative" not normalised. The bar is the polling-day version's 1,623 of 2,897 (56.0%). Pollcheck's own claim for its 6 May 2026 projection, 67.7% on 2,951 wards, is a reference and is not re-scored here.

**Starting point.** The candidate starts from the engine as it stood on polling day (commit `5e85c84`, forecast sha256 `56686814…`), not from HEAD. HEAD has already been tuned on the May 2026 results: the Step 9b multipliers were reset from the post-audit on 20 May and swept on May 2026 by council folds on 21 August, and `party-bias.json` and `confidence.json` are fitted on May 2026. Scoring HEAD on May 2026 would be scoring the answer key.

**Stage replay.** The upstream stages, from the ward baseline to Final-B2, are taken from the polling-day file unchanged. The file records, for each ward, the Step 9b (Final-B3) Reform share before and after the lift, and the Final-C multipliers. Dividing out the multipliers and reversing the pro-rata lift recovers both intermediate stages exactly: re-applying Final-C to the recovered post-9b stage gives 1,623 again. The candidate then re-runs only the steps it changes. One limit: those upstream stages used the polls of 23 April to 5 May in the national swing step. The polling-day 56.0% used the same polls, so the comparison against it is like for like, but it is not a fully pre-26-April run. A full re-run on pre-lock inputs needs the engine's input files as they stood on 25 April, which the gitignored history file no longer holds.

**Data the candidate may be fitted on.**
- Election results with a polling date on or before 25 April 2026: the May 2025 county and unitary elections, and council by-elections from 2 May 2025 to 25 April 2026, both from `data/history/dc-historic-results.json` filtered by date.
- Polls with a fieldwork end date on or before 25 April 2026, from `data/polling/timeseries.json`.
- GE2024 results, and the engine's own constants as they stood at `5e85c84`.
- The polling-day forecast's own upstream output (no result enters it).

**Data the candidate may not use.** Any May 2026 result, any by-election after 25 April 2026, `data/calibration/party-bias.json`, `confidence.json`, `reform-regional-multiplier.json` and `reform-regional-multiplier.fitted.json` (all fitted on or adjusted from May 2026).

**What is changed, decided from the diagnosis before fitting.**
- C1, Step 9b: refit the per-tier regional multipliers. For each tier, multiplier = Reform's mean share in the pre-lock by-elections held in councils with no 2025 county anchor in that tier, divided by the mean Step 9b base target of that tier's 2026 wards. A tier with fewer than five such by-elections keeps its 7 May value.
- C2, the party adjustment (Final-C): aim the national-share calibration at a local-election target for the councils actually voting, instead of the Westminster poll. Per party, the target is the GE2024 share of each voting council, carried forward by the change in Westminster polling since GE2024 (polls to 25 April), times a local-to-Westminster ratio measured on the May 2025 county elections. Calibration strength stays at 0.65.

**Scoring.** C1 alone, C2 alone and C1 with C2 (the candidate) are each scored once and all three are reported. No parameter is changed after the scores are seen in this session. If the candidate does not beat 1,623, that is the result.

**Calibrations.** After any engine change every file in `data/calibration/` is refitted, as `CLAUDE.md` requires. For the candidate, the refits are written beside the live files under `data/calibration/candidate-2026-10-24/` and are not read by the published engine.

## 2. Diagnosis

All figures are on the like-for-like basis: 2,897 local wards, Others pooled. "Named first" is the number of wards where the forecast put a party top; "won" is where it came top.

### What changed between the lock and polling day

The forecast locked on 26 April and the polling-day version are different engines, not one engine with a late tweak.

- The locked file ran on a placeholder poll. `UK_WESTMINSTER_2026_APRIL_AVERAGE` at `ab3d999` reads "PLACEHOLDER: refresh from named pollster average before model run", with Reform 30%, Labour 23% and Green 9%. The polling-day file used the 14-day average of 23 April to 5 May: Reform 25.4%, Labour 18.2%, Green 16.3%.
- Five commits between 26 April and 7 May changed the local engine: `1a00e97` (entrenched non-major candidates), `93e82e4` (the Lancashire 2025 lookup), `69c586c` (May 2025 signal for all two-tier districts), `863f661` (Final-C, the national-share calibration, 6 May 18:45) and `5e85c84` (Step 9b, the Reform realignment uplift, 7 May 13:40, while polls were open).

### What each late step did

The polling-day file was peeled back stage by stage (section 1) and each combination re-scored.

| Version | Called | Reform named first | Lib Dem recall | Green recall | Reform bias |
|---|---|---|---|---|---|
| Locked, 26 April | 1,463 (50.5%) | 427 | 67% | 22% | -10.9pp |
| Polling day, before Step 9b and Final-C | 1,487 (51.3%) | 374 | 67% | 24% | -11.7pp |
| Step 9b only | 1,545 (53.3%) | 607 | 64% | 22% | -1.2pp |
| Final-C only | 1,480 (51.1%) | 833 | 56% | 35% | -3.6pp |
| Both, as published | 1,623 (56.0%) | 1,251 | 48% | 32% | +3.3pp |

Reform won 980 wards. Neither step overshoots on its own. Stacked, they do. Step 9b sets Reform to a demographic target in 2,024 wards of councils with no 2025 county result. Final-C then compares the forecast's aggregate with the Westminster poll and multiplies Reform by 1.16 in every ward, Labour by 0.74 and the Liberal Democrats by 0.93.

That comparison is the fault. The wards voting in May 2026 were not a national sample: 636 of the 2,897 were in London and 718 in metropolitan boroughs. Parties also do not poll the same in a council election as in a Westminster poll. In the May 2025 county elections Labour won 0.67 of its Westminster-implied share and the Conservatives 0.83, while the Liberal Democrats won 1.03 and Greens 1.13 (section 3, C2). Final-C pushed the Liberal Democrats down because their local aggregate stood above their Westminster poll, which is normal for them.

### Where the misses were

| Council type | Wards | Called (published) | Reform named first | Reform won | Lib Dem wins called |
|---|---|---|---|---|---|
| Unitary or county, no 2025 anchor | 1,121 | 522 (46.6%) | 768 | 465 | 48 of 237 |
| Metropolitan borough | 718 | 367 (51.1%) | 293 | 351 | 34 of 62 |
| London borough | 636 | 447 (70.3%) | 20 | 33 | 67 of 85 |
| Shire district with 2025 county anchor | 422 | 287 (68.0%) | 167 | 131 | 103 of 137 |

Of the 225 "Reform predicted, Liberal Democrat won" wards, 172 were in councils with no 2025 anchor: West Surrey 29, East Surrey 20, Hampshire 15, West Sussex 14, Winchester 12, Norfolk 11. Step 9b had lifted 139 of the 225, and in 105 the model had the Liberal Democrats ahead before Step 9b and Final-C ran. Step 9b's target for these councils is the Burnley relationship scaled by 0.85, transferred to southern counties where the Liberal Democrats are the main challenger. Pre-lock by-elections in the same councils put Reform at 28.9% on average, against a mean target there of 35.2% × 0.85 = 29.9%.

The Green shortfall is in the local base, not the late steps: Green recall is between 22% and 35% at every stage. Labour runs 10.8 points hot before Final-C, and Final-C fixes most of that by a uniform cut.

## 3. The candidate

Both changes were chosen from the diagnosis above and fitted only on pre-lock data (`scripts/fit-candidate-engine-2026-10-24.mjs`; values in `data/calibration/candidate-2026-10-24/`).

**C1, Step 9b multipliers.** Fitted on 117 council by-elections, 2 May 2025 to 25 April 2026, in English councils with no 2025 county anchor:

| Tier | By-elections | Reform mean share | Mean base target | 7 May | Fitted |
|---|---|---|---|---|---|
| London | 10 | 19.3% | 29.4% | 0.50 | 0.656 |
| Metropolitan | 20 | 27.8% | 31.4% | 0.75 | 0.885 |
| Northern unitary | 14 | 37.7% | 33.6% | 1.00 | 1.12 |
| Other | 73 | 28.9% | 35.2% | 0.85 | 0.823 |
| County district | 0 | | | 1.00 | 1.00 (kept) |

**C2, the party adjustment.** Final-C keeps its form and strength (0.65) but aims at a local-election target. That target takes each voting council's GE2024 share, carries it forward by the Westminster poll over GE2024 (polls to 24 April 2026: 13 polls), and multiplies by the May 2025 local-to-Westminster ratio: Reform 1.003, Labour 0.665, Conservative 0.828, Liberal Democrats 1.034, Green 1.134 (`src/lib/localElectionTarget.js`). For May 2026 the targets come out as Reform 26.5%, Green 23.8%, Labour 15.8%, Conservative 15.9% and Liberal Democrats 13.1%. The Westminster poll was Reform 25.5%, Labour 18.9%, Conservative 18.3%, Green 16.1% and Liberal Democrats 12.1%. This replaces the per-party bias of `party-bias.json`, which was fitted on May 2026 and so cannot be scored on it.

## 4. Score, held out

`scripts/replay-may-2026-candidate.mjs`, output `data/transparency/may-2026-candidate-2026-10-24.json`. The replay of the 7 May engine lands one ward off the published file (1,622 against 1,623) because the forecast records its intermediate figures rounded, so every arm goes through the same replay.

| Arm | Called | Seat basis | Reform named first | Lib Dem recall | Green recall | Labour recall |
|---|---|---|---|---|---|---|
| 7 May engine, replayed | 1,622 (56.0%) | 1,582 of 2,784 | 1,249 | 48% | 32% | 62% |
| Control: 7 May engine, polls to 25 April | 1,620 (55.9%) | 1,579 | 1,248 | 49% | 31% | 65% |
| C2 only | 1,636 (56.5%) | 1,593 | 1,416 | 49% | 54% | 39% |
| C1 only | 1,672 (57.7%) | 1,627 | 1,102 | 56% | 33% | 64% |
| **Candidate, C1 and C2** | **1,684 (58.1%)** | 1,641 | 1,329 | 58% | 55% | 38% |

**The candidate calls 1,684 of 2,897 ward leaders (58.1%), against the bar of 1,623 (56.0%) and Pollcheck's claimed 67.7%.** It clears the bar by 61 wards and is still about 9.6 points short of Pollcheck. Signed bias, candidate: Reform +3.3pp, Labour -0.9, Conservative +0.8, Liberal Democrats -1.5, Green -0.7, Others -3.1.

By council type the gain is not even:

| Council type | Published | Candidate | Reform named first (published / candidate) | Lib Dem wins called |
|---|---|---|---|---|
| Metropolitan borough | 367 (51.1%) | 445 (62.0%) | 293 / 483 | 34 / 26 of 62 |
| Unitary or county, no 2025 anchor | 522 (46.6%) | 578 (51.6%) | 768 / 645 | 48 / 105 of 237 |
| London borough | 447 (70.3%) | 373 (58.6%) | 20 / 43 | 67 / 61 of 85 |
| Shire district with 2025 county anchor | 287 (68.0%) | 288 (68.2%) | 167 / 158 | 103 / 109 of 137 |

The candidate wins 78 wards in the metropolitan boroughs and 56 in the no-anchor councils, and loses 74 in London. C2's single national ratio cuts Labour by a third everywhere and lifts Greens. London had no May 2025 election, so no London ratio can be fitted from it. Labour recall falls from 62% to 38%, and "Green predicted, Labour won" becomes a top-five miss (110 wards).

Reform is still named first in 1,329 wards against 980 won. The largest misses are Reform predicted with the Liberal Democrats (170), Labour (156) or the Conservatives (154) winning.

## 5. Calibrations after the change

| File | Status for the candidate |
|---|---|
| `reform-regional-multiplier.json` | Replaced by the C1 fit, `candidate-2026-10-24/reform-regional-multiplier.json`. |
| `party-bias.json` | Refitted on the candidate's May 2026 output: `candidate-2026-10-24/party-bias.json`. Held out by council, applying it now costs 1.16 points of winners (+0.02pp MAE); the 21 August fit on the 7 May engine gained 3.1. With C2 in place the per-party offset no longer helps, apart from Reform's +3.3. Do not apply it to the candidate. |
| `confidence.json` | Refitted on the candidate's output: `candidate-2026-10-24/confidence.json`. Held-out Brier 0.228 against a flat 0.247; calibration error 5.3pp against a flat 4.2pp, so the bins are noisier than the base rate. |
| `regional-dampening.json` | Not refitted: `calibrate-regional-dampening.mjs` calls `predictWard` directly on the May 2024 wards and never runs Step 9b or Final-C, so the candidate cannot move it. |
| `baseline-recency.json` | Not refitted: choosing the half-life needs full engine runs at each candidate value, and the replay only re-runs the last two steps. A full re-run on pre-lock inputs is the next step for this file. |
| `byelection-reliability.json` | Not affected: it belongs to the by-election model, not the May local engine. |
| `reform-regional-multiplier.fitted.json` | Not used by the candidate (it is the 21 August sweep on May 2026). |

## 6. Limits

- The upstream stages are the polling-day engine's own output, which used the polls to 5 May in its national swing step. The polls to 24 April are within 0.7 points of them for every major party, and swapping them in at Final-C moves two wards (control row). A full pre-lock run remains to be done.
- C1 compares by-election shares with the base targets of 2026 wards, at tier level. By-elections are not a random sample, and a council's by-election wards are not its 2026 wards.
- C2 rests on `UK_WESTMINSTER_2025_MAY_AVERAGE`, a hand-set average with no named source, because the poll series has no polls between February 2025 and January 2026. County GE2024 shares come from constituency-name matching (Lincolnshire rests on 3 constituencies, Oxfordshire on 2), and four councils had no match.
- The candidate is not wired into `run-bulk-predictions.mjs`. HEAD's engine already carries changes fitted on May 2026 (London multiplier 0, metropolitan 1.0, a Green cap and a Tory floor), so applying C1 and C2 to HEAD would be a different engine from the one scored here.

## 7. What next

1. Give C2 a London ratio, or leave London out of the ratio, from pre-lock evidence: London's 2022 borough elections against 2022 polls, or London by-elections. That is the largest single loss.
2. Re-run the whole engine on 25 April inputs, which needs the history file as it stood then rebuilt from Democracy Club with a date filter, then refit `baseline-recency.json`.
3. Decide the 2027 engine's base: the 7 May engine with C1 and C2, or HEAD with its May-fitted changes undone. Only the first has a held-out score.
4. Nothing for 2027 is published until a run beats 1,623 held out. This candidate does, by 61 wards, but the London loss and the remaining Reform overcall mean it is not ready.
