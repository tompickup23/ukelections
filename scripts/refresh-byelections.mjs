#!/usr/bin/env node
// refresh-byelections.mjs
//
// Keep data/history/dc-historic-results.json fed with local by-election
// results, automatically. The Lancashire model rebuild (Aug 2026) discovered
// the feed had silently stopped at 23 Apr 2026: the models read the HISTORY
// file, the display scorecard is a separate hand-curated artefact, and
// nothing was appending to the history. This closes that hole.
//
// Method (same as the verified 8 Aug 2026 manual sweep):
//   1. Sweep Democracy Club's EveryElection API day by day from the last
//      sweep date for ballots whose id contains ".by." (local by-elections).
//   2. For each, fetch the DC candidates API ballot record; ingest candidates
//      and vote counts where results are published.
//   3. Append idempotently by ballot_paper_id, flagged
//      review_status: "auto_ingested_dc" (DC transcription has erred before:
//      two errors found in the Blackpool 2023 verification. Treat these rows
//      as usable-but-unverified; declaration-PDF verification upgrades them.)
//   4. Ballots with no published result yet are recorded as pending and
//      retried next run.
//
// Where it writes (changed 20 Aug 2026): rows go to the TRACKED sidecar
// data/history/byelection-appends.json first, then get folded into the
// gitignored history file. Writing only to the history file lost every sweep:
// the nightly ingest rebuilds that file wholesale from the DC results
// endpoint, so the six contests appended on 14 Aug 2026 were gone by the 15th
// while the cron's dead-man stayed green. The nightly ingest now merges the
// sidecar back in.
//
// Backfill: --from=YYYY-MM-DD forces the sweep start date.
//
// State: data/history/byelection-refresh-state.json
// Exit code 0 even when results are pending; non-zero only on hard failure,
// so the cron's Kuma dead-man distinguishes "ran fine" from "broken".

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const p = (rel) => path.join(ROOT, rel);
const HISTORY = p("data/history/dc-historic-results.json");
const APPENDS = p("data/history/byelection-appends.json");
const STATE = p("data/history/byelection-refresh-state.json");
const EE = "https://elections.democracyclub.org.uk/api/elections/";
const DC = "https://candidates.democracyclub.org.uk/api/next/ballots/";

const today = new Date().toISOString().slice(0, 10);

// --from=YYYY-MM-DD overrides the sweep start, for backfills.
const fromArg = process.argv.find((a) => a.startsWith("--from="));
const forcedFrom = fromArg ? fromArg.slice("--from=".length) : null;

