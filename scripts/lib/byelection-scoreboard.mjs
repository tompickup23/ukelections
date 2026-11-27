/**
 * Council by-election forecaster scoreboard: the ledger rules and the scoring.
 *
 * One ledger (data/scoreboard/byelection-forecasts.json) holds every recorded
 * forecast, one entry per contest per forecaster. Every forecaster is scored by
 * the same rules on the same contests, beside two plain benchmarks that need
 * nothing but what was known before the poll.
 *
 * The rule this file exists to enforce: an entry is LIVE only if it was
 * captured before polls opened for that contest, 07:00 UK time on polling day.
 * Everything else is RETROSPECTIVE, however it was made, and the two are never
 * added together.
 *
 * Pure functions only. Reading files is the caller's job, so the logging
 * script, the tests and the pages all share exactly this code.
 */

export const LEDGER_FILE = "data/scoreboard/byelection-forecasts.json";

/** The six pooled lanes. Others pools independents and every smaller party. */
export const MAJOR = ["Reform UK", "Labour", "Conservative", "Liberal Democrats", "Green Party"];
export const LANES = [...MAJOR, "Others"];

export const CAPTURE_METHODS = [
  "site_snapshot", // this site's forecast, copied from what the site published
  "site_rebuild", // this site's forecast as the contest file was rebuilt after the poll
  "research_export", // a research model run after the polls, so a back-test
  "hand_recorded", // an outside forecast typed in by the owner from a public source
  "supplied_by_forecaster", // an outside forecast sent in by the forecaster
];

export const STATUSES = ["live", "retrospective"];

/** Pool one party label into its lane. */
export function poolParty(label) {
  return MAJOR.includes(label) ? label : "Others";
}

/** Pool a {party: share} map into the six lanes. Missing lanes are 0. */
export function poolShares(shares) {
  const out = Object.fromEntries(LANES.map((l) => [l, 0]));
  for (const [party, v] of Object.entries(shares || {})) {
    if (typeof v === "number" && Number.isFinite(v)) out[poolParty(party)] += v;
  }
  return out;
}

/** The lane with the highest share, or null when nothing is above zero. */
export function topLane(pooled) {
  let best = null;
  let bestV = 0;
  for (const lane of LANES) {
    const v = pooled?.[lane] ?? 0;
    if (v > bestV) {
      best = lane;
      bestV = v;
    }
  }
  return best;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const ZONED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** Minutes the UK clock is ahead of UTC on a date (0 in winter, 60 in summer). */
export function londonOffsetMinutes(isoDate) {
  // Midday UTC: the clocks change at 01:00 UTC on a Sunday, never near midday.
  const probe = new Date(`${isoDate}T12:00:00Z`);
  const name = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", timeZoneName: "shortOffset" })
    .formatToParts(probe)
    .find((p) => p.type === "timeZoneName")?.value || "GMT";
  const m = name.match(/GMT([+-]\d+)(?::(\d+))?/);
  if (!m) return 0;
  const sign = m[1].startsWith("-") ? -1 : 1;
  return Number(m[1]) * 60 + sign * Number(m[2] || 0);
}

/** 07:00 UK time on polling day, as a UTC instant. */
export function pollsOpenAt(pollingDay) {
  const [y, mo, d] = pollingDay.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d, 7, 0, 0) - londonOffsetMinutes(pollingDay) * 60000);
}

/**
 * The latest instant a captured_at value can mean. A full timestamp must carry
 * its zone. A bare date could be any time that day, so it is read as the last
 * moment of that day in the UK: a date can only prove a capture was early
 * enough if the whole of that day was.
 */
export function capturedInstant(capturedAt) {
  if (typeof capturedAt !== "string") return null;
  if (DATE_ONLY.test(capturedAt)) {
    const [y, mo, d] = capturedAt.split("-").map(Number);
    return new Date(Date.UTC(y, mo - 1, d, 23, 59, 59, 999) - londonOffsetMinutes(capturedAt) * 60000);
  }
  if (ZONED.test(capturedAt)) {
    const t = new Date(capturedAt);
    return Number.isNaN(t.getTime()) ? null : t;
  }
  return null;
}

/** The one rule: live only if captured before polls opened. */
export function entryStatus(capturedAt, pollingDay) {
  const at = capturedInstant(capturedAt);
  if (!at || !DATE_ONLY.test(pollingDay || "")) return "retrospective";
  return at.getTime() < pollsOpenAt(pollingDay).getTime() ? "live" : "retrospective";
}

