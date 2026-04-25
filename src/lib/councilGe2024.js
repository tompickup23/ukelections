/**
 * councilGe2024.js — derive a per-council GE2024 vote-share aggregate by
 * matching DC parl.* ballot slugs against the council slug.
 *
 * Strategy: for each council we look for parl ballots whose slug:
 *   1. Equals the council slug exactly (e.g. "burnley", "blackburn-with-darwen")
 *   2. Starts with the council slug + "-" or "-and-" (e.g. "barking-and-dagenham"
 *      maps to council "barking-and-dagenham")
 *   3. Contains the council slug as a token boundary (covers councils whose
 *      area is split across multiple constituencies — e.g. "manchester" matches
 *      "manchester-central", "manchester-rusholme", etc.)
 *
 * Aggregation: weighted average of per-party vote share, weighted by total
 * votes cast in each constituency.
 *
 * Output is the constituencyResult arg for the model — used in step 1.5
 * (stale-baseline decay) and step 5 (Reform UK new-party entry proxy).
 *
 * Pure functions.
 */

const PARTY_CANON = (n) => {
  if (!n) return "Unknown";
  const p = String(n).trim();
  if (/^Labour Party$/i.test(p)) return "Labour";
  if (/^Labour and Co-operative Party$/i.test(p)) return "Labour";
  if (/^Conservative and Unionist Party$/i.test(p)) return "Conservative";
  if (/^Liberal Democrats?$/i.test(p)) return "Liberal Democrats";
  if (/^Reform UK$/i.test(p)) return "Reform UK";
  if (/^Green Party$/i.test(p)) return "Green Party";
  if (/^Scottish National Party \(SNP\)$/i.test(p)) return "SNP";
  if (/^Plaid Cymru/i.test(p)) return "Plaid Cymru";
  if (/independent/i.test(p)) return "Independent";
  return p;
};

function slugTokens(slug) {
  return String(slug || "").split(/-/).filter(Boolean);
}

function constituencyMatchesCouncil(parlSlug, councilSlug) {
  if (!parlSlug || !councilSlug) return false;
  if (parlSlug === councilSlug) return true;
  if (parlSlug.startsWith(councilSlug + "-")) return true;
  // Multi-constituency council: e.g. council "manchester" should pick
  // "manchester-central", "manchester-rusholme", "manchester-withington"
  const cTokens = slugTokens(councilSlug);
  const pTokens = slugTokens(parlSlug);
  if (cTokens.length === 1 && pTokens.includes(cTokens[0])) return true;
  return false;
}

/**
 * Return GE2024 share dict aggregated for a council slug, plus diagnostics.
 *
 * historyBundle: data/history/dc-historic-results.json
 * councilSlug: e.g. "burnley"
 *
 * Returns null if no matching parl ballots found.
 */
export function ge2024ForCouncil(historyBundle, councilSlug) {
  const ge24 = (historyBundle.results || []).filter(
    (r) => r.tier === "parl" && r.election_date === "2024-07-04",
  );
  const matches = ge24.filter((r) => {
    const slug = (r.ballot_paper_id || "").split(".")[1];
    return constituencyMatchesCouncil(slug, councilSlug);
  });
  if (matches.length === 0) return null;

  const partyVotes = {};
  let totalVotes = 0;
  for (const r of matches) {
    const ballotTotal = (r.candidates || []).reduce((s, c) => s + (c.votes || 0), 0);
    if (ballotTotal <= 0) continue;
    for (const c of r.candidates || []) {
      const p = PARTY_CANON(c.party_name);
      partyVotes[p] = (partyVotes[p] || 0) + (c.votes || 0);
    }
    totalVotes += ballotTotal;
  }
  if (totalVotes <= 0) return null;
  const shares = {};
  for (const [p, v] of Object.entries(partyVotes)) shares[p] = v / totalVotes;
  return {
    shares,
    constituency_count: matches.length,
    total_votes: totalVotes,
    constituencies: matches.map((r) => r.ballot_paper_id),
  };
}

/**
 * Build a council-slug → ge2024 shares index for fast lookup.
 */
export function buildCouncilGe2024Index(historyBundle, councilSlugs) {
  const out = {};
  for (const slug of councilSlugs) {
    const result = ge2024ForCouncil(historyBundle, slug);
    if (result) out[slug] = result;
  }
  return out;
}
