# Estate series check: specification

27 November 2026. **Research only.** Written and committed before any residual statistic was computed. Nothing here changes a page, the engine, a calibration or a published forecast, and no model is refitted.

## The question

The research ward model's local inputs stop moving in 2021: ward features are frozen at Census 2021 and the 2019 deprivation index. The sister sites (UK Demographics, Asylum Stats, UK Council Tax) hold local series dated after 2021. Do the model's misses by local authority district line up with any of those series?

This is a check of relationships between places, not people. A district whose residual moves with a measure says nothing about how any person or group in it voted.

## What is checked

**Forecast.** Version C2 of `BRIDGE_LEVEL_SPEC.md` (PR 197): the forward-only forecast with standing rates, cached in `cache/bridge_level_predictions.pkl` (columns `c2_*` forecast, `s_*` actual full-slate share, `stood_*`). Scheduled contests only; by-elections are not used.

**Unit.** A local authority district (LAD, the April 2023 codes used by the sister-site series) at one scheduled May election. The sister-site series are district level, and May 2025 had 23 electing councils, 14 of them counties, so a council-level test would have about 23 points in confirmation. Each ward or county division is placed in its district (`estate_common.py`, first rule that applies):

1. ONS ward code in `data/geography/wd25-bsc-raw.geojson`: its LAD25CD;
2. ONS ward code in `wd26-bgc.geojson`: its LAD26CD;
3. ONS county division code in `ced26-bgc.geojson`: the district polygon in `lad24-bgc.geojson` that holds the division's representative point (county divisions nest inside districts);
4. council slug in `data/identity/council-slug-to-lad24.json` with a code;
5. May 2026 Essex, Norfolk and Suffolk divisions, which have no ONS code yet: the district council that hosted the statement of persons nominated (`wards-may-2026.json`, `sopn_source_url`). The Colchester host is a document store (`cbccrmdata.blob.core.windows.net`); its 26 ballots are all Colchester wards and divisions by name. The shared South Norfolk and Broadland site names two districts, so its 22 Norfolk divisions are left unplaced.

Barnsley and Sheffield took new codes in April 2023 (E08000038, E08000039); where a sister-site file keeps the old codes (E08000016, E08000019) the old value is used for the new code.

Placement, from `results/estate_inventory.json`:

| election | role | scored wards | placed | unplaced | districts |
|---|---|---|---|---|---|
| 7 May 2026 | discovery | 2,576 | 2,554 | 22 (South Norfolk and Broadland host) | 152 |
| 1 May 2025 | confirmation | 1,399 | 1,399 | 0 | 115 |
| 5 May 2022 | check | 2,533 | 2,533 | 0 | 131 |
| 4 May 2023 | check | 1,734 | 1,734 | 0 | 96 |

**Council slug to authority code join** (`ukplaces` `places.json`, 361 authorities, by `slug`), reported as the task asks: May 2026 matches 126 of 134 councils (unmatched: city-of-lincoln, east-sussex, essex, hampshire, kingston-upon-hull, norfolk, suffolk, west-sussex); May 2025 matches 9 of 23 (unmatched: the 14 county councils); May 2022 and May 2023 match all but city-of-lincoln and kingston-upon-hull, whose registry slugs differ. County councils are not in a district registry by design, which is the reason for the ward placement above. The join is reported only; the analysis uses the placement.

## The residual

For each district, election and lane (Reform UK, Labour, Conservative, Liberal Democrats, Green Party, Others): the vote-weighted mean of actual share minus C2 forecast share, in points, over the scored wards in that district where the lane stood. Positive means the model forecast the lane too low.

- Weight: votes cast for candidates divided by seats filled (an approximation to ballot papers in multi-member wards). Votes from `data/results/may-2026/local-and-mayor.merged.json` for May 2026 and `data/history/dc-historic-results.json` for the others; every one of the 8,242 rows has a weight.
- Districts with fewer than five such wards are left out for that lane and election, and counted.

Districts with at least five wards where the lane stood (counted from standing flags only):

| election | Reform UK | Labour | Conservative | Lib Dem | Green | Others |
|---|---|---|---|---|---|---|
| May 2026 | 148 | 148 | 147 | 134 | 147 | 87 |
| May 2025 | 108 | 108 | 108 | 96 | 100 | 38 |
| May 2022 | 4 | 131 | 130 | 115 | 104 | 70 |
| May 2023 | 11 | 96 | 95 | 86 | 79 | 56 |

## Inventory and the measures, fixed before any result

