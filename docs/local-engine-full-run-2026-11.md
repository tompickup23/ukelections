# Local engine: full run on 25 April 2026 inputs (November 2026)

Status: working note. Nothing here changes a published forecast. It follows `docs/local-engine-holdout-2026-10-24.md` (whose section 1 hold-out rules apply) and `docs/local-engine-holdout-2026-11.md` (the London arms, where A0P was kept).

Section 1 was written and committed before the engine was run.

## 1. Protocol (committed before running)

**Why.** Every held-out score so far replays only Step 9b and Final-C on the polling-day engine's own upstream output. This run re-runs every stage of the 7 May engine on inputs dated on or before 25 April 2026, then applies C1 and A0P as the replay does.

**Engine.** `scripts/run-bulk-predictions.mjs` at `5e85c84`, run in a detached checkout of that commit, unchanged.

**Inputs.**
- History: `data/history/dc-historic-results.json` rebuilt with `scripts/rebuild-history-as-at.mjs --as-at=2026-04-25` (ukelections PR 145). On this Mac's copy that keeps the 21,269 rows of the Democracy Club fetch of 25 April 2026, 16:09 UTC, and drops 132 by-election appends dated 30 April onwards. Tom approved using this copy on 3 November 2026.
- Westminster polls: `data/polling/override.json` set so that `UK_WESTMINSTER_2026_APRIL_AVERAGE` carries the 14-day average to 24 April 2026 from `data/polling/timeseries.json` (13 polls, fieldwork ending 12 to 24 April), the same figures the candidate's Final-C target already uses.
- Everything else as committed at `5e85c84`. The Lancashire 2025 reference files are read from `~/clawd` as they stand now; they hold the May 2025 county results, which are pre-lock.

**Reproduction first.** Run 0 is the engine at `5e85c84` with every input as committed (its own override file) and the history rebuilt as at 25 April. If it reproduces the polling-day forecast's winners in all but a handful of wards, the environment is faithful. If not, stop and report before scoring anything else.

**Runs, each scored once on the yardstick** (`scripts/score-may-2026-like-for-like.mjs`, bar 1,623):
- F0: Run 0 as it comes out (the 7 May engine, its own polls, 25 April history).
- F1: the engine on 25 April polls as it comes out (the 7 May engine, fully pre-lock).
- F2: F1's output with Step 9b and Final-C replaced by C1 and A0P (the replay's stage functions; A0P as in the November note: LSOA baseline in London, named May 2025 polls, national ratio refitted).
- F3 (diagnostic): F1 with C1 and A1P (London out of Final-C), reported, not choosable.

**What counts.** F2 is the gate figure: the candidate engine run in full on 25 April inputs. It is reported beside the replay's A0P (1,646) with the difference explained stage by stage. No parameter changes after the scores are seen.

**Calibrations.** After the run, `baseline-recency.json` is refitted by a half-life sweep only if the engine's half-life can be set without editing the engine at `5e85c84`; otherwise that is reported. `regional-dampening.json` is refitted only if its calibration script can be made to run Step 9b and Final-C; otherwise that is reported. `party-bias.json` and `confidence.json` are refitted on F2 and not applied.

## 2. Reproduction

Run 0 (the engine at `5e85c84`, its own poll override, history rebuilt as at 25 April) reproduces the polling-day forecast exactly: 2,971 wards, no ward with a different top party, largest share difference 0.000000. Two things follow.

- The polling-day forecast already ran on this history. The history file the engine read on 7 May was the Democracy Club fetch of 25 April 2026, 16:09 UTC; no result after the cut-off entered it.
- Its one input from after the cut-off was the poll override, `data/polling/override.json` at `5e85c84`: retrieved 26 April 2026, 12 polls, fieldwork window given as 13 to 27 April, Reform 25.4%, Labour 18.2%, Conservative 18.6%, Liberal Democrats 11.9%, Green 16.3%. The 24 October note describes these as the polls of 23 April to 5 May; the file itself gives the window above.

## 3. Scores, held out

`scripts/score-full-run-2026-04-25.mjs`, output `data/transparency/may-2026-full-run-2026-04-25.json`, which records the sha256 of both engine outputs. Every run scored once.

| Run | Called | London (636) | Metropolitan (718) | No anchor (1,119) | Anchored (424) | Reform named first (won 980) | Labour recall | Lib Dem recall | Green recall |
|---|---|---|---|---|---|---|---|---|---|
| F0, 7 May engine, own polls | 1,623 (56.0%) | 447 | 367 | 521 | 288 | 1,248 | 62% | 48% | 32% |
| F1, 7 May engine, polls to 24 April | 1,627 (56.2%) | 450 | 358 | 528 | 291 | 1,243 | 65% | 49% | 31% |
| **F2, F1 with C1 and A0P** | **1,650 (57.0%)** | 399 | 397 | 563 | 291 | 946 | 51% | 66% | 53% |
| F3, F1 with C1 and A1P (diagnostic) | 1,708 (59.0%) | 436 | 409 | 576 | 287 | 1,038 | 68% | 64% | 38% |

MAE and signed bias per party (pp, MAE / signed), by council type:

**F2, the gate figure**

