# Results morning: council declarations the day after the poll

Written 3 November 2026. Register items R393 and R410 (Reports, `Website_Audits/roadmap.csv`).
The first live test is the six contests that poll on Thursday 12 November 2026.

## What it does

`scripts/results-morning.mjs` takes every contest file in `data/contests/local-byelections/`
that polled on a given day (yesterday by default) and, for each one:

1. finds the council's own declaration of result, from `data/results/declaration-sources.json`
   (a pinned URL for the ballot, or the council page the declaration is expected to join,
   scanned for a link naming the ward with "declaration" or "result");
2. reads it: HTML directly, PDF through `pdftotext -layout` (poppler); Word documents and
   scanned PDFs stay pending for a person;
3. matches every candidate on Democracy Club's list by surname and takes their count;
4. writes a `hand_verified_declaration` row to `data/history/byelection-appends.json` only when
   the counts reconcile, then reruns `finalise-october-byelection-results.mjs` for that day so
   the contest files carry the result before the next build.

"Reconcile" means all of these hold:

- every candidate is found once, the candidate table has exactly as many vote figures as
  candidates (so an unlisted candidate cannot hide), and the declared winner has the highest count;
- at least one arithmetic cross-check agrees and none disagrees: valid votes plus rejected papers
  equal the ballot papers issued; that total over the electorate matches the printed turnout at
  its printed precision; the printed majority equals first less second; or Democracy Club's
  counts, where it has them all, are identical.

A Democracy Club count that differs from a reconciled declaration is printed and recorded in the
row's note, never applied (Hartlebury: Reform UK 238 on the declaration, 248 on Democracy Club).

Everything else is listed as pending with the reason, and a person reads it.

## What it will not do

- Fetch a path robots.txt disallows, or anything on a host whose robots.txt it could not read.
  A disallow is a stop, not a workaround.
- Retry past a bot check or a 403. Wychavon puts a JavaScript check in front of its declarations
  and Halton has done so before; those contests stay pending for a hand read.
- Read a council more than three times in one run, or at all if a run read it less than an hour
  ago (`.cache/results-morning/last-fetch.json`).
- Run between 21:00 and 06:00 UK time on count night (`--allow-count-night` overrides it, and
  should not be used).
- Overwrite a row that is already hand verified. It never touches the model, forecasts or grading
  rules; the finaliser grades against the forecast as published.
- Use a spoofed user agent. It sends `ukelections-results-morning/0.1 (+https://ukelections.co.uk/about/)`.

## Running it

```bash
node scripts/results-morning.mjs --date=2026-11-12              # dry run: no election data changes
node scripts/results-morning.mjs --date=2026-11-12 --write      # merges reconciled rows
node scripts/results-morning.mjs --date=2026-10-29 --fixtures=tests/fixtures/results-morning
```

`--report=<file>` writes the rows and the pending list as JSON. The offline fixtures are the
22 and 29 October declarations, read on 3 November 2026; `tests/results-morning.test.mjs` checks
that they reproduce the hand-verified rows (Hartlebury Reform UK 238 and 25.29%; Calverley and
Farsley 5,804 papers and 32.20%) and that Bassetlaw and Dudley stay pending.

On the fixtures: 5 reconciled, 2 pending for a reason (Bassetlaw prints 1,304 papers issued
against 1,308 counted and no rejected total; Dudley's page marks the wrong row elected and has
no declaration sentence), and 4 with no saved declaration.

## Proposed cron (Tom's change; not applied)

vps-main, in the working checkout `/root/ukelections` that the Friday 09:00 sweep already
commits from. Two runs, six hours apart, so overnight counts are read in the morning and
Friday daytime counts in the afternoon:

```
30 7,13 * * 5 /opt/aidoge-monitoring/cron-alert.sh ukelections-results-morning 'cd /root/ukelections && git pull --ff-only --autostash && /usr/bin/node scripts/results-morning.mjs --write --report=/var/log/ukelections-results-morning.json >> /var/log/ukelections-results-morning.log 2>&1 && git add data/history/byelection-appends.json data/contests/local-byelections && (git diff --cached --quiet || (git commit -m "data: council declarations, results morning" && git push))'
```

