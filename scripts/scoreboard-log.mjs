#!/usr/bin/env node
/**
 * Keep the council by-election forecaster ledger up to date.
 *
 *   node scripts/scoreboard-log.mjs                 log this site's forecast for every
 *                                                   contest whose polls have not opened
 *   node scripts/scoreboard-log.mjs --dry-run       say what would change, write nothing
 *   node scripts/scoreboard-log.mjs --state=.cache/scoreboard/site-forecasts.json
 *                                                   the nightly publisher's form: merge the
 *                                                   persistent log in, log, write it back
 *   node scripts/scoreboard-log.mjs --merge-only --state=<publisher checkout>/.cache/scoreboard/site-forecasts.json
 *                                                   the weekly commit's form: fold the nightly
 *                                                   log into the tracked ledger without logging
 *   node scripts/scoreboard-log.mjs --import-research=data/scoreboard/research-ward-model-export-2026-11.json
 *                                                   add the research model's back-test entries
 *   node scripts/scoreboard-log.mjs --import-research-live=data/scoreboard/research-ward-model-live.json
 *                                                   add the live research model's forecasts, written
 *                                                   before polls opened by
 *                                                   research/ward-model-2026-11/live_forecast.py
 *   node scripts/scoreboard-log.mjs --add --forecaster=<id> --contest=<slug> --party="<party>"
 *        --captured-at=<date or zoned timestamp> --source=<url or file>
 *        [--chance=0.62] [--shares='{"Labour":0.41,"Reform UK":0.33}']
 *        [--method=hand_recorded|supplied_by_forecaster] [--note="..."]
 *                                                   add one outside forecaster's call
 *
 * For a contest still ahead of us, this site's entry is replaced on every run
 * with the forecast the contest file holds now, stamped with the time of the
 * run. Once polls have opened an entry is never touched again, so the last
 * capture before 07:00 on polling day is the one that stands. A past contest
 * with no entry is filled once, from the published snapshot where one exists
 * and from the rebuilt contest file where it does not, and the capture time
 * decides whether that counts as live.
 *
 * Nothing here deletes or edits an outside forecaster's entry; corrections to
 * those are made by hand, in the ledger, with a note.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CAPTURE_METHODS,
  LEDGER_FILE,
  capturedInstant,
  entryStatus,
  poolParty,
  pollsOpenAt,
  topLane,
  validateLedger,
} from "./lib/byelection-scoreboard.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTEST_DIR = "data/contests/local-byelections";
const PUBLISHED_FILE = "data/cards/published-byelection-forecasts.json";

export const SITE = "uk-elections";
export const RESEARCH = "uk-elections-research-model";
export const RESEARCH_LIVE = "uk-elections-research-model-live";

const round4 = (x) => Math.round(x * 10000) / 10000;
const positiveShares = (shares) =>
  Object.fromEntries(
    Object.entries(shares || {})
      .filter(([, v]) => typeof v === "number" && v > 0)
      .map(([p, v]) => [p, round4(v)]),
  );

function base(d, forecaster) {
  const c = d.contest;
  return {
    contest: d.slug,
    ballot_paper_id: c.ballot_paper_id,
    polling_day: c.polling_day,
    council: c.council_name,
    ward: c.ward_name,
    forecaster,
  };
}

function finish(entry) {
  entry.called_leader = poolParty(entry.called_party);
  entry.status = entryStatus(entry.captured_at, entry.polling_day);
  return entry;
}

/** This site's forecast as the contest file holds it, captured at `capturedAt`. */
export function siteEntryFromContest(d, capturedAt, { rebuilt = false } = {}) {
  const f = d.forecast;
  return finish({
    ...base(d, SITE),
    called_party: f.winner,
    win_chance: typeof f.leader_probability === "number" ? round4(f.leader_probability) : null,
    shares: positiveShares(f.central),
    too_close_to_call: Boolean(f.too_close_to_call),
    captured_at: capturedAt,
    source: `${CONTEST_DIR}/${d.slug}.json`,
    capture_method: rebuilt ? "site_rebuild" : "site_snapshot",
    basis: rebuilt ? "rebuilt_after_poll" : "as_published",
    note: rebuilt
      ? "No copy of the forecast as published was kept for this contest. This is the contest file as rebuilt after polling day, which can draw on by-elections held after this one."
      : null,
  });
}

