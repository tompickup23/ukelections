# Council control on the May 2026 forecasts: results

One scoring run, 27 November 2026, of `control_score.py` under
`CONTROL_SPEC.md` (committed before the run). Output:
`results/control_summary.json`. Research only; nothing on the site reads it.

## Answer

On the 68 councils that all three forecasts and the benchmark can score, the
research blend called council control right in **57 of 68 (83.8%)** and the
largest party in **56 of 68 (82.4%)**. The published forecast called control in
48 (70.6%), the candidate engine in 46 (67.6%), and "no change from before the
election" in 45 (66.2%).

That is near 90% but not there, and it is on the easier councils: the 19 that
only the published forecast and the candidate engine can score (mostly
metropolitan boroughs voting all out on new wards, where Reform UK gained most)
are where they went wrong most often, and the ward model has no forecast for
new wards. Control was scorable at all in 87 of the 136 councils that voted.

Counts are councils. "Control" is the lane (or no overall control) holding more
than half of all seats after the election, derived from the ward results
(`data/results/may-2026/local-and-mayor.merged.json`, `by_ballot`) plus seats not
up, by the rules in the specification.

## The three forecasts and the benchmark

Common set: 68 councils (33 all out, 35 thirds or halves). Primary rule A: every
seat in a ward goes to the forecast leader.

| arm | control right | largest party right | mean absolute seat error (seats per lane per council) |
|---|---|---|---|
| blend (candidate engine 0.5, ward model S1 0.5) | **57 / 68** | **56 / 68** | **2.51** |
| published (polling-day forecast, git `5e85c84`) | 48 / 68 | 53 / 68 | 3.06 |
| candidate engine (24 October 2026 replay) | 46 / 68 | 46 / 68 | 3.75 |
| no change (2025 composition) | 45 / 68 | 48 / 68 | 4.55 |

Actual control in the common set: no overall control 29, Labour 19, Liberal
Democrats 9, Conservative 7, Reform UK 2, Green Party 2.

Where each forecast went wrong, by kind (common set):

| arm | majority councils called right | NOC councils called right |
|---|---|---|
| blend | 33 / 39 | 24 / 29 |
| published | 28 / 39 | 20 / 29 |
| candidate engine | 24 / 39 | 22 / 29 |
| no change | 32 / 39 | 13 / 29 |

### Each arm on its own coverage

| arm | councils scored | control right | largest party right | seat error |
|---|---|---|---|---|
| published | 87 | 58 (66.7%) | 63 | 4.23 |
| candidate engine | 87 | 57 (65.5%) | 57 | 4.77 |
| blend | 68 | 57 (83.8%) | 56 | 2.51 |
| no change | 87 (2 with no call) | 48 (55.2%) | 51 | 6.16 (85 councils) |

The 19 councils outside the common set: Barnsley, Calderdale, Coventry, East
Surrey, Gateshead, Milton Keynes, Newcastle upon Tyne, Norfolk, Sandwell,
Sefton, Solihull, South Tyneside, Suffolk, Sunderland, Swindon, Thurrock,
Wakefield, Walsall, West Surrey. The published forecast got control wrong in 9
of them and the candidate engine in 8.

### Rule B and the secondary fill

Rule B (slate capped, the leader takes as many seats as it fielded candidates,
then the next lane): blend 55, published 47, candidate engine 46 of 68 on control;
largest party 54, 52, 46. Rule A is as good or better on control and largest
party for every arm, as the check on actual shares in the specification
suggested (rule B gives the candidate engine a slightly lower seat error, 3.68
against 3.75).

The secondary fill (a ward with no forecast takes its pre-election holder)
added no council for any arm. None of the 252 wards the blend lacks has a
contest under the same ward slug in its council's previous all out year (most
are wards or divisions first used in 2026), so no previous holder can be known. The published forecast and the candidate engine have a forecast for every
ward in all 87 councils.

## Every council each forecast got control wrong

