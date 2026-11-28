# Seats defended

`seats-defended.json` records which party was defending each council seat before
a contest. It covers two kinds of contest:

- `by_elections`: every council by-election with a contest file under
  `data/contests/local-byelections/`, keyed by ballot paper id.
- `scheduled`: every ward up on 7 May 2026 in a council that elects by thirds or
  halves, keyed by ballot paper id, with a per-council roll-up in
  `councils_2026`.

It is rebuilt by `node scripts/build-seats-defended.mjs` (`--check` compares
without writing). The nightly publisher does not run it: it needs the gitignored
Democracy Club history bundle, so rebuild it on a machine that has that file and
commit the output.

## The one rule

A party is recorded only when it is determined. Where held data leaves more than
one party possible, the record says `"confidence": "unresolved"`, carries no
party, and gives a `reason` and a `detail`. Nothing is estimated, and nothing is
filled in from what usually happens.

## Every record

| field | meaning |
|---|---|
| `confidence` | `determined` or `unresolved` |
| `holders` (by-elections) / `defended` (scheduled) | one party per seat, or `null` when unresolved |
| `basis` | which rule determined it (below) |
| `review_status` | which tier it came from (below) |
| `source` | the documents it rests on: address, and the date read for anything read by hand |
| `reason`, `detail` | why an unresolved record is unresolved |
| `held_data_check` | for records from a named source: whether the last-elected reading of held results `agrees`, `differs` or could not be worked out (`not_determined`) |
| `disagreement` | present when a named source and held results disagree, with both readings |

## Tiers, best first

1. `hand_verified_two_sources`: `data/contests/local-byelection-holders.json`,
   two independent sources each, party at the moment the seat fell vacant. The
   contest pages already publish these. Never overwritten.
2. `hand_recorded`: `data/seats/hand-recorded.json`, typed in from one named
   public source with the date it was read. The generator reads this file and
   never writes it, so a rebuild cannot lose an entry. Single-source entries say
   so in their note. They feed the scoreboard benchmark only; a contest page
   still needs the two-source holders file before it calls a result a gain or a
   hold.
3. `published_roundup`: the `previous` party in `data/results/local-byelections.json`,
   as published by ALDC and the per-date roundups that file cites (already shown
   on the site's by-election scorecard). Where it disagrees with the
   last-elected reading of held results, the record is **unresolved** with
   reason `sources_disagree`: that is usually a change of party, sometimes an
   error, and either way it needs the council's own record, not a choice made
   here.
4. `derived`: worked out from election results with elected flags, by the rules
   below.

## Rules for a by-election

The holder is the party of the councillor whose seat fell vacant, if a source
names it (tiers 1 to 3). Otherwise it is derived from the ward's own results:

- **Window.** Contests in the ward on its current boundaries (on or after the
  contest file's `boundary_set_start`) in the four years before polling day.
  Every councillor in scope serves a four-year term, so anyone sitting was
  elected, or re-elected, inside the window.
- **The window must fill the ward.** The ordinary elections in it must elect
  exactly the ward's number of seats. Fewer means a postponed election (members
  serving past four years) or a gap in the data; more means a casual vacancy
  filled at an ordinary election. Either is `seat_count_mismatch` or
  `no_election_in_window`.
- **One seat:** the last winner holds it, by-election winners included
  (`single_member_ward_last_election` or `single_member_ward_last_byelection`).
- **More than one seat:** determined only when every councillor elected in the
  window, at ordinary elections and by-elections, stood for the same party
  (`every_sitting_councillor_one_party`). Otherwise `two_or_more_parties_in_ward`:
  the ward's last result does not say whose seat fell vacant. Sheffield Southey
  is the worked example: Reform UK won the May 2026 seat, but the seat that fell
  vacant belonged to an independent.
- Labour and Co-operative counts as Labour. Every independent counts as
  "Independent". A residents' group or other small party keeps its own name, so
  two different local groups are never treated as one party.

## Rules for a scheduled thirds or halves contest (7 May 2026)

The seat up is the one filled at the ordinary election four years earlier (May
2022), adjusted for any by-election to that same seat:

- `base_election`: the 2022 contest in the ward elected as many councillors as
  are up in 2026, and every later ordinary contest elected the same number.
- `base_election_byelections_same_party`: as above, and every by-election in the
  ward since 2022 was won by the 2022 winner's party, so whichever seat it
  filled, the party defending is the same.
- Unresolved otherwise:
  - `byelection_may_have_filled_seat`: a by-election since 2022 was won by
    another party and could have filled the 2022 seat or another one.
  - `base_was_all_out`: 2022 was an all-out election in that ward. Which of its
    councillors retires in 2026 is set by the council's own retirement order,
    which held data does not record. The common convention (the lowest-placed
    winner serves the shortest term) is not applied: it is a convention, not a
    rule, and some councils resolve it differently.
  - `ordinary_contest_odd_size`: a later ordinary contest elected a different
    number (an all-out year on new boundaries, or a casual vacancy filled at the
    same time).
  - `casual_vacancy_in_2026`: more seats are up in 2026 than were filled in 2022.
  - `no_base_election`: no 2022 contest for the ward in held data.
  - `missing_elected_flags`.
- Fallback for every unresolved case: if everyone elected in the ward since
  2022 stood for one party, the seats defended are that party
  (`every_sitting_councillor_one_party`).

`councils_2026` adds up the seats defended for councils where every ward is
determined and compares the result with `data/results/may-2026/council-control.json`,
which estimates seats not up proportionally. **That file is not changed here.**
A disagreement is listed for the owner to check against the council's own
record. `does_not_reconcile` marks a council where the 2025 composition holds
fewer seats for a party than the seats determined as defended, which means a
change of party or a by-election since the composition snapshot; its derived
totals are not reliable.

## Changes of party

A change of party is recorded only from a named public source (tiers 1 to 3).
Otherwise a record shows the party the councillor was last elected for, and its
note says so.

## Coverage limit worth knowing

The history bundle holds only councils in scope for 7 May 2026, plus the
by-election sidecar from April 2026. Councils outside that scope (most Welsh and
Scottish councils, and English districts last elected in 2023) have no ward
history here, so their by-elections resolve only through a named source. The
Democracy Club ward file in the owner's Drive library was checked as a fuller
source and added two ballots out of 17,772, so it is not used.

## Sources and licences

| source | what it gives | licence or terms |
|---|---|---|
| Democracy Club results (the `dc-historic-results.json` bundle, the by-election sidecar, the May 2026 results file) | candidates, votes and elected flags | CC0 1.0 for raw fields; party metadata from the Electoral Commission under the Open Government Licence |
| `data/results/local-byelections.json` | previous party per by-election | facts as published by ALDC and the per-date roundups it cites, each listed per polling day |
| English Wikipedia | the vacating councillor or the defending party, for the entries in `hand-recorded.json` | CC BY-SA 4.0; robots.txt permits the pages read |

Not used: Andrew's Previews (Substack) and PollCheck both disallow AI crawlers
in robots.txt, so neither was fetched for this file (the two-source holders file
cites them from earlier hand reading). The Democracy Club candidates website
disallows all crawling in robots.txt, so it was not fetched either; only the
data already held from its API was used.
