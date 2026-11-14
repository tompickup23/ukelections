// Which ward pages search engines are asked to index.
//
// The 2,977 ward pages built from the 7 May 2026 ballots share most of their
// text with each other (74% to 92%, SEO audit of 2 November 2026), and Search
// Console's indexed count fell from 2,035 (27 August) to 1,770 (2 November)
// while they sat in the sitemap. So from the quality
// reset (register T13) every ward page is `noindex,follow` and left out of the
// sitemap, unless it carries something no other ward page has. The pages stay
// live for readers and the postcode lookup; only indexing changes.
//
// A ward earns its way back by holding a contest of its own after 7 May 2026:
//
//   - a by-election whose result is declared, or
//   - a by-election not yet held whose candidates are published, or
//   - a 6 May 2027 contest with published candidates. No 2027 candidate data
//     is held yet, so this arm admits nothing today; it is written so the rule
//     does not have to change when nominations close in April 2027.
//
// A by-election whose polls have closed but whose result we do not yet hold
// does not count: the ward page would show only a date.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export interface WardByElection {
  slug: string;
  pollingDay: string;
  status: string;
  declared: boolean;
  winnerParty: string | null;
  winnerCandidate: string | null;
  winnerVotes: number | null;
  totalVotes: number | null;
  majorityVotes: number | null;
  candidateCount: number | null;
  fieldPublished: boolean;
  resultSource: { label: string; url: string } | null;
  nominationsUrl: string | null;
  resultUpdatedAt: string | null;
}

export interface WardIndexDecision {
  index: boolean;
  reason: string;
}

/** The ward pages' own ballot date. Contests on or before it are not "since". */
export const WARD_BALLOT_DATE = "2026-05-07";

const wardKey = (council: string | null | undefined, ward: string | null | undefined) => `${council}/${ward}`;

function fromContestFile(c: any): WardByElection | null {
  const contest = c?.contest;
  if (!contest?.polling_day || !c.slug) return null;
  const result = c.result?.declared ? c.result : null;
  const sources: Array<{ label: string; url: string }> = Array.isArray(c.sources) ? c.sources : [];
  // Use the result's own source. A contest's first link may be nominations
  // or a secondary account, so neither its purpose nor publisher is assumed.
  const resultSource = result
    ? sources.find((s) => s.url === result.source) || (result.source ? { label: "Recorded result source", url: result.source } : null)
    : null;
  return {
    slug: c.slug,
    pollingDay: contest.polling_day,
    status: c.status || "unknown",
    declared: !!result,
    winnerParty: result?.winner_party ?? null,
    winnerCandidate: result?.winner_candidate ?? null,
    winnerVotes: typeof result?.winner_votes === "number" ? result.winner_votes : null,
    totalVotes: typeof result?.total_votes === "number" ? result.total_votes : null,
    majorityVotes: typeof result?.majority_votes === "number" ? result.majority_votes : null,
    candidateCount: typeof c.field?.candidate_count === "number" ? c.field.candidate_count : null,
    fieldPublished: !!(c.field?.locked && c.field?.candidate_count > 0),
    resultSource,
    nominationsUrl: c.field?.sopn_url ?? null,
    resultUpdatedAt: c.result_updated_at ?? null,
  };
}

let _byWard: Map<string, WardByElection[]> | null = null;

/**
 * Every local by-election in data/contests/local-byelections, keyed by
 * "<council_slug>/<ward_slug>" and, where the contest names one, by its ward
 * GSS code. The contest folder is regenerated on the server every night, so
 * this reads the folder rather than any copied list.
 */
export function loadWardByElections(dir?: string): Map<string, WardByElection[]> {
  // Memoised for the build's default folder only; a test fixture folder is read fresh.
  if (!dir && _byWard) return _byWard;
  const folder = dir || path.join(process.cwd(), "data/contests/local-byelections");
  const out = new Map<string, WardByElection[]>();
  if (existsSync(folder)) {
    for (const f of readdirSync(folder)) {
      if (!f.endsWith(".json") || f.startsWith("_")) continue;
      const raw = JSON.parse(readFileSync(path.join(folder, f), "utf8"));
      const row = fromContestFile(raw);
      if (!row) continue;
      const keys = [wardKey(raw.contest.council_slug, raw.contest.ward_slug)];
      if (raw.contest.ward_gss) keys.push(`gss/${raw.contest.ward_gss}`);
      for (const k of keys) out.set(k, [...(out.get(k) || []), row]);
    }
  }
  for (const list of out.values()) list.sort((a, b) => b.pollingDay.localeCompare(a.pollingDay));
  if (!dir) _byWard = out;
  return out;
}

/** By-elections held, or due, in this ward after its 7 May 2026 ballot, newest first. */
export function byElectionsSince(
  ward: { council_slug?: string | null; ward_slug?: string | null; gss_code?: string | null },
  all: Map<string, WardByElection[]> = loadWardByElections()
): WardByElection[] {
  const seen = new Set<string>();
  const rows = [
    ...(all.get(wardKey(ward.council_slug, ward.ward_slug)) || []),
    ...(ward.gss_code ? all.get(`gss/${ward.gss_code}`) || [] : []),
  ];
  return rows.filter((r) => r.pollingDay > WARD_BALLOT_DATE && !seen.has(r.slug) && seen.add(r.slug));
}

/** The re-admission rule. Pure, so the test can state every case. */
export function wardIndexDecision(input: {
  byElections: WardByElection[];
  contests2027WithCandidates?: number;
  today?: string;
}): WardIndexDecision {
  const declared = input.byElections.find((b) => b.declared);
  if (declared) return { index: true, reason: `by-election result declared (${declared.pollingDay})` };
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const upcoming = input.byElections.find((b) => b.status === "upcoming" && b.fieldPublished && b.pollingDay >= today);
  if (upcoming) return { index: true, reason: `by-election candidates published (${upcoming.pollingDay})` };
  if ((input.contests2027WithCandidates || 0) > 0) return { index: true, reason: "2027 contest with candidates" };
  return { index: false, reason: "no contest of its own since 7 May 2026" };
}

/** The decision for one ward from the data on disk. */
export function wardIsIndexable(ward: { council_slug?: string | null; ward_slug?: string | null; gss_code?: string | null }): WardIndexDecision {
  return wardIndexDecision({ byElections: byElectionsSince(ward) });
}
