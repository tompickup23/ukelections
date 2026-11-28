/**
 * One page per council by-election polling day: /by-elections/week/YYYY-MM-DD/.
 *
 * Built from the same contest files as the contest pages, so a day page can
 * never disagree with the contests it lists. A date gets a page only when at
 * least one contest polls on it. Nothing here changes a forecast or a count:
 * it groups, orders and tallies what the contest files already say.
 */
import { isDeclared, loadLocalContests, prettyElectionDate } from "./byElections";
import { shortPartyLabel } from "./siteData";
import { titleDate, TITLE_LIMIT } from "./seo";

export type DayPhase = "upcoming" | "awaited" | "part-declared" | "declared";

export interface ContestOutcome {
  /** The party key the winner stood under ("Other" for a local party). */
  winner: string | null;
  /** The party that held the seat before, where the record establishes it. */
  previous: string | null;
  kind: "hold" | "gain" | null;
  /** "Labour hold", "Reform UK gain from Labour", or null when unknown. */
  label: string | null;
}

export interface PartyTally {
  party: string;
  won: number;
  /** Gains minus losses, counted only where the previous holder is known. */
  net: number;
}

export interface PollingDay {
  date: string;
  path: string;
  contests: any[];
  declared: number;
  phase: DayPhase;
  councils: string[];
  outcomes: Map<string, ContestOutcome>;
  tally: PartyTally[];
  /** Contests whose winner and previous holder are both known. */
  changeKnown: number;
  changedHands: number;
  candidates: number;
  forecasts: number;
  /** Contests each party stands in, for days with nothing declared yet. */
  standing: Array<{ party: string; contests: number }>;
}

export const dayPath = (date: string) => `/by-elections/week/${date}/`;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Who won and whether it was a hold or a gain. The contest's own recorded
 * outcome comes first, because the contest page prints it; otherwise the
 * reviewed previous holder. A gain is never inferred from anything weaker.
 */
export function contestOutcome(d: any): ContestOutcome {
  const result = d?.result?.declared ? d.result : null;
  const dec = d?.declaration?.declared ? d.declaration : null;
  const winner: string | null = result?.winner_party ?? dec?.winner_party ?? null;
  if (!winner) return { winner: null, previous: null, kind: null, label: null };
  const known = new Set(Object.keys(result?.shares || {}));
  let previous: string | null = null;
  const outcome: string | null = typeof result?.outcome === "string" ? result.outcome : null;
  const gain = outcome?.match(/^(.+) gain from (.+)$/);
  if (outcome && /\shold$/.test(outcome)) previous = winner;
  else if (gain) previous = known.has(gain[2]) ? gain[2] : "Other";
  else if (d?.previous_holder?.established && d.previous_holder.party) previous = d.previous_holder.party;
  if (!previous) return { winner, previous: null, kind: null, label: null };
  const kind = previous === winner ? "hold" : "gain";
  const label = outcome ?? (kind === "hold"
    ? `${shortPartyLabel(winner)} hold`
    : `${shortPartyLabel(winner)} gain from ${shortPartyLabel(previous)}`);
  return { winner, previous, kind, label };
}

/** Seats won and net change by party, most seats first, then alphabetical. */
export function dayTally(outcomes: ContestOutcome[]): PartyTally[] {
  const rows = new Map<string, PartyTally>();
  const row = (party: string) => {
    if (!rows.has(party)) rows.set(party, { party, won: 0, net: 0 });
    return rows.get(party)!;
  };
  for (const o of outcomes) {
    if (!o.winner) continue;
    row(o.winner).won += 1;
    if (o.kind === "gain" && o.previous) {
      row(o.winner).net += 1;
      row(o.previous).net -= 1;
    }
  }
  return [...rows.values()].sort((a, b) => b.won - a.won || b.net - a.net || a.party.localeCompare(b.party, "en-GB"));
}

function dayPhase(contests: any[], date: string, today: string): DayPhase {
  const declared = contests.filter(isDeclared).length;
  if (declared === contests.length) return "declared";
  if (declared > 0) return "part-declared";
  return date < today ? "awaited" : "upcoming";
}