A value may be used for an election only if it is dated (its reference date or period end) before that polling day. Where only a later value is held, the measure is excluded for that election. Publication dates are recorded too: several values used were published after the polling day they are tested against (for example the mid-2024 population as revised in July 2026, and the 31 March 2025 asylum stock published 22 May 2025). That is acceptable for a descriptive check; the proposed model test (if any) must use only values published before polling day.

Coverage is districts with a value, of districts with scored wards (May 2026: 152; May 2025: 115).

| measure | what it counts | source and edition | May 2026 value | cover | May 2025 value | cover |
|---|---|---|---|---|---|---|
| `pop_change_21` | population change since mid-2021, % | ONS mid-year estimates, June 2025 edition (29 Jul 2026), MYE4 series as revised; `ukdemographics/.../population-estimates.json` | mid-2021 to mid-2025 | 152 | mid-2021 to mid-2024 | 115 |
| `nino_rate` | new NINo registrations to adult overseas nationals in the calendar year before polling, per 1,000 residents (a flow) | DWP Stat-Xplore NINo, calendar years 2002 to 2025; `nino-historical.json` (29 Apr 2026) | 2025 | 152 | 2024 | 115 |
| `nino_change_21` | that rate minus the 2021 rate | as above | 2025 less 2021 | 152 | 2024 less 2021 | 115 |
| `asylum_rate` | people in receipt of asylum support at the last quarter end before polling, per 1,000 residents | Home Office immigration system statistics, year ending June 2026 (27 Aug 2026), Asy_D11; `asylumstats/.../area-series.json` | 31 Mar 2026 | 149 | 31 Mar 2025 | 106 |
| `asylum_change_21` | that rate minus the rate at 31 March 2021 | as above | change since 31 Mar 2021 | 129 | change since 31 Mar 2021 | 70 |
| `income_median` | median total income of income taxpayers, £ | HMRC Personal Incomes Statistics 2023 to 2024, Table 3.14 (29 Apr 2026); `income-taxpayers-la.json` | 2023 to 2024 | 152 | 2023 to 2024 | 115 |
| `band_d` | area Band D council tax for two adults including precepts, year in force on polling day, £ | MHCLG Council Tax levels 2025 to 2026 (revised 22 Apr 2026) and 2026 to 2027 (25 Mar 2026), Table 8; `ukcounciltax/data/council-tax/england-*.json` | 2026 to 2027 | 152 | 2025 to 2026 | 115 |
| `band_d_rise` | % rise in that Band D from the year before | as above, plus 2024 to 2025 (updated 8 May 2024) | 2025-26 to 2026-27 | 152 | 2024-25 to 2025-26 | 115 |
| `hmo_rate` | houses in multiple occupation per 1,000 residents | ONS Census 2021 RM192; `hmo-density.json` (29 Apr 2026) | 21 Mar 2021 | 152 | 21 Mar 2021 | 115 |
| `wb_change_1121` | annual change in the White British share of usual residents, Census 2011 to 2021, points a year | Census 2011 KS201EW and 2021 TS021, as the base of the UK Demographics projections (`ethnic-projections.json`, `annualChangePp`) | 2011 to 2021 | 152 | 2011 to 2021 | 115 |
| `placebo_hash` | fixed pseudo-random number from SHA-256 of a salt and the district code | none | | 152 | | 115 |
| `placebo_digit` | last digit of the mid-2021 population estimate | ONS, as `pop_change_21` | | 152 | | 115 |
| `spd_share` | single person discount dwellings over chargeable dwellings, % | MHCLG Council Taxbase 2025 (snapshot 6 Oct 2025, revised 21 Jan 2026); `council-tax-spd.json` | 6 Oct 2025 | 152 | **excluded**: only this snapshot held | 0 |
| `ta_rate` | households in temporary accommodation per 1,000 residents | MHCLG statutory homelessness LA tables, Jan to Mar 2026 (13 Aug 2026, provisional), TA1; `asylumstats/.../housing-pressure.json` | 31 Mar 2026 | 149 | **excluded**: only this stock held | 0 |
| `births_nonuk_mother` | share of live births to mothers born outside the UK, % | ONS Births in England and Wales 2025, parents' country of birth, Table 6a (27 May 2026); `births-by-mother-cob.json` | calendar 2025 | 152 | **excluded**: only 2025 held | 0 |

Measures per 1,000 residents use the ONS mid-year estimate for mid-(polling year minus one); the change measures use mid-2021 for the 2021 base. Missing asylum values are districts absent from the Home Office series for that quarter; they are left missing, not set to zero.