Primary rule A. "Common" marks councils in the 68; "own only" marks the 19 the
blend cannot score.

### Blend (11, all common)

| council | forecast control | actual control |
|---|---|---|
| Barnet | Conservative | NOC |
| Camden | NOC | Labour |
| Gosport | Liberal Democrats | NOC |
| Haringey | Labour | NOC |
| Harlow | NOC | Conservative |
| Havering | NOC | Reform UK |
| Islington | Green Party | Labour |
| Lambeth | Green Party | NOC |
| Merton | NOC | Labour |
| Stockport | NOC | Liberal Democrats |
| West Oxfordshire | Liberal Democrats | NOC |

### Published (29: 20 common, 9 own only)

| council | forecast control | actual control | set |
|---|---|---|---|
| Adur | NOC | Labour | common |
| Barnet | Labour | NOC | common |
| Bromley | NOC | Conservative | common |
| City of Lincoln | NOC | Labour | common |
| Enfield | Conservative | NOC | common |
| Fareham | NOC | Conservative | common |
| Hackney | NOC | Green Party | common |
| Hampshire | Conservative | NOC | common |
| Haringey | Labour | NOC | common |
| Harlow | NOC | Conservative | common |
| Havering | NOC | Reform UK | common |
| Huntingdonshire | Reform UK | NOC | common |
| Lewisham | Labour | Green Party | common |
| Merton | NOC | Labour | common |
| Portsmouth | NOC | Liberal Democrats | common |
| Redbridge | Labour | NOC | common |
| Southwark | Labour | NOC | common |
| Stockport | NOC | Liberal Democrats | common |
| Wandsworth | Labour | NOC | common |
| West Sussex | Reform UK | NOC | common |
| Barnsley | NOC | Reform UK | own only |
| East Surrey | Reform UK | Liberal Democrats | own only |
| Milton Keynes | Reform UK | NOC | own only |
| Norfolk | Reform UK | NOC | own only |
| Sandwell | NOC | Reform UK | own only |
| Sefton | Reform UK | Labour | own only |
| Swindon | Reform UK | NOC | own only |
| Walsall | NOC | Reform UK | own only |
| West Surrey | Reform UK | Liberal Democrats | own only |

### Candidate engine (30: 22 common, 8 own only)

| council | forecast control | actual control | set |
|---|---|---|---|
| Adur | NOC | Labour | common |
| Barnet | Green Party | NOC | common |
| Bromley | NOC | Conservative | common |
| Camden | NOC | Labour | common |
| City of Lincoln | NOC | Labour | common |
| Ealing | NOC | Labour | common |
| Greenwich | Green Party | Labour | common |
| Hampshire | Conservative | NOC | common |
| Haringey | Green Party | NOC | common |
| Harlow | NOC | Conservative | common |
| Harrow | NOC | Conservative | common |
| Havering | NOC | Reform UK | common |
| Hounslow | Green Party | Labour | common |
| Islington | Green Party | Labour | common |
| Lambeth | Green Party | NOC | common |
| Merton | NOC | Labour | common |
| Portsmouth | NOC | Liberal Democrats | common |
| Redbridge | Labour | NOC | common |
| Southwark | Green Party | NOC | common |
| Stockport | NOC | Liberal Democrats | common |
| West Oxfordshire | Liberal Democrats | NOC | common |
| Westminster | NOC | Conservative | common |
| Coventry | Reform UK | NOC | own only |
| East Surrey | Reform UK | Liberal Democrats | own only |
| Milton Keynes | Reform UK | NOC | own only |
| Newcastle upon Tyne | Reform UK | NOC | own only |
| Norfolk | Reform UK | NOC | own only |
| Sefton | Reform UK | Labour | own only |
| Swindon | Reform UK | NOC | own only |
| West Surrey | Reform UK | Liberal Democrats | own only |

### No change benchmark (39: 23 common, 16 own only)

