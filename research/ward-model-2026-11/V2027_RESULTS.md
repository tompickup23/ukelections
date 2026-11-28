# The ward model's forecast for 6 May 2027, as an unpublished dry run: results

28 November 2026. **This is a research dry run on incomplete coverage, not a prediction of the 6 May 2027 elections.** It is unpublished, no page reads it, and it is not vintage 1 of the pre-registered forecast in `docs/preregistration-2027.md`, which it does not change. It rests on the national polls of 28 November 2026, five months before polling day, on an assumed slate of candidates (nominations close in April 2027), and it covers 3,258 of the 3,696 verified wards and 5,421 of the 6,083 verified seats up whose number is known. Its job is to show what the research ward model produces for 2027 and what is missing before it could be a publishable vintage 1, so that the owner can decide in January 2027 whether it joins or replaces forecast U1.

Specification: `V2027_SPEC.md`, committed before any forecast (`acaf6a7`). Coverage table committed before the forecast (`1ae6093`). Every figure below comes from one of three files, named with each table:

- `results/v2027_coverage.json` (coverage),
- `data/forecasts/research/wards-2027-dryrun.json` (the per ward dry run; status `RESEARCH, UNPUBLISHED, DRY RUN`),
- `results/v2027_results.json` (seats, control, plausibility).

Lanes are listed in the research folder's fixed order (Reform UK, Labour, Conservative, Liberal Democrats, Green Party, Others), not by size. Others pools every party outside the five main lanes and every independent.

## Runs

| Run | Code commit | What happened |
|---|---|---|
| 1 | `1ae6093` | Fitted and written. On reading the outputs, 107 of the 329 bridged wards had no previous contest and 17 councils failed "seats defended unresolved: May 2026 ballot not found". The cause was a join fault: the May 2026 ballot ids drop "and" from ward slugs (`local.calderdale.hebden-bridge-todmorden-east` against the listed `hebden-bridge-and-todmorden-east`). |
| 2 | `b3b0e5d` | The join now tries the listed slug, then the ballot named in `wards-2027-baselines.json`, then the slug without "and" when that is unique in the council (`v2027_forecast.may26_ballot`). Nothing else changed: same inputs, rule, model, seed. **Run 2 is the result reported here.** |

This rerun was made after outputs were seen, so it is reported. The fix is to a join, not a modelling choice. Its effect: C2's M0 seats moved from Reform UK 1,433, Labour 1,195, Conservative 2,091, Liberal Democrats 518, Green Party 94, Others 90 (run 1) to the figures below; callable councils went from 75 to 91.

## Inputs (from the dry run file's `inputs` block)

- Training rows per lane are Reform UK 5,268, Labour 16,811, Conservative 17,161, Liberal Democrats 13,938, Green Party 12,548, Others 7,667 (contests where the lane stood, dated before 28 November 2026), including 111 by-elections after 7 May 2026 rebuilt from the contest files at `origin/main` `ed32715`.
- Dataset: `cache/rebuild/corrected/bridge_level_dataset.pkl`, sha256 `3393cfdb...e53a8` (the corrected rebuild).
- Polls: `research/ward-model-2026-11/live/inputs/timeseries-9588dc90eb62.json`, sha256 `9588dc90...194ae`, generated 27 November 2026 04:30 UTC, latest poll dated 23 November 2026; plus the 2025 to 2026 Wikipedia file.
- **Anchor on 28 November 2026** (mean of the 14 days to 23 November): Reform UK 21.75%, Labour 28.58%, Conservative 22.33%, Liberal Democrats 9.50%, Green Party 8.75%, Others 9.08%. For scale, the anchor on 7 May 2026 in the same dataset was Reform UK 26.3%, Labour 18.5%, Conservative 18.5%, Liberal Democrats 11.9%, Green Party 15.7%, Others 9.1%. The series moves steadily between those dates (monthly means in the polls file: Labour 19.1% in May, 25.7% in August, 28.7% in November), so this is the polls file as it stands, not a parsing jump.
- Standing assumption (before nominations): the five main lanes in every ward; Others where another candidate stood at the ward's last scheduled election. On this run Others are assumed in 525 of 3,258 forecast wards.