**Two families.** The first twelve measures (ten series plus two placebos) have a dated value for both elections and form the tested family. The last three have no value dated before May 2025 polling day, so by the rule below they cannot be confirmed; their May 2026 statistics are reported as description only and are kept out of the correction family so they do not dilute it.

**Candidates considered and not used.** `ethnic-projections.json` projected shares (dated 2031 onward, and fitted in August 2026 with the 2022-based subnational projections, published after May 2025: no projected value is dated before either polling day; the observed 2011 to 2021 change it holds is used instead as `wb_change_1121`). `housing-demand.json` (a projection to 2041 from Census 2021 tenure). `economic-profile.json` (Census 2021 only, and close to the model's own ward features). International migration in the population components (only mid-2024 to mid-2025 held, excluded for May 2025). `nino-dashboard.json` (rolling year to Q4 2025 only; `nino-historical.json` has the history). `crime-dashboard.json` (police force areas, not districts; not used). `country-of-birth-change-2011-2021.json` (close to `wb_change_1121`). `local-route-latest.json` (one snapshot, 30 June 2026, after both polling days).

Checks only (May 2022, May 2023): `pop_change_21` and `nino_change_21` are not defined for May 2022 (no later value before polling day); `income_median`, `band_d` and `band_d_rise` have no value dated before either (2023 to 2024 is the earliest income edition and 2024 to 2025 the earliest council tax file held).

## The statistic

For each measure, lane and election, over districts with a residual and a measure value (at least ten districts, or the test is not run):

- Spearman's rank correlation between residual and measure, with a two-sided permutation p value (10,000 shuffles of the measure, seeded from the measure, lane and election names; p = (1 + count of |shuffled rho| at least |rho|) / 10,001).
- The unweighted mean residual of districts in the bottom fifth and the top fifth on the measure (rank at most n/5; rank above 4n/5), and top minus bottom, in points.
- The same correlation with the residual after taking out each region's mean (unweighted over districts, by election and lane; region from `data/geography/lad24-to-region.json`). The model has a region input, so a relationship that is really a regional one should vanish here.

Every measure is run against every lane in exactly the same way. No party-specific rule.

## Discovery and confirmation

- **Discovery: May 2026.** The family is the twelve tested measures by six lanes, 72 tests less any not run. Benjamini and Hochberg at q = 0.10 within this family.
- **Confirmation: May 2025.** Different councils, so an independent set of districts.
- **Checks: May 2022 and May 2023.** Reported to show whether a relationship is a standing feature of the model rather than of the years of change. Not used to choose anything.

## What counts

A measure **lines up** for a lane only if it passes discovery after the correction AND, in confirmation, has the same sign with a permutation p under 0.05. Everything else is reported as **not supported**. A placebo that lines up would mean the machinery is producing false positives, and would be reported as such.

For any pair that lines up, the result also reports:

- the effect: top minus bottom fifth in points, in discovery and confirmation;
- **within region**: "holds within region" only if the within-region correlation has the same sign with p under 0.05 in both discovery and confirmation; otherwise "does not hold within region", meaning region alone may explain it;
- the May 2022 and May 2023 checks.

If something lines up, the write-up ends with a short proposed specification for a six-election test of that input in the model. If nothing does, it says so.

## Run

```bash
uv run python estate_inventory.py     # done before this spec: results/estate_inventory.json
uv run python estate_check.py --dry   # code check on random residuals; done, read nothing
uv run python estate_check.py         # the one run: results/estate_summary.json
```

## Faults fixed before any result

All found while building the inventory, before any residual was computed:

1. `council-slug-to-lad24.json` holds entries with a null code for counties; rule 4 first took those, leaving the 141 Essex, Norfolk and Suffolk divisions with no district. Rule 4 now needs a code.
2. Barnsley and Sheffield were missing from every UK Demographics measure because of their 2023 code change; the alias above fixed it (May 2026 coverage 137 to 152 districts once the Essex, Norfolk and Suffolk rule also applied).
3. Per-1,000 rates for Barnsley and Sheffield failed because the population series holds only the old codes; the population lookup now carries the alias too.

The dry run on random residuals gave no discovery passes of 72, as it should.

## Limits stated in advance

Ecological (districts, not people); two elections decide; authority-level measures set against ward forecasts; the measures are correlated with each other (population growth, registrations and asylum rates share an urban gradient), so passes are not independent findings; the population series is the July 2026 revision, not the edition available on polling day; asylum change since 2021 covers only 70 of 115 districts in May 2025.
