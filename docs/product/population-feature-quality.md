# Population Feature Quality

Population modelling is not uniform across every area. UK Elections must store the method and evidence depth for each area before population features can be used in an election model.

## Required Per-Area Metadata

Each population feature snapshot must record:

- `method`: the actual method used for that area.
- `quality_level`: how complete the modelling is.
- `source_depth`: which dimensions contributed data.
- `geography_fit`: whether the data matches the election geography exactly or is weighted/proxied.
- `confidence`: high, medium, low, or none.
- `limitations`: area-specific caveats.

## Method Classes

- `census_2021_rebased_component`: strongest class. Census 2021 base with cohort-component logic and migration components.
- `newethpop_2011_validation`: historic NEWETHPOP comparison or validation layer.
- `ons_snpp_constrained`: constrained to ONS subnational population totals.
- `census_static`: Census 2021 baseline without a full projection model.
- `area_proxy`: nearby or parent-area proxy used because exact geography is unavailable.
- `manual_context`: manually reviewed contextual feature, not model-grade until backtested.

## Quality Rule

An area with proxy or unknown population modelling cannot have high or medium confidence. Exact-area cohort-component features can be high or medium only when source snapshots, transformation notes, and validation results exist.

## Election Model Use

Population features should enter a forecast only after the relevant model family has shown through backtesting that the feature improves calibration or error. Until then, publish them as context, not as a causal vote driver.
