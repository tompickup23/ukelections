# Council control at the 7 May 2026 English local elections: specification

Written and committed before any control score was computed. Research only;
nothing here feeds the site.

## Question

How often did each forecast call council control (which party, if any, holds
more than half of all seats after the election), and the largest party, at the
7 May 2026 English local elections? Three forecasts and one benchmark:

| arm | source |
|---|---|
| published | the polling-day forecast, `data/predictions/may-2026/local-and-mayor.json` at git `5e85c84`, sha256 checked exactly as `score.py` does |
| candidate | the 24 October 2026 candidate engine replay, `cache/arms/candidate-2026-10-24.json` |
| blend | candidate and ward model S1 (`cache/recency_predictions.pkl`, columns `s1_*`, rows with `set == "may26"`), 0.5 and 0.5, renormalised, with `blend` and `BLEND_WEIGHT_MODEL` from `score.py`/`common.py` (weight fixed before any scoring, not tuned) |
| no change | the pre-election composition: control and seats as they stood in the 2025 snapshot of `data/features/council-composition-history.json` (OpenCouncilData) |

## Facts read from the data before writing this (no score was looked at)

- The results file `data/results/may-2026/local-and-mayor.merged.json` holds
  2,877 scheduled local ballots (`tier == "local"`, `is_by_election == false`)
  in 136 councils, and 20 local by-elections. 20 councils had only a
  by-election on 7 May (for example Somerset, Surrey, Powys); they are not
  councils voting in a scheduled election and are listed, not scored.
  `council-control.json` counts them among its 156 "contesting" councils.
- The results file lists 68 undeclared local ballots and seven councils as
  partial (`partial_councils`: Newham, Birmingham, Tower Hamlets, Brent,
  Kensington and Chelsea, Kirklees, Waltham Forest).
- 1,196 of the 2,877 scheduled ballots elect more than one councillor, and in
  223 of them (18.6%) the winners came from more than one of the six lanes.
  Split wards are common, so a secondary seat rule is fixed below.
- The `elected` flag is missing on 41 ballots (all of Redbridge and St Helens,
  two Havering wards, one Birmingham ward); the `winners` list is complete on
  every ballot and agrees with `elected` wherever both exist. Actual seats are
  taken from `winners`.
- `council-control.json` itself approximates the seats not up in thirds and
  halves councils as `pre[party] * seats_up / total` (its own `method` field).
  That is an estimate, so it is not used here as the source of continuing
  seats; it is compared against, not relied on.
- All three forecast arms are shares by party; the published and candidate
  files cover all 2,877 scheduled ballots, ward model S1 covers 2,576 of them.

## Lanes

The six pooled lanes of `score.py`: Reform UK, Labour, Conservative, Liberal
Democrats, Green Party, Others. A forecast's ward shares are pooled with
`pooled` and its ward leader is `top` of the pooled shares, the same rule for
every arm. Actual seat winners are pooled with `pool_party` on
`party_canonical`. Composition columns map `con`, `lab`, `ld`, `green`, `ref`
to the five named lanes and `ukip`, `snp`, `pc`, `nat`, `other` to Others.

For the published arm, the number of wards where `top` of the pooled shares
differs from the post-audit `predicted_winner` (the leader `score.py` uses) is
reported; the score uses `top` so that every arm is treated the same.

## Seats from a ward forecast

Seats up in a ward = `winner_count` of its 7 May 2026 result.

- **Primary**: all seats up in a ward go to the forecast leader.
- **Secondary** (reported beside it): if the second lane's forecast share is
  within 5 percentage points of the leader's and the ward elects two or more,
  the leader takes `ceil(seats / 2)` and the second lane the rest; otherwise
  the leader takes all. The 5 point threshold is fixed here and not tuned.

## Council type and size

