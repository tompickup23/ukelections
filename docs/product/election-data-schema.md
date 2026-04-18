# UK Elections Canonical Data Schema

This is the first implementation target for the data foundation. Keep source rows immutable, then build public marts from these canonical entities.

## Core Entities

### `areas`

Administrative and electoral geography.

Required fields:

- `area_id`: stable internal id
- `area_code`: official code where available
- `area_name`
- `area_type`: `westminster_constituency`, `ward`, `division`, `region`, `local_authority`, `devolved_constituency`, `devolved_region`, `pcc_area`, `mayoral_area`
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
- `election_type`: `general`, `local`, `mayoral`, `pcc`, `scottish_parliament`, `senedd`, `assembly`, `by_election`
- `voting_system`: `fptp`, `ams`, `closed_list_pr`, `stv`
- `seats_available`
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
- `source_url`

### `boundary_mappings`

Area-to-area relationship for changed boundaries.

Required fields:

- `mapping_id`
- `source_area_id`
- `target_area_id`
- `weight`
- `weight_basis`: `population`, `electorate`, `lsoa_best_fit`, `manual`
- `source_url`

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
