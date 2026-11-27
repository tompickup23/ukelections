# May 2027 ward list and baselines: method, sources and first-cut results

Built 27 November 2026 by `scripts/build-wards-2027.mjs`. Data only: no page, engine or forecast reads these files yet.

- `data/identity/wards-2027.json`: the councils in scope, the wards or divisions that vote on 6 May 2027, seats up where a source gives them, and the source of each fact.
- `data/identity/wards-2027-baselines.json`: one baseline record per listed ward, with its method, the most recent by-election kept apart, and the notional validation result.

This is a first cut. Where a fact could not be established it is blank with a note. Nothing is estimated to fill a gap.

## 1. Scope

England only. Scotland (STV) and Wales are out of scope for this cut, as `docs/preregistration-2027.md` section 4 already says for the forecast.

The councils are those in `data/identity/councils-2027.json`:

- the 158 verified English councils (block `verified`);
- the 65 English councils not yet verified, as a separate block (`block: "unverified"`). Of these, the 59 that `councils-2027-cycle-evidence.json` marks `due_by_cycle` have their wards listed; the 6 marked `not_due_by_cycle` (Adur, Hastings, Huntingdonshire, South Cambridgeshire, Stroud, Worcester) are recorded with the reason and no wards.

Nothing in the unverified block should be treated as confirmed that the council votes in 2027.

## 2. Sources

| Key | Source | Retrieved | Used for |
|---|---|---|---|
| `wd26` | ONS, Wards (May 2026) Boundaries UK BGC, as committed in `data/geography/wd26-bgc.geojson` | in repo | The current ward set for each council |
| orders | legislation.gov.uk, every UK Statutory Instrument titled "(Electoral Changes) Order" made in 2023, 2024, 2025 and 2026 (103 orders). Article 1 of each; the whole order for the 52 that change an in-scope council's wards in 2024 or later or take effect in 2027 | 27 November 2026 | Which councils are redrawn for 2027, the new wards and councillors, small boundary transfers, and who retires in 2027 |
| `dc` | Democracy Club ward results, England 2016 to April 2026. Drive library: `DOGE/Elections & Demographics/01 Election results (ward, 2016-2026)/ward_results_2016-2026_candidates.csv` (CC0) | copied 27 November 2026 | 2022 to 2024 ordinary results; by-elections to April 2026; 2023 winners for seats up |
| `may2026` | `data/results/may-2026/local-and-mayor.merged.json`, joined to ONS codes by `data/identity/wards-may-2026.json` | in repo | May 2026 ordinary results, the same actuals the yardstick uses |
| `leap2022` | Andrew Teale, Local Elections Archive Project, all local election results for 2022, `https://www.andrewteale.me.uk/2022/leap-2022-05-05.zip` (CC BY-SA) | 27 November 2026 | 2022 results (the four 2022 unitaries) |
| `leap2019` | The same archive, 2019, `https://www.andrewteale.me.uk/2019/leap-2019-05-02.zip` | 27 November 2026 | 2019 context only, and 2019 winners for seats up |
| `appends` | `data/history/byelection-appends.json` | in repo | By-elections since May 2026 |
| lookups | ONS LSOA (2021) to ward best-fit lookups for the 2023, 2024 and 2025 ward sets, and LSOA population-weighted centroids. Drive library: `03 Geography and lookups/`. The 2022 lookup is `data/features/lsoa21-to-ward.json` | copied 27 November 2026 | The notional method and its validation |

Each output's `inputs` block records the sha256 of every input file. Inputs from outside the repo sit in `.cache/wards-2027/` (gitignored); section 9 says how to get them back.

robots.txt was read before each fetch. legislation.gov.uk allows these paths with a five-second crawl delay, which the fetch script keeps. Andrew Teale's site disallows only its upload pages. `candidates.democracyclub.org.uk` disallows everything (`Disallow: *`), so nothing from it is used here; see section 10.

## 3. The ward list

For each council:

1. **Redrawn for 2027.** If an Electoral Changes Order's explanatory note says it replaces the council's wards (or divisions) with new ones "for the purpose of elections held on or after the ordinary day of election of councillors in England in 2027", the wards are the names in its Schedule 1 and the councillors are the numbers there, or the order's uniform rule ("the number of councillors to be elected for each ward is one"). These wards are `boundaries: "new"` and have no ONS code yet. The ward count must equal the count in the order's note, or the council is left `unknown`. Ten verified councils:

   | Council | Order | Wards | Councillors |
   |---|---|---|---|
   | Canterbury | SI 2025/141 | 24 | 40 |
   | Cheshire East | SI 2026/55 | 47 | 82 |
   | Cumberland | SI 2026/1166 | 55 | 55 |
   | East Riding of Yorkshire | SI 2026/53 | 28 | 67 |
   | Middlesbrough | SI 2025/1345 | 20 | 46 |
   | North Yorkshire | SI 2026/1046 | 87 divisions | 89 |
   | Somerset | SI 2026/1047 | 93 divisions | 96 |
   | Stockton-on-Tees | SI 2023/1342 | 27 | 56 |
   | Westmorland and Furness | SI 2026/296 | 35 | 65 |
   | Wirral | SI 2026/1045 | 22 | 66 |