Before it is applied:

1. **PDF extraction.** Confirmed present during the 3 November review: `/usr/bin/pdftotext`
   on vps main. Node is also present at `/usr/bin/node`. No installation was needed or performed.
2. **When it reaches the site.** A push to main ships at the 04:30 UTC nightly, so the Friday
   07:30 rows are live on Saturday morning. To have them live on Friday, the publisher would run
   a second time that day, for example `0 8,14 * * 5` with the nightly's own command. That is a
   second production deploy each Friday and is Tom's call.
3. **The tier name.** The rows say `hand_verified_declaration` because that is the tier the
   generator and the sweep protect, and the brief asked for it. They carry
   `verified_by: "scripts/results-morning.mjs"` and a note saying they were read by the script.
   If machine-read rows should carry their own tier, it has to be added to `isHandVerified` in both
   `build-local-byelections.mjs` and `refresh-byelections.mjs` and to `reviewPriority` in
   `scripts/lib/election-history.mjs`, or the nightly will let Democracy Club overwrite them.
4. **Committing to main from cron.** The Friday sweep already does this. If Tom would rather
   review each Friday's rows, drop the commit and push, and read the log and the report instead.

## The morning after a poll, by hand

1. `node scripts/results-morning.mjs` (dry run) and read the output: `+` reconciled, `.` pending.
2. For each pending contest, open the declaration and enter the row by hand, as for October.
3. A `!` line means Democracy Club disagrees with a reconciled declaration. Look at it; the
   declaration stands unless it is itself wrong.
4. When a council's link changes, update `declaration-sources.json`; a known URL for a ballot goes
   under `contests` and is used before any page scan.

## Where the 12 November declarations should appear

Read on 3 November 2026 with the script's user agent; robots.txt allows each page and none showed
a bot check. These are where each council posted its notices or earlier results, not a promise.

| Council | Page | Earlier format |
|---|---|---|
| Hyndburn (Huncoat) | download/election-results/ | PDF; the title sits beside a bare "Download" link |
| North East Lincolnshire (Croft Baker) | the ward's by-election page | not confirmed; crawl delay 30 seconds |
| Oldham (Failsworth West) | info/200732/election_notices, then the ModernGov results list | not confirmed |
| Staffordshire Moorlands (Cheddleton) | article/8764 | PDF, possibly a scan |
| Suffolk, Bosmere (Mid Suffolk count) | election-results, then election-notices | Liferay document; the May 2026 Bosmere result is excluded |
| Wigan (Hindley Green) | Council/Voting-and-Elections/Elections.aspx | PDF named by link text, not filename |


## Review safeguards added 3 November 2026

Council requests and Democracy Club requests have a 20 second timeout. A failed
council request is recorded in the report, leaves that contest unchanged and
allows the other contests to be read. A transport error, unreadable robots file,
HTTP error other than 404, or bot challenge makes the process exit with status 1.
An absent declaration remains pending and can be read on a later run for the same
polling date. Valid rows may still be saved locally when another council fails;
the proposed cron stops before committing or pushing if the process exits with
status 1. Read the report before repeating the write.

The hourly gap is checked before requesting robots. The council fetch timestamp
is saved before requesting the page, so an interruption cannot erase that guard.
A 403, 429 or recognised bot challenge stops further requests to that host in the
same run. Redirects are left pending: check and record the destination URL before
fetching it, so a redirect cannot bypass the destination's robots rules.

Node and pdftotext were confirmed present on vps main during this review. No
software, schedule or production data was changed there.

The durable sidecar is replaced by an atomic rename after a complete temporary
file has been written. Existing verified rows are left untouched. When replacing
a weaker row, absent turnout, electorate or rejected paper figures retain the
previous value and a provenance note. Saved fixtures cannot be used in write
mode. A later successful read retries finalisation even if the sidecar row was
already saved by an interrupted run.