/** Check a ledger against its own rules. Returns a list of problems, empty when sound. */
export function validateLedger(ledger) {
  const errors = [];
  const forecasters = ledger?.forecasters || {};
  const seen = new Set();
  for (const [id, f] of Object.entries(forecasters)) {
    if (!f.name) errors.push(`forecaster ${id} has no name`);
    if (f.kind !== "forecaster") errors.push(`forecaster ${id} must have kind "forecaster"`);
  }
  for (const [i, e] of (ledger?.entries || []).entries()) {
    const where = `entry ${i} (${e.contest} / ${e.forecaster})`;
    if (!forecasters[e.forecaster]) errors.push(`${where}: unknown forecaster`);
    if (!e.contest || !e.ballot_paper_id) errors.push(`${where}: no contest`);
    if (!DATE_ONLY.test(e.polling_day || "")) errors.push(`${where}: polling_day must be YYYY-MM-DD`);
    if (!CAPTURE_METHODS.includes(e.capture_method)) errors.push(`${where}: unknown capture_method ${e.capture_method}`);
    if (!e.source) errors.push(`${where}: no source`);
    if (!capturedInstant(e.captured_at)) errors.push(`${where}: captured_at must be a date or a timestamp with its zone`);
    const expected = entryStatus(e.captured_at, e.polling_day);
    if (e.status !== expected) errors.push(`${where}: status ${e.status} but the capture time makes it ${expected}`);
    if (!e.called_party) errors.push(`${where}: no called_party`);
    if (e.called_leader !== poolParty(e.called_party)) errors.push(`${where}: called_leader must be the pooled lane of called_party`);
    if (e.win_chance != null && !(e.win_chance >= 0 && e.win_chance <= 1)) errors.push(`${where}: win_chance must be between 0 and 1`);
    if (e.shares != null) {
      const vals = Object.values(e.shares);
      if (vals.some((v) => typeof v !== "number" || v < 0 || v > 1)) errors.push(`${where}: shares must be between 0 and 1`);
    }
    if (e.capture_method === "research_export" && e.status === "live") errors.push(`${where}: a research export cannot be live`);
    const key = `${e.ballot_paper_id}|${e.forecaster}`;
    if (seen.has(key)) errors.push(`${where}: duplicate entry`);
    seen.add(key);
  }
  return errors;
}

/** True when a contest file holds a declared result with vote shares to score against. */
export function hasScorableResult(d) {
  return Boolean(d?.result?.declared && d.result.shares && topLane(poolShares(d.result.shares)));
}

/** What the scoreboard needs from one contest file. */
export function contestRecord(d) {
  const c = d.contest;
  const scorable = hasScorableResult(d);
  const actual = scorable ? poolShares(d.result.shares) : null;
  const leader = actual ? topLane(actual) : null;
  const prior = d.prior_result?.shares && !c.boundary_changed_since_prior ? poolShares(d.prior_result.shares) : null;
  const holder = d.previous_holder?.established && d.previous_holder.party ? poolParty(d.previous_holder.party) : null;
  return {
    slug: d.slug,
    ballot_paper_id: c.ballot_paper_id,
    polling_day: c.polling_day,
    month: c.polling_day.slice(0, 7),
    council: c.council_name,
    ward: c.ward_name,
    territory: c.territory,
    scorable,
    actual,
    leader,
    winner_lane: scorable && d.result.winner_party ? poolParty(d.result.winner_party) : null,
    benchmarks: {
      holder: holder ? { called_leader: holder, shares: null } : null,
      last_leader: prior && topLane(prior) ? { called_leader: topLane(prior), shares: prior } : null,
    },
  };
}

export const BENCHMARKS = [
  {
    id: "holder",
    name: "The defending party holds",
    description:
      "Calls the party that held the seat before the vacancy, as recorded on the contest page. Left out where no holder is recorded.",
  },
  {
    id: "last_leader",
    name: "Last time's leader leads again",
    description:
      "Calls the party with the most votes at the ward's previous result recorded on the contest page. Left out where there is none, or where the boundaries changed since.",
  },
];

/** Share error in percentage points for one forecast: mean absolute gap over the lanes either side used. */
export function shareError(forecastShares, actual) {
  const f = poolShares(forecastShares);
  const gaps = [];
  for (const lane of LANES) {
    if ((f[lane] || 0) === 0 && (actual[lane] || 0) === 0) continue;
    gaps.push(Math.abs((f[lane] || 0) - (actual[lane] || 0)) * 100);
  }
  return gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null;
}

/**
 * Score a set of calls against results.
 * calls: [{ballot_paper_id, called_leader, win_chance?, shares?}]
 * Returns counts, never a bare rate: contests, called, and the n behind every mean.
 */
