# Decision: the base engine for the May 2027 council forecasts (3 November 2026)

Status: **decided, 3 November 2026: Tom chose (a)**, the 7 May engine with the candidate steps. Nothing is published by this note, and no 2027 forecast is published until the gate below is passed.

**Gate:** a full engine run on 25 April 2026 inputs must beat 1,623 of 2,897 wards (56.0%) on `scripts/score-may-2026-like-for-like.mjs`, with London no worse than the published 447. Neither option passes it today.

## The two options

**(a) The 7 May engine with the candidate steps.** This is `scripts/run-bulk-predictions.mjs` at `5e85c84` with three changes:
- C1: the Step 9b multipliers, fitted on pre-lock by-elections;
- C2: Final-C aimed at a local-election target;
- the November input fixes: an LSOA-weighted London baseline and named May 2025 polls.

Every part of it was fitted on data dated on or before 25 April 2026.

**(b) HEAD with its May-fitted changes undone.** HEAD's engine differs from the 7 May one in five ways that were chosen or fitted on the May 2026 results:
- the London uplift set to 0, with a plausibility ceiling;
- the metropolitan uplift set to 1.0;
- a Green cap;
- a Conservative floor;
- the baseline recency half-life.

It also has two structural changes, predecessor-ward inheritance and the local-party register. Option (b) would undo the five and keep the two.

## Scored on the same basis

All figures are held out, on the yardstick, with Reform winning 980 wards. Sources:
- `docs/local-engine-full-run-2026-11.md` and `data/transparency/may-2026-full-run-2026-04-25.json` (ukelections PR 146);
- `docs/local-engine-holdout-2026-11.md` (PR 144).

| | Called | London (447 to beat) | Reform named first | Lib Dem recall | Green recall | Labour recall |
|---|---|---|---|---|---|---|
| Bar: polling-day forecast | 1,623 (56.0%) | 447 | 1,251 | 48% | 32% | 62% |
| 7 May engine alone, full run, polls to 24 April | 1,627 (56.2%) | 450 | 1,243 | 49% | 31% | 65% |
| **(a) as specified (F2)** | **1,650 (57.0%)** | **399** | 946 | 66% | 53% | 51% |
| (a) with London out of Final-C (F3, diagnostic) | 1,708 (59.0%) | 436 | 1,038 | 64% | 38% | 68% |
| (b) | no held-out score | | | | | |

Signed bias for (a) as specified, in percentage points across all wards:

| Reform | Labour | Conservative | Lib Dem | Green | Others |
|---|---|---|---|---|---|
| +0.7 | +0.6 | +1.0 | -0.7 | -0.3 | -3.1 |

In London alone it is Reform +6.6, Labour -3.5 and Conservative -5.0.

## Why (b) cannot be scored honestly yet

Undoing the five May-fitted changes is not enough. Every later part of HEAD was designed after the May 2026 results were known. Scoring (b) on May 2026 would mark an engine against the answer key it was built from, however carefully the fitted constants were reset.

An honest score for (b) needs an election it has not seen.

**Correction, 3 November 2026: the May 2025 elections cannot serve.** This note first proposed a May 2025 backtest. Checked before any run, it would not be held out, for either option:
- **The shared core was built on May 2025.** Both (a) and (b) rest on the 7 May engine. Its Step 9b curve is, in the words of `src/lib/reformRealignmentUplift.js` at `5e85c84`, "empirically derived from Burnley 2026 ward-level forecasts", which had already taken the May 2025 county lift. Its Step 5 proxy also feeds May 2025 county shares into the districts. The step is gated off for the May 2024 backtest because that "predates the realignment signal".
- **The baselines are missing on this Mac.** 21 of the 24 May 2025 councils have no earlier ordinary election in `data/history/dc-historic-results.json`. Only Gloucestershire, Hertfordshire and West Northamptonshire have 2017 or 2021 results there.

The route that remains:
- **A forward test.** Lock both engines now and score them on what follows. Council by-elections give an earlier read: about six a week, each forecast through the local engine and hashed before polling day. Weekly by-elections are small and not a random sample of wards, so it would take months to separate the two options. May 2027 itself settles the question, but only after the forecast has to be published.

## Recommendation

**(a)** is the only base with a held-out score, and the only one fitted entirely on pre-lock data.

**The work before (a) can pass the gate is London.** Within (a), London out of Final-C (F3) comes nearest: 1,708 overall, 11 London wards short. What remains is a London Reform overcall of about +6.5 points, which comes from Step 9b and the upstream stages, not from Final-C.

**The next protocol** should pre-register:
- London out of Final-C;
- a London Step 9b multiplier fitted on pre-lock London evidence.

It should then score both once on the full run. If that clears 1,623 with London at 447 or better, Phase 5 can start.

**Remaining error for (a) as specified:**
- Reform is named first in 946 wards against 980 won, so there is no aggregate overcall; the biggest miss is now "Conservative predicted, Reform won" (191 wards).
- Lib Dem recall is 66% and Green recall 53%.

**Remaining error for (a) with London out of Final-C:**
- Reform is named first in 1,038 wards, an overcall of 58.
- Lib Dem recall is 64% and Green recall 38%.

**Decision.** Tom chose (a) on 3 November 2026. Phase 5 (lock, publish, score) still waits for the gate.
