# UK Elections Canonical Data Schema

This is the first implementation target for the data foundation. Keep source rows immutable, then build public marts from these canonical entities. Local and devolved models must not reuse Westminster assumptions without an explicit model family.

## Core Entities

### `areas`

Administrative and electoral geography.

Required fields:

- `area_id`: stable internal id
- `area_code`: official code where available
- `area_name`
- `area_type`: `westminster_constituency`, `senedd_constituency`, `senedd_super_constituency`, `scottish_parliament_constituency`, `scottish_parliament_region`, `ward`, `county_division`, `local_authority`, `pcc_area`, `mayoral_area`
- `country`
- `valid_from`
- `valid_to`
- `boundary_version`
- `source_url`

### `contests`

One election contest in one area on one date.

Required fields:

- `contest_id`
- `area_id`
- `election_date`
- `election_type`: `westminster_general`, `westminster_by_election`, `borough`, `district`, `county`, `unitary`, `mayoral`, `pcc`, `scottish_parliament_constituency`, `scottish_parliament_regional_list`, `senedd_closed_list`, `senedd_by_election`
- `model_family`: `westminster_fptp`, `local_fptp_borough`, `local_fptp_county`, `local_fptp_unitary`, `local_stv`, `senedd_closed_list_pr`, `scottish_ams`
- `voting_system`: `fptp`, `ams_constituency`, `ams_regional_list`, `closed_list_pr`, `stv`
- `seats_available`
- `election_cycle`: `all_out`, `thirds`, `halves`, `single_member`, `regional_list`
- `source_url`

### `candidates`

Candidate standing in a contest.

Required fields:

- `candidate_id`
- `contest_id`
- `person_name`
- `party_name`
- `party_id`
- `incumbent`
- `defending_seat`
- `statement_of_persons_nominated_url`
- `source_url`

### `results`

Declared result rows.

Required fields:

- `result_id`
- `contest_id`
- `candidate_id`
- `votes`
- `vote_share`
- `elected`
- `rank`
- `turnout`
- `electorate`
- `result_status`: `official`, `verified_secondary`, `provisional`, `manual_review`
- `source_url`

### `source_snapshots`

Immutable record of each imported source file or API response.

Required fields:

- `snapshot_id`
- `source_name`
- `source_url`
- `retrieved_at`
- `licence`
- `raw_file_path`
- `sha256`
- `row_count`
- `quality_status`: `accepted`, `accepted_with_warnings`, `quarantined`
- `review_notes`

### `boundary_mappings`

Area-to-area relationship for changed boundaries.

Required fields:

- `mapping_id`
- `source_area_id`
- `target_area_id`
- `weight`
- `weight_basis`: `population`, `electorate`, `lsoa_best_fit`, `manual`
- `source_url`

### `boundary_versions`

Boundary record for a ward, division, constituency, region, or authority during a defined period.

Required fields:

- `boundary_version_id`
- `area_type`
- `area_code`
- `area_name`
- `valid_from`
- `valid_to`
- `predecessor_boundary_version_ids`
- `successor_boundary_version_ids`
- `source_snapshot_id`
- `source_url`
- `review_status`

### `election_history_records`

Auditable historic result for one contest in the geography used on polling day.

Required fields:

- `history_id`
- `contest_id`
- `area_id`
- `area_code`
- `area_name`
- `boundary_version_id`
- `election_date`
- `election_type`
- `voting_system`
- `source_snapshot_id`
- `result_rows`
- `electorate`
- `turnout_votes`
- `turnout`
- `review_status`

### `polls`

Polling inputs.

Required fields:

- `poll_id`
- `pollster`
- `client`
- `fieldwork_start`
- `fieldwork_end`
- `sample_size`
- `population`
- `geography`
- `mode`
- `party_shares`
- `source_url`

### `predictions`

Model output for one contest.

Required fields:

- `prediction_id`
- `model_version`
- `contest_id`
- `party_name`
- `p10`
- `p50`
- `p90`
- `win_probability`
- `generated_at`
- `input_snapshot_id`
- `status`: `internal`, `review`, `published`, `withdrawn`
- `caveat`

### `backtests`

Predicted-vs-actual validation.

Required fields:

- `backtest_id`
- `model_version`
- `contest_id`
- `prediction_id`
- `actual_party`
- `predicted_party`
- `actual_vote_share`
- `predicted_vote_share_p50`
- `absolute_error`
- `winner_correct`

## Source Rule

Every public row must be traceable to `source_url`, a local raw file hash, or both. If a source has been transformed through a boundary mapping, preserve both the original result source and the mapping source.

## Model Families

- `local_fptp_borough`: ward-level borough contests. Requires current ward boundaries, council cycle, wards up, defending councillor, candidates, and borough election history. County results may be a feature, not a baseline.
- `local_fptp_county`: county division contests. Requires division boundaries and division history. Borough ward demographics must be area-weighted to divisions before use.
- `local_fptp_unitary`: unitary ward or division contests. Requires the authority's own ward structure, election cycle, and any predecessor authority mapping.
- `westminster_fptp`: Westminster constituency contests. Requires 2024 boundary generation, official constituency results, candidates, national and regional polling, and notional or mapped predecessor results.
- `senedd_closed_list_pr`: 2026 Senedd contests under the new list system. Requires the new constituency groupings, list candidates, regional/national Welsh polling, and previous Senedd/Westminster/local signals with explicit caveats.
- `scottish_ams`: Scottish Parliament constituency and regional list contests. Requires separate constituency and list vote models, current or next-election Scottish Parliament boundaries, and AMS seat allocation backtests.

## Quality Gates

1. Candidate gate: no published forecast until the candidate roster is sourced from Democracy Club or the official statement of persons nominated.
2. Geography gate: no local forecast until ward/division codes and boundary generation match the contest being modelled.
3. History gate: no local forecast until previous results are normalised to the same ward/division or mapped with an explicit weight.
4. Feature gate: no demographic, deprivation, fiscal, or polling feature without source metadata and transformation notes.
5. Backtest gate: no model family is public until it has at least one archived backtest or a visible "unbacktested pilot" label.