| Council type | Wards | Called | Reform | Labour | Conservative | Lib Dem | Green | Others |
|---|---|---|---|---|---|---|---|---|
| London borough | 636 | 399 | 10.0 / +6.6 | 8.1 / -3.5 | 7.5 / -5.0 | 5.9 / +1.2 | 8.3 / +2.0 | 5.6 / -2.8 |
| Metropolitan borough | 718 | 397 | 9.3 / -2.1 | 6.9 / +1.5 | 5.9 / +2.6 | 4.8 / +0.7 | 8.2 / -1.9 | 7.5 / -0.9 |
| No 2025 anchor | 1,119 | 563 | 7.2 / -0.3 | 5.1 / +1.6 | 8.4 / +3.8 | 7.4 / -2.6 | 8.1 / -0.6 | 9.8 / -5.6 |
| 2025 county anchor | 424 | 291 | 8.4 / -0.8 | 6.2 / +2.6 | 6.0 / +0.1 | 7.0 / -0.9 | 5.4 / -0.5 | 8.8 / -2.3 |
| All | 2,897 | 1,650 | 8.5 / +0.7 | 6.4 / +0.6 | 7.2 / +1.0 | 6.4 / -0.7 | 7.8 / -0.3 | 8.0 / -3.1 |

**F1, the 7 May engine fully pre-lock**

| Council type | Wards | Called | Reform | Labour | Conservative | Lib Dem | Green | Others |
|---|---|---|---|---|---|---|---|---|
| London borough | 636 | 450 | 9.4 / +6.4 | 6.9 / -0.9 | 6.7 / -2.7 | 5.8 / +0.6 | 7.9 / -2.4 | 5.7 / -2.5 |
| Metropolitan borough | 718 | 358 | 9.4 / -1.4 | 7.5 / +3.3 | 6.7 / +4.1 | 4.6 / 0.0 | 8.5 / -5.5 | 7.6 / -0.6 |
| No 2025 anchor | 1,119 | 528 | 8.4 / +4.6 | 5.0 / +1.5 | 8.7 / +4.6 | 7.7 / -4.8 | 8.0 / -4.5 | 9.8 / -6.0 |
| 2025 county anchor | 424 | 291 | 9.0 / +3.2 | 6.3 / +2.9 | 6.2 / +1.2 | 7.3 / -3.2 | 5.9 / -4.2 | 8.9 / -2.4 |
| All | 2,897 | 1,627 | 9.0 / +3.3 | 6.3 / +1.6 | 7.4 / +2.3 | 6.4 / -2.1 | 7.8 / -4.3 | 8.0 / -3.0 |

## 4. Against the replay

| | Replay | Full run | Difference |
|---|---|---|---|
| 7 May engine, polls to 24 April | 1,620 (control) | 1,627 (F1) | +7 |
| Candidate, C1 and A0P | 1,646 (A0P) | 1,650 (F2) | +4 |
| Candidate, C1 and A1P | 1,709 (A1P) | 1,708 (F3) | -1 |

Run 0 shows the replay's upstream stages were already on 25 April history, so the full run differs from the replay in one input only: the Westminster poll in the upstream national swing step, the 24 April average (Reform 25.5%, Labour 18.9%, Conservative 18.3%, Liberal Democrats 12.1%, Green 16.1%) instead of the 26 April override (25.4%, 18.2%, 18.6%, 11.9%, 16.3%). The replay's control already used the 24 April polls at Final-C, so the 7 wards between control and F1, and the 4 between A0P and F2, are what the upstream swing step does with a poll that differs by under 0.8 points per party. The replay was a close stand-in for the full run.

## 5. The gate

**The full run on 25 April inputs, with the candidate steps (F2), calls 1,650 of 2,897 ward leaders (57.0%), 27 above the bar of 1,623.** The London loss stands: 399 London wards against the published 447, a loss of 48, with London Reform +6.6, Labour -3.5 and Conservative -5.0 points. By the gate rule (`docs/local-engine-holdout-2026-10-24.md`, section 7), clearing the bar with London worse is not ready, so nothing for 2027 is published on this engine.

Two other results matter for the base decision:

- The 7 May engine alone, fully pre-lock (F1), calls 1,627 and holds London (450), but names Reform first in 1,243 wards against 980 won and runs Green 4.3 points low.
- London out of Final-C (F3) calls 1,708 and 436 in London, 11 short of 447. It is the best full run, and the only candidate form near both conditions.

## 6. Calibrations

| File | Status |
|---|---|
| `party-bias.json` | Refitted on F2: `candidate-full-run-2026-11/party-bias.json`. Bias Reform +0.72pp, Labour +0.54, Conservative +0.97, Liberal Democrats -0.69, Green -0.33. Held out by council, applying it costs 0.73 points of winners (+0.04pp MAE). Do not apply it. |
| `confidence.json` | Refitted on F2: `candidate-full-run-2026-11/confidence.json`. Held-out Brier 0.227 against a flat 0.248; calibration error 6.1pp against a flat 4.1pp. |
| `baseline-recency.json` | Not refitted. The engine at `5e85c84` has no half-life setting: the ward baseline is the most recent contest, and the half-life blend arrived on 21 August, fitted on May 2026. A sweep needs that blend ported into the 7 May engine and a pre-lock target to sweep on (the May 2025 elections, not May 2026). That is a protocol of its own. |
| `regional-dampening.json` | Not refitted. `calibrate-regional-dampening.mjs` still calls `predictWard` on the May 2024 wards and never runs Step 9b or Final-C; making it do so is a rewrite of the fitter, left for its own protocol. |
| `reform-regional-multiplier.json` | C1's fit unchanged. |

Both refits are fitted on May 2026 and may never be applied to May 2026.
