# Scripts

This starter repo leaves room for three script families:

- `fetch/`: download official releases, archive captures, and public evidence files
- `transform/`: normalize files into canonical observations and hotel ledgers
- `export/`: write site-ready JSON for the frontend

## Current ingestion entrypoints

- `npm run fetch:lancashirecc`
- `npm run transform:lancashirecc`
- `npm run ingest:lancashirecc`

These implement the first real council-accountability ingestion flow for Lancashire County Council:

- fetch current publish-layer JSON from the Lancashire / AI DOGE repo
- store raw files under `data/raw/lancashire_cc/`
- generate canonical outputs under `data/canonical/lancashire_cc/`
- generate lighter summary marts under `data/marts/lancashire_cc/`

The current implementation covers:

- spending transactions
- budget outturn and budget plan records
- budget mapping normalization

The current marts also surface:

- missing monthly publication gaps in the spend corpus
- redacted supplier spend totals
- reserves and council-tax drift from official budget summaries
- differences between the upstream mapping layer and the canonical spend corpus