export function scoreCalls(calls, records) {
  let contests = 0;
  let called = 0;
  const briers = [];
  const errs = [];
  for (const call of calls) {
    const r = records.get(call.ballot_paper_id);
    if (!r?.scorable) continue;
    contests += 1;
    const right = call.called_leader === r.leader;
    if (right) called += 1;
    // Brier on the named favourite: (stated chance minus 1 if it led, else 0) squared.
    if (typeof call.win_chance === "number") briers.push((call.win_chance - (right ? 1 : 0)) ** 2);
    if (call.shares && r.actual) {
      const e = shareError(call.shares, r.actual);
      if (e != null) errs.push(e);
    }
  }
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return {
    contests,
    called,
    brier: briers.length ? { n: briers.length, mean: mean(briers) } : null,
    share_error: errs.length ? { n: errs.length, mae_pp: mean(errs) } : null,
  };
}

function benchmarkCallsFor(ids, records, benchmarkId) {
  const out = [];
  for (const id of ids) {
    const b = records.get(id)?.benchmarks?.[benchmarkId];
    if (b) out.push({ ballot_paper_id: id, called_leader: b.called_leader, shares: b.shares });
  }
  return out;
}

const byName = (forecasters) => (a, b) =>
  (forecasters[a]?.name || a).localeCompare(forecasters[b]?.name || b, "en-GB");

/**
 * The whole scoreboard from a ledger and the contest files.
 * Returns plain data the pages render: tables for live and retrospective,
 * head-to-head pairs, a monthly view and the counts the method note quotes.
 */
export function buildScoreboard(ledger, contests) {
  const records = new Map();
  for (const d of contests) {
    if (d?.contest?.ballot_paper_id && d.slug) records.set(d.contest.ballot_paper_id, contestRecord(d));
  }
  const forecasters = ledger.forecasters || {};
  const entries = (ledger.entries || []).map((e) => ({ ...e, status: entryStatus(e.captured_at, e.polling_day) }));
  const ids = Object.keys(forecasters).sort(byName(forecasters));

  const table = (status) => {
    const blocks = [];
    for (const fid of ids) {
      const mine = entries.filter((e) => e.forecaster === fid && e.status === status);
      if (!mine.length) continue;
      const score = scoreCalls(mine, records);
      const scoredIds = mine.filter((e) => records.get(e.ballot_paper_id)?.scorable).map((e) => e.ballot_paper_id);
      const pending = mine.length - scoredIds.length;
      const benchmarks = BENCHMARKS.map((b) => {
        const calls = benchmarkCallsFor(scoredIds, records, b.id);
        const covered = new Set(calls.map((c) => c.ballot_paper_id));
        return {
          id: b.id,
          name: b.name,
          score: scoreCalls(calls, records),
          forecaster_same_contests: scoreCalls(mine.filter((e) => covered.has(e.ballot_paper_id)), records),
          left_out: scoredIds.length - covered.size,
        };
      });
      const methods = {};
      for (const e of mine) methods[e.capture_method] = (methods[e.capture_method] || 0) + 1;
      blocks.push({
        forecaster: fid,
        name: forecasters[fid].name,
        short_name: forecasters[fid].short_name || forecasters[fid].name,
        entries: mine.length,
        pending,
        methods,
        score,
        benchmarks,
      });
    }
    return blocks;
  };

  // Every pair of forecaster records, compared only on contests both called and that have a result.
  const series = [];
  for (const fid of ids) {
    for (const status of STATUSES) {
      const mine = entries.filter((e) => e.forecaster === fid && e.status === status);
      if (mine.length) series.push({ forecaster: fid, status, entries: mine });
    }
  }
  const headToHead = [];
  // A forecaster's own live and retrospective entries never share a contest
  // (one entry per contest), so pairs are between different forecasters only.
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const a = entries.filter((e) => e.forecaster === ids[i]);
      const b = entries.filter((e) => e.forecaster === ids[j]);
      const bIds = new Set(b.map((e) => e.ballot_paper_id));
      const common = a
        .map((e) => e.ballot_paper_id)
        .filter((id) => bIds.has(id) && records.get(id)?.scorable);
      if (!common.length) continue;
      const set = new Set(common);
      const pick = (xs) => xs.filter((e) => set.has(e.ballot_paper_id));
      const statusMix = (xs) => ({
        live: pick(xs).filter((e) => e.status === "live").length,
        retrospective: pick(xs).filter((e) => e.status === "retrospective").length,
      });
      headToHead.push({
        a: { forecaster: ids[i], name: forecasters[ids[i]].name, score: scoreCalls(pick(a), records), mix: statusMix(a) },
        b: { forecaster: ids[j], name: forecasters[ids[j]].name, score: scoreCalls(pick(b), records), mix: statusMix(b) },
        contests: common.length,
        benchmarks: BENCHMARKS.map((bm) => {
          const calls = benchmarkCallsFor(common, records, bm.id);
          return { id: bm.id, name: bm.name, score: scoreCalls(calls, records), left_out: common.length - calls.length };
        }),
      });
    }
  }

  // Monthly: each series on its own contests that month, with the count beside it.
  const months = [...new Set(entries.map((e) => records.get(e.ballot_paper_id)).filter((r) => r?.scorable).map((r) => r.month))].sort();
  const monthly = months.map((month) => {
    const inMonth = (e) => records.get(e.ballot_paper_id)?.month === month;
    const scoredIds = [...new Set(entries.filter(inMonth).filter((e) => records.get(e.ballot_paper_id)?.scorable).map((e) => e.ballot_paper_id))];
    return {
      month,
      contests: scoredIds.length,
      series: series.map((s) => ({
        forecaster: s.forecaster,
        status: s.status,
        score: scoreCalls(s.entries.filter(inMonth), records),
      })),
      benchmarks: BENCHMARKS.map((b) => ({ id: b.id, score: scoreCalls(benchmarkCallsFor(scoredIds, records, b.id), records) })),
    };
  });

  const scoredRecords = [...records.values()].filter((r) => r.scorable);
  const ledgerScored = new Set(entries.filter((e) => records.get(e.ballot_paper_id)?.scorable).map((e) => e.ballot_paper_id));
  const leaderDiffersFromWinner = scoredRecords.filter((r) => ledgerScored.has(r.ballot_paper_id) && r.winner_lane && r.winner_lane !== r.leader).length;
  const unknownContest = entries.filter((e) => !records.has(e.ballot_paper_id)).length;
  const dated = [...ledgerScored].map((id) => records.get(id).polling_day).sort();
  const latestCapture = entries
    .map((e) => ({ e, at: capturedInstant(e.captured_at) }))
    .filter((x) => x.at)
    .sort((x, y) => y.at - x.at)[0]?.e.captured_at ?? null;

  return {
    forecasters,
    benchmarks: BENCHMARKS,
    live: table("live"),
    retrospective: table("retrospective"),
    headToHead,
    monthly,
    series: series.map((s) => ({ forecaster: s.forecaster, status: s.status, name: forecasters[s.forecaster].name })),
    counts: {
      entries: entries.length,
      live_entries: entries.filter((e) => e.status === "live").length,
      retrospective_entries: entries.filter((e) => e.status === "retrospective").length,
      live_scored: entries.filter((e) => e.status === "live" && records.get(e.ballot_paper_id)?.scorable).length,
      live_pending: entries.filter((e) => e.status === "live" && !records.get(e.ballot_paper_id)?.scorable).length,
      outside_entries: entries.filter((e) => ["hand_recorded", "supplied_by_forecaster"].includes(e.capture_method)).length,
      contests_scored: ledgerScored.size,
      leader_differs_from_winner: leaderDiffersFromWinner,
      unknown_contest: unknownContest,
      first_polling_day: dated[0] ?? null,
      last_polling_day: dated.at(-1) ?? null,
      latest_capture: latestCapture,
    },
  };
}

