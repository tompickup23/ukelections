/**
 * antiAttenuation.js — moments-matched "unwinding" against historic spread.
 *
 * MRP and other models tend to over-shrink (attenuation bias) — the predicted
 * distribution of constituency vote shares is "flatter" than the historic
 * one. YouGov's 2024 unwinding algorithm calibrates the posterior spread per
 * party so it matches the historic between-PCON variance for that party.
 *
 * Implementation: a per-party rescale around the national mean.
 *
 *   adjusted_share_p_i = mean_p + (share_p_i - mean_p) * gamma_p
 *
 * where gamma_p = sigma_historic_p / sigma_predicted_p (clipped to [0.5, 2.5]
 * to avoid amplifying weak signals on tiny parties).
 *
 * After rescale we re-normalise so each constituency's shares sum to 1.
 *
 * Pure function. Operates over an array of constituency-prediction objects.
 *
 * @param {Array<{shares: Object<string,number>}>} predictions
 *        Array of per-constituency prediction blocks. Each must have a
 *        `shares` field with party→share floats.
 * @param {Object<string,number>} historicSigmas - per-party SD of share across PCONs
 *        from a historic election. Computed once in the calibration step.
 * @param {Object} [opts]
 *        - clipMin: minimum allowed gamma (default 0.5)
 *        - clipMax: maximum allowed gamma (default 2.5)
 *        - parties: explicit party list to operate on; defaults to union of all
 * @returns {{
 *   adjusted: Array<{shares: Object<string,number>}>,
 *   gammas: Object<string, number>,
 *   stats: { meansBefore, sigmasBefore, meansAfter, sigmasAfter }
 * }}
 */
export function applyAntiAttenuation(predictions, historicSigmas, opts = {}) {
  const clipMin = opts.clipMin ?? 0.5;
  const clipMax = opts.clipMax ?? 2.5;

  const partySet = new Set(opts.parties || []);
  if (partySet.size === 0) {
    for (const pred of predictions) {
      for (const p of Object.keys(pred.shares || {})) partySet.add(p);
    }
  }
  const parties = [...partySet];

  // Compute mean + sigma per party across the prediction set
  const meansBefore = {};
  const sigmasBefore = {};
  for (const p of parties) {
    const vals = predictions.map((pred) => pred.shares?.[p] || 0);
    const mean = vals.reduce((s, v) => s + v, 0) / Math.max(1, vals.length);
    const variance = vals.reduce((s, v) => s + (v - mean) * (v - mean), 0) / Math.max(1, vals.length - 1);
    meansBefore[p] = mean;
    sigmasBefore[p] = Math.sqrt(variance);
  }

  // gamma_p = sigma_historic / sigma_before (clipped)
  const gammas = {};
  for (const p of parties) {
    const sigHist = historicSigmas[p];
    if (!sigHist || sigHist <= 0 || !sigmasBefore[p] || sigmasBefore[p] <= 0) {
      gammas[p] = 1; // no rescale if data is missing or degenerate
      continue;
    }
    let g = sigHist / sigmasBefore[p];
    if (g < clipMin) g = clipMin;
    if (g > clipMax) g = clipMax;
    gammas[p] = g;
  }

  // Apply per-PCON rescale, then re-normalise to sum to 1
  const adjusted = predictions.map((pred) => {
    const newShares = { ...(pred.shares || {}) };
    for (const p of parties) {
      const m = meansBefore[p];
      const original = newShares[p] || 0;
      const rescaled = m + (original - m) * gammas[p];
      newShares[p] = Math.max(0, Math.min(1, rescaled));
    }
    const sum = Object.values(newShares).reduce((s, v) => s + v, 0);
    if (sum > 0) {
      for (const p of Object.keys(newShares)) newShares[p] = newShares[p] / sum;
    }
    return { ...pred, shares: newShares };
  });

  // Stats after
  const meansAfter = {};
  const sigmasAfter = {};
  for (const p of parties) {
    const vals = adjusted.map((pred) => pred.shares?.[p] || 0);
    const mean = vals.reduce((s, v) => s + v, 0) / Math.max(1, vals.length);
    const variance = vals.reduce((s, v) => s + (v - mean) * (v - mean), 0) / Math.max(1, vals.length - 1);
    meansAfter[p] = mean;
    sigmasAfter[p] = Math.sqrt(variance);
  }

  return {
    adjusted,
    gammas,
    stats: { meansBefore, sigmasBefore, meansAfter, sigmasAfter },
  };
}

/**
 * Compute per-party historic sigma from a set of past constituency results.
 * Useful as the calibration target for applyAntiAttenuation.
 *
 * @param {Array<{shares: Object<string,number>}>} historicResults
 * @param {string[]} [parties] - explicit party list; defaults to union
 * @returns {Object<string,number>}
 */
export function computeHistoricSigmas(historicResults, parties = null) {
  const partySet = new Set(parties || []);
  if (partySet.size === 0) {
    for (const r of historicResults) {
      for (const p of Object.keys(r.shares || {})) partySet.add(p);
    }
  }
  const out = {};
  for (const p of [...partySet]) {
    const vals = historicResults.map((r) => r.shares?.[p] || 0);
    const mean = vals.reduce((s, v) => s + v, 0) / Math.max(1, vals.length);
    const variance = vals.reduce((s, v) => s + (v - mean) * (v - mean), 0) / Math.max(1, vals.length - 1);
    out[p] = Math.sqrt(variance);
  }
  return out;
}
