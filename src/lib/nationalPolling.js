/**
 * nationalPolling.js — versioned snapshots of national vote-intention.
 *
 * Each snapshot has shares (0..1) per party + a `_meta` block recording
 * source, fieldwork window, sample size, method. The model's swing step
 * computes (currentNational - ge2024National) per party, dampens by
 * assumptions.nationalToLocalDampening (default 0.65), and applies the
 * remainder as an additive adjustment to baseline shares.
 *
 * Replace this file's snapshots with the most recent reputable polling
 * average before each Stage 1 model run. The contract is that
 * `latestUKWestminster()` returns the shares used for prediction, and
 * the Methodology page renders the `_meta` block verbatim.
 *
 * Strict neutrality rule: source must be a named pollster published in
 * the previous 14 days, OR a transparent average (e.g. PollOfPolls.eu /
 * Politico EU UK aggregate / Wikipedia rolling average). Never editorial
 * commentary.
 */

export const UK_WESTMINSTER_2024_GE_RESULT = {
  // Source: HoC Library "General election 2024 results" CBP-10009.
  // Vote share of valid votes cast across UK constituencies.
  shares: {
    "Labour": 0.337,
    "Conservative": 0.236,
    "Reform UK": 0.143,
    "Liberal Democrats": 0.122,
    "Green Party": 0.069,
    "SNP": 0.025,
    "Plaid Cymru": 0.007,
    "Other": 0.061,
  },
  _meta: {
    label: "GE2024 actual UK-wide vote share",
    fieldwork: "2024-07-04",
    source: "House of Commons Library CBP-10009",
    source_url: "https://commonslibrary.parliament.uk/research-briefings/cbp-10009/",
    licence: "Open Parliament Licence",
  },
};

export const UK_WESTMINSTER_2026_APRIL_AVERAGE = {
  // Indicative April 2026 rolling average. Update this object before
  // each Stage 1 model run with the latest publicly available pollster
  // average (PollOfPolls / Wikipedia rolling 14-day mean).
  shares: {
    "Labour": 0.230,
    "Conservative": 0.180,
    "Reform UK": 0.300,
    "Liberal Democrats": 0.130,
    "Green Party": 0.090,
    "SNP": 0.025,
    "Plaid Cymru": 0.008,
    "Other": 0.037,
  },
  _meta: {
    label: "UK Westminster vote intention — April 2026 rolling average (placeholder)",
    fieldwork: "2026-04-15 to 2026-04-25",
    source: "PLACEHOLDER — refresh from named pollster average before model run",
    source_url: null,
    licence: null,
    review_status: "draft_placeholder",
    refresh_required_by: "2026-05-01",
  },
};

/**
 * Returns the snapshot used by predictWard's nationalPolling argument.
 * This indirection lets us swap snapshots without touching call sites.
 */
export function latestUKWestminster() {
  return UK_WESTMINSTER_2026_APRIL_AVERAGE;
}

/**
 * GE2024 baseline that every swing computation references.
 */
export function ge2024UKBaseline() {
  return UK_WESTMINSTER_2024_GE_RESULT;
}

/**
 * Convenience: return both as the bare share dicts (model arg shape).
 */
export function pollingPair() {
  return {
    nationalPolling: latestUKWestminster().shares,
    ge2024Result: ge2024UKBaseline().shares,
  };
}
