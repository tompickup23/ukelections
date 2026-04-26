/**
 * independentEntrenchment.js — handle wards where the most recent borough
 * cycle was won decisively by a non-major-party candidate (Independent,
 * Workers Party, etc.) whose personal vote is hyperlocal and is NOT
 * represented in cross-tier county-cycle results.
 *
 * Two related symptoms the model needs to handle:
 *
 *   1. **2025 county-cycle anchor wash-out.** The Final-B step blends
 *      borough predictions toward the parent county's May 2025 result at
 *      a default 0.45 weight. County divisions are 4× the size of borough
 *      wards and tend to have major-party candidates only — there's no
 *      Independent on the 2025 LCC ballot for Bank Hall, Daneshouse, or
 *      Queensgate. Blending in the LCC result therefore drags the local
 *      Independent share back DOWN toward Labour/Reform. The fix is to
 *      drop the anchor weight to 0.10 in any ward whose most-recent
 *      borough cycle had a single non-major-party candidate ≥40%.
 *
 *   2. **Post-2023 Muslim-majority defection crystallisation.** Wards
 *      like Bank Hall and Daneshouse moved from Labour ~80% in 2023 to
 *      Labour ~25% in 2024 (the rest going to Independents over Gaza).
 *      The 2024 result IS the model's baseline, so the shift is captured
 *      for THAT cycle — but the model otherwise treats 2024 as the
 *      starting point of a normal regression to a major-party share. Tom
 *      observes the trend will continue (sitting Independents have built
 *      a personal vote and are entrenched, not regressing). We need to
 *      detect the pattern and add a small continuation bonus to the
 *      Independent share on top of the 2024 baseline.
 *
 * Pure functions; no I/O.
 */

const MAJOR_CANONICAL = new Set([
  "Labour",
  "Conservative",
  "Liberal Democrats",
  "Reform UK",
  "Green Party",
  "Plaid Cymru",
  "SNP",
]);

/**
 * Inspect the most-recent borough cycle in `historyRows` and return
 * { entrenched: bool, party: string|null, share: number, name: string|null }.
 *
 * `entrenched=true` means a single non-major-party candidate took ≥40%
 * of the vote — the kind of personal-vote stronghold whose share will
 * NOT show up in a county-cycle anchor.
 */
export function detectLocalNonMajorEntrenchment(historyRows, threshold = 0.40) {
  if (!Array.isArray(historyRows) || historyRows.length === 0) {
    return { entrenched: false, party: null, share: 0, name: null };
  }
  const cycles = historyRows.filter((r) => r.type !== "by-election");
  const latest = cycles[cycles.length - 1] || historyRows[historyRows.length - 1];
  if (!latest?.candidates?.length) {
    return { entrenched: false, party: null, share: 0, name: null };
  }
  // Find the largest non-major candidate. Independents share a label so we
  // don't sum across separate Independents — only the leading individual.
  let leader = null;
  for (const c of latest.candidates) {
    if (MAJOR_CANONICAL.has(c.party)) continue;
    if (!leader || (c.pct || 0) > (leader.pct || 0)) leader = c;
  }
  if (!leader || (leader.pct || 0) < threshold) {
    return { entrenched: false, party: null, share: 0, name: null };
  }
  return {
    entrenched: true,
    party: leader.party,
    share: leader.pct,
    name: leader.name || null,
    election_date: latest.date || null,
  };
}

/**
 * Detect the post-2023 Labour-to-non-major defection pattern.
 *
 * Returns { defected: bool, donor: string, recipient: string, drop_pp: number,
 * recipient_share_2024: number } when:
 *   - the 2022 OR 2023 cycle had Labour at ≥0.50 of the vote, AND
 *   - the most recent cycle (typically 2024) shows Labour at ≤0.40, AND
 *   - the swing went to a non-major-party candidate (Independent, etc.)
 *     who ended up first or a strong second
 *
 * The continuation bonus from this signal applies on top of the 2024
 * baseline for the matching non-major party, IF that party still has a
 * candidate on the 2026 ballot. Bonus magnitude is half the 2023→2024
 * Labour drop, capped at +10pp, applied to the non-major recipient.
 *
 * Examples this fires on:
 *   Bank Hall:   2023 Lab 79% → 2024 Lab 26% (Indep 42% recipient)
 *   Daneshouse:  2023 Lab 76% → 2024 Lab 11% (Indep 56% recipient)
 *   Queensgate:  2023 Lab 65% → 2024 Lab 17% (Indep 60% recipient)
 *
 * Does NOT fire on Coal Clough (LD stronghold; recipient was LD, a
 * major) or Brunshaw (Labour held in 2024).
 */