| council | forecast control | actual control | set |
|---|---|---|---|
| Barnet | Labour | NOC | common |
| Enfield | Labour | NOC | common |
| Epping Forest | Conservative | NOC | common |
| Gosport | Liberal Democrats | NOC | common |
| Hackney | Labour | Green Party | common |
| Hampshire | Conservative | NOC | common |
| Haringey | Labour | NOC | common |
| Havering | Others | Reform UK | common |
| Kingston upon Hull | Liberal Democrats | NOC | common |
| Lambeth | Labour | NOC | common |
| Lewisham | Labour | Green Party | common |
| Newcastle-under-Lyme | Conservative | Reform UK | common |
| Portsmouth | NOC | Liberal Democrats | common |
| Redbridge | Labour | NOC | common |
| Redditch | Labour | NOC | common |
| Southampton | Labour | NOC | common |
| Southwark | Labour | NOC | common |
| Stockport | NOC | Liberal Democrats | common |
| Tameside | Labour | NOC | common |
| Wandsworth | Labour | NOC | common |
| West Lancashire | Labour | NOC | common |
| West Sussex | Conservative | NOC | common |
| Westminster | Labour | Conservative | common |
| Barnsley | Labour | Reform UK | own only |
| Calderdale | NOC | Reform UK | own only |
| Coventry | Labour | NOC | own only |
| East Surrey | no call (first election) | Liberal Democrats | own only |
| Gateshead | Labour | Reform UK | own only |
| Norfolk | Conservative | NOC | own only |
| Sandwell | Labour | Reform UK | own only |
| Solihull | Conservative | NOC | own only |
| South Tyneside | Labour | Reform UK | own only |
| Suffolk | Conservative | Reform UK | own only |
| Sunderland | Labour | Reform UK | own only |
| Swindon | Labour | NOC | own only |
| Thurrock | Labour | Reform UK | own only |
| Wakefield | Labour | Reform UK | own only |
| Walsall | Conservative | Reform UK | own only |
| West Surrey | no call (first election) | Liberal Democrats | own only |

Largest party calls for each council are in `results/control_summary.json`,
`per_council`.

## Actual control checked against council-control.json

Control derived here agrees with `data/results/may-2026/council-control.json`
in 83 of the 87 councils. It disagrees in four, all thirds or halves councils,
where that file approximates the seats defended as each party's pre-election
seats times seats up over chamber, and this score takes them from the 2022 (or
later all out) ward results:

| council | derived here | council-control.json | seats derived here | seats in council-control.json |
|---|---|---|---|---|
| Adur | Labour (16 of 29) | NOC | Lab 16, Ref 6, Oth 5, Grn 2 | Lab 13, Ref 6, Con 4, Oth 4, Grn 2 |
| Portsmouth | Liberal Democrats (22 of 42) | NOC | LD 22, Oth 8, Ref 5, Lab 4, Con 3 | LD 21, Oth 7, Lab 6, Ref 5, Con 3 |
| Redditch | NOC (Lab 13 of 27) | Labour | Lab 13, Ref 8, Con 4, Oth 2 | Lab 14, Ref 8, Con 3, Oth 1, Grn 1 |
| Tamworth | Labour (16 of 30) | NOC | Lab 16, Ref 9, Oth 5 | Lab 13, Ref 9, Con 4, Oth 4 |

Neither source was checked here against a council's own published composition,
so neither is preferred silently: the score uses the derived control, as the
specification fixed. If the four took the `council-control.json` verdict instead
(changing only the actual, not the shared seats not up), the common set counts
would be blend 53, published 48, candidate engine 46, no change 45. The blend
gains most from the derived figures in these four (it called Adur and Portsmouth
as derived), so its lead over the published forecast is 5 to 9 councils
depending on which source is right.

## Others (independents and local parties pooled)

