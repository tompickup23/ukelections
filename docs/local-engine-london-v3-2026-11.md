# Local engine: London, third and last protocol (November 2026)

Status: working note. Nothing here changes a published forecast. This follows `docs/local-engine-london-v2-2026-11.md`, whose section 3 found that London's leader misses are the Labour and Green split: C2's local target pushes London Greens far past their result, while no Final-C in London leaves Labour far above its result. The 7 May engine pulled London towards the Westminster poll and held London (450). This is the last London arm scored against May 2026; after it, the engine is judged on a fresh election. Section 1 was written and committed before the arm was scored.

## 1. Protocol (committed before scoring)

**London target.** London's Final-C is run separately from the rest. It aims at the London Westminster polls taken before the cut-off, with no local-to-Westminster ratio (a ratio of 1 for every party, as the 7 May engine treated the national poll).
- **Source:** Wikipedia "Opinion polling for the next United Kingdom general election", revision 1383556886, section "London".
- **Window:** polls with fieldwork ending 25 October 2025 to 25 April 2026, the six months before the cut-off.
- **Duplicates:** rows from the same pollster with the same sample size and overlapping fieldwork are treated as one survey reported twice, and averaged into one poll.
- **Averaging:** polls are averaged within each pollster, then across pollsters.

The five major parties' targets are scaled to leave room for the forecast's own non-major share, as `localElectionTargets` does.

**Everything else as S2** (`docs/local-engine-london-v2-2026-11.md`):
- the full run's stage (run 1, sha256 `932d1c56…`);
- C1's Step 9b;
- the slate step;
- outside London, Final-C on the A0P local target (named May 2025 polls, national ratio refitted).

**One arm, T, scored once on the yardstick.** It passes if it calls more than 1,623 of 2,897 wards and at least 447 London wards. No parameter changes after the score is seen. Whatever the result, this is the last arm scored against May 2026.

**Calibrations.** `party-bias` and `confidence` are refitted on T and not applied.

## 2. The London target

`data/polling/wikipedia/london-westminster-2025-10-25-to-2026-04-25.json`, extracted with `scripts/extract-wikipedia-polls.mjs --section=London` from revision 1383556886. The window holds three rows, all Savanta:
- for Centre for London, fieldwork 30 October to 7 November 2025, 1,242 respondents: Labour 32%, Reform 23%, Conservative 20%, Liberal Democrats 11%, Green 10%;
- for QMUL, 15 to 21 December 2025 and 17 to 23 December 2025, both 1,006 respondents. Under the duplicate rule these count as one poll: Labour 30.5%, Reform 20%, Green 17.5%, Conservative 17%, Liberal Democrats 13%.

London target (mean of the two polls): Labour 31.3%, Reform 21.5%, Conservative 18.5%, Green 13.8%, Liberal Democrats 12.0%. London's Final-C multipliers came out at Reform ×1.15, Conservative ×1.05, Labour ×0.98, Liberal Democrats ×0.91 and Green ×0.89.

## 3. Score, held out

`scripts/score-london-v3-2026-11.mjs`, output `data/transparency/may-2026-london-v3-2026-11.json`. Scored once.

| Arm | Called | London (447 to beat) | Metropolitan | No anchor | Anchored | Reform named first (won 980) | Labour recall | Lib Dem recall | Green recall | Passes |
|---|---|---|---|---|---|---|---|---|---|---|
| **T** | **1,707 (58.9%)** | **435** | 409 | 576 | 287 | 1,053 | 68% | 62% | 38% | **no** |

London, 636 wards:
- Labour is named first in 396 wards against 243 won; Green in 13 against 95.
- The largest miss is "Labour predicted, Green won" (83 wards).
- Signed bias: Reform +6.6, Labour +5.1, Conservative -3.1, Liberal Democrats -0.3, Green -7.2.

Signed bias across all wards: Reform +1.3, Labour +2.1, Conservative +0.5, Liberal Democrats -1.1, Green -1.6, Others -3.2.

**By the rule fixed in section 1, T does not pass.**

## 4. What the three London protocols show

The pre-lock London polls had Greens at 10% and 17.5%, a mean of 13.8%. Aiming at them pulls London Greens down and leaves Labour named first in most London wards. Every source of London evidence dated before the cut-off has now been tried: the 2022 borough elections, the 2025 and 2026 by-elections, the slate counts and the London polls. None gives an arm that both beats 1,623 overall and holds 447 London wards. The only engine that holds London is the 7 May engine as it stood (450, full run, F1), which overcalls Reform elsewhere and calls 1,627.

As section 1 says, this is the last arm scored against May 2026. Since 24 October, 19 arms beyond the reproductions have been scored against the same results: 4 in the 24 October note, 9 in the November London note, 3 in the full run, 2 in the second London note and this one. Any further choice made on May 2026 would be fitting to it.

## 5. Calibrations

Refitted on T: `data/calibration/candidate-london-v3-2026-11/`.
- `party-bias`: Labour +2.04pp, Reform +1.35, Conservative +0.52, Liberal Democrats -1.11, Green -1.63. Held out, applying it costs 0.16 points of winners. Not applied.
- `confidence`: held-out Brier 0.222 against a flat 0.244; calibration error 6.0pp against a flat 3.3pp.

Neither may be applied to May 2026.
