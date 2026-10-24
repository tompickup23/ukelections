# Local engine: May 2026 diagnosis, hold-out protocol and one candidate (24 October 2026)

Status: working note. Nothing here changes a published forecast. The candidate engine is off unless `UKE_CANDIDATE_ENGINE=2026-10-24` is set.

## 1. Hold-out protocol

This section was written and committed before any candidate parameter was fitted. Its commit is the first on this branch; the fits and scores come in later commits.

**Yardstick.** `scripts/score-may-2026-like-for-like.mjs` (ukelections PR 130): local wards only (2,897), the five major parties kept and every other party pooled as Others, the leader by full-slate vote share, with "Labour Co-operative" not normalised. The bar is the polling-day version's 1,623 of 2,897 (56.0%). Pollcheck's own claim for its 6 May 2026 projection, 67.7% on 2,951 wards, is a reference and is not re-scored here.

**Starting point.** The candidate starts from the engine as it stood on polling day (commit `5e85c84`, forecast sha256 `56686814…`), not from HEAD. HEAD has already been tuned on the May 2026 results: the Step 9b multipliers were reset from the post-audit on 20 May and swept on May 2026 by council folds on 21 August, and `party-bias.json` and `confidence.json` are fitted on May 2026. Scoring HEAD on May 2026 would be scoring the answer key.

**Stage replay.** The upstream stages, from the ward baseline to Final-B2, are taken from the polling-day file unchanged. The file records, for each ward, the Step 9b (Final-B3) Reform share before and after the lift, and the Final-C multipliers. Dividing out the multipliers and reversing the pro-rata lift recovers both intermediate stages exactly: re-applying Final-C to the recovered post-9b stage gives 1,623 again. The candidate then re-runs only the steps it changes. One limit: those upstream stages used the polls of 23 April to 5 May in the national swing step. The polling-day 56.0% used the same polls, so the comparison against it is like for like, but it is not a fully pre-26-April run. A full re-run on pre-lock inputs needs the engine's input files as they stood on 25 April, which the gitignored history file no longer holds.

**Data the candidate may be fitted on.**
- Election results with a polling date on or before 25 April 2026: the May 2025 county and unitary elections, and council by-elections from 2 May 2025 to 25 April 2026, both from `data/history/dc-historic-results.json` filtered by date.
- Polls with a fieldwork end date on or before 25 April 2026, from `data/polling/timeseries.json`.
- GE2024 results, and the engine's own constants as they stood at `5e85c84`.
- The polling-day forecast's own upstream output (no result enters it).

**Data the candidate may not use.** Any May 2026 result, any by-election after 25 April 2026, `data/calibration/party-bias.json`, `confidence.json`, `reform-regional-multiplier.json` and `reform-regional-multiplier.fitted.json` (all fitted on or adjusted from May 2026).

**What is changed, decided from the diagnosis before fitting.**
- C1, Step 9b: refit the per-tier regional multipliers. For each tier, multiplier = Reform's mean share in the pre-lock by-elections held in councils with no 2025 county anchor in that tier, divided by the mean Step 9b base target of that tier's 2026 wards. A tier with fewer than five such by-elections keeps its 7 May value.
- C2, the party adjustment (Final-C): aim the national-share calibration at a local-election target for the councils actually voting, instead of the Westminster poll. Per party, the target is the GE2024 share of each voting council, carried forward by the change in Westminster polling since GE2024 (polls to 25 April), times a local-to-Westminster ratio measured on the May 2025 county elections. Calibration strength stays at 0.65.

**Scoring.** C1 alone, C2 alone and C1 with C2 (the candidate) are each scored once and all three are reported. No parameter is changed after the scores are seen in this session. If the candidate does not beat 1,623, that is the result.

**Calibrations.** After any engine change every file in `data/calibration/` is refitted, as `CLAUDE.md` requires. For the candidate, the refits are written beside the live files under `data/calibration/candidate-2026-10-24/` and are not read by the published engine.
