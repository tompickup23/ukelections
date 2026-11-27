# Council control at the 7 May 2026 English local elections: results

Specification: `CONTROL_SPEC.md`, committed before this run. One scoring run of
`control_score.py`; full output in `results/control_summary.json`. Research only.

## Answer

On the 57 councils that every forecast and the no change benchmark could be scored on,
the blend called control in 48, the published forecast in 38, the candidate engine
in 37 and "no change from before the election" in 38. The blend's mean seat error
was 2.56 seats per party per council against 3.27 published, 4.09 candidate engine and
4.63 no change. On their own wider sets (76 councils), the published forecast and the
candidate engine each called control in 48 (63.2%); no change called 40 of 74.

Only 76 of the 136 councils with a scheduled election could be scored at all, and the
blend could not be scored on 19 of them (among them Essex, Norfolk and the two new Surrey
unitaries), because the ward model has no forecast for some of their wards. Those councils hold
9 of the published forecast's 28 misses and 8 of the candidate engine's 28, so the blend's
lead is measured only where the ward model had forecasts. The published forecast was the
only one public before polling day; the candidate engine and the blend are October and November
2026 research replays.

## Scores

Primary rules: every seat in a ward to the forecast leader; a council scored only if every ward up
has a forecast. Control and largest party are counts of councils; seat error is the mean over
councils and the six lanes of |forecast seats minus actual seats|.

| forecast | councils scored | control called | largest party called | mean seat error |
|---|---|---|---|---|
| **Common set** | | | | |
| Published (polling day) | 57 | 38 (66.7%) | 42 (73.7%) | 3.27 |
| Candidate engine | 57 | 37 (64.9%) | 36 (63.2%) | 4.09 |
| Blend (candidate and ward model S1) | 57 | 48 (84.2%) | 42 (73.7%) | 2.56 |
| No change | 57 | 38 (66.7%) | 35 (61.4%) | 4.63 |
| **Each on its own set** | | | | |
| Published (polling day) | 76 | 48 (63.2%) | 52 (68.4%) | 4.52 |
| Candidate engine | 76 | 48 (63.2%) | 47 (61.8%) | 5.14 |
| Blend (candidate and ward model S1) | 57 | 48 (84.2%) | 42 (73.7%) | 2.56 |
| No change | 74 | 40 (54.1%) | 38 (51.4%) | 6.47 |

Secondary seat rule (a ward electing two or more is split when the second lane is within 5
points of the leader), primary coverage:

| forecast | councils scored | control called | largest party called | mean seat error |
|---|---|---|---|---|
| Published (polling day), common set | 57 | 38 (66.7%) | 42 (73.7%) | 3.12 |
| Candidate engine, common set | 57 | 39 (68.4%) | 35 (61.4%) | 4.05 |
| Blend (candidate and ward model S1), common set | 57 | 47 (82.5%) | 40 (70.2%) | 2.62 |
| Published (polling day), own set | 76 | 48 (63.2%) | 54 (71.1%) | 4.29 |
| Candidate engine, own set | 76 | 50 (65.8%) | 46 (60.5%) | 4.95 |
| Blend (candidate and ward model S1), own set | 57 | 47 (82.5%) | 40 (70.2%) | 2.62 |

Secondary coverage (missing wards filled from the pre-election holder) changed nothing: no ward
without a forecast had a pre-election holder that the data determines (a ward of the same name
whose last ordinary election filled the same number of seats, with no ambiguity left by later
by-elections), so every count equals the primary one.

Mean seat error by party, primary rules, common set (seats per council):

| forecast | Reform UK | Labour | Conservative | Liberal Democrats | Green Party | Others |
|---|---|---|---|---|---|---|
| Published (polling day) | 4.53 | 4.40 | 3.63 | 2.86 | 3.21 | 1.02 |
| Candidate engine | 4.95 | 5.44 | 4.49 | 2.33 | 6.40 | 0.91 |
| Blend (candidate and ward model S1) | 3.21 | 3.49 | 3.12 | 1.46 | 2.81 | 1.25 |
| No change | 5.88 | 8.32 | 4.58 | 1.96 | 4.98 | 2.04 |

Actual control in the 76 councils scored: NOC 31, Labour 13, Reform UK 12, Liberal Democrats 11, Conservative 6, Green Party 3.
No scored council had an Others majority after the election. The only Others majority anywhere
in the scoring is Havering's pre-election composition, so the no change benchmark's call there
(Others majority; actual Reform UK) is its one such council; without it no change called 40 of 73.

## Councils each forecast got wrong (primary rules, own set)

### Published (polling day): 28 of 76

