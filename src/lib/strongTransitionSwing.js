/**
 * strongTransitionSwing.js — Martin Baxter's Strong Transition Model (STM).
 *
 * Why: replaces additive uniform-national-swing (UNS) for predicting
 * constituency vote shares from a baseline + national change. UNS is
 * unbounded (a 4pp national fall in a party with 5% local share gives -1%);
 * STM is multiplicative and bounded in [0, 1] by construction.
 *
 * Mechanism (for a single PCON):
 *   1. Compute national gain/loss per party: delta_p = polling_p - past_p.
 *   2. Losers (delta < 0) shed share locally in proportion to their LOCAL
 *      share, scaled so total loss matches national loss share.
 *   3. Gainers (delta > 0) absorb the freed share in proportion to their
 *      national gain weights.
 *
 * Pure function. Never mutates inputs.
 *
 * Reference:
 *   Electoral Calculus / Britain Predicts STM explainer
 *   https://www.electoralcalculus.co.uk/blogs/ec_mrpinfo_20240604.html
 *
 * @param {Object<string,number>} localBaseline - per-party SHARE 0..1 in this PCON
 * @param {Object<string,number>} nationalNow   - per-party national SHARE 0..1
 * @param {Object<string,number>} nationalPast  - per-party past national SHARE
 * @param {Object} [opts] - { dampening?: 0..1 — apply *dampening* to the national delta
 *                            before propagation (default 1.0 = full national swing) }
 * @returns {{ shares: Object<string,number>, swingsApplied: Object<string,{delta:number,localChange:number}> }}
 */
export function applyStrongTransitionSwing(localBaseline, nationalNow, nationalPast, opts = {}) {
  const dampening = typeof opts.dampening === "number" ? opts.dampening : 1.0;

  // Universe of parties = union of inputs
  const parties = new Set([
    ...Object.keys(localBaseline || {}),
    ...Object.keys(nationalNow || {}),
    ...Object.keys(nationalPast || {}),
  ]);

  // Compute per-party national delta (dampened)
  const delta = {};
  for (const p of parties) {
    const now = nationalNow[p] || 0;
    const past = nationalPast[p] || 0;
    delta[p] = (now - past) * dampening;
  }

  // Identify losers (delta < 0) and gainers (delta > 0)
  const losers = [...parties].filter((p) => delta[p] < 0);
  const gainers = [...parties].filter((p) => delta[p] > 0);

  // Total national loss share that must be redistributed
  const totalLoss = losers.reduce((s, p) => s - delta[p], 0); // delta is negative; sum of -delta is positive
  const totalGain = gainers.reduce((s, p) => s + delta[p], 0);

  const localShares = { ...localBaseline };
  const swingsApplied = {};
  for (const p of parties) swingsApplied[p] = { delta: delta[p], localChange: 0 };

  if (totalLoss === 0 && totalGain === 0) {
    return { shares: localShares, swingsApplied };
  }

  // Step 1: losers shed share locally in proportion to their local share,
  // capped so they don't go below 0. We compute a per-loser scale:
  //   scale_p = -delta_p / past_p  (national loss rate per loser)
  // Local change_p = -localShares[p] * scale_p
  // This is the multiplicative "Strong Transition" property: a loser's
  // local share falls by the SAME PROPORTION as its national share.
  let totalLocalShed = 0;
  for (const p of losers) {
    const past = nationalPast[p] || 0;
    if (past <= 0) {
      continue; // no past share to scale by
    }
    const scale = Math.min(1, -delta[p] / past);
    const localShed = (localShares[p] || 0) * scale;
    swingsApplied[p].localChange = -localShed;
    localShares[p] = (localShares[p] || 0) - localShed;
    totalLocalShed += localShed;
  }

  // Step 2: gainers absorb totalLocalShed split by their national gain ratio
  if (totalGain > 0 && totalLocalShed > 0) {
    for (const p of gainers) {
      const weight = delta[p] / totalGain;
      const absorbed = totalLocalShed * weight;
      swingsApplied[p].localChange = absorbed;
      localShares[p] = (localShares[p] || 0) + absorbed;
    }
  }

  // Defensive: clamp to [0, 1]
  for (const p of Object.keys(localShares)) {
    if (localShares[p] < 0) localShares[p] = 0;
    if (localShares[p] > 1) localShares[p] = 1;
  }

  return { shares: localShares, swingsApplied };
}
