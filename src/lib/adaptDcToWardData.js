/**
 * adaptDcToWardData.js — convert Democracy Club ingest into the AI DOGE
 * election model's wardData shape.
 *
 * Inputs:
 *   identity entry from data/identity/wards-may-2026.json#wards[]
 *   historic-results bundle from data/history/dc-historic-results.json
 *
 * Output: wardData object with shape:
 *   {
 *     gss_code, seats, current_holders, electorate,
 *     history: [{ date, year, type, seats_contested, turnout_votes,
 *                 turnout, electorate, candidates: [{name, party, votes,
 *                 pct, elected}], majority, majority_pct }],
 *     candidates_2026: [...]
 *   }
 *
 * The `type` field follows AI DOGE conventions: 'borough' | 'county' |
 * 'unitary' | 'metropolitan' | 'london-borough' | 'mayor' | 'by-election'.
 * For DC `local.*` ballots without a finer tier signal, default to
 * 'borough' which is the model's primary baseline filter.
 *
 * Pure function. No I/O.
 */

/**
 * Translate Democracy Club party display names into the canonical
 * party labels the AI DOGE election model and nationalPolling snapshots
 * use as keys. The model also runs its own normalizePartyName for
 * Labour-Coop / UKIP / etc. variants — this mapping handles the few
 * DC-specific naming quirks before that runs.
 */
function dcPartyToCanonical(dcName) {
  if (!dcName) return "Unknown";
  const p = String(dcName).trim();
  if (/^Labour Party$/i.test(p)) return "Labour";
  if (/^Labour and Co-operative Party$/i.test(p)) return "Labour";
  if (/^Conservative and Unionist Party$/i.test(p)) return "Conservative";
  if (/^The Conservative Party/i.test(p)) return "Conservative";
  if (/^Scottish National Party \(SNP\)$/i.test(p)) return "SNP";
  if (/^Plaid Cymru/i.test(p)) return "Plaid Cymru";
  if (/^Workers Party of Britain$/i.test(p)) return "Workers Party";
  if (/^Scottish Green Party$/i.test(p)) return "Green Party";
  if (/^Social Democratic Party$/i.test(p)) return "SDP";
  if (/^Liberal Democrats?$/i.test(p)) return "Liberal Democrats";
  if (/^Reform UK$/i.test(p)) return "Reform UK";
  if (/^Green Party$/i.test(p)) return "Green Party";
  if (/independent/i.test(p)) return "Independent";
  return p;
}

function rankCandidates(candidates) {
  return [...candidates].sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0));
}

function shareOf(candidate, totalVotes) {
  if (!totalVotes || totalVotes <= 0) return null;
  return (candidate.votes ?? 0) / totalVotes;
}

function majorityOf(ranked) {
  if (ranked.length < 2) return { majority: null, majority_pct: null };
  const top = ranked[0]?.votes ?? 0;
  const second = ranked[1]?.votes ?? 0;
  return { majority: top - second, majority_pct: null };
}

function dcResultToHistoryRow(result, defaultType = "borough") {
  const total = (result.candidates || []).reduce((s, c) => s + (c.votes ?? 0), 0);
  const ranked = rankCandidates(result.candidates || []);
  const seatsContested = (result.candidates || []).filter((c) => c.elected).length || 1;
  const candidatesOut = ranked.map((c, i) => ({
    name: c.name,
    party: dcPartyToCanonical(c.party_name),
    party_dc: c.party_name,
    votes: c.votes,
    pct: shareOf(c, total),
    elected: c.elected === true,
    rank: i + 1,
  }));
  const { majority, majority_pct } = majorityOf(ranked);
  const totalForMajPct = candidatesOut[0]?.pct != null && candidatesOut[1]?.pct != null
    ? candidatesOut[0].pct - candidatesOut[1].pct
    : null;
  return {
    date: result.election_date,
    year: result.year,
    type: result.is_by_election ? "by-election" : defaultType,
    seats_contested: seatsContested,
    turnout_votes: result.turnout_votes ?? total ?? null,
    turnout: result.turnout_pct,
    electorate: result.electorate,
    candidates: candidatesOut,
    majority,
    majority_pct: totalForMajPct,
    source: result.source || null,
    ballot_paper_id: result.ballot_paper_id,
  };
}

function defaultTypeForTier(tier) {
  return {
    local: "borough",
    mayor: "mayor",
    senedd: "senedd",
    holyrood: "holyrood",
    pcc: "pcc",
  }[tier] || "borough";
}

/**
 * Build wardData for a given identity entry.
 * @param {object} identityWard - one element from data/identity/wards-may-2026.json#wards
 * @param {object} historyBundle - data/history/dc-historic-results.json
 * @returns {object} wardData
 */
export function buildWardData(identityWard, historyBundle) {
  const tier = identityWard.tier;
  const wardKey = `${tier}::${identityWard.council_slug}::${identityWard.ward_slug}`;
  const ballotIds = (historyBundle?.by_ward_slug || {})[wardKey] || [];
  const defaultType = defaultTypeForTier(tier);

  const history = ballotIds
    .map((id) => historyBundle.by_ballot[id])
    .filter(Boolean)
    .filter((r) => r.election_date !== identityWard.election_group_id?.split(".").pop())
    .map((r) => dcResultToHistoryRow(r, defaultType))
    .sort((a, b) => a.date.localeCompare(b.date));

  const candidates2026 = (identityWard.parties_standing || []).map((p) => ({
    party: dcPartyToCanonical(p),
    party_dc: p,
  }));

  return {
    gss_code: identityWard.gss_code,
    ward_name: identityWard.ward_name,
    council_slug: identityWard.council_slug,
    council_name: identityWard.council_name,
    seats: identityWard.winner_count,
    current_holders: [],
    electorate: history.find((h) => h.electorate)?.electorate ?? null,
    history,
    candidates_2026: candidates2026,
    _meta: {
      ballot_paper_id: identityWard.ballot_paper_id,
      tier,
      cancelled: identityWard.cancelled,
      sopn_url: identityWard.sopn_url,
      history_source: "democracy_club_results_api",
      history_count: history.length,
    },
  };
}

/**
 * Build wardData for every ward in the identity table.
 * Returns a Map keyed by ballot_paper_id.
 */
export function buildAllWardData(identity, historyBundle) {
  const map = new Map();
  for (const w of identity.wards) {
    map.set(w.ballot_paper_id, buildWardData(w, historyBundle));
  }
  return map;
}
