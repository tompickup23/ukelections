# Council by-election forecaster ledger

`byelection-forecasts.json` holds every recorded forecast for a council
by-election, one entry per contest per forecaster. The page at
`/by-elections/scoreboard/` and the "how forecasts have done" strip on the
by-election pages are built from it by `scripts/lib/byelection-scoreboard.mjs`.

## The rule

An entry is **live** only if `captured_at` is before polls opened for that
contest: 07:00 UK time on polling day. Everything else is **retrospective**.
A bare date (`2026-12-09`) is read as the last moment of that day, so it proves
a live capture only if it is before polling day. A timestamp must carry its
zone (`2026-12-09T18:00:00Z` or `2026-12-09T18:00:00+00:00`). `npm test` fails
if any stored `status` disagrees with the rule.

## Entry fields

| field | meaning |
|---|---|
| `contest`, `ballot_paper_id`, `polling_day` | the contest, as in `data/contests/local-byelections/<contest>.json` |
| `forecaster` | a key in `forecasters` |
| `called_party` | the party the forecaster named as most likely to win, as it named it |
| `called_leader` | that party pooled into one of the six lanes (Reform UK, Labour, Conservative, Liberal Democrats, Green Party, Others) |
| `win_chance` | the chance the forecaster gave its favourite, 0 to 1, or null if it published none |
| `shares` | published vote shares, 0 to 1, or null |
| `captured_at` | when the forecast was recorded |
| `source` | the file or URL the entry was taken from |
| `capture_method` | `site_snapshot`, `site_rebuild`, `research_export`, `hand_recorded` or `supplied_by_forecaster` |
| `basis` | `as_published`, `rebuilt_after_poll` or `back_test` |
| `status` | `live` or `retrospective`, always the value the rule gives |
| `note` | anything a reader needs to know about the entry |

`site_rebuild` is this site's forecast where no copy of the page as published
was kept: the contest file as rebuilt after polling day. It is always
retrospective, because a rebuild can draw on by-elections held after the
contest.

## This site's forecasts

```bash
node scripts/scoreboard-log.mjs            # log every contest whose polls have not opened
node scripts/scoreboard-log.mjs --dry-run  # say what would change
```

For a contest still ahead, the site's entry is replaced with the forecast the
contest file holds now, stamped with the time of the run. Once polls open the
entry is never touched again. Run it, and commit the ledger, at least once
between a contest's statement of persons nominated and its polling day, or the
contest has no live entry. A past contest with no entry is filled once from
`data/cards/published-byelection-forecasts.json` where a snapshot exists, and
from the rebuilt contest file otherwise.

## Adding an outside forecaster

Only with a public, dated source, or with the forecaster's agreement. Never copy
from a site whose terms forbid it.

1. Add the forecaster to `forecasters`, keyed by a short id:

   ```json
   "example-forecaster": {
     "name": "Example Forecasts",
     "kind": "forecaster",
     "url": "https://example.org/",
     "permission": "Agreed by email, 3 December 2026"
   }
   ```

   Organisations only. Never a person's name.

2. Add each call with its source and the time it was published:

   ```bash
   node scripts/scoreboard-log.mjs --add --forecaster=example-forecaster \
     --contest=gosport-hardway-2026-12-03 --party="Liberal Democrats" \
     --chance=0.55 --captured-at=2026-12-02T18:00:00Z \
     --source=https://example.org/2026-12-03 --method=hand_recorded
   ```

   Use `--method=supplied_by_forecaster` when the forecaster sent the call.
   `--shares='{"Liberal Democrats":0.41,"Reform UK":0.33}'` records shares if
   they were published. The script refuses an unknown forecaster, a missing
   source, a timestamp without a zone and a second entry for the same contest.

3. Run `npm test` and commit.

## Corrections and removals

A forecaster can ask for an entry to be fixed or removed through
info@ukelections.co.uk or the contact page. Edit or delete the entry by hand,
say what changed in the commit message, and run `npm test`.
