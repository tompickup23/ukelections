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
// State: data/history/byelection-refresh-state.json
// Exit code 0 even when results are pending; non-zero only on hard failure,
// so the cron's Kuma dead-man distinguishes "ran fine" from "broken".

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const p = (rel) => path.join(ROOT, rel);
const HISTORY = p("data/history/dc-historic-results.json");
const STATE = p("data/history/byelection-refresh-state.json");
const EE = "https://elections.democracyclub.org.uk/api/elections/";
const DC = "https://candidates.democracyclub.org.uk/api/next/ballots/";

const today = new Date().toISOString().slice(0, 10);

async function getJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": "ukelections.co.uk data refresh (tompickup23)" } });
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
  const doc = JSON.parse(readFileSync(HISTORY, "utf8"));
  const have = new Set(doc.results.map((r) => r.ballot_paper_id));
  const state = existsSync(STATE)
    ? JSON.parse(readFileSync(STATE, "utf8"))
    : { last_sweep_date: "2026-08-08", pending: [] };

  // Sweep window: from a week before the last sweep (results lag polling day)
  // through today, plus anything still pending.
  const from = new Date(state.last_sweep_date + "T00:00:00Z");
  from.setUTCDate(from.getUTCDate() - 7);
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
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  let added = 0;
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
    doc.results.push({
      ballot_paper_id: id,
      election_date,
      year: +election_date.slice(0, 4),
      tier: "local",
      council_slug,
      ward_slug,
      is_by_election: true,
      turnout_votes: null, turnout_pct: null, spoilt_ballots: null,
      electorate: null,
      source: "https://candidates.democracyclub.org.uk/elections/" + id + "/",
      review_status: "auto_ingested_dc",
      candidates: cands.map((c) => ({
        name: c.person && c.person.name,
        party_name: c.party_name || (c.party && c.party.name),
        votes: c.result.num_ballots,
        elected: !!(c.result && c.result.elected),
      })),
    });
    added += 1;
    console.log("  + ", id, `(${cands.length} candidates)`);
    await new Promise((r) => setTimeout(r, 300));
  }

  if (added) writeFileSync(HISTORY, JSON.stringify(doc, null, 1));
  writeFileSync(STATE, JSON.stringify({ last_sweep_date: today, pending: stillPending }, null, 2));
  console.log(`by-election refresh: ${added} appended, ${stillPending.length} pending, swept ${dates.length} days to ${today}`);
}

main();
