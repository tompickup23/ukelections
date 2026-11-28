# Council control on the May 2026 forecasts: specification

Written 27 November 2026, before any council control score was computed.
Research only. Nothing on the site reads this folder.

## Question

Ward accuracy has a ceiling well below 90%: 41% of May 2026 wards were won by
under 10 points. Council control (which party, if any, holds more than half the
seats after the election) is what most readers want, and close wards may cancel
out across a council. It has never been scored. This scores it once, for three
forecasts and one plain benchmark, at the 7 May 2026 English local elections.

## Forecasts scored

| arm | source | ward leader |
|---|---|---|
| published | `data/predictions/may-2026/local-and-mayor.json` at git `5e85c84`, sha256 checked as in `score.py` | the post-audit leader (`data/transparency/may-2026-postaudit-2026-05-10.json`, live rows), as `score.py` uses |
| candidate | `cache/arms/candidate-2026-10-24.json` (24 October 2026 candidate engine replay) | top pooled share |
| blend | 0.5 candidate and 0.5 ward model S1 (`cache/recency_predictions.pkl`, columns `s1_*`, set `may26`), through `score.blend` with `BLEND_WEIGHT_MODEL` | top pooled share |
| no change (benchmark) | pre-election composition, below | not ward based |

Shares are pooled into the six lanes of `common.py` (Reform UK, Labour,
Conservative, Liberal Democrats, Green Party, Others) by `score.pooled`. One
change for seats only: a label "Labour Co-operative" or "Labour and Co-operative
Party" counts as Labour in every arm and in the actual results, because those
councillors sit in the Labour group and the composition source counts them as
Labour (3 of the 4,884 winners in May 2026 carry that label).

## Data facts read before writing this

From `data/results/may-2026/local-and-mayor.merged.json`, key `by_ballot`, tier `local`:

- 2,897 local ballots: 2,877 scheduled and 20 by-elections.
- The 20 by-elections are all in councils with no scheduled election that day
  (Chelmsford, Chesterfield, East Hertfordshire, Gloucestershire, Great Yarmouth,
  Guildford, Hertfordshire, Hertsmere, Horsham, Lewes, Mid Sussex, Newport, Powys,
  Reigate and Banstead, Rother, Somerset, Stratford-on-Avon, Surrey,
  West Northamptonshire, West Suffolk). Control was not at stake there; they are
  not "councils that voted" here. `council-control.json` lists 156 councils
  because it includes them.
- 136 councils held scheduled ward elections. That is the denominator.
- Seats up per scheduled ward (`winner_count`, which equals the length of
  `winners` on every ballot): 1,681 wards elected one seat, 385 two, 811 three;
  4,884 seats in all.
- 1,198 ballots (including by-elections) elected more than one seat; 250 of them
  (21%) split between pooled lanes.
- Missing declarations: Birmingham, Newham, Tower Hamlets, Brent and Kensington
  and Chelsea have ballots with no result (`missing_ballots`), and
  `council-control.json` records undeclared seats in Kirklees and Waltham Forest.

Chamber size (T) is `cycle.total_seats` in `data/results/may-2026/council-control.json`
(the seat registry). Seats up (U) is the sum of `winner_count` over the council's
scheduled ballots.

## Seat allocation from a ward forecast

**Rule A (primary): every seat up in a ward goes to the forecast leader.**

Rule B (secondary, reported beside it): slate capped. The leader takes as many
seats as it fielded candidates on the actual ballot (nominations are known before
polling day), then the next lane by forecast share takes up to its own candidate
count, and so on until the ward's seats are filled.

Why A is primary: applying each rule to the *actual* ward shares (a check of
the rule, not of any forecast) misallocates 340 of 4,884 seats under A, 339 under
B, and 998 under D'Hondt on lane shares. Splits in May 2026 came from candidate
level vote differences that no lane share can see, so the data does not support
a split rule. B is reported because it is almost free and the brief asked for a
second rule.

## Seats not up (thirds and halves councils)

A council is **all out** when U is at least 0.6 of T. Seats not up are then T
minus U.

- All out with U equal to T: no seats carried over.
- All out with U below T: excluded, reason "results cover fewer seats than the
  chamber". The holders of the missing seats are unknown (undeclared, or no poll
  on the day), and filling them would be an estimate.

Otherwise the council elects by thirds or halves. **The pre-election composition
includes the seats being defended**, so it cannot be used as the seats not up on
its own. Seats not up are

    N[lane] = pre[lane] minus D[lane]