/** This site's forecast from the snapshot of what the page showed. */
export function siteEntryFromSnapshot(d, snap) {
  const central = Object.fromEntries(Object.entries(snap.central_pct || {}).map(([p, v]) => [p, round4(v / 100)]));
  return finish({
    ...base(d, SITE),
    called_party: snap.projected_winner ?? topLane(central),
    win_chance: typeof snap.leader_probability_pct === "number" ? round4(snap.leader_probability_pct / 100) : null,
    shares: positiveShares(central),
    too_close_to_call: Boolean(snap.too_close_to_call),
    captured_at: snap.captured_at,
    source: PUBLISHED_FILE,
    capture_method: "site_snapshot",
    basis: "as_published",
    note: null,
  });
}

const sortEntries = (entries) =>
  entries.sort(
    (a, b) =>
      a.polling_day.localeCompare(b.polling_day) ||
      a.contest.localeCompare(b.contest) ||
      a.forecaster.localeCompare(b.forecaster),
  );

/**
 * Log this site's forecasts. Pure: returns the new ledger and what changed.
 * `now` is a Date.
 */
export function logSiteForecasts(ledger, contests, published, now) {
  const entries = [...(ledger.entries || [])];
  const index = new Map(entries.map((e, i) => [`${e.ballot_paper_id}|${e.forecaster}`, i]));
  const changes = { refreshed: [], added: [], withdrawn: [] };
  const nowIso = now.toISOString();
  const drop = new Set();
  for (const d of contests) {
    const c = d.contest;
    if (!c?.ballot_paper_id || !c.polling_day) continue;
    const key = `${c.ballot_paper_id}|${SITE}`;
    const at = index.get(key);
    const before = now.getTime() < pollsOpenAt(c.polling_day).getTime();
    if (before) {
      if (d.forecast?.winner) {
        const entry = siteEntryFromContest(d, nowIso);
        if (at === undefined) {
          index.set(key, entries.push(entry) - 1);
          changes.added.push(d.slug);
        } else {
          entries[at] = entry;
          changes.refreshed.push(d.slug);
        }
      } else if (at !== undefined) {
        // The page no longer carries a forecast, so neither does the ledger.
        drop.add(at);
        changes.withdrawn.push(d.slug);
      }
      continue;
    }
    if (at !== undefined) continue; // polls have opened: the entry stands as captured
    const snap = published?.[d.slug];
    let entry = null;
    if (snap?.central_pct) entry = siteEntryFromSnapshot(d, snap);
    else if (d.forecast?.winner && d.generated_at) entry = siteEntryFromContest(d, d.generated_at, { rebuilt: true });
    if (entry) {
      index.set(key, entries.push(entry) - 1);
      changes.added.push(d.slug);
    }
  }
  const kept = entries.filter((_, i) => !drop.has(i));
  return { ledger: { ...ledger, entries: sortEntries(kept) }, changes };
}

/**
 * Fold entries kept outside git (the nightly publisher's log) into the ledger.
 * Only this site's entries are merged. Where both hold the same contest, a
 * live entry beats a retrospective one and, between two live entries, the
 * later capture wins: it is the nearer to what the page showed when polls
 * opened. Two retrospective entries: the ledger's stands.
 */
