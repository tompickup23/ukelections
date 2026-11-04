# Local engine: London, second protocol (November 2026)

Status: working note. Nothing here changes a published forecast. Tom chose the 7 May engine with the candidate steps as the 2027 base on 3 November 2026 (`docs/decision-2027-engine-base.md`). This note tries once more to close the London gap on the full run (`docs/local-engine-full-run-2026-11.md`). Section 1 was written and committed before any arm was scored.

## 1. Protocol (committed before scoring)

### What was looked at before writing this (forecast side only, no May 2026 result)

- **Step 9b's London level already matches the pre-lock evidence.** On the full run's recovered pre-Step 9b stage, London's 678 local wards average 13.0% Reform, vote-weighted. C1's London multiplier (0.656) lifts that to 19.7%. The ten pre-lock London by-elections average 19.3%. The London Westminster polls before the cut-off, from Wikipedia "Opinion polling for the next United Kingdom general election", revision 1383556886, London table, put Reform at:
  - 19% and 21% (Savanta for QMUL, December 2025);
  - 23% (Savanta for Centre for London, November 2025).

  So refitting the London multiplier on pre-lock evidence would land near C1's value, and is not done.
- **Reform's London slate was incomplete.** The yardstick scores full-slate shares: every candidate's votes summed. The nomination rosters locked on 25 April 2026 (`data/candidates/may-2026/` at `2bfb62b`) show how many seats each party stood for:

  | Area | Reform | Labour | Conservative | Lib Dem | Green |
  |---|---|---|---|---|---|
  | London | 87% | 100% | 100% | 83% | 84% |
  | Metropolitan boroughs | 100% | 100% | 81% | 67% | 93% |
  | Elsewhere | 100% | 91% | 99% | 82% | 90% |

  Step 9b sets Reform's level from single-member evidence (by-elections, the Burnley relationship), so in the wards it lifts, it credits Reform with a full slate. The other parties' levels come from full-slate ward history, which already carries their past slates.

### The change (S, the slate step)

In every ward where Step 9b raised Reform's share, multiply Reform's share by Reform's slate fraction: candidates standing over seats contested, capped at 1, from the 25 April rosters. Then renormalise the other parties pro rata. It runs after Step 9b and before Final-C. Wards Step 9b did not lift, and single-member wards (where the fraction is 1 or 0), are unchanged. A ward with no Reform candidate gets no Reform share. The step uses nothing dated after 25 April.

### Arms, each scored once on the full run's stage (run 1 of the full-run note)

| Arm | Step 9b | Slate step | Final-C |
|---|---|---|---|
| S2 | C1 | yes | A0P (one run, LSOA baseline in London, named May 2025 polls) |
| S3 | C1 | yes | A1P (London out of Final-C) |

**Gate rule, fixed now.** An arm passes if it calls more than 1,623 of 2,897 wards on the yardstick and at least 447 London wards. If both pass, the one calling more wards overall is the candidate for 2027; if neither, the London gap stands and that is the result. No parameter changes after the scores are seen.

**Calibrations.** `party-bias` and `confidence` are refitted on whichever arm passes, or on S2 if neither does. Neither is applied.

## 2. Scores, held out

`scripts/score-london-v2-2026-11.mjs`, output `data/transparency/may-2026-london-v2-2026-11.json`. The slate step changed 166 wards, all in London, 143 of them in the yardstick set; London's mean Reform share went from 19.7% to 17.1%. Each arm scored once.

| Arm | Called | London (447 to beat) | Metropolitan | No anchor | Anchored | Reform named first (won 980) | Labour recall | Lib Dem recall | Green recall | Passes |
|---|---|---|---|---|---|---|---|---|---|---|
| F2, full run, C1 and A0P (before) | 1,650 (57.0%) | 399 | 397 | 563 | 291 | 946 | 51% | 66% | 53% | no |
| **S2**, F2 with the slate step | **1,690 (58.3%)** | **399** | 427 | 574 | 290 | 1,123 | 49% | 64% | 52% | **no** |
| F3, full run, C1 and A1P (before) | 1,708 (59.0%) | 436 | 409 | 576 | 287 | 1,038 | 68% | 64% | 38% | no |
| **S3**, F3 with the slate step | **1,708 (59.0%)** | **436** | 409 | 576 | 287 | 1,038 | 68% | 64% | 38% | **no** |

Signed bias, all wards (pp): S2 Reform +1.3, Labour +0.4, Conservative +0.8, Liberal Democrats -0.8, Green -0.5, Others -3.1; S3 Reform +0.8, Labour +2.2, Conservative +0.4, Liberal Democrats -0.8, Green -1.2, Others -3.2.

**By the rule fixed in section 1, neither arm passes. The London gap stands.**

## 3. What London's misses are

The slate step lowers London's Reform bias (F2 +6.6 to S2 +5.2; F3 +6.5 to S3 +4.1) but moves no London leader in S3 and none net in S2. Reform is not what decides London's leaders: it is named first in 7 to 22 London wards across these runs and won 33. What decides them is the Labour and Green split:

| London, 636 wards | Labour named first | Green named first | Largest miss |
|---|---|---|---|
| Won | 243 | 95 | |
| F1, 7 May engine (Final-C on the Westminster poll), 450 called | 326 | 52 | Labour predicted, Green won (65) |
| S2, Final-C on the local target, 399 called | 211 | 198 | Green predicted, Labour won (88) |
| S3, no Final-C in London, 436 called | 408 | 14 | Labour predicted, Green won (84) |

With C2's local target, London Greens are pushed far past their result; with no Final-C at all, Labour is left far above its. The 7 May engine's pull towards the Westminster poll sits between the two, and holds London. The gain in S2 outside London (+40 wards against F2, 30 of them in the metropolitan boroughs) comes through Final-C: with London's Reform lower, the single run lifts Reform elsewhere.

No parameter changed after these scores were seen.

## 4. Next

A third London protocol, written before fitting, would aim London's Final-C at a London target taken directly from the pre-lock London Westminster polls (Savanta for QMUL, December 2025: Labour 30% and 31%, Conservative 17%, Liberal Democrats 13%, Green 17% and 18%, Reform 19% and 21%), split from the rest, with the slate step kept. Each further try on May 2026 adds to the number of arms scored against the same results, so it should be the last London arm before the engine is judged on a fresh election.

## 5. Calibrations

Refitted on S2, as the protocol says when neither arm passes (`data/calibration/candidate-london-v2-2026-11/`). `party-bias`: Reform +1.36pp, Labour +0.34, Conservative +0.81, Liberal Democrats -0.83, Green -0.50; held out by council, applying it costs 0.99 points of winners. Do not apply it. `confidence`: held-out Brier 0.227 against a flat 0.247; calibration error 5.6pp against a flat 4.3pp. Neither is applied, and neither may be applied to May 2026.