where `pre` is the 2025 row of `data/features/council-composition-history.json`
(OpenCouncilData, the same snapshot `council-control.json` uses), pooled into the
six lanes (con, lab, ld, green, ref; Others is other plus ukip, snp, pc and nat),
and D is the party of each seat up in 2026 at the time it was last filled.

D comes from Democracy Club results in `data/history/dc-historic-results.json`
(scheduled local ballots, `elected` flags, votes), ward by ward, by this rule:

1. Year Y for the council is the latest year from 2022 to 2025 in which its
   scheduled contests elected at least 0.6 of T seats (an all out year). If there
   is none, Y is 2022, the year the seats up in 2026 were last filled on a
   four year term.
2. For each 2026 ward, take the scheduled contest for the same ward slug in year
   Y. Let n be the seats it filled.
3. If Y is not an all out year: D is that contest's winners, and n must equal the
   ward's 2026 seats up (k).
4. If Y is an all out year: councillors elected together retire in ascending
   order of votes, the lowest first, one at each later scheduled election. With j
   the number of scheduled elections in the council after Y up to and including
   2026 (years with scheduled contests in the history, plus 2026), the seat up in
   2026 is the winner ranked n minus j plus 1 by votes (rank 1 has the most votes).
   This needs k equal to 1 and 1 at most n minus j plus 1 at most n.
5. A ward with no contest for its slug in year Y, or failing the count conditions,
   is unresolved.

A thirds or halves council is **excluded** (listed with the reason, never
estimated) if any ward up is unresolved, if the 2025 composition is missing, if
the composition total differs from T, or if N is negative in any lane (the
composition does not reconcile with seats up plus seats not up).

Known limits of D, all reported and none corrected: by-elections and defections
since year Y change who holds a seat, and the composition snapshot dates from
2025, not polling day. The same N is used for every arm and for the actual
result, so these do not favour any forecast; they can make the derived actual
control wrong, which is why it is checked against `council-control.json`.

## Actual result

Actual post-election seats are N plus the actual winners of every seat up
(`winners[].party_canonical`, pooled; Labour Co-operative as Labour). Actual
control and largest party are derived from them by the rules below. They are
compared council by council with `control.status` and `control.controlling_party`
in `council-control.json` (which uses a proportional approximation for seats not
up), and every disagreement is listed. Neither is silently preferred: the score
uses the derived control, and the disagreement list says where the other source
would differ.

## Control, largest party, Others

- **Control**: a lane holds control with more than half of all T seats (seats
  above T/2). Otherwise no overall control (NOC).
- **Largest party**: the lane with the most seats. A tie for most seats in the
  actual result counts a forecast as right if its largest lane is one of the
  tied lanes. A tie in a forecast is no call and counts as wrong.
- **Others**: independents, residents' groups, local parties and every party
  outside the five pool into one lane, for every arm and for the actual result
  alike. An Others majority is scored as a call like any other, but it does not
  mean one group controls the council. Councils where the actual result has
  Others in control, or Others as the largest lane, are listed separately so the
  reader can see where the pooled lane carries the call.

## Measures

For each arm, on each council scored:

1. **Control called correctly**: forecast control equals actual control (the
   same lane, or NOC and NOC). Count of councils.
2. **Largest party called correctly**: count of councils.
3. **Mean absolute seat error**: |forecast seats minus actual seats| for each of
   the six lanes in each council, averaged over councils and lanes (seats per
   lane per council), on the whole chamber.

The **no change** benchmark uses the 2025 composition as its forecast: control,
largest lane and seats as they stood before the election. An inaugural council
(no prior composition: East Surrey, West Surrey) gives the benchmark no call;
it counts as wrong on control and largest party and is left out of its seat
error, and this is listed.

## Wards a forecast does not cover

Counted per council and per arm.

- **Primary**: a council is scored for an arm only if every ward up has a
  forecast from that arm.
- **Secondary**, reported beside it: a missing ward is filled with its
  pre-election holder where that can be known: for a thirds or halves council,
  the D seats above; for an all out council, the winners of the same ward slug's
  contest in the council's previous all out year, when that contest filled
  exactly the same number of seats. Wards that cannot be filled leave the
  council unscored.

The headline comparison is on the **common set**: councils every arm (and the
benchmark) can score under the primary rule. Each arm on its own full coverage
is reported beside it.

## Coverage

Councils covered against the 136 that voted, with every exclusion and its
reason listed, in `results/control_summary.json` and `CONTROL_RESULTS.md`.

## Procedure

`control_score.py` builds every input, checks coverage and reconciliation, and
writes `results/control_summary.json` in one run. Faults found in input building
before the score is read are fixed and reported; the score is computed once.
