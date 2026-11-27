// byelection-barometer.mjs
//
// A descriptive monthly read of the council by-election swing corpus. It
// changes no forecast: it summarises the same observations the local
// by-election model already builds (scripts/lib/local-byelection-model.mjs,
// buildSwingCorpus), and nothing here feeds back into that model.
//
// THE RULES, fixed before any month was computed, and the same for every party
// -----------------------------------------------------------------------------
//
// 1. Which contests count. A council by-election for which the corpus also
//    holds the same ward's previous ordinary result. That pairing, the STV
//    exclusion and the treatment of multi-member wards are the model's own
//    (buildSwingCorpus); this file does not re-pair anything.
//
// 2. Which parties a contest counts for. A party counts in a contest only if it
//    stood both times: 2% or more of the vote in the previous ordinary result
//    and 2% or more in the by-election. 2% is the model's own line for "stood"
//    (PRESENT in local-byelection-model.mjs), reused so the barometer and the
//    model agree on what a contest is.
//
// 3. Which parties are shown. Every party lane the model keeps, except
//    "Independent" and "Other". Those two are pools of many unrelated
//    candidates and groups, so a change "where the party stood before" has no
//    single party behind it. A party that never appears in a previous ordinary
//    result in the corpus cannot meet rule 2 in any month, so it has no line,
//    and the page says so rather than loosening the rule.
//
// 4. The measure. For each party and calendar month (by polling day), the
//    MEDIAN change in log-odds of the party's share between the previous
//    ordinary result and the by-election. This is exactly the quantity the
//    model's swing estimator takes the median of (estimateSwing), on a monthly
//    rather than a rolling window. The median is used because a single ward
//    with a strong local factor cannot move it far.
//
//    Readers see the same figure as percentage points for a stated starting
//    share: STARTING_SHARE, 25%, the share the model itself uses to give its
//    log-odds shift a readable equivalent. A log-odds change moves a party on
//    25% by a different number of points than one on 5% or 50%; the raw figure
//    is published beside it.
//
// 5. The minimum. A party's month is shown only when at least MIN_CONTESTS (5)
//    contests in that month meet rule 2 for that party. Below that the month is
//    blank: never interpolated, never carried forward, and the line breaks.
//    5 is the model's own MIN_PARTY_N, the count below which the model will not
//    give a party a swing of its own. It was taken from the model, not chosen
//    by looking at which months it hides.
//
// 6. The window. Months from July 2024, the month of the general election,
//    which is one of the two boundaries the model already uses to divide the
//    party system (baselineEra). The latest month is shown even if it is still
//    in progress, and is labelled with its count like every other month.
//
// 7. Verification. Each month records how many of its contests carry the
//    review status "hand_verified_declaration" (the result was checked against
//    the returning officer's own declaration) and how many carry
//    "hand_verified_two_sources". Everything else is as Democracy Club
//    published it.
//
// THE ENTRANT BLOCK, one rule for every party
// -----------------------------------------------------------------------------
//
// A party lane is "new to the corpus" when its first appearance anywhere in the
// corpus, as a by-election candidate or in a previous ordinary result, falls in
// the window (on or after WINDOW_FROM). It qualifies for the block when it has
// stood (any vote, from the nomination list) in at least MIN_CONTESTS
// by-elections in the corpus. For each qualifying entrant, and for each party
// shown on the barometer that is not itself an entrant, the block compares the
// median change (rule 4, contests meeting rule 2) in by-elections with the
// entrant on the ballot against those without it, using only by-elections from
// the entrant's first appearance onwards, so both sides cover the same months.
// Either side with fewer than MIN_CONTESTS contests is left blank. Entrants are
// listed alphabetically.

import { PARTIES, canonParty, invLogit, logit } from "./local-byelection-model.mjs";

export const PRESENT = 0.02;
export const MIN_CONTESTS = 5;
export const STARTING_SHARE = 0.25;
export const WINDOW_FROM = "2024-07-01";
export const POOLED_LANES = new Set(["Independent", "Other"]);
export const SHOWN_LANES = PARTIES.filter((p) => !POOLED_LANES.has(p));