export function mergeSiteEntries(ledger, incoming) {
  const entries = [...(ledger.entries || [])];
  const index = new Map(entries.map((e, i) => [`${e.ballot_paper_id}|${e.forecaster}`, i]));
  let added = 0;
  let replaced = 0;
  for (const raw of incoming || []) {
    if (raw?.forecaster !== SITE) continue;
    const e = finish({ ...raw });
    const key = `${e.ballot_paper_id}|${e.forecaster}`;
    const at = index.get(key);
    if (at === undefined) {
      index.set(key, entries.push(e) - 1);
      added += 1;
      continue;
    }
    const cur = entries[at];
    const curStatus = entryStatus(cur.captured_at, cur.polling_day);
    const better =
      (e.status === "live" && curStatus !== "live") ||
      (e.status === "live" && curStatus === "live" && capturedInstant(e.captured_at) > capturedInstant(cur.captured_at));
    if (better) {
      entries[at] = e;
      replaced += 1;
    }
  }
  return { ledger: { ...ledger, entries: sortEntries(entries) }, added, replaced };
}

/** Add the research model's back-test entries. Never replaces an existing entry. */
export function importResearch(ledger, exportDoc, contests, { capturedAt, source }) {
  const byBallot = new Map(contests.map((d) => [d.contest?.ballot_paper_id, d]));
  const entries = [...(ledger.entries || [])];
  const have = new Set(entries.map((e) => `${e.ballot_paper_id}|${e.forecaster}`));
  const missing = [];
  let added = 0;
  for (const [ballot, row] of Object.entries(exportDoc.by_ballot || {})) {
    const d = byBallot.get(ballot);
    if (!d) {
      missing.push(ballot);
      continue;
    }
    if (have.has(`${ballot}|${RESEARCH}`)) continue;
    const shares = positiveShares(row.model_shares);
    entries.push(
      finish({
        ...base(d, RESEARCH),
        called_party: topLane(row.model_shares),
        win_chance: null,
        shares,
        captured_at: capturedAt,
        source,
        capture_method: "research_export",
        basis: "back_test",
        note: "Back-test: a model frozen before 7 May 2026, run after this contest had polled. Never published before the poll.",
      }),
    );
    added += 1;
  }
  return { ledger: { ...ledger, entries: sortEntries(entries) }, added, missing };
}

/** The ledger entry for one forecast record of the live research runner. */
export function researchLiveEntry(d, record, source) {
  const polls = record.inputs?.polls || {};
  return finish({
    ...base(d, RESEARCH_LIVE),
    called_party: record.called_leader,
    win_chance: typeof record.win_chance?.[record.called_leader] === "number" ? round4(record.win_chance[record.called_leader]) : null,
    shares: positiveShares(record.shares),
    captured_at: record.captured_at,
    source,
    capture_method: "research_live",
    basis: "research_live",
    research: {
      model_version: record.model_version ?? null,
      code_commit: record.code_commit ?? null,
      contest_files_commit: record.inputs?.contest_files?.commit ?? null,
      polls_file: polls.file ?? null,
      polls_sha256: polls.sha256 ?? null,
      polls_latest_poll_date: polls.latest_poll_date ?? null,
    },
    note:
      `Research model, not this site's published forecast. Written by research/ward-model-2026-11/live_forecast.py ` +
      `(${record.model_version ?? "model version not stated"}) before polls opened` +
      (polls.latest_poll_date ? `, with national polls to ${polls.latest_poll_date}.` : "."),
  });
}

const sameForecast = (a, b) =>
  a.captured_at === b.captured_at &&
  a.called_party === b.called_party &&
  a.win_chance === b.win_chance &&
  JSON.stringify(a.shares) === JSON.stringify(b.shares);

/**
 * Add the live research model's forecasts from its live_forecasts.json.
 * Pure: `now` is a Date. Rules, each tested:
 *  1. only records with status "forecast" are read; skipped records are counted;
 *  2. a record whose contest has no contest file, or whose polling day differs
 *     from the contest file's, is refused;
 *  3. captured_at comes from the record, never from this run, and the ledger's
 *     one live rule decides live or retrospective;
 *  4. once polls have opened an existing entry is never changed: a record that
 *     differs from it is refused, an identical one is a no-op;
 *  5. before polls open, a record replaces the entry only if it was captured later;
 *  6. no other forecaster's entry is read or written.
 */
