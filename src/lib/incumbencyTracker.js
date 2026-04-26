/**
 * incumbencyTracker.js — sitting MP / standing-down / defected adjustments
 * for general election forecasts.
 *
 * Empirical effect sizes (post-2024 evidence):
 *   - Sitting MP standing again, tenure ≥ 10 years: +2 to +4pp personal vote
 *   - Sitting MP retiring: strip the personal-vote bonus AND apply a 2-3pp drag
 *     (Brady, May, Wallace seats all swung larger than non-retirement controls)
 *   - Defector / suspended MP: treat as fresh open seat (covers Andrew Gwynne)
 *
 * Pure functions.
 */

/**
 * Apply the incumbency / retirement / defection adjustment to a per-party
 * share vector.
 *
 * @param {Object<string,number>} shares - per-party shares (mutable copy returned)
 * @param {Object} mp - { party, tenure_years, status }
 *        status ∈ { 'standing_again', 'retiring', 'defected', 'suspended', 'unknown' }
 * @returns {{ shares, applied: { party, delta, reason } | null }}
 */
export function applyIncumbencyAdjustment(shares, mp) {
  if (!mp || !mp.party || !shares) return { shares: { ...(shares || {}) }, applied: null };
  const out = { ...shares };
  const tenure = Number(mp.tenure_years) || 0;
  const status = String(mp.status || "unknown").toLowerCase();

  // Personal vote adjustment for standing-again incumbents
  if (status === "standing_again" && (out[mp.party] ?? 0) > 0) {
    let personalVote = 0;
    if (tenure >= 20) personalVote = 0.04;
    else if (tenure >= 10) personalVote = 0.03;
    else if (tenure >= 5) personalVote = 0.02;
    else personalVote = 0.01;
    out[mp.party] = (out[mp.party] || 0) + personalVote;
    return { shares: out, applied: { party: mp.party, delta: personalVote, reason: `standing again, ${tenure}yr tenure` } };
  }

  // Retirement penalty
  if (status === "retiring" && (out[mp.party] ?? 0) > 0) {
    let retirementDrag = 0;
    if (tenure >= 20) retirementDrag = 0.03;
    else if (tenure >= 10) retirementDrag = 0.025;
    else retirementDrag = 0.02;
    out[mp.party] = Math.max(0, (out[mp.party] || 0) - retirementDrag);
    return { shares: out, applied: { party: mp.party, delta: -retirementDrag, reason: `retiring after ${tenure}yr tenure` } };
  }

  // Defected/suspended — treat as open seat: strip 1.5pp from former party
  if ((status === "defected" || status === "suspended") && (out[mp.party] ?? 0) > 0) {
    const drag = 0.015;
    out[mp.party] = Math.max(0, (out[mp.party] || 0) - drag);
    return { shares: out, applied: { party: mp.party, delta: -drag, reason: `${status}, treated as open seat` } };
  }

  return { shares: out, applied: null };
}

/**
 * Build a default sitting-MP roster from GE2024 winners.
 * Each PCON's GE2024 winner is the sitting MP unless overridden by a
 * by-election. Tenure_years defaults to 1 (sworn in July 2024) for non-
 * by-election winners. Status defaults to 'standing_again' until a
 * standing-down list overrides.
 *
 * @param {Array} pcons - identity records from data/identity/pcons-ge-next.json
 * @param {Array} byElectionResults - DC parl by-election results post-2024-07-04
 * @param {Object} [standingDownMap] - { slug: { status: 'retiring'|'standing_again'|... } }
 * @returns {Object<string, {party, tenure_years, status, name, source}>}
 */
export function buildMpRosterFromGe2024(pcons, byElectionResults = [], standingDownMap = {}) {
  const today = new Date();
  const ge2024Date = new Date("2024-07-04");

  const byElectionBySlug = new Map();
  for (const r of byElectionResults) {
    if (!r.is_by_election || !r.election_date || !r.ward_slug) continue;
    if (r.election_date <= "2024-07-04") continue;
    if (!byElectionBySlug.has(r.ward_slug) || r.election_date > byElectionBySlug.get(r.ward_slug).election_date) {
      byElectionBySlug.set(r.ward_slug, r);
    }
  }

  const roster = {};
  for (const p of pcons) {
    const winner = p.ge2024?.winner_party;
    if (!winner) continue;
    const slug = p.slug;
    const byElection = byElectionBySlug.get(slug);
    let party = winner;
    let name = p.ge2024?.winner_name || null;
    let sourceDate = "2024-07-04";
    if (byElection) {
      const ranked = [...(byElection.candidates || [])].sort((a, b) => (b.votes || 0) - (a.votes || 0));
      if (ranked[0]?.party_name) {
        party = ranked[0].party_name;
        name = ranked[0].name || name;
        sourceDate = byElection.election_date;
      }
    }
    const elected = new Date(sourceDate);
    const tenureYears = Math.max(0, (today - elected) / (365.25 * 86400_000));
    const override = standingDownMap[slug];
    const status = override?.status || "standing_again";
    roster[slug] = {
      party,
      name,
      tenure_years: Number(tenureYears.toFixed(2)),
      status,
      source: byElection ? "by_election" : "ge_2024",
      since: sourceDate,
    };
  }
  return roster;
}
