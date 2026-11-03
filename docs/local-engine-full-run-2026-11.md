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
