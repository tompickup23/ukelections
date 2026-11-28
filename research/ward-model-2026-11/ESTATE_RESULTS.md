# Estate series check: results

27 November 2026. **Research only.** One run of `estate_check.py` under `ESTATE_SPEC.md` (committed first, a805612). No model was refitted and nothing published changes. These are relationships between places (local authority districts), not people.

## Answer

**Five of 72 measure and lane pairs line up in both stages, but only one survives taking out region, and it is not a moving series.** Districts with more houses in multiple occupation per 1,000 residents (Census 2021) had Reform UK's share forecast too high compared with districts with few: top fifth minus bottom fifth, minus 6.2 points in May 2026 and minus 5.6 points in May 2025, and the relationship holds within region in both. Its rank correlation with the NINo registration rate is 0.76 (May 2026 districts), so it marks an urban, rented, high-turnover gradient rather than one specific thing.

None of the series that move after 2021 (population change, change in NINo registrations, asylum support and its change, the Band D rise) explains the model's misses once region is taken out. Four pairs pass both stages but not within region: NINo registrations per head with Reform UK, change in NINo registrations since 2021 with Conservative, median taxpayer income with Reform UK, and Band D level with Liberal Democrats. The model's region input, or the regional pattern of the miss, may account for those. Neither placebo passed anything.

So the answer to "can the sister sites' dated series fix the North and Midlands Reform UK miss?" is: not on this evidence. What lines up is a fixed feature of places the model sees only at ward level, and the proposal below tests it as a district term.

## What was run

- Residual: per district, election and lane, the vote-weighted mean of actual minus C2 forecast share over scored wards where the lane stood, in points (positive: forecast too low). Districts with fewer than five such wards are left out and counted in `results/estate_summary.json` (`districts_left_out_under_5_wards`; for example May 2026 Others 55 of 142, May 2025 Others 62 of 100).
- Districts used, May 2026 / May 2025: Reform UK 148 / 108, Labour 148 / 108, Conservative 147 / 108, Liberal Democrats 134 / 96, Green 147 / 100, Others 87 / 38. 22 May 2026 Norfolk divisions could not be placed (shared South Norfolk and Broadland site).
- Discovery family 72 tests; Benjamini and Hochberg at 10% passed 21 (largest passing p 0.0164). Confirmation needs the same sign and p under 0.05 in May 2025.

## Tested measures by lane

rho is Spearman's rank correlation between district residual and measure; p is the two-sided permutation p (10,000 shuffles; the smallest possible is 0.0001). "Discovery only" means the pair passed the corrected May 2026 test but not the May 2025 test.