2. **Small transfers in 2027.** Five orders made at a council's request move a parish-led area between named district wards from 2027 (Teignbridge SI 2024/1194, Uttlesford SI 2024/597, Wealden SI 2024/435, and in the unverified block Mid Devon SI 2024/1373 and Derbyshire Dales SI 2024/484). The council keeps its May 2026 wards; the 11 named wards are marked `altered_2027`.

3. **Everyone else.** The May 2026 ONS wards for the council (`boundaries: "current"`). No order made since 2023 changes them for 2027.

Wards that an order says elect nobody in 2027 are left out of the list and recorded on the council under `wards_not_voting_2027`: Hanslope and New Bradwell (Milton Keynes, SI 2025/1237, Schedule 2) and St John's (Tunbridge Wells, SI 2024/2, Schedule 2).

### Seats up per ward

Every figure carries a `seats_up_basis`:

| Basis | Rule | Verified wards |
|---|---|---|
| `order_schedule_all_out` | Councillors per ward in the 2027 order; all-out council | 438 |
| `order_retirement_2027` | The order that drew the current wards says how many of each ward's councillors retire in 2027. 28 councils, all redrawn for 2024 or 2026; most say "one is to retire ... in 2027" of three, Milton Keynes and Tunbridge Wells give a table | 513 |
| `elected_2023_same_ward` | Winners at the 2023 ordinary poll in the same ward (same ONS code), whose four-year terms end in 2027 | 680 |
| `elected_2019_same_ward_code` | All-out council: winners in the same ONS ward code in 2019. Kept only where the council's wards then sum exactly to the sourced total in `councils-2027.json` | 868 |
| `blank_2019_unreconciled` / `blank_total_mismatch` | A figure was found but did not reconcile, so it is withheld | 613 |
| null | Not established | 584 |

