# Every probability surface on ukelections.co.uk, and whether it has been tested

Measured 29 August 2026. Reproduce the by-election rows with
`node scripts/audit-probability-calibration.mjs`. The other rows are code and
page reads, stated as such.

The question behind this audit is not "is the 5 to 10% band wrong". It is
"where along each published curve does this site stop being honest, and has
anyone ever checked". A probability published without its tail validated is the
class; the by-election pages were only the instance we happened to know about.

## The matrix

| Surface | Live URLs | What it publishes | What generates the spread | Validated against outcomes | Uncapped sigma applies |
|---|---:|---|---|---|---|
| Local by-elections, contest pages | 122 | Per party "X% to win", 10th/90th percentiles of 4,000 draws, a named favourite above 55% | Per-party MAD of the log-odds swing in the corpus, multiplied by `SIGMA_INFLATION` 1.75, lognormal on log-odds, renormalised per draw | **Yes, at both levels now.** Leader lane published since launch (3 bands, 224 contests). Lane level first measured here (3,362 lanes) | Sigma is uncapped, but measurement says the resulting tail is honest. See the memo |
| Local by-elections, index | 1 | Headline record, 3-band reliability table, per-party average miss | Same | Yes, and it reproduces (see below) | Same |
| Ward pages | ~2,977 | Projected share per party, and "Model confidence going in: High/Medium/Low" | `intervals.js`: additive Gaussian on shares, per-party residual SD from the 2024 backtest, floored at 0 and renormalised, 1,000 draws | **The published label is the OLD heuristic and it ranks backwards.** The calibrated replacement exists but is blocked on May 2026 by design | Different model entirely. Additive on shares, not log-odds. No inflation factor of any kind |
| Ward pages, latent | ~2,977 | Nothing. `p10`/`p50`/`p90` and `win_probability` are computed for ~14,000 lanes and stored, but no page renders them | Same as above | **Never.** The May 2026 results exist, so this is testable today and has not been tested | Would apply if it were ever published |
| General election, 650 seats | 651 | Seat tallies and a per-seat winner with a margin in pp | Nothing. Point estimates only | Post-audit exists for 2024 (`data/transparency/ge-postaudit-2024-07-04.json`) | **No.** The page states plainly that per-seat intervals are not yet shown |
| Mayoral, May 2027 | 1 | `p_win` per candidate, probability of reaching the runoff, modal runoff pairing | Additive Gaussian on shares at a per-contest sigma, plus noise on the SV transfer reach and split, 2,000 draws | **Shares only, once.** The GM 2026 backtest (6.2pp MAE, winner called) is one contest. The probabilities have never been scored | Sigma is hand-set per contest, not fitted to any outcome |
| Mayor of Lancashire, hypothetical | 1 | First-preference shares, a 93% win probability, runoff split | Same engine | **Never, and cannot be.** No such contest exists. The page says so loudly | Same |
| Lancashire unitaries, May 2027 | 1 | Seat ranges per party, majority probability (Reform 97% in East Lancashire), no-overall-control probability | Per-ward sigma **hand-set by signal quality** (0.05 actual-local to 0.11 proxy), plus a per-district shock and a flat per-ward sigma, 2,000 draws | **Never.** The election has not happened | Yes in principle. Nothing has ever tested whether a 97% here means 97% |
| Senedd 2026 | 1 | P10/P50/P90 seat totals per party | d'Hondt per super-constituency over a bootstrap with a **hardcoded 5pp** per-party noise | **Never**, although the election happened on 7 May 2026 and could be graded | Yes, and worse: see the defect below |
| Holyrood 2026 | 1 | P10/P50/P90 list seat totals per party | Same shape | **Never**, same | Same defect |
| Makerfield | 1 | Frozen forecast plus a forecast-versus-result scorecard | Scenario-based, retired | Yes, and published as a miss | Retired method |
| Clacton | 1 | Winner and turnout only, no vote-share forecast | Nothing, by design after Makerfield | Winner called | Not applicable |
| Past results | several | The confidence calibration curve and the party-bias offsets | Fitted, published | Yes | Not applicable |

## The findings behind the matrix

### 1. The published by-election reliability table cannot see three quarters of its own page

`calibration()` bins on `leader_probability`, the chance given to the single
party the page names as favourite, and `PUBLISHED_BANDS` starts at 0.30. A lane
the page puts at 3% is never the leader, so no result anywhere can put a 3% lane
into that table. The lowest published row is "30 to 55%".

Of the 3,362 lanes in the back-test, 2,242 sit below 30%. None of them had ever
appeared in a reliability table. This is a guard that cannot fire, and the fix
is a second table with its own denominator, not a change to the first one.

