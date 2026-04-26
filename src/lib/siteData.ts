/**
 * siteData.ts — shared headline data shown across the public surface.
 *
 * One canonical source for every page so headline numbers can never disagree
 * between, say, the homepage and the May 7 forecast page. Every page that
 * shows a top-line stat reads from here.
 */
import {
  loadSummary,
  loadIdentity,
  loadBacktest,
  loadGePredictions,
  loadGeSummary,
  loadGeBacktest,
} from "./predictions";

// Reference election dates. Tom updates ELECTION_DATE_MAY when the next
// election cycle rolls over (e.g. after May 7 2026 → May 2027).
export const ELECTION_DATE_MAY = "2026-05-07";

export interface MayHeadline {
  date: string;
  council_count: number;
  ward_count: number;
  candidate_count: number;
  seats_total: number;
  seat_tallies: Array<{ party: string; seats: number; share: number }>;
  generated_at: string;
  backtest_winner_accuracy: number;
  backtest_major_party_mae: number;
}

export interface GeHeadline {
  total_seats: number;
  seat_tallies: Array<{ party: string; seats: number; share: number }>;
  national_vote_share: Array<{ party: string; share: number }>;
  generated_at: string;
  polling_window: string | null;
  backtest_winner_accuracy: number;
  backtest_major_party_mae: number;
}

function rankTallies(map: Record<string, number>, total: number) {
  return Object.entries(map)
    .filter(([, n]) => (n || 0) > 0)
    .sort((a, b) => (b[1] as number) - (a[1] as number))
    .map(([party, seats]) => ({
      party,
      seats: seats as number,
      share: total > 0 ? (seats as number) / total : 0,
    }));
}

export function loadMayHeadline(): MayHeadline {
  const summary = loadSummary();
  const identity = loadIdentity();
  const backtest = loadBacktest();
  const wardCount = identity.wards.filter(
    (w: any) => w.tier === "local" || w.tier === "mayor",
  ).length;
  const candidateCount = identity.wards.reduce(
    (s: number, w: any) => s + (w.candidate_count || 0),
    0,
  );
  const tallies: Record<string, number> = {};
  for (const c of summary.councils as any[]) {
    for (const [party, seats] of Object.entries(c.predicted_seat_winners || {})) {
      tallies[party] = (tallies[party] || 0) + (seats as number);
    }
  }
  const seatsTotal = Object.values(tallies).reduce((s, v) => s + v, 0);
  return {
    date: ELECTION_DATE_MAY,
    council_count: summary.council_count,
    ward_count: wardCount,
    candidate_count: candidateCount,
    seats_total: seatsTotal,
    seat_tallies: rankTallies(tallies, seatsTotal),
    generated_at: summary.snapshot.generated_at,
    backtest_winner_accuracy: backtest.winner_accuracy,
    backtest_major_party_mae: backtest.overall_mae.major_parties_avg,
  };
}

export function loadGeHeadline(): GeHeadline {
  const summary = loadGeSummary();
  const ge = loadGePredictions();
  const backtest = loadGeBacktest();
  const totalSeats = Object.values(ge.predictions || {}).filter((p: any) => p?.prediction).length;
  const tallies = (summary.seat_tallies_by_party as Record<string, number>) || {};
  const shareMap = (summary.national_vote_share as Record<string, number>) || {};
  const ranked = Object.entries(shareMap)
    .filter(([, s]) => (s as number) > 0.005)
    .sort((a, b) => (b[1] as number) - (a[1] as number))
    .map(([party, share]) => ({ party, share: share as number }));
  // Polling window pulled from override.json if available, else the snapshot.
  let pollingWindow: string | null = null;
  try {
    const ov = (summary as any).snapshot?.polling_fieldwork_window || null;
    if (ov) pollingWindow = ov;
  } catch {
    /* ignore */
  }
  return {
    total_seats: totalSeats,
    seat_tallies: rankTallies(tallies, totalSeats),
    national_vote_share: ranked,
    generated_at: summary.snapshot.generated_at,
    polling_window: pollingWindow,
    backtest_winner_accuracy: backtest.summary?.stm?.winner_accuracy ?? 0,
    backtest_major_party_mae: backtest.summary?.stm?.major_party_mae_avg ?? 0,
  };
}

export interface Countdown {
  days_until: number;
  has_passed: boolean;
  date_iso: string;
  date_pretty: string;
}

export function countdownToMay(now: Date = new Date()): Countdown {
  // Use UTC midnight of the election date so the count is timezone-stable.
  const target = new Date(`${ELECTION_DATE_MAY}T00:00:00Z`);
  const diffMs = target.getTime() - now.getTime();
  const days = Math.ceil(diffMs / 86400_000);
  return {
    days_until: Math.max(0, days),
    has_passed: diffMs <= 0,
    date_iso: ELECTION_DATE_MAY,
    date_pretty: "Thursday 7 May 2026",
  };
}

/**
 * Plain-English label for a UK party. Matches the way TV results graphics
 * shorten long official party names so readers aren't confronted with a
 * "Speaker seeking re-election" or "Workers Party of Britain" cell.
 */
export function shortPartyLabel(party: string): string {
  switch (party) {
    case "Liberal Democrats": return "Lib Dem";
    case "Speaker seeking re-election": return "Speaker";
    case "Workers Party of Britain": return "Workers Party";
    case "Traditional Unionist Voice - TUV": return "TUV";
    case "Sinn Féin": return "Sinn Féin";
    default: return party;
  }
}