| council | forecast control | actual control |
|---|---|---|
| Barnet | Labour | NOC |
| Barnsley | NOC | Reform UK |
| Bromley | NOC | Conservative |
| East Surrey | Reform UK | Liberal Democrats |
| Enfield | Conservative | NOC |
| Fareham | NOC | Conservative |
| Hackney | NOC | Green Party |
| Hampshire | Conservative | NOC |
| Haringey | Labour | NOC |
| Havering | NOC | Reform UK |
| Huntingdonshire | Reform UK | NOC |
| Hyndburn | Labour | NOC |
| Lewisham | Labour | Green Party |
| Merton | NOC | Labour |
| Milton Keynes | Reform UK | NOC |
| Norfolk | Reform UK | NOC |
| Norwich | NOC | Green Party |
| Redbridge | Labour | NOC |
| Sandwell | NOC | Reform UK |
| Sefton | Reform UK | Labour |
| Southwark | Labour | NOC |
| Swindon | Reform UK | NOC |
| Tunbridge Wells | NOC | Liberal Democrats |
| Walsall | NOC | Reform UK |
| Wandsworth | Labour | NOC |
| West Surrey | Reform UK | Liberal Democrats |
| West Sussex | Reform UK | NOC |
| Wokingham | NOC | Liberal Democrats |

### Candidate engine: 28 of 76

| council | forecast control | actual control |
|---|---|---|
| Barnet | Green Party | NOC |
| Bromley | NOC | Conservative |
| Camden | NOC | Labour |
| Coventry | Reform UK | NOC |
| Ealing | NOC | Labour |
| East Surrey | Reform UK | Liberal Democrats |
| Greenwich | Green Party | Labour |
| Hampshire | Conservative | NOC |
| Haringey | Green Party | NOC |
| Harrow | NOC | Conservative |
| Havering | NOC | Reform UK |
| Hounslow | Green Party | Labour |
| Hyndburn | Labour | NOC |
| Islington | Green Party | Labour |
| Lambeth | Green Party | NOC |
| Merton | NOC | Labour |
| Milton Keynes | Reform UK | NOC |
| Newcastle upon Tyne | Reform UK | NOC |
| Norfolk | Reform UK | NOC |
| Norwich | NOC | Green Party |
| Redbridge | Labour | NOC |
| Sefton | Reform UK | Labour |
| Southwark | Green Party | NOC |
| Swindon | Reform UK | NOC |
| Tunbridge Wells | NOC | Liberal Democrats |
| West Surrey | Reform UK | Liberal Democrats |
| Westminster | NOC | Conservative |
| Wokingham | NOC | Liberal Democrats |

### Blend (candidate and ward model S1): 9 of 57

| council | forecast control | actual control |
|---|---|---|
| Barnet | Conservative | NOC |
| Camden | NOC | Labour |
| Haringey | Labour | NOC |
| Havering | NOC | Reform UK |
| Hyndburn | Labour | NOC |
| Islington | Green Party | Labour |
| Lambeth | Green Party | NOC |
| Merton | NOC | Labour |
| Tunbridge Wells | NOC | Liberal Democrats |

### No change: 34 of 74

| council | control before | actual control |
|---|---|---|
| Barnet | Labour | NOC |
| Barnsley | Labour | Reform UK |
| Calderdale | Labour | Reform UK |
| Coventry | Labour | NOC |
| Enfield | Labour | NOC |
| Epping Forest | Conservative | NOC |
| Essex | Conservative | Reform UK |
| Gateshead | Labour | Reform UK |
| Hackney | Labour | Green Party |
| Hampshire | Conservative | NOC |
| Haringey | Labour | NOC |
| Havering | Others majority | Reform UK |
| Hyndburn | Labour | NOC |
| Lambeth | Labour | NOC |
| Lewisham | Labour | Green Party |
| Milton Keynes | Labour | NOC |
| Newcastle under Lyme | Conservative | Reform UK |
| Norfolk | Conservative | NOC |
| Norwich | NOC | Green Party |
| Redbridge | Labour | NOC |
| Redditch | Labour | NOC |
| Sandwell | Labour | Reform UK |
| Solihull | Conservative | NOC |
| South Tyneside | Labour | Reform UK |
| Southwark | Labour | NOC |
| Sunderland | Labour | Reform UK |
| Swindon | Labour | NOC |
| Thurrock | Labour | Reform UK |
| Wakefield | Labour | Reform UK |
| Walsall | Conservative | Reform UK |
| Wandsworth | Labour | NOC |
| West Sussex | Conservative | NOC |
| Westminster | Labour | Conservative |
| Wokingham | NOC | Liberal Democrats |

NOC is no overall control.

## Coverage and exclusions

- 136 councils held a scheduled election on 7 May 2026. A further 20 had only a by-election
  and are not counted as voting: Chelmsford, Chesterfield, East Hertfordshire, Gloucestershire, Great Yarmouth, Guildford, Hertfordshire, Hertsmere, Horsham, Lewes, Mid Sussex, Newport, Powys, Reigate and Banstead, Rother, Somerset, Stratford on Avon, Surrey, West Northamptonshire, West Suffolk.
