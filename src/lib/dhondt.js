/**
 * dhondt.js — d'Hondt highest-averages list-PR allocator.
 *
 * Used for:
 *   - Senedd Cymru 2026: 16 super-constituencies × 6 list seats (closed list)
 *   - Holyrood 2026 regions: 8 regions × 7 list seats (each region has
 *     constituency seats already won — list seats compensate using
 *     d'Hondt over (party_votes / (1 + constituency_seats_won + iter)))
 *
 * Pure functions. No external dependencies.
 */

/**
 * Pure d'Hondt allocation over a vote map.
 * @param {Object<string, number>} votes - {party: votes}
 * @param {number} seats - total seats to allocate
 * @param {Object} [opts]
 * @param {Object<string, number>} [opts.priorSeats] - constituency seats already won by each party
 *   (Holyrood regional list mode — the divisor starts at 1 + priorSeats[party]).
 * @returns {{ allocations: Object<string, number>, sequence: Array<{step:number, party:string, quotient:number}> }}
 */
export function allocateDhondt(votes, seats, opts = {}) {
  const priorSeats = opts.priorSeats || {};
  const allocations = {};
  const sequence = [];
  for (const party of Object.keys(votes)) {
    allocations[party] = 0;
  }
  for (let step = 1; step <= seats; step += 1) {
    let bestParty = null;
    let bestQuotient = -Infinity;
    for (const party of Object.keys(votes)) {
      const v = votes[party] || 0;
      if (v <= 0) continue;
      const divisor = 1 + (priorSeats[party] || 0) + (allocations[party] || 0);
      const quotient = v / divisor;
      if (quotient > bestQuotient) {
        bestQuotient = quotient;
        bestParty = party;
      }
    }
    if (!bestParty) break;
    allocations[bestParty] = (allocations[bestParty] || 0) + 1;
    sequence.push({ step, party: bestParty, quotient: bestQuotient });
  }
  return { allocations, sequence };
}

/**
 * Allocate seats with bootstrap intervals.
 * Re-runs allocation across N samples drawn from independent dirichlet-like
 * perturbations of party shares to produce P10/P50/P90 bands.
 *
 * Inputs:
 *   shares: {party: share_in_0_1}
 *   totalVotes: rough total ballot count (controls noise scale)
 *   seats: total seats
 *   priorSeats: optional Holyrood-style prior counts
 *   intervalSamples: e.g. 1000
 *   sigma: per-party share noise (std-dev), default 0.03 = ±3pp
 *
 * Returns each party's seat count distribution + p10/p50/p90 + win_probability
 * (probability of winning at least 1 seat).
 *
 * Pure deterministic given a seed (uses a small PRNG).
 */
export function allocateDhondtWithIntervals({
  shares,
  totalVotes = 100000,
  seats,
  priorSeats = {},
  intervalSamples = 1000,
  sigma = 0.03,
  seed = 1,
}) {
  const parties = Object.keys(shares);
  const counts = Object.fromEntries(parties.map((p) => [p, []]));

  let s = seed >>> 0;
  const next = () => {
    // mulberry32
    s += 0x6D2B79F5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gaussian = () => {
    // Box-Muller
    const u = Math.max(1e-12, next());
    const v = next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  for (let i = 0; i < intervalSamples; i += 1) {
    const noisy = {};
    let sum = 0;
    for (const p of parties) {
      const noisy_p = Math.max(0, shares[p] + gaussian() * sigma);
      noisy[p] = noisy_p;
      sum += noisy_p;
    }
    if (sum <= 0) continue;
    const votes = {};
    for (const p of parties) votes[p] = (noisy[p] / sum) * totalVotes;
    const { allocations } = allocateDhondt(votes, seats, { priorSeats });
    for (const p of parties) counts[p].push(allocations[p] || 0);
  }

  const summary = {};
  const central = allocateDhondt(
    Object.fromEntries(parties.map((p) => [p, shares[p] * totalVotes])),
    seats,
    { priorSeats },
  );
  for (const p of parties) {
    const arr = counts[p].slice().sort((a, b) => a - b);
    const pct = (q) => arr[Math.floor(q * (arr.length - 1))] || 0;
    summary[p] = {
      p10: pct(0.1),
      p50: pct(0.5),
      p90: pct(0.9),
      central: central.allocations[p] || 0,
      win_probability: arr.length ? arr.filter((c) => c >= 1).length / arr.length : 0,
    };
  }
  return { per_party: summary, central: central.allocations };
}