No council in the 87 has Others in control. Three have Others as the largest
lane in a hung council: Burnley, Oldham and Redbridge (actual NOC in all three).
In those the "largest party" call rests on a pooled lane that is not one group.
The no change benchmark called Havering as an Others majority (local groups
pooled, as the 2025 composition stood); Reform UK won it.

No forecast carries a "Labour Co-operative" label, so the merge into Labour for
seats changed no forecast; it moved 3 actual winners from Others to Labour.

## Coverage: 87 of 136 councils that voted

136 councils held scheduled ward elections on 7 May 2026. The 20 with only a
by-election that day are not counted (control was not at stake). 49 of the 136
are excluded:

- **Results incomplete** (7): Birmingham, Brent, Kensington and Chelsea,
  Kirklees, Newham, Tower Hamlets, Waltham Forest.
- **Results cover fewer seats than the chamber** (4): Bradford (87 of 90), Essex
  (77 of 78), Hillingdon (51 of 53), St Helens (46 of 48).
- **Seats defended could not be resolved** (38, thirds or halves): in each, at
  least one ward up in 2026 has a different number of seats than the contest
  that last filled them (a casual vacancy filled at the same time, or a double
  election in 2022), so who held the seats up is not known without guessing.

| council | wards unresolved |
|---|---|
| Basingstoke and Deane | oakley-the-candovers (2022 filled 1, 2026 has 2); whitchurch-overton-laverstoke (2022 filled 2, 2026 has 1) |
| Blackburn with Darwen | roe-lee (2022 filled 2, 2026 has 1) |
| Brentwood | brentwood-west (all out 2024: 3 filled, 2026 has 2) |
| Cambridge | arbury (2022 filled 2, 2026 has 1); trumpington (2022 filled 1, 2026 has 2); west-chesterton (2022 filled 2, 2026 has 1) |
| Cannock Chase | hednesford-pye-green (all out 2024: 3 filled, 2026 has 2) |
| Cherwell | banbury-calthorpe-easington (2022 filled 1, 2026 has 2); bicester-west (2022 filled 1, 2026 has 2); launton-otmoor (2022 filled 2, 2026 has 1) |
| Colchester | new-town-christ-church (2022 filled 2, 2026 has 1) |
| Crawley | three-bridges (2022 filled 1, 2026 has 2) |
| Dudley | wollaston-stourbridge-town (all out 2024: 3 filled, 2026 has 2) |
| Eastleigh | chandlers-ford (2022 filled 1, 2026 has 2) |
| Exeter | exwick, pennsylvania, priory (2022 filled 2, 2026 has 1) |
| Halton | daresbury-moore-sandymoor (2022 filled 1, 2026 has 2) |
| Hartlepool | rural-west (2022 filled 2, 2026 has 1) |
| Hastings | st-helens (2022 filled 1, 2026 has 2) |
| Hyndburn | st-oswalds (2022 filled 2, 2026 has 1) |
| Ipswich | st-johns (2022 filled 2, 2026 has 1) |
| Knowsley | roby (2022 filled 1, 2026 has 2) |
| Leeds | adel-wharfedale, morley-north, temple-newsam (2022 filled 1, 2026 has 2); horsforth, roundhay (2022 filled 2, 2026 has 1) |
| North East Lincolnshire | east-marsh (2022 filled 2, 2026 has 1) |
| Norwich | wensum (2022 filled 1, 2026 has 2) |
| Pendle | barrowford-pendleside, vivary-bridge (2022 filled 2, 2026 has 1) |
| Peterborough | fletton-stanground (2022 filled 2, 2026 has 1) |
| Preston | brookfield (2022 filled 2, 2026 has 1) |
| Reading | caversham-heights (all out 2022: 3 filled, 2026 has 2) |
| Rochford | downhall-rawreth, hawkwell-east (2022 filled 1, 2026 has 2) |
| Rugby | bilton (2022 filled 1, 2026 has 2) |
| Rushmoor | fernhill (2022 filled 1, 2026 has 2) |
| Salford | cadishead-lower-irlam (2022 filled 1, 2026 has 2) |
| Sheffield | beighton, firth-park (2022 filled 1, 2026 has 2) |
| Southend-on-Sea | victoria (2022 filled 2, 2026 has 1) |
| St Albans | colney-heath, marshalswick-west, redbourn (all out 2022, too few seats for the retirement order); sandridge-wheathampstead, st-stephen (all out 2022: 3 filled, 2026 has 2) |
| Stevenage | st-nicholas (all out 2024: 3 filled, 2026 has 2) |
| Three Rivers | gade-valley (2022 filled 2, 2026 has 1) |
| Tunbridge Wells | sherwood, southborough-bidborough (all out 2024: 3 filled, 2026 has 2) |
| Welwyn Hatfield | handside (2022 filled 2, 2026 has 1); welwyn-east (2022 filled 1, 2026 has 2) |
| Wokingham | wokingham-without (all out 2024: 3 filled, 2026 has 2) |
| Wolverhampton | wednesfield-south (all out 2023: 3 filled, 2026 has 2) |
| Worthing | castle (2022 filled 2, 2026 has 1) |