- 76 councils were scorable on the actual results (52 all up, 24 electing by thirds or halves).
  60 were excluded for every forecast:
  - results incomplete in the results file (7): Birmingham (60 of 101), Brent (49 of 57), Kensington and Chelsea (48 of 50), Kirklees (68 of 69), Newham (5 of 66), Tower Hamlets (7 of 45), Waltham Forest (59 of 60).
  - all up, but fewer seats elected than the 2025 composition total, so unfilled seats and a smaller council cannot be told apart (4): Bradford (87 seats elected against 90), Hillingdon (51 seats elected against 53), St Helens (46 seats elected against 48), Suffolk (70 seats elected against 75).
  - no 2025 composition (1): City of Lincoln.
  - composition does not reconcile (1): Hastings (Labour comes to minus 1).
  - seats being defended not determined in at least one ward (47), almost all because a by-election or casual
    vacancy since 2022 could have replaced either of two members of different parties. Every ward
    is named in `results/control_summary.json` (`prep.excluded_all_arms`). Councils: Adur, Basildon, Basingstoke and Deane, Blackburn with Darwen, Bolton, Brentwood, Burnley, Bury, Cambridge, Cannock Chase, Cherwell, Chorley, Colchester, Crawley, Dudley, Exeter, Gosport, Harlow, Hartlepool, Kingston upon Hull, Knowsley, Leeds, North Tyneside, Pendle, Peterborough, Plymouth, Portsmouth, Preston, Rochdale, Rugby, Rushmoor, Salford, Sheffield, Southampton, St Albans, Stevenage, Stockport, Tameside, Tamworth, Three Rivers, Trafford, West Lancashire, West Oxfordshire, Wigan, Winchester, Wolverhampton, Worthing.
- Blend: 57 of the 76. Not scored because some wards have no ward model forecast (wards missing): Barnsley 3, Calderdale 6, Coventry 2, East Surrey 36, Essex 38, Gateshead 5, Milton Keynes 14, Newcastle upon Tyne 7, Norfolk 18, Sandwell 7, Sefton 12, Solihull 6, South Tyneside 3, Sunderland 16, Swindon 21, Thurrock 11, Wakefield 1, Walsall 6, West Surrey 45.
- Published and candidate engine: all 76. No change: 74 (East Surrey and West Surrey are new and have no composition).
- Common set: 57 councils.

## Comparison with `council-control.json`

Actual control derived here agrees with `council-control.json` on 75 of the 76 councils scored.
It disagrees on Redditch (a partial council): derived here NOC (Reform UK 8, Labour 13, Conservative 4, Others 2; majority needs more than half of 27), `council-control.json` Labour (Conservative 3, Labour 14, Green Party 1, Reform UK 8, Others 1).
The two differ in the seats not up: that file approximates them as each party's pre-election seats
times the share of seats not up (its own `method` field), while this run subtracts the seats
actually defended. Neither is checked against Redditch's own record of the result, so the
disagreement is reported, not resolved. Its outcome is scored as derived here.

## Faults found before reading a score

None. A preparation pass (`--prep`, which computes no score) was run first: no composition or
seat total failed to add up, and the ambiguous wards were checked by hand on three examples
(Adur Buckingham, Colchester Highwoods, Wigan Central) and are genuine. An unused loop was
removed from the script before the scoring run; it changed no output.

For the published forecast, the leader taken as the top of the pooled shares differs from the post-audit `predicted_winner` in 2 of the 1803 wards that both cover in the councils scored (local.epping-forest.loughton-forest.2026-05-07, local.rochford.hawkwell-east.2026-05-07).

## Limits

- Only 24 of the councils electing by thirds or halves are scored. The rule excludes any council with
  one ward whose defending party is not determined, which bites hardest where by-elections were
  frequent, so the partial councils scored are not a random sample.
- Seats not up come from the 2025 OpenCouncilData composition minus the seats defended. Defections
  and by-elections after that snapshot are not in it, and a defender is counted under the party
  they were elected for. The same continuing seats are used for every forecast and for the actual,
  so this cannot change seat errors, but it can move a council across the majority line.
- Defenders after an all-out election assume the convention that the lowest-placed winner retires
  first; this was not checked against each council's record.
- The blend is scored on fewer councils, and not on Essex, Norfolk or the new Surrey unitaries. Its
  lead on the common set says nothing about those councils.
- The 5 point split rule was fixed in advance and not tuned; it is one simple rule, not a model of
  split voting.
- Others pools independents and local parties. No scored council ended with an Others majority, so
  that rule was exercised only at Havering (actual Reform UK): by the benchmark, and by the blend
  under the secondary seat rule (Others 28 of 55), both counted as misses.
- Actual control is derived from the results file and the composition. It was compared with
  `council-control.json` but not with councils' own published compositions after the election.
- Not verified: the 2026 council sizes of Bradford, Hillingdon, St Helens and Suffolk; the Redditch
  outcome; whether the October 2026 candidate engine replay used any information from after polling day.
