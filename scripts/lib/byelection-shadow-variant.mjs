// Shadow by-election swing variant, pre-registered 27 November 2026.
//
// Protocol: docs/byelection-shadow-variant-2026-11.md. Research only. Nothing
// on the site reads this module or its output, and it changes no published
// forecast. The engine (local-byelection-model.mjs) is imported, never edited:
// the variant is expressible as a post-step on estimateSwing's output, so no
// engine code is copied here.
//
// The variant is the one tested in the Reports repo scratch script
// UKE_ByElections_2026-11-26_work/scripts/variants.mjs ("Restore-aware Reform,
// 180d"), reproduced as written. Do not improve it: a changed variant needs a
// new protocol and new contests.

import {
  PARTIES,
  baselineEra,
  estimateSwing,
  logit,
  projectContest,
} from "./local-byelection-model.mjs";

export const VARIANT_ID = "restore-aware-reform-180d-2026-11";
export const PROTOCOL_PATH = "docs/byelection-shadow-variant-2026-11.md";
export const SHADOW_FILE = "data/transparency/byelection-shadow-variant.json";
export const VARIANT_WINDOW_DAYS = 180;
export const CURRENT_WINDOW_DAYS = 365;
export const SHADOW_CUT = "2026-11-26";
export const MIN_POOL_N = 5;

const REFORM = "Reform UK";
const RESTORE = "Restore Britain";
const PRESENT = 0.02;
const DAY_MS = 864e5;

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** A past corpus contest's Restore Britain status, as variants.mjs reads it. */
export function restoreStoodInCorpus(contest) {
  return (contest.to[RESTORE] || 0) >= PRESENT;
}

/**
 * Replace Reform UK's shift and entry share with values measured only from
 * comparable contests that share the target's Restore Britain status. Pure.
 * Mirrors restoreAware() in variants.mjs line for line.
 */
export function restoreAwareReform(swing, corpus, { date, era, restoreStanding, windowDays = VARIANT_WINDOW_DAYS, excludeId = null }) {
  const pool = corpus.filter(
    (x) =>
      x.date < date &&
      x.ballot_paper_id !== excludeId &&
      (Date.parse(date) - Date.parse(x.date)) / DAY_MS <= windowDays &&
      x.era === era &&
      restoreStoodInCorpus(x) === restoreStanding,
  );
  const deltas = pool
    .filter((x) => (x.from[REFORM] || 0) >= PRESENT && (x.to[REFORM] || 0) >= PRESENT)
    .map((x) => logit(x.to[REFORM]) - logit(x.from[REFORM]));
  const entries = pool
    .filter((x) => (x.from[REFORM] || 0) < PRESENT && (x.to[REFORM] || 0) >= PRESENT)
    .map((x) => x.to[REFORM]);
  const s = { ...swing, shifts: { ...swing.shifts }, entry: { ...swing.entry } };
  if (deltas.length >= MIN_POOL_N) s.shifts[REFORM] = median(deltas);
  if (entries.length >= MIN_POOL_N) s.entry[REFORM] = median(entries);
  return {
    swing: s,
    reform: {
      restore_standing: restoreStanding,
      pool_contests: pool.length,
      shift_n: deltas.length,
      shift_source: deltas.length >= MIN_POOL_N ? "restore_status_pool" : "window_estimate",
      entry_n: entries.length,
      entry_source: entries.length >= MIN_POOL_N ? "restore_status_pool" : "window_estimate",
    },
  };
}

/** The variant swing: estimateSwing at 180 days, then the Restore Britain step. */
export function variantSwing(corpus, { asOf, era, reformEntering, restoreStanding, excludeId = null }) {
  const base = estimateSwing(corpus, { asOf, windowDays: VARIANT_WINDOW_DAYS, era, reformEntering, excludeId });
  return restoreAwareReform(base, corpus, { date: asOf, era, restoreStanding, windowDays: VARIANT_WINDOW_DAYS, excludeId });
}

function topParty(shares) {
  return PARTIES.filter((p) => (shares[p] || 0) > 0).sort((a, b) => shares[b] - shares[a])[0] ?? null;
}

/**
 * Leave one out backtest over the swing corpus, as run() in variants.mjs does.
 * Each contest is projected from contests polled strictly before it.
 */
export function backtestLoo(corpus, { from, to, variant }) {
  const rows = [];
  for (const c of corpus) {
    if (c.date < from || c.date > to) continue;
    const field = new Set(PARTIES.filter((p) => (c.to[p] || 0) > 0));
    if (field.size < 2) continue;
    const windowDays = variant ? VARIANT_WINDOW_DAYS : CURRENT_WINDOW_DAYS;
    let swing = estimateSwing(corpus, { asOf: c.date, windowDays, era: c.era, reformEntering: c.reform_entered, excludeId: c.ballot_paper_id });
    if (swing.n < 8) continue;
    if (variant) {
      swing = restoreAwareReform(swing, corpus, {
        date: c.date,
        era: c.era,
        restoreStanding: restoreStoodInCorpus(c),
        windowDays,
        excludeId: c.ballot_paper_id,
      }).swing;
    }
    const { central } = projectContest(c.from, field, swing);
    const errs = [...field].map((p) => Math.abs(((central[p] || 0) - (c.to[p] || 0)) * 100));
    rows.push({
      id: c.ballot_paper_id,
      mae: errs.reduce((a, b) => a + b, 0) / errs.length,
      called: topParty(central) === topParty(c.to),
      reformError: field.has(REFORM) ? ((central[REFORM] || 0) - (c.to[REFORM] || 0)) * 100 : null,
    });
  }
  const reform = rows.filter((r) => r.reformError !== null);
  return {
    n: rows.length,
    mae: rows.reduce((a, r) => a + r.mae, 0) / rows.length,
    called: rows.filter((r) => r.called).length,
    reformBias: reform.reduce((a, r) => a + r.reformError, 0) / reform.length,
    rows,
  };
}