export function importResearchLive(ledger, doc, contests, { source, now }) {
  const byBallot = new Map(contests.map((d) => [d.contest?.ballot_paper_id, d]));
  const entries = [...(ledger.entries || [])];
  const index = new Map(entries.map((e, i) => [`${e.ballot_paper_id}|${e.forecaster}`, i]));
  const out = { added: [], replaced: [], unchanged: [], refused: [], skipped_records: 0 };
  for (const [ballot, record] of Object.entries(doc?.records || {})) {
    if (record?.status !== "forecast") {
      out.skipped_records += 1;
      continue;
    }
    const d = byBallot.get(ballot);
    if (!d) {
      out.refused.push({ ballot, reason: "no contest file for this ballot" });
      continue;
    }
    if (record.polling_day && record.polling_day !== d.contest.polling_day) {
      out.refused.push({ ballot, reason: `polling day ${record.polling_day} but the contest file says ${d.contest.polling_day}` });
      continue;
    }
    if (!/T/.test(record.captured_at || "") || !capturedInstant(record.captured_at)) {
      out.refused.push({ ballot, reason: "captured_at must be a timestamp with its zone" });
      continue;
    }
    if (!record.called_leader) {
      out.refused.push({ ballot, reason: "no called leader" });
      continue;
    }
    const entry = researchLiveEntry(d, record, source);
    const key = `${ballot}|${RESEARCH_LIVE}`;
    const at = index.get(key);
    if (at === undefined) {
      index.set(key, entries.push(entry) - 1);
      out.added.push(ballot);
      continue;
    }
    const cur = entries[at];
    if (sameForecast(cur, entry)) {
      out.unchanged.push(ballot);
      continue;
    }
    if (now.getTime() >= pollsOpenAt(d.contest.polling_day).getTime()) {
      out.refused.push({ ballot, reason: "polls have opened; the entry is frozen" });
      continue;
    }
    if (capturedInstant(entry.captured_at) > capturedInstant(cur.captured_at)) {
      entries[at] = entry;
      out.replaced.push(ballot);
    } else {
      out.unchanged.push(ballot);
    }
  }
  return { ledger: { ...ledger, entries: sortEntries(entries) }, ...out };
}

/** Add one outside forecaster's call. Throws on anything the ledger rules would reject. */
export function addOutsideEntry(ledger, input, contests) {
  const d = contests.find((x) => x.slug === input.contest || x.contest?.ballot_paper_id === input.contest);
  if (!d) throw new Error(`No contest file for ${input.contest}`);
  if (!ledger.forecasters?.[input.forecaster]) {
    throw new Error(`Add ${input.forecaster} to "forecasters" in ${LEDGER_FILE} first (name, kind "forecaster", url, permission).`);
  }
  if ([SITE, RESEARCH, RESEARCH_LIVE].includes(input.forecaster)) throw new Error("Use the logger, not --add, for this site's own forecasts.");
  const method = input.method || "hand_recorded";
  if (!["hand_recorded", "supplied_by_forecaster"].includes(method) || !CAPTURE_METHODS.includes(method)) {
    throw new Error(`--method must be hand_recorded or supplied_by_forecaster`);
  }
  if (!input.source) throw new Error("--source is required: where the forecast was published or who supplied it");
  const entry = finish({
    ...base(d, input.forecaster),
    called_party: input.party,
    win_chance: input.chance == null ? null : Number(input.chance),
    shares: input.shares ? positiveShares(input.shares) : null,
    captured_at: input.captured_at,
    source: input.source,
    capture_method: method,
    basis: "as_published",
    note: input.note || null,
  });
  const next = { ...ledger, entries: sortEntries([...(ledger.entries || []), entry]) };
  const errors = validateLedger(next);
  if (errors.length) throw new Error(errors.join("\n"));
  return { ledger: next, entry };
}

export function loadContests(root = ROOT) {
  const dir = path.join(root, CONTEST_DIR);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")));
}