- **All up**: seats elected in 2026 (declared plus those the results file lists
  as undeclared) are at least 90% of the 2025 composition total, or the
  council has no composition and every seat is new (East Surrey, West Surrey).
  Council size = seats elected in 2026. If fewer seats were elected than the
  2025 composition total, the council is excluded: whether seats were left
  unfilled (a postponed poll) or the council was made smaller cannot be told
  from these files. If more were elected, the council was enlarged and size is
  the 2026 figure.
- **Partial** (thirds or halves): otherwise. Size = 2025 composition total.

## Seats not up (partial councils)

Continuing seats by lane = 2025 composition by lane minus the seats being
defended in 2026 by lane. Defenders come from Democracy Club results
(`data/history/dc-historic-results.json`), ward by ward:

1. Build the ward's seat queue, earliest expiry first. If the council held an
   all-out election (winners at least 90% of that year's composition total)
   in 2022 or later, start from the ward's winners at the latest such
   election, lowest vote first, then apply each later ordinary election.
   Otherwise the queue is the ward's ordinary-election winners from 1 May 2022
   to 6 May 2026 in date order, and the first must date from 2022 (a four year
   term ending in 2026).
2. An ordinary election with one winner removes the front seat and appends the
   winner. A winner beyond the first at an ordinary election (a casual
   vacancy), and every by-election winner, replaces a seat whose identity the
   data does not give: every possible seat is enumerated.
3. In 2026 the front seat is defended; if the ward elects more than that, the
   further seats are casual vacancies, enumerated over the remaining seats;
   if it elects every seat in the queue, all are defended.
4. The ward resolves only if every enumeration gives the same defending lanes.
   Otherwise, or if the ward has no usable history, it does not resolve.

A partial council is scored only if every ward up resolves, the 2025
composition exists, and every lane's continuing seats are zero or more. If
not, it is excluded and listed with the reason. Nothing is estimated.

Known limits, not corrected: defections and by-elections after the 2025
composition snapshot are not in it; a party label at election is used for the
defender even if the councillor later changed party.

## Control and largest party

- Control: a lane holding more than half of all seats. If no lane does: no
  overall control (NOC). Others pools independents and local parties, so an
  Others lane above half is not one party: it is recorded as the outcome
  "Others majority", scored like any other outcome, and every council where
  the actual or a forecast outcome is Others majority is listed separately.
  Control accuracy is also given with those councils left out.
- Largest party: the lane or lanes with the most seats, Others included as a
  pooled lane. Called correctly only if the forecast's set of top lanes equals
  the actual set.
- Actual control is derived the same way from continuing seats plus actual
  2026 winners. It is compared with `council-control.json` council by council
  and every disagreement is listed; neither is silently preferred.

## Measures (per arm, and for no change)

- Control called correctly: count of councils, and share of councils scored.
- Largest party called correctly: count and share.
- Mean absolute seat error: for each lane, mean over councils scored of
  |forecast seats minus actual seats|; plus the mean over all six lanes. For
  no change, forecast seats are the 2025 composition (its own total), which
  differs from the 2026 size where the council was resized; that is reported
  as it falls.

## Coverage

Councils voting = councils with at least one scheduled 2026 local ballot.
Exclusions for every arm: results incomplete (`partial_councils`), council size
not verifiable, partial council not reconciled. Then per arm:

- **Primary**: a council is scored for an arm only if every ward up has that
  arm's forecast.
- **Secondary** (beside it): a ward without a forecast takes its pre-election
  holder where known (the resolved defenders for a partial council; for an all
  up council, the winners of that ward's most recent ordinary election if it
  elected the same number of seats). Councils with any ward still unfilled are
  excluded.
- No change is scored where the 2025 composition exists.
- A common set (every arm and no change scorable under the primary rule) is
  reported so that the arms are compared on the same councils.

## Run

One scoring run: `uv run python control_score.py`, writing
`results/control_summary.json` and `CONTROL_RESULTS.md`. Any fault found and
fixed before a score is read is reported in the results.
