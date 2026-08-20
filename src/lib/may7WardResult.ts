// Turns one raw 7 May 2026 declaration row into the shape the ward page
// renders. Kept out of the .astro file so the awkward parts (which
// candidates were elected, what the majority was, whether the row can be
// trusted at all) are unit-testable.
//
// The merged results file blends three providers and they do NOT agree on
// which fields they populate:
//
//   dc-api                   2,691 ballots. Full candidate rows, person_id
//                            and `elected` set.
//   wikipedia                  138 ballots. person_id always null, and 41
//                            rows carry no `elected` flag at all.
//   council-pdf-declaration     74 ballots. Authoritative, but some rows
//                            parsed party + votes only, leaving every
//                            candidate `name` null.
//
// So the elected set has to be derived defensively, and a handful of rows
// are short of candidates against the nomination papers, which would
// otherwise publish a fabricated vote share (three Birmingham wards render
// a single candidate on 100%). Those are flagged, not shown as shares.

export interface RawCandidate {
  person_id: number | null;
  name: string | null;
  party_name: string | null;
  party_canonical: string | null;
  votes: number | null;
  elected?: boolean;
}

export interface RawWardResult {
  ballot_paper_id: string;
  election_date: string;
  tier: string;
  council_slug: string | null;
  ward_slug: string | null;
  is_by_election: boolean;
  winner_count: number;
  electorate: number | null;
  turnout_votes: number | null;
  turnout_pct: number | null;
  spoilt_ballots: number | null;
  total_valid_votes: number | null;
  candidates: RawCandidate[];
  vote_shares: Record<string, number> | null;
  winner_party_canonical: string | null;
  winners: Array<{ name: string | null; party_canonical: string | null; person_id: number | null; votes: number | null }> | null;
  source: string | null;
  source_article?: string | null;
  source_provider?: string | null;
  quality_caveat?: string | null;
}

export interface ResultCandidate {
  name: string | null;
  party: string;
  votes: number;
  share: number | null;
  elected: boolean;
}

export interface SeatsByParty {
  party: string;
  seats: number;
}

export interface WardResultSummary {
  ballotPaperId: string;
  seats: number;
  isByElection: boolean;
  candidates: ResultCandidate[];
  elected: ResultCandidate[];
  seatsByParty: SeatsByParty[];
  /** True when more than one party took a seat in a multi-member ward. */
  split: boolean;
  turnoutPct: number | null;
  electorate: number | null;
  totalValidVotes: number | null;
  spoiltBallots: number | null;
  /** Last elected candidate's votes minus the best-placed loser. Null when it cannot be stated honestly. */
  majority: number | null;
  majorityOverParty: string | null;
  /** Fewer candidates recorded than were nominated, so shares are unsafe to publish. */
  incomplete: boolean;
  recordedCandidates: number;
  nominatedCandidates: number | null;
  provider: string | null;
  sourceUrl: string | null;
  sourceArticle: string | null;
  qualityCaveat: string | null;
}

