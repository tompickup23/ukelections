# Pre-registration: the May 2027 council forecasts (3 November 2026)

Status: protocol, committed before any 2027 forecast exists. Nothing is published by it. The 2027 gate is passed on the London-free basis Tom set on 3 November 2026 (section 1). Tom chose the 7 May engine with the candidate steps as the 2027 base on 3 November 2026 (`docs/decision-2027-engine-base.md`) and asked for the 2027 forecasts to be pre-registered in more than one form. This note fixes now what will be locked, when, how it will be scored, and what is still blocked.

## 1. Why London does not decide this

No London borough votes on 6 May 2027; they next vote in 2030. The 158 English councils verified for 6 May 2027 (`data/identity/councils-2027.json`) are:
- 29 metropolitan boroughs;
- 64 districts inside a county that voted in May 2025;
- 65 other unitaries and districts.

The May 2026 gate failed only on London (`docs/local-engine-london-v3-2026-11.md`). So the relevant comparison for 2027 is outside London, with the party adjustment (Final-C) run over the non-London wards as it will be in a London-free year.

Held out on the yardstick, the 2,261 non-London wards of May 2026, on the full run on 25 April inputs:

| Engine, Final-C over the non-London wards | Called | Metropolitan (718) | No 2025 anchor (1,119) | 2025 county anchor (424) | Reform named first (won 947) |
|---|---|---|---|---|---|
| Polling-day forecast as published (Final-C over all wards) | 1,176 | 367 | 521 | 288 | 1,228 |
| 7 May engine (polls to 24 April) | 1,152 | 319 | 539 | 294 | 677 |
| **Candidate: C1, slate step, C2** (S3 of the second London note) | **1,272** | 409 | 576 | 287 | 1,031 |

Source: `data/transparency/may-2026-london-free-2026-11.json` (`scripts/score-london-free-2026-11.mjs`), built from the full-run and second London outputs. The middle row is one further re-run of the 7 May engine's own Final-C without London; no parameter was chosen for it. It brings the arms scored against May 2026 since 24 October to 20.

**Decided, 3 November 2026: Tom dropped the London condition for 2027**, a year with no London wards. The 2027 gate is therefore the London-free comparison above: the named forecast's engine must call more than the published forecast's 1,176 of 2,261 non-London wards, held out, on the yardstick. The candidate calls 1,272 and passes, by 96 wards. The London result is not hidden:
- It stays in the record (399 London wards called, against 447 published, on the full run).
- It is stated on the 2027 methodology page.
- The condition returns for any year in which London votes.

Publication of each vintage still needs Tom's yes, and vintage 1 is blocked on the inputs in section 4.

## 2. What is pre-registered

Two forecasts, both run at every vintage on the same inputs:

| Label | Engine | At each lock |
|---|---|---|
| **U1, the named forecast** | `run-bulk-predictions.mjs` at `5e85c84`, plus C1's Step 9b, the slate step and C2's Final-C, as scored in S3 | Published, subject to Tom's yes for that vintage |
| U2, the comparator | The 7 May engine as it stood: Step 9b at its 7 May multipliers, and Final-C aimed at the Westminster poll | Sealed: hash published, file kept in the private Reports repo |

U1 is named now, before any 2027 number exists. The scoring after 6 May reports both.

### Inputs, refreshed at each lock by rules fixed now

- **History.** The ward history as at the lock date (`scripts/rebuild-history-as-at.mjs`).
- **Polls.** The UK Elections 14-day Westminster average on the lock date (`data/polling/timeseries.json`).
- **C1.** The Step 9b multipliers are refitted by C1's method on council by-elections in the 12 months before the lock (`scripts/fit-candidate-engine-2026-10-24.mjs`, same tiers, same five-contest minimum).
- **C2.** The local-to-Westminster ratio is refitted on the May 2026 local wards outside London, against their GE2024 area shares carried by the polls of the 14 days before 7 May 2026. This is the most recent full local election, and it covers the metropolitan boroughs and districts that vote in 2027. It may be applied to 2027 because it is not fitted on 2027.
- **Baselines.** GE2024 baselines are LSOA-weighted for every council, extending the London fix (`ge2024ForLadByLsoa`). Name matching is not used.
- **Slate step.** Reform's share is scaled by its slate fraction in the wards Step 9b lifts, from the statements of persons nominated. Before nominations close (vintage 1) the fraction is taken as 1 everywhere, and the forecast says so.
- **Calibrations.** The confidence curve is refitted on the candidate's May 2026 output and supplies the win probabilities. The party-bias offset is not applied, because every refit since October cost winners held out.

### Vintages

Each vintage is locked once with `scripts/preregister-sealed.mjs`, which refuses to overwrite a locked manifest. Earlier vintages stay published.

| Vintage | When | Notes |
|---|---|---|
| 2027-v1 | by 31 January 2027 | Party-level; no candidate data |
| 2027-v2 | after the statements of persons nominated are published, computed as by 4pm on Friday 9 April 2027 | Slate step and entrenched-candidate step switched on |
| 2027-v3 | 26 to 30 April 2027 | Final lock |

The 2027 dates are computed, not yet verified. They count back working days from polling day, excluding weekends and the bank holiday of Monday 3 May 2027, the same way that gives the 2026 dates:
- delivery of nominations closes at 4pm on the 19th working day before polling day, which is Thursday 8 April 2027;
- the statement of persons nominated is published by 4pm on the 18th working day, Friday 9 April 2027.

The same count gives nominations closing on Thursday 9 April 2026 and statements due by Friday 10 April 2026. That fits the 2026 record: the SOPN uploads in the rosters locked on 25 April 2026 (`data/candidates/may-2026/` at `2bfb62b`) are dated 9 and 10 April 2026. The 2027 dates are to be checked against the Electoral Commission's 2027 timetable once it is published.

## 3. Scoring after 6 May 2027

- **Conventions.** Exactly the May 2026 yardstick's (`scripts/score-may-2026-like-for-like.mjs`): local FPTP wards only; Labour, Conservative, Liberal Democrats, Reform UK and Green kept, every other party pooled as Others; the leader by full-slate vote share; "Labour Co-operative" not normalised.
- **Actuals.** Councils' own declarations, checked against Democracy Club.
- **Reported, for U1 and U2 at every vintage:**
  - wards called overall and by council type (metropolitan, district in a 2025 county, other);
  - recall per party and Reform named first;
  - MAE and signed bias per party;
  - the calibration of the win probabilities.
- **Comparisons.** Pollcheck's own claimed figure is quoted as a reference if it publishes one, and is not re-scored.
- **Unscored wards.** A ward with no forecast counts as a miss.

## 4. Blocked before vintage 1

- **Ward lists.** `data/identity/wards-2027.json` does not exist. Each council's wards and seats come from its electoral change order or notice. A council with no published list is "seats up unknown" and gets no forecast.
- **Baselines.** 93 of the 158 verified English councils have no 2023 to 2025 ordinary result on this Mac. The Democracy Club file covers May 2026 councils only, and LEAP stops at 2017. A fetch from the server, or another named source, is needed: **Tom**.
- **Unverified councils.** 65 English councils are still unverified, 4 of them disputed. Each needs its order or the council's own page.
- **Out of scope.** Scotland (STV) and Wales (outside the demographic model) have no forecast, and the 2027 pages will say so.