/**
 * The running record of every forecaster and benchmark, for the compact strip.
 * Live and retrospective stay separate; benchmarks are scored on the same
 * contests as the live record they sit beside.
 */
export function runningRecord(board) {
  const rows = [];
  for (const status of STATUSES) {
    for (const block of board[status]) {
      rows.push({ forecaster: block.forecaster, name: block.name, short_name: block.short_name, status, score: block.score });
    }
  }
  return rows;
}

/** Who called one finished contest, from the ledger, plus the benchmarks for it. */
export function contestCalls(ledger, d) {
  const r = contestRecord(d);
  const forecasters = ledger.forecasters || {};
  const calls = (ledger.entries || [])
    .filter((e) => e.ballot_paper_id === r.ballot_paper_id)
    .sort((a, b) => byName(forecasters)(a.forecaster, b.forecaster))
    .map((e) => ({
      forecaster: e.forecaster,
      name: forecasters[e.forecaster]?.name || e.forecaster,
      status: entryStatus(e.captured_at, e.polling_day),
      called_party: e.called_party,
      called_leader: e.called_leader,
      right: r.scorable ? e.called_leader === r.leader : null,
      basis: e.basis || null,
    }));
  const benchmarks = BENCHMARKS.map((b) => {
    const call = r.benchmarks[b.id];
    return { id: b.id, name: b.name, called_leader: call?.called_leader ?? null, right: call && r.scorable ? call.called_leader === r.leader : null };
  });
  return { record: r, calls, benchmarks };
}