## 1. Coverage (`results/v2027_coverage.json`)

Wards by council type and route. Council type is the ONS district code's prefix; no London borough elects in 2027.

| Council type | Councils | Wards | Direct (code in the feature file) | Bridge (code not in it) | None |
|---|---|---|---|---|---|
| District | 94 | 1,957 | 1,929 | 4 | 24 |
| Metropolitan borough | 29 | 686 | 358 | 306 | 22 |
| Unitary | 35 | 1,053 | 642 | 19 | 392 |
| **All verified** | **158** | **3,696** | **2,929** | **329** | **438** |
| Unverified councils | 65 | 1,170 | 0 | 0 | 1,170 |

Seats up by route (verified councils): direct 5,097, bridge 324, none 662. 53 forecast wards have blank seats up (48 district, 4 unitary, 1 metropolitan); their seats are unknown and are counted nowhere.

Why no forecast:

- **438 wards, `new_ward_no_ons_code`**: every ward of the ten councils redrawn for 2027 (Canterbury 24, Cheshire East 47, Cumberland 55, East Riding of Yorkshire 28, Middlesbrough 20, North Yorkshire 87, Somerset 93, Stockton-on-Tees 27, Westmorland and Furness 35, Wirral 22). They have no ONS code, and their boundary files cannot be redistributed, so no bridge was attempted. These ten councils hold 662 seats up.
- **1,170 wards, `unverified_council`**: the 65 councils whose 2027 election is not verified.
- No ward failed the bridge: all 329 coded wards missing from the feature file are in `wd26-bgc.geojson`, and every one has at least 90% of its population in old wards that carry features. 219 were cut from a single old ward. 306 of the 329 are in metropolitan boroughs, 305 of them in the 14 boroughs whose wards were redrawn for May 2026; Milton Keynes has 19.

**A second coverage gap, found in running: the model has no earlier contest for most 2027 wards.** 1,861 of the 3,258 forecast wards (1,855 direct, 6 bridged) have no earlier contest with the same code in the training dataset, so their ward lag inputs are missing and M50 has no swing benchmark there. 1,839 of those 1,861 do have a same ward baseline in `data/identity/wards-2027-baselines.json`, 1,833 of them from May 2023. The training dataset comes from the Drive matrix `ward_contests_v2.csv`, which holds about 1,820 contests from 2023, far fewer than the councils that voted that year. This is the same gap `docs/preregistration-2027.md` section 4 records ("93 of the 158 verified English councils have no 2023 to 2025 ordinary result on this Mac"); the baselines file has since closed it for the repo, but not for the model.

## 2. Seats (`results/v2027_results.json`, `seats`)

Over the 3,205 wards with a forecast and known seats up: **5,421 seats counted; 662 verified seats up not covered** (the ten redrawn councils); 53 forecast wards with blank seats up are excluded and their seats are unknown. None of the 1,824 seats up in the unverified councils is included.

| Lane | C2, M0 | C2, expected | M50, M0 | M50, expected |
|---|---|---|---|---|
| Reform UK | 1,409 | 1,476.1 | 1,448 | 1,485.2 |
| Labour | 1,204 | 1,161.8 | 1,166 | 1,159.4 |
| Conservative | 2,091 | 1,798.9 | 2,091 | 1,811.4 |
| Liberal Democrats | 531 | 698.0 | 506 | 673.0 |
| Green Party | 96 | 180.0 | 106 | 178.1 |
| Others | 90 | 106.1 | 104 | 113.9 |
| **Seats counted** | **5,421** | **5,421** | **5,421** | **5,421** |
| Seats up not covered | 662 | 662 | 662 | 662 |