| measure | lane | May 2026 rho | p | BH pass | May 2025 rho | p | verdict |
|---|---|---|---|---|---|---|---|
| `pop_change_21` | Reform UK | +0.24 | 0.0028 | yes | +0.01 | 0.9269 | discovery only |
| `pop_change_21` | Labour | -0.08 | 0.3102 | no | +0.11 | 0.2455 | not supported |
| `pop_change_21` | Conservative | -0.04 | 0.6564 | no | -0.04 | 0.6847 | not supported |
| `pop_change_21` | Lib Dem | +0.00 | 0.9805 | no | +0.02 | 0.8096 | not supported |
| `pop_change_21` | Green | +0.05 | 0.5770 | no | +0.04 | 0.6621 | not supported |
| `pop_change_21` | Others | -0.32 | 0.0022 | yes | -0.06 | 0.7314 | discovery only |
| `nino_rate` | Reform UK | -0.36 | <0.001 | yes | -0.20 | 0.0411 | **lines up** |
| `nino_rate` | Labour | +0.35 | <0.001 | yes | +0.10 | 0.3215 | discovery only |
| `nino_rate` | Conservative | +0.11 | 0.1784 | no | +0.11 | 0.2725 | not supported |
| `nino_rate` | Lib Dem | -0.10 | 0.2614 | no | +0.03 | 0.7602 | not supported |
| `nino_rate` | Green | +0.24 | 0.0036 | yes | +0.06 | 0.5493 | discovery only |
| `nino_rate` | Others | -0.13 | 0.2311 | no | +0.23 | 0.1641 | not supported |
| `nino_change_21` | Reform UK | +0.40 | <0.001 | yes | +0.03 | 0.7467 | discovery only |
| `nino_change_21` | Labour | +0.01 | 0.9384 | no | +0.08 | 0.4304 | not supported |
| `nino_change_21` | Conservative | -0.22 | 0.0081 | yes | -0.26 | 0.0071 | **lines up** |
| `nino_change_21` | Lib Dem | -0.09 | 0.2967 | no | +0.00 | 0.9738 | not supported |
| `nino_change_21` | Green | +0.11 | 0.1847 | no | +0.19 | 0.0562 | not supported |
| `nino_change_21` | Others | -0.26 | 0.0159 | yes | +0.25 | 0.1333 | discovery only |
| `asylum_rate` | Reform UK | +0.16 | 0.0618 | no | +0.08 | 0.4402 | not supported |
| `asylum_rate` | Labour | +0.06 | 0.4834 | no | -0.19 | 0.0634 | not supported |
| `asylum_rate` | Conservative | -0.20 | 0.0164 | yes | +0.07 | 0.4654 | discovery only |
| `asylum_rate` | Lib Dem | -0.05 | 0.5870 | no | +0.00 | 0.9648 | not supported |
| `asylum_rate` | Green | +0.31 | <0.001 | yes | +0.02 | 0.8503 | discovery only |
| `asylum_rate` | Others | -0.32 | 0.0037 | yes | -0.20 | 0.2325 | discovery only |
| `asylum_change_21` | Reform UK | +0.01 | 0.9255 | no | +0.02 | 0.8769 | not supported |
| `asylum_change_21` | Labour | -0.01 | 0.9290 | no | -0.08 | 0.5471 | not supported |
| `asylum_change_21` | Conservative | +0.06 | 0.5341 | no | +0.15 | 0.2272 | not supported |
| `asylum_change_21` | Lib Dem | +0.10 | 0.3135 | no | -0.14 | 0.3063 | not supported |
| `asylum_change_21` | Green | -0.09 | 0.3203 | no | +0.12 | 0.3420 | not supported |
| `asylum_change_21` | Others | -0.04 | 0.7449 | no | -0.32 | 0.1076 | not supported |
| `income_median` | Reform UK | -0.33 | <0.001 | yes | -0.24 | 0.0115 | **lines up** |
| `income_median` | Labour | +0.10 | 0.2456 | no | +0.52 | <0.001 | not supported |
| `income_median` | Conservative | +0.55 | <0.001 | yes | +0.13 | 0.1762 | discovery only |
| `income_median` | Lib Dem | -0.09 | 0.3243 | no | -0.06 | 0.5436 | not supported |
| `income_median` | Green | -0.34 | <0.001 | yes | -0.05 | 0.6400 | discovery only |
| `income_median` | Others | +0.10 | 0.3341 | no | +0.12 | 0.4586 | not supported |
| `band_d` | Reform UK | +0.24 | 0.0025 | yes | -0.35 | <0.001 | discovery only |
| `band_d` | Labour | -0.15 | 0.0683 | no | +0.01 | 0.9562 | not supported |
| `band_d` | Conservative | -0.27 | <0.001 | yes | +0.01 | 0.9085 | discovery only |
| `band_d` | Lib Dem | +0.21 | 0.0153 | yes | +0.24 | 0.0175 | **lines up** |
| `band_d` | Green | +0.07 | 0.4243 | no | -0.32 | 0.0016 | not supported |
| `band_d` | Others | -0.01 | 0.9224 | no | +0.56 | <0.001 | not supported |
| `band_d_rise` | Reform UK | +0.09 | 0.2676 | no | +0.01 | 0.9577 | not supported |
| `band_d_rise` | Labour | -0.05 | 0.5274 | no | +0.03 | 0.7854 | not supported |
| `band_d_rise` | Conservative | -0.06 | 0.4520 | no | -0.02 | 0.8066 | not supported |
| `band_d_rise` | Lib Dem | +0.15 | 0.0799 | no | +0.13 | 0.2029 | not supported |
| `band_d_rise` | Green | +0.08 | 0.3613 | no | -0.06 | 0.5576 | not supported |
| `band_d_rise` | Others | -0.10 | 0.3403 | no | -0.03 | 0.8584 | not supported |
| `hmo_rate` | Reform UK | -0.44 | <0.001 | yes | -0.34 | <0.001 | **lines up** |
| `hmo_rate` | Labour | +0.25 | 0.0029 | yes | +0.16 | 0.0985 | discovery only |
| `hmo_rate` | Conservative | +0.21 | 0.0102 | yes | +0.10 | 0.3067 | discovery only |
| `hmo_rate` | Lib Dem | +0.00 | 0.9602 | no | +0.06 | 0.5687 | not supported |
| `hmo_rate` | Green | +0.06 | 0.4768 | no | -0.07 | 0.4842 | not supported |
| `hmo_rate` | Others | +0.17 | 0.1125 | no | +0.32 | 0.0438 | not supported |
| `wb_change_1121` | Reform UK | +0.10 | 0.2457 | no | +0.09 | 0.3503 | not supported |
| `wb_change_1121` | Labour | -0.08 | 0.3546 | no | -0.04 | 0.7118 | not supported |
| `wb_change_1121` | Conservative | +0.01 | 0.8863 | no | -0.21 | 0.0341 | not supported |
| `wb_change_1121` | Lib Dem | +0.17 | 0.0541 | no | +0.00 | 0.9885 | not supported |
| `wb_change_1121` | Green | -0.21 | 0.0140 | yes | -0.00 | 0.9829 | discovery only |
| `wb_change_1121` | Others | +0.21 | 0.0538 | no | -0.18 | 0.2772 | not supported |
| `placebo_hash` | Reform UK | -0.03 | 0.7108 | no | -0.06 | 0.5341 | not supported |
| `placebo_hash` | Labour | -0.05 | 0.5533 | no | -0.09 | 0.3429 | not supported |
| `placebo_hash` | Conservative | +0.01 | 0.8804 | no | +0.07 | 0.4727 | not supported |
| `placebo_hash` | Lib Dem | +0.13 | 0.1320 | no | +0.05 | 0.6099 | not supported |
| `placebo_hash` | Green | -0.10 | 0.2012 | no | +0.03 | 0.7381 | not supported |
| `placebo_hash` | Others | +0.06 | 0.5678 | no | -0.21 | 0.1967 | not supported |
| `placebo_digit` | Reform UK | -0.02 | 0.7817 | no | +0.02 | 0.8327 | not supported |
| `placebo_digit` | Labour | -0.07 | 0.4256 | no | +0.04 | 0.6727 | not supported |
| `placebo_digit` | Conservative | +0.03 | 0.7492 | no | -0.15 | 0.1095 | not supported |
| `placebo_digit` | Lib Dem | -0.03 | 0.7671 | no | -0.05 | 0.6128 | not supported |
| `placebo_digit` | Green | -0.03 | 0.7401 | no | -0.11 | 0.2754 | not supported |
| `placebo_digit` | Others | +0.06 | 0.5916 | no | +0.04 | 0.8279 | not supported |

