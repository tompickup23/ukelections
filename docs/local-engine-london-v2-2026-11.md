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