export function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Percentage points a log-odds change moves a party starting on `start`. */
export function pointsAt(shift, start = STARTING_SHARE) {
  if (shift === null || shift === undefined) return null;
  return (invLogit(logit(start) + shift) - start) * 100;
}

const round = (x, dp) => (x === null ? null : Number(x.toFixed(dp)));

/** True when the party stood both times under rule 2. */
export function stoodBoth(row, party) {
  return (row.from[party] || 0) >= PRESENT && (row.to[party] || 0) >= PRESENT;
}

export function changeFor(row, party) {
  return logit(row.to[party]) - logit(row.from[party]);
}

function monthsBetween(from, to) {
  const out = [];
  let [y, m] = from.slice(0, 7).split("-").map(Number);
  const [ty, tm] = to.slice(0, 7).split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

function summariseChanges(changes) {
  const n = changes.length;
  const shift = n >= MIN_CONTESTS ? median(changes) : null;
  return {
    contests: n,
    median_logit_change: round(shift, 4),
    median_points_at_start: round(pointsAt(shift), 1),
  };
}

/**
 * @param {Array} corpus rows from buildSwingCorpus
 * @param {Map<string, {review_status?: string, field?: Set<string>}>} meta per ballot id
 */
export function buildBarometer(corpus, meta = new Map()) {
  const inWindow = corpus.filter((c) => c.date >= WINDOW_FROM);
  const latest = inWindow.at(-1)?.date ?? null;
  const months = latest ? monthsBetween(WINDOW_FROM, latest) : [];

  const monthRows = months.map((month) => {
    const rows = inWindow.filter((c) => c.date.slice(0, 7) === month);
    const status = (s) => rows.filter((c) => meta.get(c.ballot_paper_id)?.review_status === s).length;
    const parties = {};
    for (const party of SHOWN_LANES) {
      const counted = rows.filter((c) => stoodBoth(c, party));
      const s = summariseChanges(counted.map((c) => changeFor(c, party)));
      parties[party] = {
        ...s,
        hand_verified_declaration: counted.filter((c) => meta.get(c.ballot_paper_id)?.review_status === "hand_verified_declaration").length,
      };
    }
    return {
      month,
      contests: rows.length,
      hand_verified_declaration: status("hand_verified_declaration"),
      hand_verified_two_sources: status("hand_verified_two_sources"),
      parties,
    };
  });

  // A party with at least one shown month gets a line; the rest are listed
  // with the reason, so the page can say why they are absent.
  const shown = SHOWN_LANES.filter((p) => monthRows.some((m) => m.parties[p].median_logit_change !== null));
  const notShown = SHOWN_LANES.filter((p) => !shown.includes(p)).map((party) => {
    const everPrior = corpus.some((c) => (c.from[party] || 0) >= PRESENT);
    const stoodBy = inWindow.filter((c) => (c.to[party] || 0) >= PRESENT).length;
    return {
      party,
      by_elections_stood_in_window: stoodBy,
      reason: everPrior
        ? `No month in the window has ${MIN_CONTESTS} or more contests where it stood both times.`
        : "It stands in no previous ordinary result in the record, so it has no contest where it stood before.",
    };
  });

  return {
    window_from: WINDOW_FROM.slice(0, 7),
    latest_contest_date: latest,
    contests_in_window: inWindow.length,
    parties_shown: shown,
    parties_not_shown: notShown,
    months: monthRows,
    entrants: buildEntrants(corpus, meta, shown),
  };
}

/** On the ballot at all: the nomination list where we have it, else 2%. */
function onBallot(row, party, meta) {
  const field = meta.get(row.ballot_paper_id)?.field;
  if (field) return field.has(party);
  return (row.to[party] || 0) >= PRESENT;
}

export function buildEntrants(corpus, meta, shownParties) {
  const firstSeen = {};
  for (const c of corpus) {
    for (const party of SHOWN_LANES) {
      if ((c.from[party] || 0) > 0 && (!firstSeen[party] || c.prior_date < firstSeen[party])) firstSeen[party] = c.prior_date;
      if (onBallot(c, party, meta) && (!firstSeen[party] || c.date < firstSeen[party])) firstSeen[party] = c.date;
    }
  }
  const candidates = SHOWN_LANES.filter((p) => firstSeen[p] && firstSeen[p] >= WINDOW_FROM).sort((a, b) => a.localeCompare(b));
  const entrants = [];
  for (const entrant of candidates) {
    const since = corpus.filter((c) => c.date >= firstSeen[entrant]);
    const stood = since.filter((c) => onBallot(c, entrant, meta));
    if (stood.length < MIN_CONTESTS) {
      entrants.push({ party: entrant, first_seen: firstSeen[entrant], by_elections_stood: stood.length, qualifies: false, comparisons: [] });
      continue;
    }
    const comparisons = shownParties
      .filter((p) => !candidates.includes(p))
      .sort((a, b) => a.localeCompare(b))
      .map((party) => {
        const counted = since.filter((c) => stoodBoth(c, party));
        const withE = counted.filter((c) => onBallot(c, entrant, meta)).map((c) => changeFor(c, party));
        const withoutE = counted.filter((c) => !onBallot(c, entrant, meta)).map((c) => changeFor(c, party));
        return { party, with_entrant: summariseChanges(withE), without_entrant: summariseChanges(withoutE) };
      });
    entrants.push({
      party: entrant,
      first_seen: firstSeen[entrant],
      by_elections_stood: stood.length,
      by_elections_since_first_seen: since.length,
      qualifies: true,
      comparisons,
    });
  }
  return entrants;
}

/** Canonical parties on a by-election's nomination list. */
export function fieldOf(row) {
  return new Set((row?.candidates || []).map((c) => canonParty(c.party_name ?? c.party)));
}

// -----------------------------------------------------------------------------
// The page's opening sentence, generated from the JSON, never typed. It names
// no individual and characterises no party: it reports each party's figure for
// the latest month, in alphabetical order, with the count behind it.
// -----------------------------------------------------------------------------

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthName = (m) => `${MONTH_NAMES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const PROSE = { Conservative: "the Conservatives", "Green Party": "the Green Party", "Liberal Democrats": "the Liberal Democrats", SNP: "the SNP" };
export const partyInProse = (p) => PROSE[p] ?? p;
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

export function describePoints(v) {
  if (v === null || v === undefined) return null;
  const a = Math.abs(v).toFixed(1);
  if (a === "0.0") return "no change";
  return `${v > 0 ? "up" : "down"} ${a} ${a === "1.0" ? "point" : "points"}`;
}

function joinList(items) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

export function barometerSummary(doc) {
  const last = doc.months.at(-1);
  if (!last) return "";
  const parties = [...doc.parties_shown].sort((a, b) => a.localeCompare(b));
  const shown = parties.filter((p) => last.parties[p].median_logit_change !== null);
  const blank = parties.filter((p) => last.parties[p].median_logit_change === null);
  const start = Math.round(doc.starting_share * 100);
  const lead = `In ${monthName(last.month)}, the latest month, ${last.contests} council ${last.contests === 1 ? "by-election was" : "by-elections were"} paired with the ward's previous ordinary result.`;
  if (!shown.length) {
    return `${lead} No party stood before in ${doc.min_contests} or more of them, so the month is blank for every party.`;
  }
  const parts = shown.map((p) => `${partyInProse(p)} ${describePoints(last.parties[p].median_points_at_start)} (${last.parties[p].contests} contests)`);
  let text = `${lead} Where each party stood before, the median change in share for a party starting on ${start}% was: ${joinList(parts)}.`;
  if (blank.length) text += ` ${cap(joinList(blank.map(partyInProse)))} stood before in fewer than ${doc.min_contests} of them, so ${blank.length === 1 ? "its" : "their"} month is blank.`;
  return text;
}