Some pairs that failed discovery are strong in May 2025 alone (median income with Labour, rho 0.52; Band D with Reform UK, minus 0.35, the opposite sign to May 2026; Band D with Others, 0.56 on 38 districts). By the rule they are not supported, and the sign flip for Band D with Reform UK is a reason to be wary of single-year results.

## The pairs that line up

Effect is the mean residual of the top fifth of districts on the measure minus the bottom fifth, in points (unweighted over districts). Within region: the same rank correlation after taking out each region's mean residual.

| pair | May 2026 effect | May 2025 effect | within region, May 2026 | within region, May 2025 | verdict |
|---|---|---|---|---|---|
| `hmo_rate`, Reform UK | -6.2 (bottom +5.5, top -0.7) | -5.6 (bottom +9.0, top +3.4) | rho -0.28, p 0.0008 | rho -0.22, p 0.024 | **holds within region** |
| `nino_rate`, Reform UK | -4.9 (bottom +5.0, top +0.0) | -3.4 (bottom +7.5, top +4.1) | rho -0.22, p 0.006 | rho -0.14, p 0.155 | does not hold |
| `income_median`, Reform UK | -3.1 (bottom +3.3, top +0.2) | -3.4 (bottom +5.9, top +2.5) | rho -0.05, p 0.579 | rho -0.22, p 0.024 | does not hold |
| `nino_change_21`, Conservative | -2.8 (bottom +1.2, top -1.6) | -4.0 (bottom +0.3, top -3.7) | rho -0.04, p 0.653 | rho -0.18, p 0.058 | does not hold |
| `band_d`, Liberal Democrats | +1.1 (bottom -2.0, top -1.0) | +6.6 (bottom -5.4, top +1.2) | rho +0.07, p 0.433 | rho +0.22, p 0.033 | does not hold |

