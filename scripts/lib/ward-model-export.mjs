/**
 * The research ward model's live council by-election forecasts, cut down to
 * what the contest pages read.
 *
 * Input: research/ward-model-2026-11/live/live_forecasts.json, written by
 * live_forecast.py before polls open and frozen once they do.
 * Output: data/forecasts/ward-model-byelections.json, keyed by contest slug.
 *
 * Pure functions only, so the script and the tests share one implementation.
 * The output carries no build-clock time: the same input always gives the same
 * bytes.
 */

import { LANES, capturedInstant, pollsOpenAt } from "./byelection-scoreboard.mjs";

export const SOURCE_FILE = "research/ward-model-2026-11/live/live_forecasts.json";
export const OUTPUT_FILE = "data/forecasts/ward-model-byelections.json";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const round4 = (x) => Math.round(x * 10000) / 10000;

/** Every reason a forecast record cannot be published. Empty when it can. */
export function recordProblems(id, r) {
  const problems = [];
  const where = `${id}`;
  if (!DATE_ONLY.test(r.polling_day || "")) problems.push(`${where}: polling_day must be YYYY-MM-DD`);
  const at = capturedInstant(r.captured_at);
  if (!at) problems.push(`${where}: captured_at must be a timestamp with its zone`);
  if (at && DATE_ONLY.test(r.polling_day || "")) {
    // The site's own rule (07:00 UK time on polling day) and the runner's own
    // polls_open_at both have to agree the capture was early enough.
    const opens = [pollsOpenAt(r.polling_day).getTime()];
    const own = capturedInstant(r.polls_open_at);
    if (own) opens.push(own.getTime());
    if (at.getTime() >= Math.min(...opens)) {
      problems.push(`${where}: captured at ${r.captured_at}, after polls opened on ${r.polling_day}`);
    }
  }
  if (r.code_dirty !== false) problems.push(`${where}: code_dirty is not false, so no commit names the code`);
  if (!r.code_commit) problems.push(`${where}: no code_commit`);
  if (!r.model_version) problems.push(`${where}: no model_version`);
  if (!r.contest) problems.push(`${where}: no contest slug`);
  if (!LANES.includes(r.called_leader)) problems.push(`${where}: called_leader is not one of the six lanes`);
  for (const lane of LANES) {
    const v = r.shares?.[lane];
    if (typeof v !== "number" || v < 0 || v > 1) problems.push(`${where}: share for ${lane} missing or out of range`);
  }
  for (const [lane, v] of Object.entries(r.win_chance || {})) {
    if (!LANES.includes(lane) || typeof v !== "number" || v < 0 || v > 1) problems.push(`${where}: win_chance for ${lane} out of range`);
  }
  return problems;
}

/** One page record from one runner record. */
export function pageRecord(r) {
  const lanes = (r.standing_lanes || []).filter((l) => LANES.includes(l));
  const inputs = r.inputs || {};
  return {
    ballot_paper_id: r.ballot_paper_id,
    contest: r.contest,
    council: r.council,
    ward: r.ward,
    polling_day: r.polling_day,
    polls_open_at: r.polls_open_at,
    captured_at: r.captured_at,
    model_version: r.model_version,
    code_commit: r.code_commit,
    shares: Object.fromEntries(LANES.map((l) => [l, round4(r.shares[l])])),
    called_leader: r.called_leader,
    win_chance: Object.fromEntries(LANES.filter((l) => typeof r.win_chance?.[l] === "number").map((l) => [l, round4(r.win_chance[l])])),
    standing_lanes: LANES.filter((l) => lanes.includes(l)),
    // Which parties on the ballot were pooled as Others, so the page can say so.
    others_parties: [...new Set((r.candidates || []).filter((c) => c.lane === "Others").map((c) => c.party))].sort(),
    ward_has_earlier_contest: r.ward_has_earlier_contest ?? null,
    inputs: {
      contest_files_commit: inputs.contest_files?.commit ?? null,
      polls_sha256: inputs.polls?.sha256 ?? null,
      polls_generated_at: inputs.polls?.generated_at ?? null,
      polls_latest_poll_date: inputs.polls?.latest_poll_date ?? null,
      polls_count: inputs.polls?.polls ?? null,
      ward_features_sha256: inputs.ward_features?.sha256 ?? null,
      base_dataset_sha256: inputs.base_dataset?.sha256 ?? null,
      fit_meta_sha256: inputs.fit_meta?.sha256 ?? null,
    },
  };
}

/**
 * Build the output from the runner's file. Throws, naming every bad record,
 * if any forecast record cannot be published: a late capture is a refusal of
 * the whole export, never a quiet skip.
 */
export function buildExport(live, sourceFile = SOURCE_FILE) {
  const records = live?.records || {};
  const forecasts = {};
  const skipped = {};
  const problems = [];
  for (const id of Object.keys(records).sort()) {
    const r = records[id];
    if (r.status === "skipped") {
      skipped[id] = r.reason || "skipped";
      continue;
    }
    if (r.status !== "forecast") {
      problems.push(`${id}: unknown status ${r.status}`);
      continue;
    }
    const p = recordProblems(id, r);
    if (p.length) {
      problems.push(...p);
      continue;
    }
    forecasts[r.contest] = pageRecord(r);
  }
  if (problems.length) {
    const err = new Error(`Refusing to export the ward model forecasts:\n  ${problems.join("\n  ")}`);
    err.problems = problems;
    throw err;
  }
  const sortedForecasts = Object.fromEntries(Object.keys(forecasts).sort().map((k) => [k, forecasts[k]]));
  return {
    about:
      "The research ward model's live forecasts for upcoming council by-elections, read by the contest pages. Written by scripts/export-ward-model-byelections.mjs from the runner's own file; never edit by hand. Shares are full slate shares over six lanes, with parties outside the five largest pooled as Others. Win chances come from fixed lane spreads and are not calibrated. Research, not this site's published forecast.",
    source: sourceFile,
    model_version: live?.model_version ?? null,
    source_last_run_captured_at: live?.last_run?.captured_at ?? null,
    forecasts: sortedForecasts,
    skipped,
  };
}

/** Stable JSON text: two-space indent and a final newline. */
export const serialise = (obj) => `${JSON.stringify(obj, null, 2)}\n`;
