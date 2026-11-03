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