export function buildPollingDays(contests: any[], today = new Date().toISOString().slice(0, 10)): PollingDay[] {
  const byDate = new Map<string, any[]>();
  for (const d of contests) {
    const date = d?.contest?.polling_day;
    if (!date || !ISO_DAY.test(date)) continue;
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date)!.push(d);
  }
  return [...byDate.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, list]) => {
      const ordered = [...list].sort((a, b) =>
        a.contest.council_name.localeCompare(b.contest.council_name, "en-GB")
        || a.contest.ward_name.localeCompare(b.contest.ward_name, "en-GB"));
      const outcomes = new Map(ordered.map((d) => [d.slug as string, contestOutcome(d)]));
      const known = [...outcomes.values()].filter((o) => o.kind);
      const standingCount = new Map<string, number>();
      for (const d of ordered) {
        for (const p of new Set<string>(d.field?.parties || [])) standingCount.set(p, (standingCount.get(p) || 0) + 1);
      }
      return {
        date,
        path: dayPath(date),
        contests: ordered,
        declared: ordered.filter(isDeclared).length,
        phase: dayPhase(ordered, date, today),
        councils: [...new Set(ordered.map((d) => d.contest.council_name as string))],
        outcomes,
        tally: dayTally([...outcomes.values()]),
        changeKnown: known.length,
        changedHands: known.filter((o) => o.kind === "gain").length,
        candidates: ordered.reduce((n, d) => n + (d.field?.candidate_count || 0), 0),
        forecasts: ordered.filter((d) => d.forecast).length,
        standing: [...standingCount.entries()]
          .map(([party, n]) => ({ party, contests: n }))
          .sort((a, b) => b.contests - a.contests || a.party.localeCompare(b.party, "en-GB")),
      };
    });
}

/** Every polling day with at least one contest, newest first. */
export const loadPollingDays = (today?: string) => buildPollingDays(loadLocalContests(), today);

/** The day page URL for a contest, or null when its date is unusable. */
export function dayPathForContest(d: any): string | null {
  const date = d?.contest?.polling_day;
  return date && ISO_DAY.test(date) ? dayPath(date) : null;
}

/** Sitemap routes: the index and one page per polling day. */
export function getByElectionDayPaths(): string[] {
  const days = loadPollingDays();
  return days.length ? ["/by-elections/week/", ...days.map((d) => d.path)] : [];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Titles lead with what people type: "Council by-election results,
 * 26 November 2026: 6 contests" once polls have closed, "Council by-elections
 * on 3 December 2026: 4 contests, candidates and forecasts" before. Each is
 * shortened to TITLE_LIMIT where the words allow; the date and count stay.
 */
export function pollingDayTitle(day: PollingDay): string {
  const n = plural(day.contests.length, "contest");
  const long = titleDate(day.date);
  const short = titleDate(day.date, true);
  const ladder = day.phase === "upcoming"
    ? [
        `Council by-elections on ${long}: ${n}, candidates and forecasts`,
        `Council by-elections on ${long}: ${n} and candidates`,
        // The month stays in full: it is what people type.
        `Council by-elections on ${long}: ${n}`,
      ]
    : [`Council by-election results, ${long}: ${n}`, `Council by-election results, ${short}: ${n}`];
  return ladder.find((t) => t.length <= TITLE_LIMIT) ?? ladder[ladder.length - 1];
}

const joinAnd = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0] ?? "");

/**
 * Figure first, councils named, at most 155 characters. The council names
 * matter more than the closing line, so the closing line shortens or goes
 * before any council is dropped; only then does the list end "and 3 more".
 */
export function pollingDayDescription(day: PollingDay): string {
  const n = day.contests.length;
  const date = prettyElectionDate(day.date);
  const lead = day.phase === "upcoming"
    ? `${plural(n, "council by-election")} on ${date}`
    : day.phase === "awaited"
      ? `${plural(n, "council by-election")} on ${date}, results awaited`
      : day.phase === "part-declared"
        ? `${day.declared} of ${n} council by-election results declared, ${date}`
        : `${plural(n, "council by-election result")}, ${date}`;
  const tails = day.phase === "upcoming"
    ? [` Candidates${day.forecasts ? " and forecasts" : ""}, with official sources.`, day.forecasts ? " Candidates and forecasts." : " Candidates."]
    : day.declared
      ? [" Winners, vote shares, holds and gains, with official sources.", " Winners, shares, holds and gains.", " Results and sources."]
      : [" Candidates and the pre-poll forecasts.", " Pre-poll forecasts."];
  const fits = (t: string) => t.length <= 155;
  const all = joinAnd(day.councils);
  for (const tail of [...tails, ""]) {
    const text = `${lead}: ${all}.${tail}`;
    if (fits(text)) return text;
  }
  const tail = tails[tails.length - 1];
  for (let k = day.councils.length - 1; k >= 1; k -= 1) {
    const text = `${lead}: ${day.councils.slice(0, k).join(", ")} and ${day.councils.length - k} more.${tail}`;
    if (fits(text)) return text;
  }
  return `${lead}: ${day.councils.length} councils.${tail}`;
}
