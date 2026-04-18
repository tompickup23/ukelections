# ONS Custom Dataset Downloads — Manual Guide

Two datasets need manual download from the ONS "Create a custom dataset" tool.
The tool is at: **https://www.ons.gov.uk/datasets/create**

Both require selecting Census 2011 or 2021, then configuring dimensions.

---

## Dataset 1: Census 2011 — Single-Year × Ethnicity × Sex × LA

### Purpose
Eliminates the proportional 12→20 group splitting when computing CCRs.
Currently the model uses NEWETHPOP's 12-group 2011 data and splits proportionally using 2021 ratios.
With real 2011 data at 18 groups, the CCRs would be based on actual observations.

### ONS Tool Configuration

**Step 1: Choose Census**
- Select: **Census 2011**

**Step 2: Choose population base**
- Select: **All usual residents** (the main population base — includes households + communal establishments, excludes short-term residents and visitors. This matches the 2021 dataset which totals 58.4M.)

**Step 3: Choose variables**
| Variable | Selection |
|----------|-----------|
| **Geography** | Lower tier local authorities (LTLAs) — select ALL England LAs |
| **Age** | Single year of age (0 to 100+) — 101 categories. If not available, use 5-year age bands |
| **Ethnic group** | 18 categories (2011 classification): |
| | White: English/Welsh/Scottish/Northern Irish/British |
| | White: Irish |
| | White: Gypsy or Irish Traveller |
| | White: Other White |
| | Mixed/Multiple: White and Black Caribbean |
| | Mixed/Multiple: White and Black African |
| | Mixed/Multiple: White and Asian |
| | Mixed/Multiple: Other Mixed |
| | Asian/Asian British: Indian |
| | Asian/Asian British: Pakistani |
| | Asian/Asian British: Bangladeshi |
| | Asian/Asian British: Chinese |
| | Asian/Asian British: Other Asian |
| | Black/African/Caribbean/Black British: African |
| | Black/African/Caribbean/Black British: Caribbean |
| | Black/African/Caribbean/Black British: Other Black |
| | Other ethnic group: Arab |
| | Other ethnic group: Any other ethnic group |
| **Sex** | Male, Female (2 categories) |

**Step 3: Format**
- Download as CSV

### Expected Output
- ~1.2M rows (311 LAs × 101 ages × 18 ethnic groups × 2 sexes)
- ~100-120 MB
- Save to: `data/raw/census_2011_single_year/census2011_ethnic_age_sex_la_singleyear.csv`

### Notes
- Census 2011 has 18 ethnic groups, NOT 20 (Roma was counted within "Gypsy or Irish Traveller", not separate)
- The 2021 dataset has 20 groups (Roma + Gypsy/Traveller split)
- Our model handles this by combining WGT+WRO into one category for 2011
- Some small LAs may be suppressed for disclosure control (same as 2021 — 20 LAs)
- If single-year age is not available for 2011, use 5-year age bands instead

---

## Dataset 2: Census 2021 — Internal Migration OD by Ethnicity

### Purpose
The single biggest remaining model accuracy gap. Currently migration is modelled as a flat net rate per ethnic group nationally. With OD flows by ethnicity, the model can capture ethnic-specific migration patterns (e.g., "Pakistani families move from Bradford to Keighley" or "White British move from London to Kent").

### ONS Tool Configuration

**Step 1: Choose Census**
- Select: **Census 2021**

**Step 2: Choose topic**
- Migration — Internal migration (address one year ago)

**Step 3: Choose variables**
| Variable | Selection |
|----------|-----------|
| **Current residence** | Lower tier local authorities — ALL England LAs |
| **Address one year ago** | Lower tier local authorities — ALL England LAs |
| **Ethnic group** | 20 categories (2021 classification — same as existing 2021 base): |
| | All 20 groups listed above in Dataset 1's 2021 equivalent |
| **Age** | Broad age bands (if single-year is too large): |
| | 0-15, 16-24, 25-34, 35-49, 50-64, 65+ |
| | OR if available: 5-year bands |

**Step 3: Format**
- Download as CSV

### Expected Output
- Very large: 300+ origin LAs × 300+ destination LAs × 20 ethnic groups × 6 age bands
- Could be 10-50 GB if fully expanded. May need to request in batches by region.
- Save to: `data/raw/census_migration/census2021_od_migration_ethnicity.csv`

### Alternative approach if too large
If the full OD × ethnicity cross-tab is too large or suppressed:

**Option A: Migration indicator only**
- Variable: "Migrant indicator" (moved / did not move / moved within LA / moved between LAs)
- Cross with: Ethnicity × LA × Age
- This gives ethnic-specific migration RATES per LA (proportion who moved) without full OD
- Much smaller: 311 LAs × 20 eths × 6 ages × 4 migration types = ~150K rows

**Option B: Aggregate destination regions**
- Instead of 311 destination LAs, use 9 regions as destinations
- 311 origin LAs × 9 destination regions × 20 eths × 6 ages = ~330K rows
- Captures regional flow patterns (London → South East, North → Midlands) by ethnicity

### Notes
- Census 2021 migration is for the 12 months before Census Day (March 2020 — March 2021)
- This covers the first COVID lockdown. Migration patterns were atypical.
- Plan to blend 70% Census 2021 / 30% Census 2011 to mitigate COVID distortion
- The NEWETHPOP archive provides Census 2011 migration rates (already extracted)

---

## How to Use After Download

### Census 2011 20-group:
```bash
# Place in data directory
mv ~/Downloads/census2011_*.csv data/raw/census_2011_single_year/

# Update build script to use direct 2011 data
node scripts/model/build_single_year_base.mjs --use-2011-direct

# Recompute CCRs
node scripts/model/run_hp_single_year.mjs

# Revalidate
node scripts/model/validate_backcast.mjs
```

### Census 2021 migration:
```bash
# Place in data directory
mv ~/Downloads/census2021_*migration*.csv data/raw/census_migration/

# Build migration matrix
node scripts/model/build_migration_matrix.mjs --use-od-table

# Integrate into CC v2
node scripts/model/run_projection_v2.mjs

# Compare with current projections
```

---

## Priority

1. **Census 2021 migration (Option A: migration indicator)** — quick download, immediate model value
2. **Census 2011 single-year × 18 ethnicity** — moderate download, eliminates proportional splitting
3. **Census 2021 migration (full OD)** — largest download, highest accuracy gain but may be suppressed
