# Ward code bridge for the unscored May 2026 wards: specification

Written 27 November 2026, before any forecast for these wards was produced or scored. Research only.

## The gap

The November model scores 2,596 of the 2,897 May 2026 wards. The other 301 count as misses, which is why the blend scores 65.8% on the wards it can forecast and 58.9% overall. All 301 carry a Democracy Club slug where an ONS code should be (counted today from `data/identity/wards-may-2026.json`), so they join to nothing: no ward features and no previous result.

## Counted before any forecast (`bridge_build.py`)

- 220 of the 301 match one boundary by name inside their own council or county, using the site's rule in `src/lib/wardBoundaryJoin.ts` (unique name, one listed alias). They are in 20 councils. The 81 that do not match are East Surrey and West Surrey, where no boundary is on file.
- None of the 220 matched codes is in the feature file, so every one needs a bridge.
- 219 contain at least one small area centroid. For all 219 the old areas they were cut from carry features; for 218 those old areas carry a previous result for at least 90% of the population. 96 were cut from one old area only.

## Method

1. **Boundary.** Name match as above: `wd26-bgc.geojson` for wards, `ced26-bgc.geojson` for county divisions.
2. **Small areas.** A 2021 LSOA belongs to the new area whose boundary contains its population-weighted centroid (Drive `03 Geography and lookups/lsoa21_population_weighted_centroids.csv`, British National Grid converted to latitude and longitude). A new area containing no centroid takes the single LSOA whose centroid is nearest to it.
3. **Old areas.** Each LSOA's old area is its 2025 ward (`lsoa21_to_ward_wd25.csv`), or for a county division the 2025 division of that ward (`ward25_to_ced25_lookup.csv`). Weights are LSOA population (`05 Population estimates and projections/population_lsoa21_total_latest.csv`, 2024).
4. **Features.** Each of the 44 numeric inputs is the population-weighted mean of the old areas' values in the feature file. Total residents is the summed LSOA population. Region is the largest old area's.
5. **Previous result.** For each old area, its latest contest before 7 May 2026 in the dataset. The notional share for each lane is the weighted mean over old areas that have one. A lane counts as having stood if its notional share is above zero. The year, for the year mean and the gap, is the largest old area's. If old areas with a result cover less than half the population, the ward is treated as having no previous result.
6. **Standing and anchor.** As for every other May 2026 ward: lanes standing from the nomination list, the same national anchor.
7. **Model.** The November model, unchanged: refitted from the same training rows, settings and seed, and checked to reproduce its stored forecasts before use.

The bridge assumes every small area carries its old ward's values. That is the main approximation.

## Scoring

The 220 bridged wards, with the November scorer. Arms: the candidate engine of 24 October (the benchmark, since it already forecasts these wards), the model, and the 0.5 and 0.5 blend. Also the new totals on all 2,897 wards.

## What would count

The bridge is supported if the model and the blend each call more leaders on the bridged wards than the candidate engine does on the same wards. The rates on the 2,596 wards scored directly (model 60.6%, blend 65.8%) are shown beside them for scale, not as a test.

## Run rule

One scoring run. A fault that stops the run can be fixed without reading scores. Any rerun after a score is seen is reported.