`tests/probability-reliability.test.mjs` pins this: twenty contests where the
named favourite was given 20% and every one of them lost produce an **empty**
published table and a correctly dishonest full-range table.

### 2. A party on the ballot can be given no lane at all, and 39 live pages do it

`projectContest()` deletes any party standing where it has no prior ward result
and the corpus cannot price an entry share. The deletion is recorded in
`unpriced_parties` and **rendered nowhere**. The contest page builds its
projection table and its "Ranges, not point estimates" table from
`forecast.central`, so an unpriced party is simply absent, while "The field"
section lists it as standing.

Measured over the back-test corpus:

| | |
|---|---:|
| Contests with at least one party given no lane | 184 of 785 (23.4%) |
| Same, since May 2025 | 71 of 224 (31.7%) |
| Party-contests with no lane | 222 of 3,584 (6.2%) |
| Median vote share taken by an unpriced party | 3.9pp |
| 90th percentile | 17.2pp |
| Largest | **54.2pp** |
| Contests actually **won** by a party with no lane | **3** |

On live data, 39 of the 122 contest files carry at least one unpriced party.
Cotswold St Michaels is the worked example: five candidates on the page, four in
the projection, Labour dropped, and Labour then polled 2.5%. Great Yarmouth
Caister South is the serious one: Great Yarmouth First took 54.2% and won a
contest in which the model had published a complete-looking set of chances that
did not mention them.

This is a bigger integrity problem than any small-party number being somewhat
high, because the reader cannot tell it is happening.

### 3. The Senedd and Holyrood seat bands are wrong by construction

`run-senedd-predictions.mjs` builds a party's Wales-wide P10 by **summing the
per-super-constituency P10s**, and its own comment says so: "p10/p90 totals are
sum-of-quantiles (approximation; not the same as joint p10/p90)". The sum of
sixteen 90th percentiles is the case where a party hits its own 90th percentile
in all sixteen areas at once, which is not a 90th percentile of anything.

The published consequence is visible on the page. The Green Party is given a
central projection of **1 seat and a P90 of 12**. Labour is given a central of 26
and a P10 of 12. The page describes these as coming from a bootstrap with 5pp of
per-party noise and does not mention that the aggregate is a sum of quantiles.
Holyrood does the same thing to its list seats.

Both pages are honestly labelled "archived pre-election estimate" with a scaffold
warning, which mitigates the harm considerably. Neither has been graded against
the 7 May 2026 results, which have existed for nearly four months.

### 4. The ward confidence label published on ~2,977 pages ranks backwards

`calibrate-confidence.mjs` replaced the three-band high/medium/low label because
it ranked backwards on May 2026: wards marked "high" were called right 55.5% of
the time against 58.6% for "medium". The replacement is correctly refused on the
election it was fitted on (`confidenceApplies` blocks `local.2026-05-07`), which
is the right anti-circularity call.

The consequence is that every May 2026 ward page, which is almost all of them,
falls back to `classifyConfidence` and publishes the old label. The live page
reads "Model confidence going in: **High**" with no caveat. The calibrated curve
arms the next election and describes none of the pages currently published.

### 5. The uncapped-sigma issue does not generalise the way it looks like it should

The by-election engine and everything else are different models. The by-election
engine multiplies log-odds by a lognormal shock whose width is measured from the
corpus and then inflated by a fitted constant. Every other surface adds Gaussian
noise to shares at a sigma that is either hardcoded (Senedd 5pp), hand-set per
contest (mayoral), or hand-set by a signal-quality tier (Lancashire unitaries
0.05 to 0.11).

So capping per-party sigma in the by-election engine would move **only** the 122
by-election contest pages and their cards. It would not touch the mayoral, the
unitaries, the devolved or the ward surfaces, because they do not share the code
path or the parameter. That makes the Phase 3 decision smaller than it looks.

The reverse is also true and is the more useful conclusion: three surfaces
publish probabilities from a spread nobody has ever fitted to an outcome, and
two of them (Lancashire unitaries at 97%, mayoral) put confident numbers in front
of readers. That is where the unvalidated risk actually is.

## What would close each gap

1. **Ward-level win probability.** The largest testable gap. ~14,000 lanes,
   outcomes already in `data/results/may-2026/local-and-mayor.merged.json`. The
   same `toLanes` and `reliability` functions apply unchanged.
2. **Senedd and Holyrood.** Replace the sum of quantiles with the quantile of
   the simulated total, which is a small change inside the existing bootstrap,
   and grade both against the 7 May 2026 results.
3. **Unpriced parties.** Render them. A row saying "standing, not priced" is
   honest and cheap; deleting the party is not.
4. **Lancashire unitaries and mayoral.** Nothing can validate these before the
   contests happen. The honest interim step is to say on the page that the
   spread is hand-set and has never been scored against an outcome.
