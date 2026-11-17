// One ward's declared 7 May 2026 result, resolved the same way for the ward
// page and for the council page's ward table, so the two cannot disagree.
//
// The scored results file comes first. Where it lacks the ward but the
// contest-history archive holds the same ballot's declaration, that row is
// used instead (see historyRowAsWardResult).

import { loadHistory, loadMay7ResultForWard } from "./predictions";
import { historyRowAsWardResult, summariseWardResult, type RawWardResult, type WardResultSummary } from "./may7WardResult";

type WardRef = {
  ballot_paper_id: string | null;
  tier: string;
  council_slug: string | null;
  ward_slug: string | null;
  winner_count?: number | null;
  candidate_count?: number | null;
};

/** The raw declaration row the ward's figures are read from, or null. */
export function wardResultRowFor(ward: WardRef): RawWardResult | null {
  if (!ward.ballot_paper_id) return null;
  const scored = loadMay7ResultForWard(ward.ballot_paper_id);
  if (scored) return scored;
  const history = loadHistory();
  const ids: string[] = (history.by_ward_slug || {})[`${ward.tier}::${ward.council_slug}::${ward.ward_slug}`] || [];
  const match = ids.includes(ward.ballot_paper_id) ? history.by_ballot[ward.ballot_paper_id] : null;
  return historyRowAsWardResult(match, ward.ballot_paper_id, ward.winner_count ?? null);
}

export function wardResultFor(ward: WardRef): WardResultSummary | null {
  return summariseWardResult(wardResultRowFor(ward), ward.candidate_count ?? null);
}
