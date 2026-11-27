# Live by-election forecasts from the ward model

Research only. Nothing on the site, the publisher or any cron reads this folder. The rules are fixed in `LIVE_SPEC.md`, committed before the first forecast.

## The weekly command

Run on this Mac, from `research/ward-model-2026-11/`, any day before the coming Thursday's polls open (07:00 UK time):

```bash
git fetch origin && scp vps-main:/root/ukelections-polling-publisher/data/polling/timeseries.json /tmp/uke-timeseries.json && uv run python live_forecast.py --polls=/tmp/uke-timeseries.json
```

Then commit `live/` and push the same day (see "Proving the time" below).

- Without `--polls`, the runner uses `data/polling/timeseries.json` on `origin/main`. That file is only as fresh as the last hand sync: on 27 November 2026 its latest poll was dated 6 November, exactly at the anchor rule's 21 day limit. The nightly publisher on vps-main refreshes the same file every night without committing it, so the `scp` above (a read) gives a current anchor. Whichever file is used is copied into `live/inputs/timeseries-<sha>.json` and named with its sha256, `generated_at` and latest poll date in every record.
- Contest files are always read from `origin/main` (`--ref` to change it). Fetch first.
- `--dry-run` prints the forecasts and writes nothing except the polls copy.
- The runner refuses to write if the code in this folder (outside `live/`) has uncommitted changes, so every record names the commit that produced it.
- One run takes about two and a half minutes (six lane fits on about 17,600 training contests).

## Where the output goes

`live/live_forecasts.json`:

- `records`, keyed by ballot paper id: one per contest the runner has seen before its polls opened. A forecast record holds `polling_day`, `polls_open_at`, `captured_at` (UTC), `model_version` (`ward-model-2026-11/C2`), `code_commit`, the six lane `shares`, `called_leader`, `win_chance` per standing lane, the candidates and their lanes, the national anchor used, and `inputs` (contest file commit, polls file and its sha256, sha256 of the feature file, base dataset and settings). A skipped record holds `reason` and `reason_text` instead of shares.
- `last_run`: the latest run's facts (anchor, training rows per lane, which contests were forecast and skipped).

A rerun before polls open replaces a contest's record. Once polls open the record is frozen: `merge_records` raises rather than change it, and refuses to create a record for a contest whose polls have opened. `live_test_freeze.py` tests both:

```bash
uv run python live_test_freeze.py
```

A record whose contest later disappears from `origin/main` before polling day (withdrawn, uncontested) is left as it is; drop it by hand with a note in the commit if that happens.

## First run, 27 November 2026

See the PR description and `live/live_forecasts.json` for the figures. Sixteen contests had polling days after 27 November on `origin/main`; four got a forecast and twelve were skipped (five outside England, two with no ward code in the feature file, six with no statement of persons nominated on Democracy Club yet). Skipped contests are retried on every run until their polls open, so contests on 10 and 17 December will be forecast once their statements appear on `main`.

## Reproduction check

`live_check.py` runs the same code as of 1 October and 1 November 2026 for the by-elections polling in those months and compares with the cached forward only C2 back-test (`cache/bridge_level_predictions.pkl`). Output: `results/live_check.json`. Results are in the PR description. Past-dated runs are never written to `live/` and never offered as live.

## Getting the entries onto the scoreboard on `main`

`scripts/scoreboard-log.mjs` on `origin/main` (as of PR 198) cannot import these as they stand:

- `--add` refuses the research forecaster outright ("Use the logger, not --add, for this site's own forecasts"), and is for one hand-recorded call at a time.
- `--import-research` reads `by_ballot[<ballot>].model_shares` and `meta.exported_at`, writes every entry with `basis: "back_test"`, the back-test note and `win_chance: null`, uses one capture time for the whole file, and never replaces an existing entry. Live records need their own `captured_at` each (frozen records come from earlier runs), a win chance, a non back-test basis, and replacement of the same contest's earlier live entry while polls are still closed.
- The ledger's `uk-elections-research-model` forecaster is described as "trained only on results before 7 May 2026" with "every entry a back-test". The live runner is a different model (C2, retrained on every contest before the run date), so it should be a forecaster of its own, not new entries under that one.

**Smallest change on `main`** (not made here):

1. Add a forecaster `uk-elections-research-model-live` to `forecasters` in `data/scoreboard/byelection-forecasts.json`: name "UK Elections research ward model (live)", kind `forecaster`, url this PR, permission "Own research", a description saying it is the C2 ward model retrained before each run, forecasts written before polls open and frozen after.
2. Add `--import-research-live=<file>` to `scripts/scoreboard-log.mjs`, a sibling of `importResearch` (about 30 lines) that, for each record in `records` with `status == "forecast"` and a contest file:
   - builds the entry with `base(d, "uk-elections-research-model-live")`, `called_party: record.called_leader`, `win_chance: record.win_chance[record.called_leader]`, `shares: positiveShares(record.shares)`, `captured_at: record.captured_at`, `source: "<file>@<record.code_commit>"`, `capture_method: "research_export"`, `basis: "as_published"`, and a note naming the model version;
   - replaces an existing entry for the same ballot and forecaster only under `mergeSiteEntries`' rule (a live entry beats a retrospective one; of two live entries the later capture wins), so a stale or re-imported file never overwrites a later capture, and a frozen record re-imported is a no-op.
   `finish()` already sets `status` from `captured_at`, so the live or retrospective verdict stays the ledger's own rule.
3. Copy `live/live_forecasts.json` to `data/scoreboard/research-ward-model-live.json` on `main` (as the back-test export was copied) and run the import, then `npm test`.

### Proving the time

`captured_at` is this Mac's clock. What makes it credible on the scoreboard is a commit pushed to GitHub before polls open: the push time of the branch carrying `live/live_forecasts.json` is independent evidence. Commit and push each run the same day; a record whose push is after polls opened should be treated as retrospective whatever its `captured_at` says.

## Running it on the server instead of this Mac

The runner itself needs only three local files, Python and a git checkout:

| File | Size | Where it comes from |
|---|---|---|
| `cache/bridge_level_dataset.pkl` | 16 MB | built on this Mac from the Drive feature matrix, DC history and polls (`prepare.py`, `backtest_b_anchor.py`, `bridge_level_anchor.py`) |
| `cache/fit_meta.pkl` | 2 KB | `fit_predict.py` |
| `cache/drive07/universe_features_v2.csv` | 6 MB | the Drive feature file (`doge:`), see `fetch_inputs.sh` |

To run on vps-main: copy those three files once into a research checkout there (not the publisher checkout, which resets nightly), install `uv` and the locked environment (`uv sync`), point `--ref` at a ref that checkout can fetch and `--polls` at the publisher's `data/polling/timeseries.json`, and add a weekly job that runs the command and commits and pushes `live/`. vps-main has Python already; vps-news must not be used. Adding that job is a cron change, so it needs Tom's go-ahead and is not done here. The cached dataset is frozen at the C2 study: new scheduled elections (May 2027) need the dataset rebuilt on this Mac, where the Drive matrix and DC history live, before the server copy is refreshed.
