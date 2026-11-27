# Council by-election swing variant: pre-registered shadow test

Protocol written 27 November 2026, before any shadow forecast was generated and
before the results of the six council by-elections polled on 26 November 2026
were in this repository. This document is committed on its own, ahead of the
code and the forecast file, so that its commit time is the evidence that the
variant, the comparison, the scoring and the decision rule were fixed first.
Nothing below may be changed after that commit except by a dated addendum at
the foot of this file that leaves the original text in place.

This is research only. It changes no published forecast and does not touch the
engine (`scripts/lib/local-byelection-model.mjs`). No page on the site reads the
shadow file.

## Why

A diagnosis on 26 November 2026 found the published council by-election
forecasts put Reform UK 4.2 points too high on average across 37 contests from
October 2026, too high in 27 of them. It named two causes: the swing is a 365
day trailing median that lags a falling trend, and Restore Britain now stands in
many contests, where Reform UK's change is larger. Source: Reports repo,
`Website_Audits/UKE_ByElection_Reform_Overstatement_2026-11-26.md` (branch
`uke/byelections-accuracy-2026-11-26`, PR 901), with the scratch script
`UKE_ByElections_2026-11-26_work/scripts/variants.mjs`.

A variant was tested leave one out on the same rounds it was chosen on, so its
result there is not evidence. This protocol scores it on contests it has never
seen.

## The variant, exactly as tested

Taken from `variants.mjs` as written, not improved. Two changes to the current
model, applied together.

1. **A 180 day window.** `estimateSwing` is called exactly as the published
   generator calls it (same era, same Reform UK entering flag, the same
   stratum fallbacks, `MIN_STRATUM_N = 8`, `MIN_PARTY_N = 5`), except that
   `windowDays` is 180 instead of 365.
2. **Reform UK measured by Restore Britain status.** After that estimate, Reform
   UK's log-odds shift and Reform UK's entry share are replaced by values
   measured from a pool of corpus by-elections that:
   - polled strictly before the contest's polling day, and within 180 days of
     it;
   - share the contest's baseline era (`baselineEra` of the baseline date);
   - have the same Restore Britain status as the contest.

   Within that pool, the shift is the median of `logit(to) - logit(from)` over
   contests where Reform UK had at least 2% both times; the entry share is the
   median Reform UK share over contests where Reform UK had under 2% at the
   baseline and at least 2% at the by-election. Each replaces the current value
   only if it rests on at least five contests. Otherwise the 180 day estimate
   from step 1 stands. No other party is touched.

A pool contest's Restore Britain status is, as in `variants.mjs`, whether
Restore Britain took at least 2% there.

**The one adaptation, forced by forecasting ahead of the result.** In the
backtest the scored contest's own Restore Britain status was also read from its
result (at least 2%). A real forecast cannot see the result, so for the contest
being forecast the status is whether a Restore Britain candidate is on the
ballot. That is the only difference from what was tested, and it is made
because the tested rule cannot be applied before polling day.

Everything else is the published generator's own method: the baseline shares,
the field of parties standing, the era, the Reform UK entering flag
(`reform_entered` when Reform UK is standing and had under 2% at the baseline)
and `projectContest`, all imported unchanged from
`scripts/lib/local-byelection-model.mjs`. Only by-elections polled strictly
before a contest's polling day are used for that contest.

## What it is compared with

The published forecast as shown before polling day: `central_pct` for the
contest's slug in `data/cards/published-byelection-forecasts.json`, the same
record the public post-mortem grades. A contest with no entry there is not
scored, because there is nothing published to compare.

For diagnosis only, the shadow file also carries the current engine run on the
same inputs on the same day, so any difference can be traced to the variant
rather than to a later corpus. That figure plays no part in the decision.

## Which contests count

All of these must hold:

1. Polling day on or after 26 November 2026.
2. A shadow forecast for it was written to
   `data/transparency/byelection-shadow-variant.json` while the repository held
   no result and no declaration for it. The file records the generation time,
   and git records when it was committed. A shadow forecast is never
   overwritten or regenerated; the script refuses.
3. A published forecast exists for it, as above.
4. A declared result with every candidate's votes, as the contest file's
   `result` block holds. Scottish STV declarations without comparable counts
   are not scored, as on the public post-mortem.

Contests that miss a shadow forecast because nobody ran the script before the
result arrived are left out, never filled in afterwards.

## Scoring

For each counted contest, over the parties with a share above zero in the
declared result, with any party absent from a forecast counted at 0%:

- **Mean absolute error per party**, in percentage points, for the shadow and
  for the published forecast. The headline is the mean of those per-contest
  figures across contests, as in `variants.mjs`.
- **Winner called**: the party with the highest central share is the party that
  won.
- **Reform UK signed error**: forecast minus actual, in points, for contests
  where Reform UK stood. The headline is its mean.
- **Count of contests** scored, and how many of them had Restore Britain on the
  ballot.

## Decision rule for mid January

Review on or after 15 January 2027, on every counted contest polled from 26
November 2026 to 14 January 2027 whose result is in the repository by then.

**The variant justifies the next step only if all of these hold:**

1. At least 15 contests are counted.
2. Its mean absolute error is lower than the published forecasts' by at least
   0.3 points.
3. Its per-contest error is lower than the published forecast's in more than
   half of the counted contests.
4. It calls at least as many winners as the published forecasts.
5. Its mean Reform UK signed error is smaller in absolute size than the
   published forecasts'.

The next step is not shipping it straight onto the site. It is the engine
change the house rules require: the variant in `estimateSwing`, every
calibration refitted, and a hold out, on one branch as one PR for Tom, with the
public post-mortem still grading forecasts as published.

**It does not justify shipping if any condition fails.** If fewer than 15
contests are counted, there is no decision in January: scoring continues on the
same frozen variant and the same rule is applied at the first review after the
count reaches 15. If the count reaches 15 and any of conditions 2 to 5 fails,
the variant is not shipped, and that result is reported here as it stands. A
failed variant is not tuned and rescored on the same contests; a new variant
needs a new protocol and new contests.

## Running it

```bash
node scripts/shadow-byelection-variant.mjs           # print the running score table
node scripts/shadow-byelection-variant.mjs --write   # add shadow forecasts for contests that lack one
```

`--write` only adds forecasts for contests that have a published forecast in
their contest file, no result and no declaration, and no shadow forecast yet.
Nothing in the nightly runs it, so it needs running by hand after nominations
close for each round, and the output committed, before results arrive.
