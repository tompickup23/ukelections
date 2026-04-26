/**
 * nationalPolling.js — versioned snapshots of national vote-intention.
 *
 * Each snapshot has shares (0..1) per party + a `_meta` block recording
 * source, fieldwork window, sample size, method. The model's swing step
 * computes (currentNational - ge2024National) per party, dampens by
 * assumptions.nationalToLocalDampening (default 0.65), and applies the
 * remainder as an additive adjustment to baseline shares.
 *
 * Two-tier resolution:
 *   1. data/polling/override.json — auto-refreshed weekly by
 *      scripts/refresh-polling.mjs (Wikipedia rolling-average parser).
 *      If present and the relevant constant has a successful
 *      auto-parsed entry, it overrides the static snapshot below.
 *   2. The hardcoded constants in this file act as a stable fallback
 *      so a parse failure can never blank the model.
 *
 * Strict neutrality rule: source must be a named pollster published in
 * the previous 14 days, OR a transparent average (e.g. Wikipedia
 * rolling average). Never editorial commentary.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

let __OVERRIDE_BY_CONSTANT = null;
function loadOverride() {
  if (__OVERRIDE_BY_CONSTANT !== null) return __OVERRIDE_BY_CONSTANT;
  __OVERRIDE_BY_CONSTANT = {};
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const overridePath = resolve(here, "../../data/polling/override.json");
    if (!existsSync(overridePath)) return __OVERRIDE_BY_CONSTANT;
    const raw = JSON.parse(readFileSync(overridePath, "utf8"));
    for (const [key, src] of Object.entries(raw.sources || {})) {
      if (src.review_status === "auto_parsed" && src.shares && src.constant) {
        __OVERRIDE_BY_CONSTANT[src.constant] = {
          shares: src.shares,
          fieldwork_window: src.fieldwork_window,
          polls_used: src.polls_used,
          page: src.page,
          retrieved_at: src.retrieved_at,
          generated_at: raw.generated_at,
          source_key: key,
        };
      }
    }
  } catch {
    // Override is best-effort; failures are silent so the static fallback wins.
  }
  return __OVERRIDE_BY_CONSTANT;
}

function applyOverride(constantName, snapshot) {
  const ov = loadOverride()[constantName];
  if (!ov) return snapshot;
  return {
    ...snapshot,
    shares: { ...snapshot.shares, ...ov.shares },
    _meta: {
      ...snapshot._meta,
      label: `${snapshot._meta?.label || constantName} (auto-refreshed from Wikipedia ${ov.fieldwork_window?.latest})`,
      fieldwork: ov.fieldwork_window
        ? `${ov.fieldwork_window.earliest} to ${ov.fieldwork_window.latest}`
        : snapshot._meta?.fieldwork,
      source: `Wikipedia rolling 14-day average — ${ov.polls_used} polls`,
      source_url: `https://en.wikipedia.org/wiki/${ov.page}`,
      review_status: "auto_refreshed",
      retrieved_at: ov.retrieved_at,
    },
  };
}

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

const UK_WESTMINSTER_2026_APRIL_AVERAGE_STATIC = {
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

const WELSH_2026_APRIL_AVERAGE_STATIC = {
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

const SCOTTISH_2026_APRIL_AVERAGE_STATIC = {
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

// Auto-override-aware exports: each 2026 placeholder is replaced at module
// load time with the latest Wikipedia rolling average if data/polling/
// override.json contains a successful auto-parsed entry. Otherwise the
// static placeholder above is returned unchanged.
export const UK_WESTMINSTER_2026_APRIL_AVERAGE = applyOverride(
  "UK_WESTMINSTER_2026_APRIL_AVERAGE",
  UK_WESTMINSTER_2026_APRIL_AVERAGE_STATIC,
);
export const WELSH_2026_APRIL_AVERAGE = applyOverride(
  "WELSH_2026_APRIL_AVERAGE",
  WELSH_2026_APRIL_AVERAGE_STATIC,
);
export const SCOTTISH_2026_APRIL_AVERAGE = applyOverride(
  "SCOTTISH_2026_APRIL_AVERAGE",
  SCOTTISH_2026_APRIL_AVERAGE_STATIC,
);

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
