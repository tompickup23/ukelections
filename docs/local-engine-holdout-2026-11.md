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
