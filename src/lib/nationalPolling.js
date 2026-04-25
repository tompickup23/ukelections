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

export const UK_WESTMINSTER_2019_GE_RESULT = {
  // GE2019 — used as the prior-baseline for the 2024 backtest run.
  shares: {
    "Conservative": 0.436,
    "Labour": 0.321,
    "Liberal Democrats": 0.116,
    "SNP": 0.039,
    "Reform UK": 0.020,
    "Green Party": 0.027,
    "Plaid Cymru": 0.005,
    "Other": 0.036,
  },
  _meta: {
    label: "GE2019 actual UK-wide vote share",
    fieldwork: "2019-12-12",
    source: "House of Commons Library CBP-8749",
    source_url: "https://commonslibrary.parliament.uk/research-briefings/cbp-8749/",
    licence: "Open Parliament Licence",
  },
};

export const UK_WESTMINSTER_2024_MAY_AVERAGE = {
  // May 2024 (just before May 2 local elections) — used as nationalPolling for the 2024 backtest.
  shares: {
    "Labour": 0.440,
    "Conservative": 0.240,
    "Reform UK": 0.120,
    "Liberal Democrats": 0.090,
    "Green Party": 0.070,
    "SNP": 0.030,
    "Plaid Cymru": 0.005,
    "Other": 0.005,
  },
  _meta: {
    label: "UK Westminster vote intention — May 2024 average (pre-local-elections)",
    fieldwork: "2024-04-15 to 2024-05-01",
    source: "Cross-pollster average (YouGov, Opinium, Savanta, Redfield) — historical reference",
    source_url: null,
    licence: null,
  },
};

export const UK_WESTMINSTER_2025_MAY_AVERAGE = {
  // May 2025 average — used as the "national context at time of 2025 county
  // elections" snapshot, so the county-2025 anchor can compute swing-since-2025.
  shares: {
    "Reform UK": 0.255,
    "Labour": 0.245,
    "Conservative": 0.220,
    "Liberal Democrats": 0.135,
    "Green Party": 0.085,
    "SNP": 0.025,
    "Plaid Cymru": 0.005,
    "Other": 0.030,
  },
  _meta: {
    label: "UK Westminster vote intention — May 2025 average",
    fieldwork: "2025-04-15 to 2025-05-01",
    source: "Cross-pollster average — historical reference",
  },
};

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

export const WELSH_2024_GE_RESULT = {
  // Wales-wide GE2024 vote share (32 Welsh constituencies aggregated).
  shares: {
    "Labour": 0.366,
    "Plaid Cymru": 0.149,
    "Reform UK": 0.169,
    "Conservative": 0.182,
    "Liberal Democrats": 0.067,
    "Green Party": 0.043,
    "Other": 0.024,
  },
  _meta: {
    label: "Welsh GE2024 vote share (32 constituencies aggregated)",
    fieldwork: "2024-07-04",
    source: "House of Commons Library — derived from CBP-10009 Welsh subset",
    licence: "Open Parliament Licence",
  },
};

export const WELSH_2026_APRIL_AVERAGE = {
  // Welsh-wide vote intention placeholder, April 2026.
  shares: {
    "Plaid Cymru": 0.250,
    "Reform UK": 0.230,
    "Labour": 0.210,
    "Conservative": 0.130,
    "Liberal Democrats": 0.070,
    "Green Party": 0.060,
    "Other": 0.050,
  },
  _meta: {
    label: "Welsh vote intention — April 2026 placeholder (refresh required)",
    fieldwork: "2026-04",
    source: "PLACEHOLDER — refresh from Beaufort / YouGov Wales / ITV Wales poll before launch",
    review_status: "draft_placeholder",
    refresh_required_by: "2026-05-01",
  },
};

export const SCOTTISH_2021_HOLYROOD_RESULT = {
  // Scotland-wide 2021 Holyrood result (constituency vote, 73-seat).
  shares: {
    "SNP": 0.479,
    "Labour": 0.218,
    "Conservative": 0.218,
    "Liberal Democrats": 0.066,
    "Green Party": 0.013,
    "Other": 0.006,
  },
  shares_regional_list: {
    // 56-seat regional list (second vote)
    "SNP": 0.402,
    "Labour": 0.179,
    "Conservative": 0.234,
    "Green Party": 0.082,
    "Liberal Democrats": 0.054,
    "Reform UK": 0.000,
    "Other": 0.049,
  },
  _meta: {
    label: "Scottish Parliament 2021 election (constituency + regional list)",
    fieldwork: "2021-05-06",
    source: "Electoral Commission Scottish Parliament results 2021",
    licence: "Open Government Licence",
  },
};

export const SCOTTISH_2026_APRIL_AVERAGE = {
  // Scotland-wide Westminster/Holyrood placeholder, April 2026.
  shares: {
    "SNP": 0.290,
    "Labour": 0.240,
    "Reform UK": 0.180,
    "Conservative": 0.140,
    "Liberal Democrats": 0.080,
    "Green Party": 0.050,
    "Other": 0.020,
  },
  _meta: {
    label: "Scottish vote intention — April 2026 placeholder (refresh required)",
    fieldwork: "2026-04",
    source: "PLACEHOLDER — refresh from Survation / Ipsos / YouGov Scotland poll before launch",
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