M0: every seat up in a ward to its forecast leader. Expected: seats up times each lane's win chance, summed (live runner draws, not calibrated). Wards led, all 3,258 forecast wards: C2 Reform UK 819, Labour 723, Conservative 1,274, Liberal Democrats 330, Green Party 55, Others 57; M50 838, 704, 1,274, 312, 61, 69.

M0 seats by council type (C2; M50 in brackets):

| Type | Reform UK | Labour | Conservative | Liberal Democrats | Green Party | Others |
|---|---|---|---|---|---|---|
| District | 924 (945) | 289 (274) | 1,585 (1,572) | 314 (303) | 41 (54) | 56 (61) |
| Metropolitan borough | 225 (244) | 516 (491) | 90 (97) | 93 (84) | 20 (21) | 34 (41) |
| Unitary | 260 (259) | 399 (401) | 416 (422) | 124 (119) | 35 (31) | 0 (2) |

These totals are not a national seat projection. They omit ten whole councils, every unverified council, and 53 wards, and they assume a slate and a poll five months out.

## 3. Council control (`results/v2027_results.json`, `control`)

**91 of the 158 verified councils can be called; 67 cannot.** Of the 91, 69 elect all out (seats up equal the chamber) and 22 elect part of the chamber, where seats not up are the current composition in `councils-2027.json` less the seats defended, derived per `V2027_SPEC.md` (2023 winners from the Democracy Club ward results file, or the lowest polling May 2026 winner where an order retires one councillor per ward in 2027). PR 201's `data/seats/seats-defended.json` covers by-elections and the May 2026 thirds contests, not 2027, so it was not used.

Control under M0 seats, callable councils:

| Arm | Reform UK | Labour | Conservative | Liberal Democrats | No overall control |
|---|---|---|---|---|---|
| C2 | 14 | 12 | 31 | 3 | 31 |
| M50 | 15 | 11 | 30 | 3 | 32 |

The arms disagree on control in four councils: Chelmsford (C2 Conservative, M50 no overall control), Dacorum (Conservative, no overall control), West Suffolk (no overall control, Conservative), Wigan (Labour, Reform UK). The per council calls are in the file and in the table at the end.

Why 67 cannot be called (one reason each, the first that applies):

| Reason | Councils |
|---|---|
| Chamber size blank in `councils-2027.json` | 32 |
| One or more wards with blank seats up | 18 |
| Wards without a forecast (the ten redrawn councils) | 10 |
| Current composition blank (needed for a part chamber council) | 6 (Bradford, Castle Point, City of Lincoln, Havant, Redditch, Rochford) |
| Composition does not sum to the chamber | 1 (Manchester, 95 against 96) |

No council failed on seats defended in run 2. Known limits: by-elections and defections since a seat was filled are not reflected in who defends it; the composition is as sourced in October 2026; an Others majority is a pooled lane, not one group.

## 4. Plausibility, descriptive only (`results/v2027_results.json`, `plausibility`)

Nothing below was used to change anything.

**Against May 2026, in the same wards.** 1,033 forecast wards had a scheduled contest on 7 May 2026 (mostly metropolitan boroughs and thirds councils). Mean full slate share over those wards:

| | Reform UK | Labour | Conservative | Liberal Democrats | Green Party | Others |
|---|---|---|---|---|---|---|
| May 2026 actual | 32.8% | 20.3% | 14.5% | 11.7% | 16.0% | 4.8% |
| C2 dry run | 27.3% | 28.5% | 17.2% | 12.3% | 10.3% | 4.5% |
| M50 dry run | 27.6% | 29.1% | 17.2% | 11.6% | 10.0% | 4.5% |

First places in the same 1,033 wards:

| | Reform UK | Labour | Conservative | Liberal Democrats | Green Party | Others |
|---|---|---|---|---|---|---|
| May 2026 actual | 510 | 135 | 92 | 153 | 93 | 50 |
| C2 dry run | 260 | 416 | 144 | 156 | 21 | 36 |
| M50 dry run | 271 | 404 | 148 | 143 | 21 | 46 |

