/**
 * Per-party bias calibration.
 *
 * The 7 May 2026 post-audit showed the ward model carries a systematic,
 * near-constant per-party offset: it ran the Greens 7.6 points cold and Labour
 * 6.1 points hot across 2,903 wards. That is not noise. Fitted on four fifths of
 * councils and tested on the held-out fifth, subtracting the offset improved the
 * held-out wards in all five folds: winner accuracy +4.77pp and major-party MAE
 * -0.91pp on average. The fitted values are stable across folds (Green sd 0.14pp,
 * Labour sd 0.20pp), which is what tells you it is a real constant rather than
 * something fitted to the fold.
 *
 * Circularity is the trap here. Applying a correction to the same election it was
 * fitted on scores the answer key and means nothing, so `applyPartyBias` refuses
 * to touch any election listed in the calibration's `do_not_apply_to`.
 *
 * The offset is an empirical patch, not an explanation. Refit it after every real
 * election with scripts/calibrate-party-bias.mjs, and if a refit moves a party by
 * more than its fold standard deviation, the underlying model has changed
 * behaviour and that is worth understanding rather than patching over.
 */

/**
 * @param {object|null} calibration - parsed data/calibration/party-bias.json
 * @param {string} electionGroupId - the election being predicted
 * @returns {boolean}
 */
export function calibrationApplies(calibration, electionGroupId) {
  if (!calibration?.parties) return false;
  if (!electionGroupId) return true;
  // Election group ids are `local.<council>.<date>`, so a fit label of
  // `local.2026-05-07` never matches one by string equality. Compare the
  // polling date, which is what actually identifies the election. Getting this
  // wrong is silent and expensive: the first version applied a May 2026
  // correction to 2,600 May 2026 wards and reported a lift that was pure
  // self-scoring.
  const dateOf = (id) => String(id).split(".").pop();
  const target = dateOf(electionGroupId);
  const blocked = [
    ...(calibration.do_not_apply_to || []),
    calibration.fitted_on,
    calibration.fitted_on_date,
  ].filter(Boolean);
  return !blocked.some((id) => dateOf(id) === target);
}

/**
 * Subtract the fitted per-party offset from a prediction and renormalise.
 * Shares are clamped at zero: a party cannot be corrected below nothing.
 *
 * @param {object} prediction - { party: { pct, ... } }
 * @param {object} bias - { party: signedOffsetAsFraction }
 * @returns {{ prediction: object, applied: boolean, shifted: object }}
 */
export function applyPartyBias(prediction, bias) {
  if (!prediction || !bias) return { prediction, applied: false, shifted: {} };
  const out = {};
  const shifted = {};
  let total = 0;
  for (const [party, payload] of Object.entries(prediction)) {
    const before = payload?.pct || 0;
    const after = Math.max(0, before - (bias[party] || 0));
    if (after !== before) shifted[party] = Number((after - before).toFixed(6));
    out[party] = { ...payload, pct: after };
    total += after;
  }
  if (total <= 0) return { prediction, applied: false, shifted: {} };
  for (const party of Object.keys(out)) out[party].pct = out[party].pct / total;
  return { prediction: out, applied: Object.keys(shifted).length > 0, shifted };
}
