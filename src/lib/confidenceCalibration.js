/**
 * Calibrated winner probability.
 *
 * The old three-band confidence label described how much input data a ward had,
 * not how often the model was right, and the 7 May 2026 post-audit showed it was
 * inverted at the top: wards labelled "high" were called correctly 55.5% of the
 * time against 58.6% for "medium". A label that ranks backwards is worse than no
 * label, because readers price it in.
 *
 * The replacement is the realised hit rate binned by predicted margin between
 * first and second place, fitted by scripts/calibrate-confidence.mjs. On councils
 * the curve never saw it beats quoting a flat base rate on Brier score, which is
 * the metric that rewards being both calibrated and discriminating.
 *
 * The band is now derived from the number rather than the other way round.
 */

/** Same date-based guard as the bias calibration: never score the answer key. */
export function confidenceApplies(calibration, electionGroupId) {
  if (!calibration?.bins?.length) return false;
  if (!electionGroupId) return true;
  const dateOf = (id) => String(id).split(".").pop();
  const target = dateOf(electionGroupId);
  const blocked = [
    ...(calibration.do_not_apply_to || []),
    calibration.fitted_on,
    calibration.fitted_on_date,
  ].filter(Boolean);
  return !blocked.some((id) => dateOf(id) === target);
}

/** Margin between the top two shares, or null when fewer than two parties stand. */
export function predictedMargin(prediction) {
  const ranked = Object.values(prediction || {})
    .map((p) => p?.pct || 0)
    .sort((a, b) => b - a);
  if (ranked.length < 2) return null;
  return ranked[0] - ranked[1];
}

/**
 * @returns {{ winner_probability: number, band: "high"|"medium"|"low", margin_pp: number, bin: object }|null}
 */
export function calibratedConfidence(prediction, calibration) {
  const margin = predictedMargin(prediction);
  if (margin == null || !calibration?.bins?.length) return null;
  const marginPp = margin * 100;
  const bin =
    calibration.bins.find((b) => marginPp >= b.margin_from_pp && marginPp < b.margin_to_pp) ||
    calibration.bins[calibration.bins.length - 1];
  const probability = bin?.winner_probability;
  if (probability == null) return null;
  const bands = calibration.bands || { high: 0.6, medium: 0.45 };
  const band = probability >= bands.high ? "high" : probability >= bands.medium ? "medium" : "low";
  return {
    winner_probability: probability,
    band,
    margin_pp: Number(marginPp.toFixed(2)),
    bin: { from_pp: bin.margin_from_pp, to_pp: bin.margin_to_pp, n: bin.n },
  };
}
