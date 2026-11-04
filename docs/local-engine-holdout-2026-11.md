# Local engine: a London ratio for C2 (November 2026)

Status: working note. Nothing here changes a published forecast. The candidate engine stays behind `UKE_CANDIDATE_ENGINE`.

This continues `docs/local-engine-holdout-2026-10-24.md`, whose section 1 (the hold-out rules) applies unchanged. Section 1 below was written and committed before any London parameter was fitted or any arm scored; the fits and scores come in later commits.

## 1. Protocol (committed before fitting)

### The problem

C2 aims Final-C at a local-election target built with one national local-to-Westminster ratio, fitted on the May 2025 county and unitary elections. London had no May 2025 election, so that ratio (Labour 0.665, Green 1.134) reaches London's 636 wards with no London evidence. The candidate lost 74 London wards against the published engine (447 to 373).

### Reproduction first

`scripts/replay-may-2026-candidate.mjs` must give 1,622 for the replayed 7 May engine and 1,684 for the candidate, and `scripts/score-may-2026-like-for-like.mjs` 1,623 for the polling-day version as published, before anything else is run. Done on 3 November 2026 at `origin/main` 5e873ca: 1,622, 1,684 and 1,623, and the candidate output file was byte-identical.

### Evidence the London ratio may use (all dated on or before 25 April 2026)

- **E1, London borough elections of 5 May 2022.** All 32 boroughs (the City of London is not in the file), every candidate's votes summed by party and borough (full slate, as the yardstick scores), from `data/history/dc-historic-results.json`, `election_date` 2022-05-05, `tier` local, not a by-election.
- **E2, London's Westminster baseline for 2022.** The notional GE2019 result on 2024 boundaries (Rallings and Thrasher, via `data/history/ge-notional-2019.json`). A constituency is in London when most of its LSOAs lie in an `E09` local authority (`data/features/lsoa21-to-pcon24.json`). The file was generated on 26 April 2026 but holds only 2019 votes, so it carries no information from after the cut-off.
- **E3, the Westminster polls of spring 2022.** Every GB or UK-wide Westminster voting intention poll listed on Wikipedia's "Opinion polling for the 2024 United Kingdom general election" with fieldwork ending 21 April to 4 May 2022 (the 14 days before polling day), each with its pollster and fieldwork dates, saved with the page revision id. Each pollster's polls are averaged first, then the pollsters are averaged equally. The GE2019 national shares are `UK_WESTMINSTER_2019_GE_RESULT` in `src/lib/nationalPolling.js` at `5e85c84`.
- **E4, London council by-elections, 2 May 2025 to 25 April 2026.** The ten used in the C1 fit. Each is set against its borough's GE2024 share (`ge2024ForArea`, as C2 uses) carried by the poll at its date: the per-pollster mean of polls listed on Wikipedia's "Opinion polling for the next United Kingdom general election" with fieldwork ending in the 14 days before that by-election.

### The ratio

For each of Labour, Conservative, Liberal Democrats and Green:

    r_London,p = London 2022 borough share_p / (London notional GE2019 share_p × poll_2022,p / GE2019_national,p)

Reform UK keeps the national ratio (1.003). In 2022 Reform polled about 2% and stood in few London wards, and in 2019 its predecessor stood in few seats, so no London Reform ratio can be estimated from E1 to E3.

The E4 ratio is fitted the same way on the by-elections, pooled by votes, for all five parties.

Known limit, accepted before fitting: C2's own national ratio uses UK-wide GE results against GB polls. This note keeps that convention for comparability; the GB/UK difference in 2019 is under 1.1 points for every party.

### Arms, each scored once on the yardstick

Final-C stays in its 7 May form at strength 0.65. "Split" means Final-C is run separately for the London wards and the rest, each group pulled towards its own target with its own multipliers.

| Arm | Final-C outside London | Final-C in London |
|---|---|---|
| A0, candidate as it stands | one run over all wards, national ratio | (same run) |
| A1, London excluded from C2 | C2 over the non-London wards, national ratio | none: London left at its post-C1 stage |
| A2, London ratio from 2022 | split, national ratio | split, `r_London` from E1 to E3 |
| A3, London ratio from by-elections (diagnostic) | split, national ratio | split, the E4 ratio |
| A4, split control (diagnostic) | split, national ratio | split, national ratio |