const pct = (shares) =>
  Object.fromEntries(PARTIES.filter((p) => (shares[p] || 0) > 0).map((p) => [p, Math.round(shares[p] * 1000) / 10]));

/**
 * The shadow forecast for one contest file. Uses the published generator's own
 * baseline and field from the contest file, and only corpus contests polled
 * strictly before polling day. Returns null when the contest is not
 * forecastable by the published model, or when a result is already in.
 */
export function shadowForecastForContest(contestFile, corpus, { generatedAt }) {
  const date = contestFile.contest?.polling_day;
  if (!date || date < SHADOW_CUT) return null;
  if (contestFile.result || contestFile.declaration) return null;
  const baseline = contestFile.forecast?.baseline;
  if (!baseline?.shares || !baseline.election_date) return null;

  const field = new Set((contestFile.field?.parties || []).filter((p) => PARTIES.includes(p)));
  if (field.size < 2) return null;
  const era = baselineEra(baseline.election_date);
  const reformEntering = field.has(REFORM) ? (baseline.shares[REFORM] || 0) < PRESENT : null;
  const restoreStanding = field.has(RESTORE);

  const prior = corpus.filter((c) => c.date < date);
  const latest = prior.reduce((m, c) => (c.date > m ? c.date : m), "");

  const { swing, reform } = variantSwing(prior, { asOf: date, era, reformEntering, restoreStanding });
  const shadow = projectContest(baseline.shares, field, swing);
  const currentSwing = estimateSwing(prior, { asOf: date, windowDays: CURRENT_WINDOW_DAYS, era, reformEntering });
  const current = projectContest(baseline.shares, field, currentSwing);

  return {
    slug: contestFile.slug,
    ballot_paper_id: contestFile.contest.ballot_paper_id,
    polling_day: date,
    variant: VARIANT_ID,
    generated_at: generatedAt,
    result_in_repo_at_generation: false,
    inputs: {
      latest_corpus_contest_date: latest || null,
      corpus_contests_before_polling_day: prior.length,
      contest_file_generated_at: contestFile.generated_at ?? null,
      baseline_election_date: baseline.election_date,
      baseline_source: baseline.source ?? null,
      era,
      reform_entering: reformEntering,
      field: [...field].sort(),
    },
    swing: {
      stratum: swing.stratum,
      contests_used: swing.n,
      window_days: VARIANT_WINDOW_DAYS,
      reform_logodds_shift: swing.shifts[REFORM] ?? null,
      reform_entry_share: swing.entry[REFORM] ?? null,
      reform: reform,
    },
    central_pct: pct(shadow.central),
    unpriced_parties: shadow.unpriced ?? [],
    diagnostic_current_engine_same_inputs_pct: pct(current.central),
  };
}

/** Add one shadow forecast. Refuses to overwrite one already written. */
export function addShadowForecast(file, entry) {
  if (!entry?.slug) throw new Error("A shadow forecast needs a slug.");
  if (Object.prototype.hasOwnProperty.call(file.forecasts, entry.slug)) {
    throw new Error(`Refusing to overwrite the shadow forecast already written for ${entry.slug}.`);
  }
  return { ...file, forecasts: { ...file.forecasts, [entry.slug]: entry } };
}

export function emptyShadowFile() {
  return {
    _readme:
      "Research only. Pre-registered shadow forecasts for the council by-election swing variant in " +
      `${PROTOCOL_PATH}. No page reads this file and it changes no published forecast. ` +
      "Each forecast is written once, before its result is in the repository, and is never overwritten.",
    variant: VARIANT_ID,
    protocol: PROTOCOL_PATH,
    cut: SHADOW_CUT,
    forecasts: {},
  };
}

/**
 * Score one contest: shadow against the published pre-poll forecast, over the
 * parties with a share above zero in the declared result. Shares in points.
 */
export function scoreContest({ shadowPct, publishedPct, resultShares }) {
  const actual = Object.fromEntries(
    PARTIES.filter((p) => (resultShares[p] || 0) > 0).map((p) => [p, resultShares[p] * 100]),
  );
  const parties = Object.keys(actual);
  const mae = (f) => parties.reduce((a, p) => a + Math.abs((f[p] || 0) - actual[p]), 0) / parties.length;
  const winner = topParty(actual);
  const reformStood = parties.includes(REFORM);
  return {
    parties: parties.length,
    winner,
    restore_standing: parties.includes(RESTORE),
    shadow: {
      mae: mae(shadowPct),
      called: topParty(shadowPct) === winner,
      reform_error: reformStood ? (shadowPct[REFORM] || 0) - actual[REFORM] : null,
    },
    published: {
      mae: mae(publishedPct),
      called: topParty(publishedPct) === winner,
      reform_error: reformStood ? (publishedPct[REFORM] || 0) - actual[REFORM] : null,
    },
  };
}

/** Summary across scored contests, in the protocol's terms. */
export function summarise(scores) {
  const n = scores.length;
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const side = (k) => {
    const re = scores.map((s) => s[k].reform_error).filter((x) => x !== null);
    return { mae: mean(scores.map((s) => s[k].mae)), called: scores.filter((s) => s[k].called).length, reform_bias: mean(re) };
  };
  return {
    contests: n,
    restore_standing: scores.filter((s) => s.restore_standing).length,
    shadow_better_per_contest: scores.filter((s) => s.shadow.mae < s.published.mae).length,
    shadow: side("shadow"),
    published: side("published"),
  };
}