Checks (reported, not used to choose). Reform UK stood in too few wards for the May 2022 test to run (4 districts with five or more wards) and in 10 or 11 districts in May 2023, so the Reform UK checks say little: `hmo_rate` May 2023 rho +0.15, p 0.68 (10 districts); `nino_rate` May 2023 rho +0.05, p 0.91 (11). `nino_change_21` with Conservative is not defined for May 2022 and in May 2023 has the opposite sign (rho +0.18, p 0.080, 95 districts). `income_median` and `band_d` have no value dated before May 2022 or May 2023, so no check exists. Nothing here shows the HMO relationship as a standing feature of the model before the years of change, but nothing rules it out either.

## Measures excluded for lack of a value dated before polling day

`spd_share` (single person discount, only the 6 October 2025 snapshot), `ta_rate` (temporary accommodation, only 31 March 2026) and `births_nonuk_mother` (only calendar 2025) have no value dated before May 2025 polling day, so they cannot be confirmed and are not supported by construction. Their May 2026 numbers, description only:

| measure | lane | May 2026 rho | p | top minus bottom fifth, pp |
|---|---|---|---|---|
| `spd_share` | Reform UK | +0.09 | 0.2808 | -0.1 |
| `spd_share` | Labour | +0.03 | 0.7569 | +0.3 |
| `spd_share` | Conservative | -0.41 | <0.001 | -3.2 |
| `spd_share` | Lib Dem | +0.09 | 0.3026 | +1.2 |
| `spd_share` | Green | +0.26 | 0.0015 | +1.3 |
| `spd_share` | Others | +0.11 | 0.2945 | +2.4 |
| `ta_rate` | Reform UK | -0.38 | <0.001 | -6.1 |
| `ta_rate` | Labour | +0.34 | <0.001 | +3.9 |
| `ta_rate` | Conservative | +0.30 | <0.001 | +3.8 |
| `ta_rate` | Lib Dem | -0.20 | 0.0230 | -1.7 |
| `ta_rate` | Green | +0.04 | 0.6352 | +1.1 |
| `ta_rate` | Others | +0.06 | 0.6147 | +0.8 |
| `births_nonuk_mother` | Reform UK | -0.43 | <0.001 | -6.0 |
| `births_nonuk_mother` | Labour | +0.37 | <0.001 | +3.9 |
| `births_nonuk_mother` | Conservative | +0.17 | 0.0345 | +1.9 |
| `births_nonuk_mother` | Lib Dem | -0.15 | 0.0768 | -0.7 |
| `births_nonuk_mother` | Green | +0.22 | 0.0079 | +2.5 |
| `births_nonuk_mother` | Others | -0.14 | 0.2085 | -2.3 |

Across the 152 May 2026 districts, temporary accommodation and births to mothers born outside the UK rank-correlate with the NINo rate (0.57 and 0.92) and the HMO rate (0.58 and 0.70), so they sit on the same gradient as the tested pairs; the single person discount share does not (-0.07 and -0.04). Without a dated value before May 2025 nothing can be concluded from them.

Also excluded for particular elections: `income_median`, `band_d` and `band_d_rise` for May 2022 and May 2023 (earliest editions held are 2023 to 2024 and 2024 to 2025); `pop_change_21` and `nino_change_21` for May 2022 (not defined). The UK Demographics projected ethnic shares were not used at all: every projected value is dated 2031 or later and the projection was fitted with inputs published after May 2025.