**Choice rule, fixed now.** Of A0, A1 and A2, keep the arm with most wards called overall that also calls at least 447 London wards (the published engine's London figure). If neither A1 nor A2 meets both, keep A0 and say so. A3 and A4 are reported but cannot be chosen; they show how much comes from splitting and how much from the 2022 evidence.

**Reported for every arm:** wards called overall and by council type (London borough; metropolitan borough; unitary or county with no 2025 anchor; shire district with a 2025 county anchor), Reform named first, recall for Labour, Liberal Democrats and Green, and MAE and signed bias per party by council type. No parameter changes after the scores are seen.

### The May 2025 poll behind C2

C2's national ratio rests on `UK_WESTMINSTER_2025_MAY_AVERAGE`, a hand-set average with no named source. It is replaced, whatever the effect on the score, by the per-pollster mean of polls listed on Wikipedia's "Opinion polling for the next United Kingdom general election" with fieldwork ending 17 to 30 April 2025 (the 14 days before 1 May 2025), with the revision id saved. The national ratio is refitted on it and the chosen arm re-scored once with it (arm A5). The decision to adopt it rests on provenance, not on the score: from A5 on, the named-poll ratio is the candidate's.

### Amendment, 3 November 2026, after the ratio fit and before any arm was scored

Running the fit showed a defect in C2's London input, not in its ratio. C2 takes each council's GE2024 share from `ge2024ForArea`, which matches constituency names to council slugs. For London that matches 15 of 33 boroughs, several on one or two seats (Bexley on Bexleyheath and Crayford alone). The other 18 (Barking and Dagenham, Camden, the City, Hammersmith and Fulham, Haringey, Havering, Hillingdon, Hounslow, Kensington and Chelsea, Kingston, Lambeth, Merton, Newham, Redbridge, Richmond, Tower Hamlets, Waltham Forest, Wandsworth) get no match and fall back to the national poll, so their Westminster-implied Labour share is the national 19% rather than their own. The same gap left 5 of the 10 London by-elections out of E4.

So, decided on provenance before any score is seen:

- **The London baseline is replaced.** For every London borough the GE2024 share is the constituency shares weighted by the number of the borough's LSOAs in each constituency (`data/features/lsoa21-to-pcon24.json`; LSOA counts stand in for population). This is called the LSOA baseline. Outside London the name matching stays for now; it is flagged for Phase 2.
- **The named May 2025 polls replace the hand-set average** in every arm of the new set, as the section above already decided.
- **Two sets of arms are scored.** Set N is A0 to A4 on the 24 October inputs (name matching, hand-set May 2025 poll), so the change from each fix can be seen. Set P is A0 to A4 on the corrected inputs (LSOA baseline in London, E4 refitted on it, named May 2025 polls and the national ratio refitted on them). A5 is dropped as a separate arm: it is set P.
- **The choice rule applies within set P.** Of A0P, A1P and A2P, keep the arm with most wards called that also calls at least 447 London wards. If neither A1P nor A2P meets both, keep A0P, the candidate on corrected inputs, and say the London loss stands.

## 2. The fits

`scripts/fit-c2-london-2026-11.mjs`, output `data/calibration/candidate-2026-11/london-ratio.json` and `local-national-ratio.json`. Polls come from `scripts/extract-wikipedia-polls.mjs` run on saved wikitext, revision 1363820081 of "Opinion polling for the 2024 United Kingdom general election" and revision 1383556886 (3 November 2026) of "Opinion polling for the next United Kingdom general election"; the extracts are in `data/polling/wikipedia/`. As a check on the extractor, every one of the 93 polls in `data/polling/timeseries.json` dated 1 January to 25 April 2026 appears in the extract with the same date, pollster and Labour and Reform shares. Six rows on the current page carry a year that disagrees with their section (for example "31 Jan to 2 Feb 2025" in the 2026 table); they take the section year and are flagged.

**E1 to E3, London 2022.** London borough elections of 5 May 2022: 32 boroughs, 677 contests, full-slate shares Labour 45.7%, Conservative 27.8%, Liberal Democrats 13.9%, Green 8.3%, Reform 0.1%. London's notional GE2019 on 2024 boundaries (75 constituencies): Labour 48.1%, Conservative 32.0%, Liberal Democrats 14.9%, Green 3.1%. Polls with fieldwork ending 21 April to 4 May 2022: 11 polls from 7 pollsters, pollster-balanced mean Labour 39.9%, Conservative 34.0%, Liberal Democrats 10.1%, Green 5.4%.

| Ratio | Reform | Labour | Conservative | Lib Dem | Green |
|---|---|---|---|---|---|
| National, 24 October (hand-set May 2025 poll) | 1.003 | 0.665 | 0.828 | 1.034 | 1.134 |
| National, refitted on named May 2025 polls (set P) | 0.987 | 0.691 | 0.871 | 1.019 | 1.036 |
| London, 2022 evidence | national kept | 0.763 | 1.113 | 1.064 | 1.339 |
| London by-elections, name-matched baseline (5 of 10 usable) | 1.093 | 0.644 | 1.519 | 1.376 | 0.743 |
| London by-elections, LSOA baseline (10 of 10) | 1.024 | 0.810 | 1.326 | 1.383 | 0.823 |

The named May 2025 polls (fieldwork ending 17 to 30 April 2025: 8 polls, 5 pollsters) average Reform 25.9%, Labour 23.6%, Conservative 20.9%, Liberal Democrats 13.7% and Green 9.3%, against the hand-set Reform 25.5%, Labour 24.5%, Conservative 22.0%, Liberal Democrats 13.5% and Green 8.5%.

The ten by-elections are small (925 to 3,948 votes each) and are a diagnostic, not a fit anyone should lean on.

## 3. Scores, held out

`scripts/replay-may-2026-c2-london.mjs`, output `data/transparency/may-2026-c2-london-2026-11.json`. Every arm went through the yardstick once. A0N reproduces the 24 October candidate exactly (1,684).

| Arm | Called | London (636) | Metropolitan (718) | No anchor (1,119) | Anchored (424) | Reform named first | Labour recall | Lib Dem recall | Green recall |
|---|---|---|---|---|---|---|---|---|---|
| Published, 7 May | 1,623 (56.0%) | 447 | 367 | 521 | 288 | 1,251 | 62% | 48% | 32% |
| A0N | 1,684 (58.1%) | 373 | 445 | 577 | 289 | 1,329 | 38% | 58% | 55% |
| A1N | 1,711 (59.1%) | 440 | 418 | 566 | 287 | 1,050 | 66% | 64% | 43% |
| A2N | 1,672 (57.7%) | 401 | 418 | 566 | 287 | 1,062 | 43% | 62% | 61% |
| A3N | 1,644 (56.7%) | 373 | 418 | 566 | 287 | 1,134 | 41% | 64% | 48% |
| A4N | 1,661 (57.3%) | 390 | 418 | 566 | 287 | 1,110 | 43% | 63% | 61% |
| **A0P** | **1,646 (56.8%)** | 394 | 394 | 566 | 292 | 946 | 50% | 66% | 53% |
| A1P | 1,709 (59.0%) | 440 | 408 | 575 | 286 | 1,028 | 68% | 64% | 39% |
| A2P | 1,654 (57.1%) | 385 | 408 | 575 | 286 | 1,022 | 43% | 62% | 60% |
| A3P | 1,705 (58.9%) | 436 | 408 | 575 | 286 | 1,022 | 57% | 65% | 45% |
| A4P | 1,674 (57.8%) | 405 | 408 | 575 | 286 | 1,032 | 50% | 64% | 55% |

Reform won 980 wards. Council types here put two wards differently from the 24 October table (1,119 and 424 against 1,121 and 422); London and metropolitan agree, and the published file scores 447 and 367 on both.

MAE and signed bias per party (pp, MAE / signed), by council type:

**A0P, kept**

| Council type | Wards | Called | Reform | Labour | Conservative | Lib Dem | Green | Others |
|---|---|---|---|---|---|---|---|---|
| London borough | 636 | 394 | 9.9 / +6.6 | 8.2 / -3.7 | 7.4 / -4.9 | 5.9 / +1.1 | 8.3 / +2.3 | 5.6 / -2.8 |
| Metropolitan borough | 718 | 394 | 9.3 / -2.1 | 6.9 / +1.5 | 5.9 / +2.6 | 4.8 / +0.7 | 8.2 / -1.9 | 7.5 / -0.9 |
| No 2025 anchor | 1,119 | 566 | 7.2 / -0.3 | 5.1 / +1.5 | 8.4 / +3.8 | 7.4 / -2.7 | 8.1 / -0.6 | 9.8 / -5.6 |
| 2025 county anchor | 424 | 292 | 8.4 / -0.6 | 6.2 / +2.6 | 6.0 / +0.1 | 7.0 / -1.0 | 5.4 / -0.5 | 8.8 / -2.3 |
| All | 2,897 | 1,646 | 8.5 / +0.7 | 6.4 / +0.5 | 7.2 / +1.0 | 6.4 / -0.7 | 7.8 / -0.3 | 8.0 / -3.0 |

**A1P, best overall, 7 London wards short of the bar**

| Council type | Wards | Called | Reform | Labour | Conservative | Lib Dem | Green | Others |
|---|---|---|---|---|---|---|---|---|
| London borough | 636 | 440 | 10.1 / +6.5 | 7.2 / +4.0 | 7.0 / -3.9 | 5.6 / +0.3 | 8.8 / -5.8 | 5.7 / -3.0 |
| Metropolitan borough | 718 | 408 | 9.2 / -1.4 | 6.8 / +0.6 | 5.5 / +1.8 | 4.8 / +0.6 | 8.2 / -0.8 | 7.4 / -1.1 |
| No 2025 anchor | 1,119 | 575 | 7.2 / +0.6 | 4.9 / +1.0 | 7.9 / +2.5 | 7.4 / -2.7 | 8.3 / +0.4 | 9.8 / -5.7 |
| 2025 county anchor | 424 | 286 | 8.4 / +0.1 | 6.0 / +2.0 | 5.9 / -1.0 | 7.0 / -1.1 | 5.7 / +0.6 | 8.8 / -2.4 |
| All | 2,897 | 1,709 | 8.5 / +1.3 | 6.1 / +1.7 | 6.8 / +0.4 | 6.3 / -1.0 | 8.0 / -1.2 | 7.9 / -3.2 |

**A2P, the London ratio arm**

| Council type | Wards | Called | Reform | Labour | Conservative | Lib Dem | Green | Others |
|---|---|---|---|---|---|---|---|---|
| London borough | 636 | 385 | 8.8 / +4.2 | 8.2 / -3.8 | 6.9 / -3.2 | 5.7 / +0.4 | 8.7 / +3.7 | 5.6 / -2.7 |
| Metropolitan borough | 718 | 408 | 9.2 / -1.4 | 6.8 / +0.6 | 5.5 / +1.8 | 4.8 / +0.6 | 8.2 / -0.8 | 7.4 / -1.1 |
| No 2025 anchor | 1,119 | 575 | 7.2 / +0.6 | 4.9 / +1.0 | 7.9 / +2.5 | 7.4 / -2.7 | 8.3 / +0.4 | 9.8 / -5.7 |
| 2025 county anchor | 424 | 286 | 8.4 / +0.1 | 6.0 / +2.0 | 5.9 / -1.0 | 7.0 / -1.1 | 5.7 / +0.6 | 8.8 / -2.4 |
| All | 2,897 | 1,654 | 8.2 / +0.8 | 6.3 / -0.1 | 6.8 / +0.6 | 6.3 / -1.0 | 8.0 / +0.9 | 7.9 / -3.1 |

The 24 October candidate for comparison (A0N): London 11.3 / +8.8 Reform, 8.8 / -5.0 Labour, 8.3 / +2.0 Green; all wards Reform +3.3, Labour -0.9, Green -0.7.

## 4. The choice, and what it says

**By the rule fixed in section 1, no arm qualifies.** A1P calls the most wards in set P (1,709) but 440 in London, 7 short of 447; A2P calls 385 in London. So A0P is kept: the candidate on corrected inputs, 1,646 of 2,897 (56.8%), 23 above the bar of 1,623, with London at 394, 53 below the published engine. The London loss stands.

What the arms show:

1. **The corrected inputs cost the candidate 38 wards** (A0N 1,684 to A0P 1,646), 51 of them in the metropolitan boroughs (445 to 394). Part of C2's October gain in the metropolitan boroughs rested on the two defects together, which this note does not separate: the hand-set May 2025 poll, and London's 18 unmatched boroughs, which entered the single Final-C run with the national poll as their baseline and so pulled Labour's target, and its multiplier in every ward, down (Labour ×0.690 in A0N, ×0.739 in A0P). With both corrected, Reform is named first in 946 wards against 980 won: the Reform overcall in the aggregate is gone, but the misses now run the other way ("Conservative predicted, Reform won", 190).
2. **The 2022 London ratio does not rescue London.** Its Green ratio (1.34) was measured when Greens polled 5%; applied multiplicatively at 16% it lifts London Greens by 1.4 to 1.6 times, and London Green bias turns positive (+3.7 in A2P) while Labour stays short (-3.8). A ratio fitted at one level of a small party's support does not carry to three times that level.
3. **London is best left out of Final-C.** A1 (no Final-C in London) calls 440 there in both sets, near the published 447, and is the best arm overall. What it leaves is a London Reform overcall of +6.5 points, Green -5.8 and Labour +4.0, which comes from Step 9b (C1's London multiplier, 0.656) and the upstream stages, not from C2. HEAD's May-fitted London multiplier is 0; this note does not use that, because it was fitted on May 2026.
4. **Splitting alone helps.** A4P (split, national ratio both sides) calls 1,674 and 405 in London, against A0P's 1,646 and 394, so running Final-C separately for London is worth about 28 wards before any London evidence.

No parameter was changed after these scores were seen. The next London step, if one is wanted, is a new protocol written before fitting: London out of Final-C (as A1) together with a London Step 9b multiplier fitted on pre-lock London evidence, or an additive rather than multiplicative local-to-Westminster gap for parties whose national share has moved a long way since the ratio was measured.

## 5. Calibrations after the change

| File | Status for A0P |
|---|---|
| `party-bias.json` | Refitted on A0P's May 2026 output: `candidate-2026-11/party-bias.json`. Bias Reform +0.74pp, Labour +0.46, Conservative +1.00, Liberal Democrats -0.73, Green -0.27. Held out by council, applying it costs 0.91 points of winners (+0.04pp MAE). Do not apply it. |
| `confidence.json` | Refitted on A0P: `candidate-2026-11/confidence.json`. Held-out Brier 0.226 against a flat 0.248; calibration error 6.1pp against a flat 4.1pp, so the bins are noisier than the base rate. |
| `reform-regional-multiplier.json` | Unchanged: C1's fit (`candidate-2026-10-24/`) is not touched by this note. |
| `regional-dampening.json`, `baseline-recency.json` | Not refitted, for the reasons in the 24 October note, section 5; both wait for the full run. |

Both refits are fitted on May 2026 and so may never be applied to May 2026; the apply-time libraries refuse it by polling date.

## 6. Limits and open points

- Outside London C2 still takes GE2024 shares from name matching. That decides the targets in every council with a weak match; the LSOA baseline should replace it everywhere in the full run.
- LSOA counts stand in for population in the London baseline.
- The ten London by-elections are small and not a random sample of wards.
- `UKE_CANDIDATE_ENGINE` is named in the 24 October note but no script or library reads it. The candidate exists only in the replay scripts; nothing in the nightly build can pick it up.
- The upstream stages are still the polling-day engine's own output (24 October note, section 6). The gate figure for 2027 is the full run on 25 April inputs, not this replay.