In councils elected in parts, 28 wards with no 2023 contest on record (where the council's other wards have one) carry `may_not_vote_2027: true`. Either they skip 2027 in the council's cycle or the record is missing; this cut cannot tell which.

## 4. Baselines

Shares are full-slate party shares, the convention of `scripts/score-may-2026-like-for-like.mjs`: every candidate's votes summed by party, over all votes cast in the ward. "Labour and Co-operative Party" counts as Labour, as in `local-and-mayor.merged.json`. Each baseline also carries `pooled` shares (Reform UK, Labour, Conservative, Liberal Democrats, Green Party, Others).

| Method | Rule |
|---|---|
| `same_ward` | The ward's own last ordinary result on the same boundaries (same ONS code), with date, ballot id, source and candidate row count. For an all-out council it must come from the council's last ordinary poll or later, so an older result is never passed off as current. |
| `renamed` | An explicit old-to-new mapping from a source. None was found in this cut. |
| `notional` | Old wards' results carried to the new ward by the 2021 LSOAs they share, weights kept (`notional.weights`: old ward, LSOA count, weight). Used only when at least 80% of the new ward's LSOAs fall in old wards with a result. |
| `none` | No baseline, with a note saying why. |

By-elections are never a baseline. `last_by_election` holds the most recent principal-council by-election in the ward on its current boundaries (252 verified wards have one).

`fallback_2019` is context only and never a baseline: where a ward has no baseline, its 2 May 2019 result on the same ward code, or carried to it by LSOAs from the 2019 wards. It is eight years old by polling day.

LSOAs are counted, not weighted by population. LSOAs are built to hold 1,000 to 3,000 people, so the count is a rough proxy for population. Every LSOA is assigned whole to one ward (best fit).

### A 2026 lookup had to be built

ONS best-fit lookups on hand stop at the 2025 ward set. `scripts/wards-2027-lsoa-to-wd26.mjs` builds the May 2026 one the way ONS builds best-fit lookups: each LSOA goes to the ward holding its population-weighted centroid. Against ONS's own 2025 lookup, over wards unchanged between the two sets, it agrees on 30,693 of 30,800 LSOAs (99.65%). Five of 33,755 English LSOAs fall outside every generalised ward boundary and are unplaced.

## 5. Validation of the notional method

The notional method was tested on boundary changes that already happened, against the result the new wards actually produced (`scripts/wards-2027-validate-notional.mjs`; result stored under `notional_validation`):

- **2023 to 2024:** 12 councils redrawn for 2024 (Basildon, Brentwood, Cannock Chase, Dudley, Epping Forest, Harlow, Havant, North Tyneside, Redditch, Stevenage, Tunbridge Wells, Wokingham).
- **2024 to 2026:** 17 councils redrawn for 2026 (Barnsley, Bradford, Calderdale, Coventry, Gateshead, Kirklees, Milton Keynes, Newcastle upon Tyne, Sandwell, Sefton, Solihull, South Tyneside, Sunderland, Swindon, Thurrock, Wakefield, Walsall).

A notional baseline is a year or two older than the result it is scored against, so its raw error mixes geography with movement in opinion. It is set beside `same_ward` on councils whose wards did not change over the same years, which is the error a perfect carry would still have, and beside the council shortcut (every new ward given the council-wide result). "Adjusted" adds the council's own actual change between the two years first, which leaves the geographic error.

MAE is the mean absolute error over the six pooled groups, in percentage points. "Leader" is the share of wards where the baseline's top party topped the poll.

| Pair | Method | Wards | MAE raw | MAE adjusted | Leader raw | Leader adjusted |
|---|---|---|---|---|---|---|
| 2023 to 2024 | notional, redrawn wards | 169 | 4.4 | 4.1 | 85.2% | 85.8% |
| | council shortcut, same wards | 169 | 7.7 | 7.5 | 54.4% | 58.0% |
| | same ward, unchanged councils | 1,036 | 4.6 | 4.3 | 82.2% | 83.0% |
| 2024 to 2026 | notional, redrawn wards | 367 | 13.3 | 5.1 | 38.1% | 67.8% |
| | council shortcut, same wards | 367 | 14.7 | 6.9 | 20.2% | 56.4% |
| | same ward, unchanged councils | 919 | 13.4 | 5.2 | 42.9% | 66.4% |

**Reading.** Carried by shared LSOAs, a redrawn ward's baseline is about as good as an unchanged ward's own result over the same years (4.4 against 4.6 points; 5.1 against 5.2 adjusted), and clearly better than the council shortcut that the 26 November diagnosis found made no-baseline wards worse. The large raw errors for 2024 to 2026 are the movement in opinion between those years, which no baseline method can know; adjusted, they fall to about 5 points for both. The method is fit to use for 2027 where new wards have an ONS or LGBCE boundary to place LSOAs in.

Limits of the test: the notional and same-ward rows are scored on different councils; the 2024 and 2026 polls were whole-council elections in the redrawn councils and the earlier polls were mostly by thirds, so slate size differs; councils only partly redrawn (15 and 17) were left out.

The brief's other design, rebuilding unchanged wards from LSOA weights, is reported as a sanity row only. With best-fit lookups an unchanged ward is rebuilt from exactly its own LSOAs, so it reproduces its own result (the rows match `same_ward` to the third decimal) and tests nothing beyond the lookup.

**Where it cannot be used yet.** The 438 wards in the ten councils redrawn for 2027 have no ONS boundary, so there are no LSOAs to place. They stay `none` until the LGBCE final recommendation boundaries are loaded (section 8).

## 6. Summary

From `wards-2027.json` `summary` (printed by the build):

| | Verified | Unverified (flagged) |
|---|---|---|
| Councils | 158 | 65 (59 listed, 6 not due) |
| Wards listed | 3,696 | 1,170 |
| of which new boundaries for 2027 | 438 (10 councils) | 0 |
| of which altered by a small transfer | 7 | 4 |
| Baseline `same_ward` | 1,231 | 473 |
| Baseline `renamed` | 0 | 0 |
| Baseline `notional` | 1 | 0 |
| **No baseline** | **2,464** | **697** |
| No baseline, but 2019 context held | 1,949 | 668 |
| Wards with seats up known | 2,499 (3,997 seats) | 466 (537 seats) |
| Wards with a by-election on current boundaries | 252 | 108 |

The one notional baseline is Idle and Thackley (Bradford): its May 2026 result is missing from the merged results file, so the 2023 wards are carried to it.

**Where the 2,464 gaps are.** 438 are the new wards above. The other 2,026 are in 83 verified councils whose wards are current but whose last ordinary poll (May 2023) has no ward results on hand. This is the 93-council gap that `docs/preregistration-2027.md` section 4 already names (83 plus the 10 redrawn councils). The thirds councils, whose last poll was May 2026, are covered almost completely.

## 7. Reconciliation

| Count | Councils | Seats |
|---|---|---|
| `councils-2027.json`, English verified | 158 | 3,643 sourced, for 81 councils |
| This file, English councils listed | 217 (158 verified, 59 unverified due by cycle) | 5,522 known, for 153 councils; 64 councils unknown |
| Rivals' published English total, as given in the brief | 215 | 7,554 |

The differences are not forced into agreement:

- **Councils, 217 against 215.** This file lists every council `councils-2027-cycle-evidence.json` says is due by cycle, verified or not. Rivals' list was not fetched, so which two councils differ is not established. Candidates worth checking are any of the 59 unverified councils whose 2027 poll is in doubt (the cycle evidence file names four disputed earlier).
- **Seats, 5,522 against 7,554.** 5,522 is a floor, not an estimate: it counts only councils with a sourced or fully reconciled seat figure. 64 councils have no seat total here. This file cannot say whether the remaining seats close the gap.
- **Against `councils-2027.json`.** Its 3,643 sourced seats are inside the 5,522. 53 verified councils have per-ward seats that sum exactly to its sourced total.

## 8. Gaps and next steps

1. **2023 ward results for 93 councils (the main gap).** The Drive results file does not fill it. It holds 2023 ordinary results for 127 councils, but they are mostly councils elected in parts. Of the 96 verified councils elected whole in May 2023, only 7 have 2023 ward results in it (Chelmsford, Chesterfield, East Hertfordshire, Hertsmere, Horsham, Rother, West Suffolk); the rest appear only through later by-elections. The plan addendum of 27 November (Reports PR 901, section 8) reads the 127 as possible coverage for the 2027 councils; on checking, it is not. Options: the Democracy Club results export from the server copy (`data/history/dc-historic-results-2027.json`, built on vps-main on 16 November, gitignored and not on this Mac), or Andrew Teale's 2023 council pages, which robots.txt allows but which would mean several thousand page fetches from a one-person site. **Tom's call.**
2. **Boundaries for the 438 new wards.** The notional method is validated but needs the LGBCE final recommendation boundaries (or ONS's May 2027 ward layer when published) for the ten redrawn councils.
3. **Seats up for 1,197 verified wards.** Mostly all-out councils with no sourced total to check 2019 figures against. Each council's notice of election (published by late March 2027) settles it.
4. **The 28 `may_not_vote_2027` wards** need each council's cycle checked.
5. **The unverified block** needs each council's order or own page, as section 4 of the pre-registration says.

## 9. Rebuilding

```bash
node scripts/wards-2027-fetch-orders.mjs        # legislation.gov.uk, 5 s between requests
node scripts/build-wards-2027.mjs               # writes both files and prints the summary
node scripts/build-wards-2027.mjs --check       # exit 1 if a fresh build differs
npx vitest run tests/wards-2027.test.mjs
```

Copy the Drive inputs into `.cache/wards-2027/` first:

```bash
rclone copyto "doge:DOGE/Elections & Demographics/01 Election results (ward, 2016-2026)/ward_results_2016-2026_candidates.csv" .cache/wards-2027/ward_results_2016-2026_candidates.csv
```

and likewise `lsoa21_to_ward_wd23.csv`, `lsoa21_to_ward_wd24.csv`, `lsoa21_to_ward_wd25.csv` and `lsoa21_population_weighted_centroids.csv` from `03 Geography and lookups/`, plus the two LEAP CSVs unzipped from the URLs in section 2. Check each against the sha256 in the output's `inputs` block.

## 10. For Tom: errors found and things to check

- **Somerset seats in `councils-2027.json`.** It gives 110 seats up. The Somerset (Electoral Changes) Order 2026 (SI 2026/1047) replaces the divisions from 2027 with 93 divisions and 96 councillors (90 single-member, three two-member). 110 looks like the council's size before the order. Not edited here.
- **North Yorkshire.** `councils-2027.json` leaves seats blank; SI 2026/1046 gives 87 divisions and 89 councillors from 2027.
- **Cambridge.** Its 2023 winners sum to 16 against 14 seats up in `councils-2027.json`; per-ward seats are withheld until that is checked.
- **Tunbridge Wells.** The May 2026 ONS layer and the May 2026 ballots carry a ward "Rural Tunbridge Wells" (E05015805) that is not in SI 2024/2, whose Schedule 1 has "Goudhurst, Lamberhurst & Horsmonden" instead. It looks like a later renaming, but no source for that is on hand, so its 2027 seat is left blank.
- **The pre-registration's section 4** remains accurate: the ward list now exists as a first cut, and the baseline gap is still 93 councils.
- **A disclosure.** In checking whether Democracy Club could be read, two requests were sent to `candidates.democracyclub.org.uk` (one results API call, which returned 401, and one CSV export) in the same command that first read its robots.txt, which disallows all paths. Nothing from either response was kept or used.
