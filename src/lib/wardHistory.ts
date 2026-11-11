// Ward history: "who has won here". PROTOTYPE.
//
// Turns the contest records the site already holds for one ward into a strip
// of past contests. Three rules:
//
// 1. Only results the site holds are shown, and the page says so. The archive
//    has gaps (a ward that elects by thirds can be missing a year), so nothing
//    here claims to be the complete record.
// 2. No individual is named. The strip is about the ward, not candidates.
// 3. Contests either side of a boundary change are never presented as one
//    series: the strip breaks and says why.
import { canonicalResultParty } from "./may7WardResult";

export interface HistoryContest {
  date: string;
  byElection: boolean;
  /** Party whose candidate took most votes. */
  topParty: string;
  /** Parties of everyone elected, in poll order. One entry per seat. */
  elected: string[];
  seats: number;
  /** Top candidate's share of all votes cast. Null in multi-seat contests,
   *  where each voter has several votes and the sum is not a count of voters. */
  topShare: number | null;
  /** Votes between first and second. Single-seat contests only. */
  majorityVotes: number | null;
  turnoutPct: number | null;
  candidates: number;
  source: string | null;
  /** True when the ward's boundaries changed between the previous contest and this one. */
  breakBefore?: boolean;
}

interface CandidateLike {
  party_name?: string | null;
  party_canonical?: string | null;
  votes?: number | null;
  elected?: boolean | null;
}

/** One contest from any record that carries candidates with votes. */
export function contestFromCandidates(input: {
  date: string;
  byElection: boolean;
  candidates: CandidateLike[];
  seats?: number | null;
  turnoutPct?: number | null;
  source?: string | null;
}): HistoryContest | null {
  const counted = (input.candidates || [])
    .filter((c) => typeof c?.votes === "number")
    .map((c) => ({ party: c.party_canonical || canonicalResultParty(c.party_name), votes: c.votes as number, elected: c.elected === true }))
    .sort((a, b) => b.votes - a.votes);
  if (counted.length === 0) return null;
  const flagged = counted.filter((c) => c.elected);
  const seats = flagged.length || input.seats || 1;
  const elected = (flagged.length ? flagged : counted.slice(0, seats)).map((c) => c.party);
  const total = counted.reduce((n, c) => n + c.votes, 0);
  const single = seats === 1;
  return {
    date: input.date,
    byElection: input.byElection,
    topParty: counted[0].party,
    elected,
    seats,
    topShare: single && total > 0 ? counted[0].votes / total : null,
    majorityVotes: single && counted.length > 1 ? counted[0].votes - counted[1].votes : null,
    turnoutPct: typeof input.turnoutPct === "number" ? input.turnoutPct : null,
    candidates: counted.length,
    source: input.source ?? null,
  };
}

/** Oldest first, one entry per polling day, with the boundary break marked. */
export function orderContests(contests: Array<HistoryContest | null>, boundaryStart?: string | null): HistoryContest[] {
  const byDate = new Map<string, HistoryContest>();
  for (const c of contests) if (c && !byDate.has(c.date)) byDate.set(c.date, c);
  const out = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (boundaryStart) {
    const first = out.findIndex((c) => c.date >= boundaryStart);
    if (first > 0) out[first] = { ...out[first], breakBefore: true };
  }
  return out;
}

/** The comparable run: contests since the last boundary change. */
export function currentRun(contests: HistoryContest[]): HistoryContest[] {
  const lastBreak = contests.map((c) => Boolean(c.breakBefore)).lastIndexOf(true);
  return lastBreak > 0 ? contests.slice(lastBreak) : contests;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * One sentence on the record, generated from the contests shown. It counts
 * only what is held, and only within the current boundaries.
 */
export function historySentence(contests: HistoryContest[], label: (party: string) => string): string {
  const run = currentRun(contests);
  if (run.length === 0) return "";
  const since = run[0].date.slice(0, 4);
  if (run.length === 1) {
    return `${label(run[0].topParty)} topped the poll in ${since}, the one result held for this ward${run !== contests ? " on its current boundaries" : ""}.`;
  }
  const tally = new Map<string, number>();
  for (const c of run) tally.set(c.topParty, (tally.get(c.topParty) ?? 0) + 1);
  const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  const scope = `the ${plural(run.length, "result", "results")} held since ${since}${run !== contests ? ", all on the current boundaries" : ""}`;
  if (ranked.length === 1) return `${label(ranked[0][0])} topped the poll at all ${run.length} of ${scope}.`;
  // Where the lead last changed.
  let changed = "";
  for (let i = run.length - 1; i > 0; i -= 1) {
    if (run[i].topParty !== run[i - 1].topParty) {
      changed = ` The lead last changed in ${run[i].date.slice(0, 4)}, from ${label(run[i - 1].topParty)} to ${label(run[i].topParty)}.`;
      break;
    }
  }
  const lead = ranked[0][1] === ranked[1][1]
    ? `${ranked.map(([p, n]) => `${label(p)} ${n}`).join(", ")}: who topped the poll across ${scope}.`
    : `${label(ranked[0][0])} topped the poll at ${ranked[0][1]} of ${scope}.`;
  return lead + changed;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Fixed format, "04 May 2023", so a column of dates lines up. */
export function fixedDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${String(d).padStart(2, "0")} ${MONTHS[m - 1]} ${y}`;
}