// Politeness delay between API calls. Backfills sweep hundreds of ballots, so
// --pace=1200 keeps a long run under the rate limit.
const paceArg = process.argv.find((a) => a.startsWith("--pace="));
const PACE_MS = paceArg ? Math.max(0, parseInt(paceArg.slice("--pace=".length), 10) || 0) : 400;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// DC rate-limits bulk callers. A weekly sweep of ten ballots never notices; a
// backfill of a hundred gets 429s on almost every request, which the first
// version of this script silently turned into "pending" (110 of 117 on the
// 20 Aug 2026 backfill). Back off and retry instead.
async function getJson(url, attempt = 0) {
  const res = await fetch(url, { headers: { "User-Agent": "ukelections.co.uk data refresh (tompickup23)" } });
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 5) throw new Error(`${res.status} after ${attempt + 1} attempts ${url}`);
    const retryAfter = parseInt(res.headers.get("retry-after") || "", 10);
    const waitMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : Math.min(60000, 2000 * 2 ** attempt);
    console.error(`  ${res.status}, waiting ${Math.round(waitMs / 1000)}s then retrying: ${url}`);
    await sleep(waitMs);
    return getJson(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

function isoDaysBetween(a, b) {
  const out = [];
  const d = new Date(a + "T00:00:00Z");
  const end = new Date(b + "T00:00:00Z");
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

async function main() {
  // The sidecar is the durable record. data/history/dc-historic-results.json is
  // gitignored and rebuilt nightly from the DC *results* endpoint, which lags
  // by-elections by months (it sat at 23 Apr 2026 for the whole summer), so
  // rows written only there were overwritten within a day of every sweep.
  // Everything ingested here is written to the tracked sidecar first and folded
  // back into the history file by scripts/ingest-dc-historic-results.mjs.
  const appends = existsSync(APPENDS)
    ? JSON.parse(readFileSync(APPENDS, "utf8"))
    : {
        note: "Local by-election results swept from the Democracy Club ballots API by scripts/refresh-byelections.mjs. Merged into data/history/dc-historic-results.json on every rebuild. Tracked in git because that file is not.",
        source: "https://candidates.democracyclub.org.uk/api/next/ballots/",
        review_status: "auto_ingested_dc",
        generated_at: null,
        results: [],
      };
  // Only a row Democracy Club itself produced closes a ballot off. Rows entered
  // by hand between polling day and DC's transcription (the ballots endpoint
  // carries winners days before it carries counts) must stay replaceable, or
  // the hand row silently blocks the authoritative one forever.
  // Three states, not two. A DC row closes a ballot off because DC produced it.
  // A row corrected against the returning officer's own declaration ALSO closes
  // it off, and deliberately outranks DC: Camp Hill on 25 June 2026 was
  // transcribed as 462 when Nuneaton and Bedworth published 460, and without
  // this the next sweep would put the wrong figure straight back. Everything
  // else, meaning a row entered by hand in the gap between polling day and DC's
  // transcription, stays replaceable.
  const CLOSED = new Set(["auto_ingested_dc", "corrected_against_declaration"]);
  const have = new Set(
    appends.results.filter((r) => CLOSED.has(r.review_status)).map((r) => r.ballot_paper_id),
  );
  const rowIndex = new Map(appends.results.map((r, i) => [r.ballot_paper_id, i]));
  const state = existsSync(STATE)
    ? JSON.parse(readFileSync(STATE, "utf8"))
    : { last_sweep_date: "2026-08-08", pending: [] };

  // Sweep window: from a week before the last sweep (results lag polling day)
  // through today, plus anything still pending. --from= forces a wider window.
  const from = new Date((forcedFrom || state.last_sweep_date) + "T00:00:00Z");
  if (!forcedFrom) from.setUTCDate(from.getUTCDate() - 7);
  const dates = isoDaysBetween(from.toISOString().slice(0, 10), today);

  const ballotIds = new Set(state.pending || []);
  for (const date of dates) {
    let url = `${EE}?poll_open_date=${date}&limit=100`;
    while (url) {
      let page;
      try { page = await getJson(url); } catch (e) { console.error("EE sweep failed:", e.message); process.exit(1); }
      for (const el of page.results || []) {
        const id = el.election_id || el.slug || "";
        if (/^local\..+\.by\./.test(id) && !el.group_type) ballotIds.add(id);
      }
      url = page.next;
      await sleep(PACE_MS);
    }
  }

  let added = 0;
  let replaced = 0;
  const stillPending = [];
  for (const id of [...ballotIds].sort()) {
    if (have.has(id)) continue;
    let ballot;
    try { ballot = await getJson(DC + id + "/"); } catch (e) {
      console.error("  ballot fetch failed", id, e.message);
      stillPending.push(id);
      continue;
    }
    const cands = ballot.candidacies || [];
    const withVotes = cands.filter((c) => c.result && typeof c.result.num_ballots === "number");
    if (!cands.length || withVotes.length !== cands.length) {
      stillPending.push(id);
      console.log("  pending (no full result yet):", id);
      continue;
    }
    const m = id.match(/^local\.([^.]+)\.(.+)\.by\.(\d{4}-\d{2}-\d{2})$/);
    if (!m) { console.log("  skip odd id:", id); continue; }
    const [, council_slug, ward_slug, election_date] = m;
    const row = {
      ballot_paper_id: id,
      election_date,
      year: +election_date.slice(0, 4),
      tier: "local",
      council_slug,
      ward_slug,
      is_by_election: true,
      // DC publishes these on the ballot where the returning officer stated
      // them. Null where it did not, never zero-filled.
      turnout_votes: ballot.results?.num_turnout_reported ?? null,
      turnout_pct: typeof ballot.results?.turnout_percentage === "number"
        ? ballot.results.turnout_percentage / 100
        : null,
      spoilt_ballots: ballot.results?.num_spoilt_ballots ?? null,
      electorate: ballot.results?.total_electorate ?? null,
      source: "https://candidates.democracyclub.org.uk/elections/" + id + "/",
      review_status: "auto_ingested_dc",
      candidates: cands.map((c) => ({
        name: c.person && c.person.name,
        party_name: c.party_name || (c.party && c.party.name),
        votes: c.result.num_ballots,
        elected: !!(c.result && c.result.elected),
      })),
    };
    if (rowIndex.has(id)) {
      const at = rowIndex.get(id);
      const was = appends.results[at].review_status;
      appends.results[at] = row;
      replaced += 1;
      console.log("  ~ ", id, `(superseded ${was} with the DC transcription)`);
    } else {
      appends.results.push(row);
      added += 1;
      console.log("  + ", id, `(${cands.length} candidates)`);
    }
    await sleep(PACE_MS);
  }

  if (added || replaced) {
    appends.results.sort((a, b) =>
      a.election_date === b.election_date
        ? a.ballot_paper_id.localeCompare(b.ballot_paper_id)
        : a.election_date.localeCompare(b.election_date),
    );
    appends.generated_at = new Date().toISOString();
    writeFileSync(APPENDS, JSON.stringify(appends, null, 1));
  }

  // Fold the sidecar into the history file, so a model run between this sweep
  // and the next nightly rebuild already sees every contest. Unconditional, not
  // gated on `added`: after a rebuild has dropped the sidecar rows there is
  // nothing new to fetch, and that is exactly when the fold is needed.
  if (existsSync(HISTORY)) {
    const doc = JSON.parse(readFileSync(HISTORY, "utf8"));
    const inHistory = new Set(doc.results.map((r) => r.ballot_paper_id));
    let folded = 0;
    for (const row of appends.results) {
      if (inHistory.has(row.ballot_paper_id)) continue;
      doc.results.push(row);
      inHistory.add(row.ballot_paper_id);
      folded += 1;
    }
    if (folded) writeFileSync(HISTORY, JSON.stringify(doc, null, 1));
    console.log(`  folded ${folded} rows into the history file`);
  }
  writeFileSync(STATE, JSON.stringify({ last_sweep_date: today, pending: stillPending }, null, 2));
  console.log(
    `by-election refresh: ${added} appended, ${replaced} superseded, ${stillPending.length} pending, ` +
      `swept ${dates.length} days to ${today}`,
  );
}

main();