## Faults

**Before the run** (in the spec): null council codes taken by the slug rule; Barnsley and Sheffield missing after their 2023 code change; their per-1,000 rates failing on the same codes.

**After the run, found on reading the output.** `data/geography/lad24-to-region.json` holds Barnsley and Sheffield only under their old codes, so those two districts had no region. In May 2026, May 2022 and May 2023 that made the within-region residual missing for them, and the within-region rho came out as NaN (with a meaningless p) for every measure that covered them. Confirmation (May 2025) was unaffected, and the main statistic does not use region. I added a fallback to the ukplaces registry region (`region_of_lad` in `estate_common.py`) and ran the script again. Every main statistic (rho, p, fifths) and every verdict, including the within-region labels, is identical between the two runs; only the within-region columns changed (for example `hmo_rate` with Reform UK, May 2026: -0.2822 before, -0.2815 after, because Yorkshire's regional mean now includes the two districts). The first output is kept as `results/estate_summary_run1_region_fault.json`.

## Limits

- **Ecological.** District measures against district residuals. Nothing here is about people, and nothing says why the relationship exists.
- **Two elections decide.** May 2026 and May 2025, both years of large change in Reform UK's level; May 2025 is 23 councils, mostly counties, placed into 115 districts.
- **Authority-level measures, ward-level forecasts.** A district value is set against wards that may differ widely from the district average; the model already has ward-level private renting, students, deprivation and ethnicity, so a district term can only add context the ward features do not carry.
- **Measures are correlated.** HMO and NINo rates rank-correlate 0.76 (May 2026) and 0.72 (May 2025); income correlates with both. The five passes are not five findings.
- **Editions and dates.** Population: ONS June 2025 edition, revised series (published 29 July 2026), so the mid-2024 value used for May 2025 is a revision, not what was published before polling day. Asylum: Home Office year ending June 2026 edition; the 31 March 2025 stock was first published after May 2025 polling day. NINo: calendar years to 2025 (lastUpdated 29 April 2026). Income: HMRC 2023 to 2024 (29 April 2026), after both polling days though dated before them. Council tax: MHCLG 2024 to 2025, 2025 to 2026 (revised April 2026) and 2026 to 2027. HMO: Census 2021. For a descriptive check, reference dates before polling day were the rule; a model input would need publication before polling day.
- **Coverage.** Asylum change since 2021 covers 70 of 115 districts in May 2025; missing asylum values were left missing, not set to zero.
- **Within region is crude.** Nine English regions, mean removed per election and lane; it does not remove finer geography.

## Proposed specification for a six-election test (not run)

**Input.** Houses in multiple occupation per 1,000 residents in the ward's local authority district (ONS Census 2021 RM192 over Census 2021 population), as a district-level feature added to every lane's model in the same way (not a Reform UK rule). Optionally a second arm with the ward-level RM192 count per 1,000 if the ward table is obtained, to see whether the district version is standing in for something the ward version carries better.

**Cut-off.** Census Day, 21 March 2021, published 2023: dated and published before the 2022, 2023, 2025 and 2026 polling days. For 2019 and 2021 it is dated after polling day, so either the 2019 and 2021 years are scored without it (and say so) or the test runs on four elections.

**Arms and rules.** C2 as the base against C2 plus the HMO term, refit forward-only exactly as `BRIDGE_LEVEL_SPEC.md`, with the standing-rate inputs unchanged. Pre-set: it counts only if it calls more ward leaders pooled over the elections where it is defined, has no higher pooled share error, is at least as good in at least three of the four (or four of six) years, loses no year by more than 1% of that year's wards, and narrows the Reform UK district miss by region (the North and West Midlands rows) rather than only moving London. Neutrality: every lane gets the same term; party totals are reported for every lane.

## Files

- `ESTATE_SPEC.md`, `estate_common.py`, `estate_inventory.py`, `estate_check.py`
- `results/estate_inventory.json` (inventory, before the spec), `results/estate_summary.json` (the run), `results/estate_summary_run1_region_fault.json` (first output, region fault)
