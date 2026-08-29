# Decision memo: the small-party win probabilities

For Tom. Written 29 August 2026. Nothing published has been changed.

## The short version

**The defect we were going to fix is not there.** The small-party tail on the
by-election pages reproduces as calibrated, not as eight times too confident.
Capping per-party sigma would move public numbers to correct a problem the data
does not support, which is the one outcome worse than leaving it alone.

**There is a real integrity problem on the same pages, and it is a different
one.** On 39 of the 122 live contests, a party that is standing is dropped from
the projection entirely, with no lane, no share and no note. Three contests in
the back-test were won by a party in exactly that position, one of them on 54.2%
of the vote.

My recommendation is therefore: **do not cap sigma, do not restate any
probability, and fix the dropped-party defect instead.** That is a change that
adds numbers rather than moving them, so it needs no correction notice.

## What the earlier finding said, and what recomputation shows

The note in memory read: "across 217 lanes projected at 5 to 10% the model
claimed 2.0% and 0.5% actually won", roughly eight times the empirical rate.

That figure **reproduces almost exactly**, and it is being read wrongly. It bins
lanes by projected vote **share**, not by claimed probability:

| Lanes projected at 5 to 10pp of the **vote**, since May 2025 | |
|---|---:|
| Lanes | 218 (the note said 217) |
| Mean win probability we claimed | 2.1% (the note said 2.0%) |
| Actually won | 0.5%, which is **1 lane out of 218** |
| 95% interval on that outcome | **0.1% to 2.6%** |

The claim of 2.1% sits inside the interval the outcome supports. The whole
finding rests on a single observed win, and the ratio is 4x rather than 8x even
taken at face value. Over the full corpus the same band points the other way:
705 lanes, claimed 1.6%, actually won 2.4%. We were understating them.

Binned the way a reliability diagram should be binned, by the probability
actually claimed, the tail is fine:

| Claimed | Lanes | Claimed | Observed | 95% interval | Verdict |
|---|---:|---:|---:|---|---|
| 0 to 5% | 1,439 | 1.4% | 2.1% | 1.5 to 3.0% | claim too **low** |
| 5 to 10% | 332 | 7.2% | 6.9% | 4.7 to 10.2% | honest |
| 10 to 20% | 353 | 14.9% | 14.2% | 10.9 to 18.2% | honest |
| 20 to 30% | 250 | 24.5% | 19.2% | 14.8 to 24.5% | honest, just |
| 30 to 40% | 170 | 34.7% | 33.5% | 26.9 to 40.9% | honest |
| 40 to 50% | 164 | 45.1% | 47.0% | 39.5 to 54.6% | honest |
| 50 to 60% | 138 | 55.0% | 56.5% | 48.2 to 64.5% | honest |
| 60 to 70% | 119 | 65.0% | 69.7% | 61.0 to 77.3% | honest |
| 70 to 80% | 112 | 74.8% | 83.9% | 76.0 to 89.6% | claim too **low** |
| 80 to 90% | 144 | 85.4% | 81.3% | 74.1 to 86.8% | honest |
| 90 to 100% | 141 | 95.1% | 88.7% | 82.4 to 92.9% | claim too **high** |

All 3,362 lanes, whole corpus. Where the model is dishonest at all, it is
**overconfident at the top**, not at the bottom: a 95% claim is worth about 89%.
The deep tail is if anything understated.

The published record checks out. "Where we said 70% or better we were right
about 78% of the time" recomputes as **38 of 48, 79.2%**, interval 66 to 88. The
headline "136 of 227, 60%" recomputes as 134 of 224 on the committed archive,
which is the same number two contests behind the nightly build. Nothing on the
live page needs correcting.

## The problem that is actually there

`projectContest()` drops any party standing where it has no prior result in that
ward and the corpus cannot price an entry share. The dropped party is recorded
in `unpriced_parties` and rendered nowhere. The contest page builds both its
projection table and its ranges table from the priced parties only.