No thirds or halves council failed the composition reconciliation (no lane went
negative and every composition total matched its chamber).

Wards without a forecast, per arm, in the 87: published none, candidate engine
none; blend 252 wards in 19 councils (East Surrey 36 of 36, West Surrey 45 of
45, Suffolk 33, Swindon 21, Norfolk 18, Sunderland 16, Milton Keynes 14, Sefton
12, Thurrock 11, Newcastle upon Tyne 7, Sandwell 7, Calderdale 6, Solihull 6,
Walsall 6, Gateshead 5, Barnsley 3, South Tyneside 3, Coventry 2, Wakefield 1).
None can be filled from a known previous holder.

## Fault fixed before the score was read

Building inputs, Birmingham, Newham and Tower Hamlets were classed as thirds
councils, because their undeclared ballots are absent from `by_ballot` and so
seats up looked small against the chamber. They are all out councils with
incomplete results. The script now excludes any council with undeclared ballots
or seats first, with that reason. The three were excluded before and after the
fix; only the stated reason changed. No other change was made between the
committed script and the run.

## Limits

- **The common set is the easier part.** The blend cannot score the 19 councils
  voting on new wards or with new divisions, where the other forecasts and the
  benchmark did worst. Its 83.8% is not a figure for all councils.
- **68 councils is a small sample.** One council is 1.5 points; the blend's lead
  over the published forecast is 9 councils, or 5 if the
  `council-control.json` verdicts are right in the four disagreements.
- **Seats defended ignore by-elections and defections** since they were last
  filled, and the composition is the 2025 OpenCouncilData snapshot, not
  polling day. The same seats not up go into every arm and the actual result, so
  no forecast is favoured, but the derived actual control can be wrong in a close
  thirds council; the four disagreements above are where it matters.
- **Retirement order after an all out election** (lowest vote first) is the
  usual convention but each council's own order governs; it was used for 2022,
  2023 and 2024 all out councils without checking each order.
- **Others is pooled.** An Others majority or largest lane is not one group.
- **Not an unseen test for the blend or the candidate engine.** The ward model
  was trained on contests before 7 May 2026 and the blend weight was fixed before
  any scoring, but both came out of research that had already reported May 2026
  ward scores, and the candidate engine is a replay made in October 2026. May
  2027 is the clean test. The published forecast is the only true polling-day
  forecast here.
- **Six of the blend's 11 misses are London boroughs** (Barnet, Camden,
  Haringey, Islington, Lambeth, Merton), and several are not near misses: in
  Islington it gave the Greens 45 of 51 seats (actual Labour 32, Green 19) and in
  Lambeth 52 of 63 (actual Green 29, Labour 26, NOC). The Labour and Green split
  in inner London is where the blend's seat totals go furthest wrong.