export function loadLedger(root = ROOT) {
  return JSON.parse(readFileSync(path.join(root, LEDGER_FILE), "utf8"));
}

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) out[m[1]] = m[2] ?? true;
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const contests = loadContests();
  let ledger = loadLedger();
  const now = args.now ? new Date(args.now) : new Date();
  const state = args.state ? path.resolve(ROOT, String(args.state)) : null;
  if (args.add) {
    const { ledger: next, entry } = addOutsideEntry(
      ledger,
      {
        forecaster: args.forecaster,
        contest: args.contest,
        party: args.party,
        chance: args.chance ?? null,
        shares: args.shares ? JSON.parse(args.shares) : null,
        captured_at: args["captured-at"],
        source: args.source,
        method: args.method,
        note: args.note,
      },
      contests,
    );
    ledger = next;
    console.log(`Added ${entry.forecaster} on ${entry.contest}: ${entry.called_party}, ${entry.status}.`);
  } else if (args["import-research"]) {
    const file = String(args["import-research"]);
    const doc = JSON.parse(readFileSync(path.join(ROOT, file), "utf8"));
    const res = importResearch(ledger, doc, contests, { capturedAt: args["captured-at"] || doc.meta?.exported_at, source: file });
    ledger = res.ledger;
    console.log(`Research export: ${res.added} entries added; ${res.missing.length} ballots with no contest file.`);
    for (const m of res.missing) console.log(`  ! no contest file for ${m}`);
  } else if (args["import-research-live"]) {
    const file = String(args["import-research-live"]);
    const doc = JSON.parse(readFileSync(path.resolve(ROOT, file), "utf8"));
    const res = importResearchLive(ledger, doc, contests, { source: path.isAbsolute(file) ? path.relative(ROOT, file) : file, now });
    ledger = res.ledger;
    console.log(
      `Live research forecasts: ${res.added.length} added, ${res.replaced.length} replaced by a later capture, ` +
        `${res.unchanged.length} unchanged, ${res.refused.length} refused; ${res.skipped_records} skipped records not read.`,
    );
    for (const r of res.refused) console.log(`  ! refused ${r.ballot}: ${r.reason}`);
  } else {
    if (state && existsSync(state)) {
      const merged = mergeSiteEntries(ledger, JSON.parse(readFileSync(state, "utf8")).entries);
      ledger = merged.ledger;
      console.log(`Persistent log ${state}: ${merged.added} added, ${merged.replaced} replaced.`);
    } else if (state) {
      console.log(`Persistent log ${state} not found; starting it.`);
    }
    if (args["merge-only"]) {
      if (!state) throw new Error("--merge-only needs --state=<path>");
    } else {
      const published = existsSync(path.join(ROOT, PUBLISHED_FILE))
        ? JSON.parse(readFileSync(path.join(ROOT, PUBLISHED_FILE), "utf8")).forecasts || {}
        : {};
      const res = logSiteForecasts(ledger, contests, published, now);
      ledger = res.ledger;
      console.log(
        `Site forecasts: ${res.changes.refreshed.length} refreshed, ${res.changes.added.length} added, ${res.changes.withdrawn.length} withdrawn before polling day.`,
      );
    }
  }
  const errors = validateLedger(ledger);
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
  if (args["dry-run"]) {
    console.log("Dry run: nothing written.");
    return;
  }
  ledger.updated_at = now.toISOString();
  writeFileSync(path.join(ROOT, LEDGER_FILE), `${JSON.stringify(ledger, null, 2)}\n`);
  console.log(`Wrote ${LEDGER_FILE}: ${ledger.entries.length} entries.`);
  // The publisher's checkout resets to origin/main every night, so its log
  // lives outside git. Only the logging form writes it; --merge-only reads it.
  if (state && !args["merge-only"]) {
    mkdirSync(path.dirname(state), { recursive: true });
    const site = ledger.entries.filter((e) => e.forecaster === SITE);
    writeFileSync(state, `${JSON.stringify({ updated_at: now.toISOString(), entries: site }, null, 2)}\n`);
    console.log(`Wrote ${state}: ${site.length} site entries.`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