function normaliseName(s: string | null | undefined): string {
  return (s || "").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Works out which candidates took a seat, in the order of preference:
 *
 *   1. explicit `elected` flags, when any row carries one
 *   2. the `winners` list matched on person_id
 *   3. the `winners` list matched on normalised name (skipping null names,
 *      which would otherwise all collapse to the same empty string and mark
 *      every candidate elected)
 *   4. top N by votes
 *
 * Only accepts a match from steps 2 and 3 when it returns exactly the
 * expected number of winners, otherwise it falls through.
 */
export function deriveElected(row: RawWardResult): RawCandidate[] {
  const candidates = row.candidates || [];
  const seats = row.winner_count || 1;

  const flagged = candidates.filter((c) => c.elected);
  if (flagged.length > 0) return flagged;

  const winners = row.winners || [];

  const winnerIds = new Set(winners.map((w) => w.person_id).filter((id): id is number => id != null));
  if (winnerIds.size > 0) {
    const byId = candidates.filter((c) => c.person_id != null && winnerIds.has(c.person_id));
    if (byId.length === seats) return byId;
  }

  const winnerNames = new Set(winners.map((w) => normaliseName(w.name)).filter((n) => n.length > 0));
  if (winnerNames.size > 0) {
    const byName = candidates.filter((c) => winnerNames.has(normaliseName(c.name)));
    if (byName.length === seats) return byName;
  }

  return [...candidates].sort((a, b) => (b.votes || 0) - (a.votes || 0)).slice(0, seats);
}

/**
 * Majority is the last elected candidate's votes minus the best-placed
 * candidate who missed out. Returns null when the row cannot support the
 * claim: no losing candidate at all, an incomplete candidate list, or an
 * elected set that sits below a non-elected candidate (two Wikipedia rows
 * do this, and a "majority" there would be a negative number presented as
 * a win).
 */
export function deriveMajority(
  elected: RawCandidate[],
  losers: RawCandidate[],
  incomplete: boolean
): { majority: number | null; overParty: string | null } {
  if (incomplete || elected.length === 0 || losers.length === 0) {
    return { majority: null, overParty: null };
  }
  const lastElected = Math.min(...elected.map((c) => c.votes || 0));
  const runnerUp = [...losers].sort((a, b) => (b.votes || 0) - (a.votes || 0))[0];
  const majority = lastElected - (runnerUp.votes || 0);
  if (majority < 0) return { majority: null, overParty: null };
  return { majority, overParty: runnerUp.party_canonical || null };
}

/**
 * Normalises one declaration row for rendering.
 *
 * `nominatedCandidates` is the count from the identity/nominations table
 * (`IdentityWard.candidate_count`). Pass it whenever it is known: it is the
 * only way to catch a provider that recorded a partial field, which is what
 * turns a two-candidate scrape of a twelve-candidate ward into a bogus
 * 100% vote share.
 */
export function summariseWardResult(
  row: RawWardResult | null | undefined,
  nominatedCandidates: number | null = null
): WardResultSummary | null {
  if (!row) return null;

  const raw = row.candidates || [];
  const recordedCandidates = raw.length;
  if (recordedCandidates === 0) return null;

  const incomplete = nominatedCandidates != null && recordedCandidates < nominatedCandidates;

  const electedRaw = deriveElected(row);
  const electedSet = new Set(electedRaw);
  const losersRaw = raw.filter((c) => !electedSet.has(c));

  const totalVotes = raw.reduce((sum, c) => sum + (c.votes || 0), 0);

  const toCandidate = (c: RawCandidate): ResultCandidate => ({
    name: c.name,
    party: c.party_canonical || c.party_name || "Unknown",
    votes: c.votes || 0,
    // Suppressed on an incomplete field: the denominator is wrong, so the
    // percentage would be an invented number.
    share: incomplete || totalVotes <= 0 ? null : (c.votes || 0) / totalVotes,
    elected: electedSet.has(c),
  });

  const candidates = [...raw].sort((a, b) => (b.votes || 0) - (a.votes || 0)).map(toCandidate);
  const elected = candidates.filter((c) => c.elected);

  const seatCounts = new Map<string, number>();
  for (const c of elected) seatCounts.set(c.party, (seatCounts.get(c.party) || 0) + 1);
  const seatsByParty = [...seatCounts.entries()]
    .map(([party, seats]) => ({ party, seats }))
    .sort((a, b) => b.seats - a.seats || a.party.localeCompare(b.party));

  const { majority, overParty } = deriveMajority(electedRaw, losersRaw, incomplete);

  return {
    ballotPaperId: row.ballot_paper_id,
    seats: row.winner_count || 1,
    isByElection: !!row.is_by_election,
    candidates,
    elected,
    seatsByParty,
    split: seatsByParty.length > 1,
    turnoutPct: row.turnout_pct ?? null,
    electorate: row.electorate ?? null,
    totalValidVotes: row.total_valid_votes ?? null,
    spoiltBallots: row.spoilt_ballots ?? null,
    majority,
    majorityOverParty: overParty,
    incomplete,
    recordedCandidates,
    nominatedCandidates,
    provider: row.source_provider || null,
    sourceUrl: row.source || null,
    sourceArticle: row.source_article || null,
    qualityCaveat: row.quality_caveat || null,
  };
}

/**
 * One-line summary of who took the seats, plural-aware and safe for the
 * 251 multi-member wards that split between parties. Deliberately avoids
 * "X won the ward" phrasing, which is wrong wherever the seats split.
 */
export function seatsWonLabel(
  summary: WardResultSummary,
  shortLabel: (party: string) => string
): string {
  if (summary.seatsByParty.length === 0) return "No seats recorded";
  if (summary.seats === 1) return shortLabel(summary.seatsByParty[0].party);
  return summary.seatsByParty.map((s) => `${s.seats} ${shortLabel(s.party)}`).join(", ");
}
