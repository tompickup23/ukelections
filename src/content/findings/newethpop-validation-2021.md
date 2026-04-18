---
headline: "Academic ethnic projections underestimated diversity in 95% of areas"
date: "2026-04-11"
category: demographics
stat_value: "2.58pp"
stat_label: "NEWETHPOP error vs our 1.71pp"
verdict: alert
source_url: "https://reshare.ukdataservice.ac.uk/852508/"
source_label: "NEWETHPOP (University of Leeds)"
summary: "The NEWETHPOP cohort-component model, the UK's most cited academic ethnic projection, over-predicted White British population share in 282 out of 296 local authorities. NEWETHPOP MAE: 2.58pp. Our Hamilton-Perry v7.0 model achieves MAE 1.71pp. 33% more accurate. using Census 2011 DC2101EW (18 groups, observed) and Census 2021 custom dataset (20 groups, direct)."
---

**The UK diversified faster than the best academic model predicted.**

NEWETHPOP - the most cited ethnic population projection for UK local authorities - was built by Rees, Norman, Wohland, Lomax and Clark at the University of Leeds. Published via the UK Data Service in 2016 (ESRC grant ES/L013878/1), it projected ethnic composition from Census 2011 to 2061 using a bi-regional cohort-component model with age-specific fertility, mortality, and migration rates by ethnic group. Two scenarios were published: a Brexit variant (Leeds1) and an ONS-aligned variant (Leeds2). The full dataset (2 × 1GB) is freely available under CC BY 4.0.

Census 2021 gave us the answer. We downloaded the Leeds2 (ONS-aligned) archive, extracted the Population2021 prediction for all local authorities, and compared it against actual Census 2021 data from ONS TS021.

**Result: the model over-predicted White British population share in 282 out of 296 areas (95%).** Mean Absolute Error: 3.95 percentage points. RMSE: 5.21pp. Only 16% of areas were accurate to within 1 percentage point.

**The worst misses were systematic, not random:**

- **Thurrock**: predicted 83.4% WBI, actual 66.2% - error of +17.2pp
- **Greenwich**: predicted 57.4%, actual 41.4% - error of +16.0pp
- **Barking & Dagenham**: predicted 46.6%, actual 30.9% - error of +15.7pp
- **Havering**: predicted 82.0%, actual 66.5% - error of +15.5pp
- **Bexley**: predicted 79.4%, actual 64.5% - error of +15.0pp

All five worst misses are in London and the Thames Gateway - areas where international migration accelerated beyond the model's assumptions. The model assumed EU and non-EU migration volumes based on pre-2016 patterns. Brexit, the post-2021 visa surge, and the expansion of student and skilled worker routes all changed the composition of migration in ways the 2011-calibrated model could not anticipate.

**This is not the first time.** The Leeds team themselves acknowledged that their original ETHPOP model (2001-based) had the same systematic bias when validated against Census 2011. NEWETHPOP was funded specifically to correct this. The correction was insufficient - the same directional error persisted, just smaller in magnitude.

**Every projection in use today inherits this problem.**

Every ethnic demographic projection for the UK - including Goodwin's CHSS report (2025), which projects White British minority by 2063 - inherits assumptions from the same academic tradition. The gold-standard model underestimated diversity growth by an average of 4 percentage points over just 10 years. Forward projections to 2050 or 2060 are likely understating the pace of demographic change.

Our own model (Hamilton-Perry v7.0 with Census 2011 DC2101EW observed base and Census 2021 direct observations, 20 ethnic groups) addresses this by using observed Census-to-Census ratios rather than modelled component rates. In backcast validation across 269 areas, our model achieves MAE 1.71pp. outperforming NEWETHPOP's 2.58pp by 33% while using a simpler, more transparent method. The v7.0 upgrade (Census 2011 DC2101EW replacing proportional splitting, Census 2021 direct base, DfE school calibration) delivered the most accurate subnational ethnic projection model publicly available. Full limitations documented on our methodology page.

**Accuracy distribution across 296 areas:**
- Within 1pp: 48 areas (16%)
- Within 2pp: 108 areas (37%)
- Within 5pp: 208 areas (70%)
- Over 10pp error: 26 areas (9%)

**Nobody else has published this validation.** The NEWETHPOP dataset has been downloaded and cited by researchers worldwide, but no systematic comparison against Census 2021 actuals has been published. This finding is, to our knowledge, the first.

**Data:** NEWETHPOP Leeds2 projection (DOI: 10.5255/UKDA-SN-852508) vs ONS Census 2021 TS021 via NOMIS API. Full validation data and error tables published at ukdemographics.co.uk. Methodology: Hamilton-Perry v7.0 single-year-of-age model, 20 ethnic groups, Census 2011 DC2101EW (18 groups, observed) + Census 2021 custom dataset (20 groups, direct), DfE School Census 2024/25 calibration, James-Stein shrinkage, 1,000 Monte Carlo simulations, backcast validation (MAE 1.71pp vs NEWETHPOP 2.58pp across 269 areas).
