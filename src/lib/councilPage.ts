// Title, snippet and ward-table rows for the council pages (/seats/<council>/),
// kept out of CouncilDetail.astro so the rules can be tested.

import type { WardResultSummary } from "./may7WardResult";

/**
 * "[Council] election results 2026 and next election" (quality reset,
 * register T13). The "next election" half is promised only where the date is
 * verified; an unverified council gets the results half alone, as PR 141 made
 * the snippet do.
 */
export function councilTitle(councilName: string, nextKnown: boolean): string {
  return nextKnown
    ? `${councilName} election results 2026 and next election`
    : `${councilName} election results 2026`;
}

/** Under 160 characters: the next-election clause goes first, then the seat count. */
export function councilDescription(input: {
  councilName: string;
  controlHeadline: string;
  seatsUp: number;
  nextLabel: string | null;
}): string {
  const base = `${input.councilName}, 7 May 2026: ${input.controlHeadline}.`;
  const seats = ` ${input.seatsUp} seats contested, with each ward's result.`;
  const next = input.nextLabel ? ` Next: ${input.nextLabel}.` : "";
  for (const candidate of [base + seats + next, base + seats, base]) {
    if (candidate.length < 160) return candidate;
  }
  return base.slice(0, 159);
}

export interface WardTableRow {
  wonBy: string | null;
  /** Votes of the last candidate elected (the only candidate in a one-seat ward). */
  votes: number | null;
  /** That candidate's share; null where the field is incomplete and shares are withheld. */
  share: number | null;
  turnoutPct: number | null;
}

/**
 * The figures one row of the council page's ward table shows, from the same
 * summary the ward page renders. In a multi-member ward the last candidate
 * elected is the one whose votes decided the final seat.
 */
export function wardTableRow(result: WardResultSummary | null, seatsWon: (r: WardResultSummary) => string): WardTableRow {
  if (!result || result.elected.length === 0) return { wonBy: null, votes: null, share: null, turnoutPct: result?.turnoutPct ?? null };
  const last = [...result.elected].sort((a, b) => a.votes - b.votes)[0];
  return {
    wonBy: seatsWon(result),
    votes: last.votes,
    share: result.incomplete ? null : last.share,
    turnoutPct: result.turnoutPct,
  };
}