export function detectDefectionCrystallisation(historyRows) {
  const fail = { defected: false };
  if (!Array.isArray(historyRows) || historyRows.length < 2) return fail;
  const cycles = historyRows.filter((r) => r.type !== "by-election");
  if (cycles.length < 2) return fail;
  const latest = cycles[cycles.length - 1];
  const prior = cycles[cycles.length - 2];
  if (!latest?.candidates?.length || !prior?.candidates?.length) return fail;

  const labPrior = prior.candidates.find((c) => c.party === "Labour");
  const labLatest = latest.candidates.find((c) => c.party === "Labour");
  if (!labPrior || !labLatest) return fail;

  const priorShare = labPrior.pct || 0;
  const latestShare = labLatest.pct || 0;
  if (priorShare < 0.50) return fail;
  if (latestShare > 0.40) return fail;
  const drop = priorShare - latestShare;
  if (drop < 0.25) return fail;

  // Find the non-major recipient — the highest non-major share in `latest`
  let recipient = null;
  for (const c of latest.candidates) {
    if (MAJOR_CANONICAL.has(c.party)) continue;
    if (!recipient || (c.pct || 0) > (recipient.pct || 0)) recipient = c;
  }
  if (!recipient) return fail;
  // Recipient must be top 2 of the latest cycle for the signal to count
  const ranked = [...latest.candidates].sort((a, b) => (b.pct || 0) - (a.pct || 0));
  const recipientRank = ranked.indexOf(recipient) + 1;
  if (recipientRank > 2) return fail;

  return {
    defected: true,
    donor: "Labour",
    recipient: recipient.party,
    recipient_name: recipient.name || null,
    drop_pp: drop,
    recipient_share_2024: recipient.pct,
    prior_year: prior.year,
    latest_year: latest.year,
  };
}

/**
 * Apply the continuation bonus to the prediction map. Bonus = min(drop_pp/2,
 * 0.10), added to the recipient party's share, taken pro-rata from every
 * other party. No-op if the recipient is not on the 2026 ballot.
 */
export function applyDefectionBonus(prediction, signal, partiesOnBallot) {
  if (!signal?.defected) return { prediction: { ...(prediction || {}) }, applied: null };
  if (!partiesOnBallot?.has(signal.recipient)) {
    return { prediction: { ...prediction }, applied: { ...signal, skipped: "recipient not on 2026 ballot" } };
  }
  const bonus = Math.min(signal.drop_pp / 2, 0.10);
  const out = { ...prediction };
  const recipientCurrent = (out[signal.recipient]?.pct ?? out[signal.recipient]) || 0;
  // Determine the share value type — some callers pass `{ Party: 0.43 }`,
  // some pass `{ Party: { pct: 0.43, votes: ... } }`. Detect once.
  const isObjectShape = typeof out[signal.recipient] === "object" && out[signal.recipient] !== null;

  // Compute donor pool (everything except the recipient)
  let donorPool = 0;
  for (const [p, v] of Object.entries(out)) {
    if (p === signal.recipient) continue;
    donorPool += isObjectShape ? (v?.pct || 0) : (v || 0);
  }
  if (donorPool <= 0) return { prediction: out, applied: { ...signal, skipped: "no donor pool" } };

  // Cap bonus by available donor headroom (don't push donors below 0)
  const effectiveBonus = Math.min(bonus, donorPool);
  // Boost recipient
  if (isObjectShape) {
    out[signal.recipient] = { ...out[signal.recipient], pct: recipientCurrent + effectiveBonus };
  } else {
    out[signal.recipient] = recipientCurrent + effectiveBonus;
  }
  // Pro-rata reduce donors
  for (const [p, v] of Object.entries(out)) {
    if (p === signal.recipient) continue;
    const pct = isObjectShape ? (v?.pct || 0) : (v || 0);
    const reduced = pct - effectiveBonus * (pct / donorPool);
    if (isObjectShape) out[p] = { ...v, pct: Math.max(0, reduced) };
    else out[p] = Math.max(0, reduced);
  }
  return {
    prediction: out,
    applied: {
      ...signal,
      bonus_applied: effectiveBonus,
      recipient_predicted_after: isObjectShape ? out[signal.recipient].pct : out[signal.recipient],
    },
  };
}
