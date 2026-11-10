// How close each ward's result was. PROTOTYPE.
//
// The lead is the gap between the best-placed candidate of the party that
// topped the poll and the best-placed candidate of the next party, as a share
// of those best-candidate votes. That is the same notional single-seat contest
// the by-election pages use, so a three-seat ward and a one-seat ward can sit
// on one scale. It describes a declared result; it is not a forecast.
import { canonicalResultParty } from "./may7WardResult";

export type Closeness = "close" | "clear" | "commanding";

/** Class boundaries in percentage points of lead. Stated on the map legend. */
export const CLOSE_UNDER = 5;
export const CLEAR_UNDER = 15;

export interface WardLead {
  topParty: string;
  secondParty: string | null;
  /** Lead in percentage points. Null when only one party stood. */
  leadPts: number | null;
  closeness: Closeness;
}

interface CandidateLike {
  party_name?: string | null;
  party_canonical?: string | null;
  votes?: number | null;
}

export function classifyLead(leadPts: number | null): Closeness {
  if (leadPts === null) return "commanding";
  if (leadPts < CLOSE_UNDER) return "close";
  if (leadPts < CLEAR_UNDER) return "clear";
  return "commanding";
}

export function wardLead(candidates: CandidateLike[] | null | undefined): WardLead | null {
  const best = new Map<string, number>();
  for (const c of candidates || []) {
    if (typeof c?.votes !== "number") continue;
    const party = c.party_canonical || canonicalResultParty(c.party_name);
    // Independents are separate people, not one party: never pool them.
    const key = party === "Independent" ? `Independent#${best.size}` : party;
    best.set(key, Math.max(best.get(key) ?? 0, c.votes));
  }
  const ranked = [...best.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) return null;
  const name = (key: string) => key.replace(/#\d+$/, "");
  const total = ranked.reduce((n, [, v]) => n + v, 0);
  const leadPts = ranked.length > 1 && total > 0 ? ((ranked[0][1] - ranked[1][1]) / total) * 100 : null;
  return {
    topParty: name(ranked[0][0]),
    secondParty: ranked.length > 1 ? name(ranked[1][0]) : null,
    leadPts,
    closeness: classifyLead(leadPts),
  };
}