C2 names the May 2026 winner first in 666 of the 1,033 wards, M50 in 689. The direction of the move from May 2026 follows the anchor: Labour up about 10 points and the Greens down about 7 between the two anchors. How much of the size is the anchor and how much the model's known Reform UK bunching (section 5) this dry run cannot say.

**Where the arms disagree.** The arms name a different leader in 116 of 3,258 wards. The ten councils with the most such wards (ties by share of the council's forecast wards):

| Council | Wards forecast | Leader differs |
|---|---|---|
| Wakefield | 21 | 5 |
| Brentwood | 13 | 4 |
| Barnsley | 21 | 4 |
| Horsham | 22 | 4 |
| Manchester | 32 | 4 |
| West Suffolk | 43 | 4 |
| Havant | 12 | 3 |
| Hyndburn | 16 | 3 |
| Epping Forest | 18 | 3 |
| South Tyneside | 18 | 3 |

First place counts per arm for each are in the results file. M50 differs from C2 only where a ward has a previous contest with an anchor (1,393 wards); in the other 1,865 it equals C2.

## 5. What vintage 1 needs

Concrete gaps between this dry run and a publishable vintage 1 by 31 January 2027, each with its size. Publication of any vintage still needs the owner's yes.

1. **Decide the model's place.** Whether the ward model joins or replaces U1 is an amendment to `docs/preregistration-2027.md`, which this dry run does not make. Until then U1 is the named forecast.
2. **Model history for 2027 wards: 1,861 of 3,258 forecast wards have no earlier contest in the training data**, though 1,839 have a same ward baseline in `wards-2027-baselines.json` (1,833 from May 2023). The dataset needs the 2023 (and 2019) ordinary contests of the 2027 councils added, from the Democracy Club ward results file the baselines were built from, then refitted. This also makes M50's benchmark available in those wards (now 1,393 of 3,258).
3. **The ten councils redrawn for 2027: 438 wards, 662 seats up, no forecast.** Needs features for the new wards, which means the order boundaries; the licence question in the hand-over notes (OS terms forbid redistribution) is the owner's. Using the boundaries locally to compute features, without redistributing them, may be enough, but that is for the owner to decide.
4. **The standing rule's error.** On May 2026 it got the whole slate right in 1,425 of 2,576 wards; Others were wrong in 759 and the Liberal Democrats were assumed in 376 wards they did not contest. On 2027 wards it is worse than on that test, because 2,062 forecast wards have no earlier scheduled election in the dataset, so Others are assumed absent there; in 922 of those the 2027 baseline shows Others stood. Item 2 fixes most of this. Vintage 2 replaces the rule with the statements of persons nominated.
5. **Reform UK bunching** (`LEVEL_DIAGNOSIS.md`, PR 218): Reform UK's calibration slope at May 2026 was 1.20, its forecast lead in wards it won averaged 2.93 points against an actual 14.53, and it was called first in 641 May 2026 wards against 858 won. A level correction cannot fix a spread fault. The parallel `spread_` study is testing a change; this dry run uses C2 as tested.
6. **Blank seats up: 53 wards** in 18 councils (largest: Cambridge 14, West Oxfordshire 11). They leave 18 councils uncallable.
7. **Blank chamber sizes: 32 councils**; **blank compositions: 6**; **Manchester's composition is one seat short** (95 against 96). Each blocks a control call.
8. **The 65 unverified councils: 1,170 wards, 1,824 seats up** listed in `wards-2027.json`, 6 councils with no ward list at all.
9. **A fresher polls file.** The anchor needs a polls file within 21 days of the run date; the copy on `origin/main` ends on 6 November 2026. Vintage 1 needs the publisher's current file committed, or a named copy, on the day it is run.
10. **Bridged wards' own May 2026 results are not training rows.** 329 bridged wards (305 seats up in metropolitan boroughs) are forecast from features averaged over old wards and lag inputs from their May 2026 result, but those wards' own May 2026 contests (323 of the 329 have one) never trained the model. Adding them is a dataset change to make before refitting.
11. **No calibration of win chances or seat totals for 2027.** Expected seats use fixed lane spreads; `SEATS_SPEC.md` found M1 not reliably better than M0. Any published seat range would need its own pre-registered rule.

## Control calls, callable councils

From `results/v2027_results.json`, `control.councils`. "Part" means part of the chamber is up; NOC is no overall control.

| Council | Type | Kind | Chamber | Seats up | C2 control | M50 control |
|---|---|---|---|---|---|---|
| amber-valley | district | all out | 42 | 42 | Reform UK | Reform UK |
| ashfield | district | all out | 35 | 35 | Reform UK | Reform UK |
| bolton | metropolitan borough | all out | 60 | 60 | NOC | NOC |
| boston | district | all out | 30 | 30 | Reform UK | Reform UK |
| bournemouth-christchurch-and-poole | unitary | all out | 76 | 76 | NOC | NOC |
| bracknell-forest | unitary | all out | 41 | 41 | Conservative | Conservative |
| breckland | district | all out | 49 | 49 | Conservative | Conservative |
| brighton-and-hove | unitary | all out | 54 | 54 | NOC | NOC |
| broadland | district | all out | 47 | 47 | Conservative | Conservative |
| calderdale | metropolitan borough | part | 54 | 18 | Reform UK | Reform UK |
| cannock-chase | district | part | 36 | 12 | NOC | NOC |
| central-bedfordshire | unitary | all out | 63 | 63 | Conservative | Conservative |
| charnwood | district | all out | 52 | 52 | Conservative | Conservative |
| chelmsford | district | all out | 57 | 57 | Conservative | NOC |
| cheshire-west-and-chester | unitary | all out | 70 | 70 | Conservative | Conservative |
| chesterfield | district | all out | 40 | 40 | NOC | NOC |
| chorley | district | part | 42 | 14 | Labour | Labour |
| coventry | metropolitan borough | part | 54 | 18 | Labour | Labour |
| dacorum | district | all out | 51 | 51 | Conservative | NOC |
| darlington | unitary | all out | 50 | 50 | NOC | NOC |
| derby | unitary | all out | 51 | 51 | Labour | Labour |
| dover | district | all out | 32 | 32 | Conservative | Conservative |
| dudley | metropolitan borough | part | 72 | 24 | NOC | NOC |
| east-cambridgeshire | district | all out | 28 | 28 | Conservative | Conservative |
| east-devon | district | all out | 60 | 60 | Conservative | Conservative |
| east-hertfordshire | district | all out | 50 | 50 | Conservative | Conservative |
| east-suffolk | district | all out | 55 | 55 | Conservative | Conservative |
| eastbourne | district | all out | 27 | 27 | NOC | NOC |
| epping-forest | district | part | 54 | 18 | NOC | NOC |
| fenland | district | all out | 43 | 43 | Reform UK | Reform UK |
| folkestone-and-hythe | district | all out | 30 | 30 | Reform UK | Reform UK |
| forest-of-dean | district | all out | 38 | 38 | NOC | NOC |
| gateshead | metropolitan borough | part | 66 | 22 | NOC | NOC |
| gedling | district | all out | 41 | 41 | NOC | NOC |
| gravesham | district | all out | 39 | 39 | NOC | NOC |
| harlow | district | part | 33 | 11 | Conservative | Conservative |
| herefordshire | unitary | all out | 53 | 53 | Conservative | Conservative |
| hertsmere | district | all out | 39 | 39 | Conservative | Conservative |
| high-peak | district | all out | 43 | 43 | Conservative | Conservative |
| hinckley-and-bosworth | district | all out | 34 | 34 | Conservative | Conservative |
| horsham | district | all out | 48 | 48 | NOC | NOC |
| kings-lynn-and-west-norfolk | district | all out | 55 | 55 | Reform UK | Reform UK |
| kirklees | metropolitan borough | part | 69 | 23 | NOC | NOC |
| lancaster | district | all out | 61 | 61 | NOC | NOC |
| leeds | metropolitan borough | part | 99 | 33 | NOC | NOC |
| leicester | unitary | all out | 54 | 54 | Labour | Labour |
| maldon | district | all out | 31 | 31 | Conservative | Conservative |
| medway | unitary | all out | 59 | 59 | NOC | NOC |
| melton | district | all out | 28 | 28 | Conservative | Conservative |
| mid-suffolk | district | all out | 34 | 34 | Conservative | Conservative |
| milton-keynes | unitary | part | 60 | 19 | NOC | NOC |
| new-forest | district | all out | 48 | 48 | Conservative | Conservative |
| newcastle-upon-tyne | metropolitan borough | part | 78 | 26 | NOC | NOC |
| north-east-lincolnshire | unitary | part | 42 | 15 | Reform UK | Reform UK |
| north-norfolk | district | all out | 40 | 40 | Conservative | Conservative |
| north-somerset | unitary | all out | 50 | 50 | NOC | NOC |
| north-tyneside | metropolitan borough | part | 60 | 20 | Labour | Labour |
| north-warwickshire | district | all out | 35 | 35 | Reform UK | Reform UK |
| nottingham | unitary | all out | 55 | 55 | Labour | Labour |
| oldham | metropolitan borough | all out | 60 | 60 | NOC | NOC |
| preston | district | part | 48 | 17 | NOC | NOC |
| redcar-and-cleveland | unitary | all out | 59 | 59 | Reform UK | Reform UK |
| rochdale | metropolitan borough | part | 60 | 20 | NOC | NOC |
| rother | district | all out | 38 | 38 | NOC | NOC |
| rushcliffe | district | all out | 44 | 44 | Conservative | Conservative |
| rutland | unitary | all out | 27 | 27 | Conservative | Conservative |
| salford | metropolitan borough | part | 60 | 21 | Labour | Labour |
| sandwell | metropolitan borough | part | 72 | 24 | Labour | Labour |
| sefton | metropolitan borough | part | 66 | 22 | Labour | Labour |
| sevenoaks | district | all out | 54 | 54 | Conservative | Conservative |
| south-derbyshire | district | all out | 36 | 36 | Reform UK | Reform UK |
| south-kesteven | district | all out | 56 | 56 | Conservative | Conservative |
| south-oxfordshire | district | all out | 36 | 36 | Liberal Democrats | Liberal Democrats |
| south-ribble | district | all out | 50 | 50 | NOC | NOC |
| south-staffordshire | district | all out | 42 | 42 | Conservative | Conservative |
| stevenage | district | part | 39 | 13 | Labour | Labour |
| stockport | metropolitan borough | all out | 63 | 63 | Liberal Democrats | Liberal Democrats |
| torbay | unitary | all out | 36 | 36 | Reform UK | Reform UK |
| torridge | district | all out | 36 | 36 | Conservative | Conservative |
| vale-of-white-horse | district | all out | 38 | 38 | Liberal Democrats | Liberal Democrats |
| wakefield | metropolitan borough | part | 63 | 21 | Reform UK | Reform UK |
| warwick | district | all out | 44 | 44 | NOC | NOC |
| wealden | district | all out | 45 | 45 | Conservative | Conservative |
| west-lancashire | district | all out | 45 | 45 | NOC | NOC |
| west-lindsey | district | all out | 36 | 36 | Conservative | Conservative |
| west-suffolk | district | all out | 64 | 64 | NOC | Conservative |
| wigan | metropolitan borough | all out | 75 | 75 | Labour | Reform UK |
| wokingham | unitary | part | 54 | 18 | NOC | NOC |
| wolverhampton | metropolitan borough | all out | 60 | 60 | Labour | Labour |
| wyre-forest | district | all out | 33 | 33 | Reform UK | Reform UK |
| york | unitary | all out | 47 | 47 | NOC | NOC |