| | |
|---|---:|
| Live contests with at least one dropped party | **39 of 122** |
| Back-test contests, since May 2025 | 71 of 224 (31.7%) |
| Median vote share the dropped party then took | 3.9pp |
| 90th percentile | 17.2pp |
| Largest | **54.2pp** |
| Contests **won** by a dropped party | **3** |

Cotswold St Michaels shows the mild form: the page says five candidates are
standing, the projection lists four, Labour is missing, Labour polls 2.5%. Great
Yarmouth Caister South shows the serious form: Great Yarmouth First took 54.2%
and won, and the projection published a set of chances summing to 100% that did
not include them.

A reader cannot detect this. The probabilities sum to 100%, so the table looks
complete. That is worse than a number that is somewhat too high, because a too
high number is at least visible and arguable.

## The options on the small-party numbers

**A. Cap per-party sigma and restate.** Moves win probabilities on up to 122
contest pages plus their share cards, requires a dated correction notice and the
previous values preserved. **Recommend against.** The measurement does not
support it, and a sigma sweep shows the current 1.75 is the only value in the
range where no band's claim escapes its interval on the published window
(reliability error 6.33pp at the leader level, 2.80pp at lane level, zero bands
outside at either). Moving it would make calibration worse, not better.

**B. Keep the numbers, add a caveat naming the tail as uncalibrated.**
**Recommend against, because it would now be false.** The tail *is* calibrated.
Printing a warning that the data contradicts is its own integrity problem.

**C. Suppress win probabilities below a threshold.** Would remove roughly two
thirds of the lanes on every contest page. **Recommend against.** They are the
best-calibrated part of the curve. Suppressing them to fix a problem that is not
there costs the reader real information.

**D. Change nothing published, publish the fuller evidence, and fix the dropped
parties.** **This is the recommendation.**

## What I recommend, and why

1. **Change no published probability.** Nothing in the recomputation justifies
   it, and a quiet walk-back of a number that turns out to have been right is
   the worst available outcome for a site whose credibility anchor is its
   published backtests.

2. **Ship the full-range reliability table** as evidence, on
   `/methodology/local-by-elections/` or under the existing table on
   `/by-elections/local/`. The current three-band table is honest about what it
   measures but structurally cannot report on three quarters of the numbers on
   the same page, and we can now show that those numbers hold up. This is a
   strengthening of the record, not a correction, so no correction notice is
   needed. It also pre-empts the obvious challenge, which is that the small
   numbers were never checked.

3. **Fix the dropped parties**, in this order:
   - Render them. A row reading "standing, not priced" with no number is honest
     and costs nothing. This is additive, so again no correction notice.
   - Then decide separately whether to price them at all. Giving them a floor
     entry share would change published shares and probabilities and **would**
     need a correction notice, so it is a second decision, not part of the fix.

4. **If you want one number changed**, the candidate is the top end, not the
   tail: 90%-plus claims run about six points hot on 141 lanes. That is a real,
   measured overstatement. It is also the band that matters least in practice,
   because the page names a favourite either way, and correcting it means
   refitting the inflation factor and moving every contest page. My view is that
   it is not worth a restatement on its own; fold it into the next scheduled
   refit after a real election, and note the direction on the methodology page
   in the meantime.

## What I have not done

- Not changed any published figure, page, template or data file.
- Not merged PR #84 (astro 6.4.8 to 7.2.8, a **major** bump). CI's green tick
  does not cover it: `deploy.yml` mirrors the canonical build rather than
  building, so nothing in CI has ever run an Astro 7 build of this site. It
  needs a build on vps-main in a scratch checkout first.
- Not filled in any previous holder. Nine are verified; the rest stay absent and
  the pages keep saying so, which is the right conduct.

## Reproducing all of this

```bash
node scripts/audit-probability-calibration.mjs
```

Offline, reads the committed archives, writes
`data/calibration/byelection-reliability.json`, and exits non-zero if a
structural bound fails. It currently exits non-zero on the three
`winner_had_no_lane` contests, which is the defect above and is meant to fail
until it is fixed.

`tests/probability-reliability.test.mjs` covers the maths. Every guard in it has
a fixture built to make it fire, and each was checked by breaking the guard and
confirming the fixture fails.
