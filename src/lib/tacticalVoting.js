/**
 * tacticalVoting.js — Curtice/Fisher-style tactical voting overlay.
 *
 * Empirical pattern (BES 2024): Lab/LD/Green voters in seats where their
 * preferred party is well behind in 3rd place are more likely to vote for
 * the 2nd-placed of those three (the "best progressive" tactical shift).
 * Strongest where the 2nd-placed is within winning distance of the 1st.
 *
 * Mechanism:
 *   - Sort parties by share descending.
 *   - If the 1st party is Conservative or Reform AND the 2nd is one of
 *     {Labour, Liberal Democrats, Green Party} AND the gap 1st→2nd is ≤
 *     `competitivenessGap` (default 0.10) AND the 3rd-placed is one of
 *     the other two of those three with share ≥ `tacticalFloor` (default 0.05),
 *     transfer `transferRate` (default 0.30) of the 3rd's share to the 2nd.
 *   - Skip when the 2nd-placed is Conservative or Reform (no progressive
 *     tactical case to make).
 *
 * Reference: Fisher 2004 "Tactical voting and tactical non-voting"
 * https://users.ox.ac.uk/~nuff0084/FisherTT.pdf
 *
 * @param {Object<string,number>} shares - per-party share 0..1
 * @param {Object} [opts]
 * @returns {{ shares: Object<string,number>, applied: { donor, recipient, amount } | null }}
 */
const PROGRESSIVE_PARTIES = new Set(["Labour", "Liberal Democrats", "Green Party"]);

export function applyTacticalVoting(shares, opts = {}) {
  const competitivenessGap = opts.competitivenessGap ?? 0.10;
  const tacticalFloor = opts.tacticalFloor ?? 0.05;
  const transferRate = opts.transferRate ?? 0.15;

  if (!shares || Object.keys(shares).length < 3) return { shares: { ...(shares || {}) }, applied: null };

  const sorted = Object.entries(shares).sort((a, b) => b[1] - a[1]);
  const first = sorted[0];
  const second = sorted[1];
  const third = sorted[2];
  if (!first || !second || !third) return { shares: { ...shares }, applied: null };

  // Tactical scenario only fires when 1st is Con or Reform (the party
  // progressives want to defeat) AND 2nd is one of the progressive parties.
  if (!["Conservative", "Reform UK"].includes(first[0])) return { shares: { ...shares }, applied: null };
  if (!PROGRESSIVE_PARTIES.has(second[0])) return { shares: { ...shares }, applied: null };

  // The 1st-2nd gap must be small enough that tactical voting matters
  if (first[1] - second[1] > competitivenessGap) return { shares: { ...shares }, applied: null };

  // The 3rd-placed must be a progressive donor with non-trivial support
  if (!PROGRESSIVE_PARTIES.has(third[0])) return { shares: { ...shares }, applied: null };
  if (third[1] < tacticalFloor) return { shares: { ...shares }, applied: null };

  const transferAmount = third[1] * transferRate;
  const newShares = { ...shares };
  newShares[third[0]] = third[1] - transferAmount;
  newShares[second[0]] = second[1] + transferAmount;
  return {
    shares: newShares,
    applied: { donor: third[0], recipient: second[0], amount: transferAmount, gap: first[1] - second[1] },
  };
}
