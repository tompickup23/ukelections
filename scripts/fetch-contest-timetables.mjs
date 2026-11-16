#!/usr/bin/env node
// Prototype: fetch the full statutory timetable for every upcoming local
// by-election from Democracy Club's EveryElection API and write it as a
// sidecar. The contest generator keeps three of the eight timetable dates;
// the voter journey tracker needs all of them (proxy, Voter Authority
// Certificate, replacement pack, notice, candidate list).
//
// Every date the tracker shows comes from this feed. Nothing is computed here.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const DIR = "data/contests/local-byelections";
const OUT = "data/contests/local-byelection-timetables.json";
const API = "https://elections.democracyclub.org.uk/api/elections/";
const today = new Date().toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const upcoming = readdirSync(DIR)
  .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
  .map((f) => JSON.parse(readFileSync(path.join(DIR, f), "utf8")))
  .filter((d) => d.contest?.polling_day >= today && d.contest?.ballot_paper_id);

const timetables = {};
let failed = 0;
for (const d of upcoming) {
  const id = d.contest.ballot_paper_id;
  try {
    const res = await fetch(`${API}${id}/`, { headers: { "User-Agent": "election-timetable-fetch/0.1" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const b = await res.json();
    timetables[id] = {
      polling_day: b.poll_open_date,
      requires_voter_id: b.requires_voter_id ?? null,
      cancelled: Boolean(b.cancelled),
      timetable: b.timetable ?? null,
      source: `${API}${id}/`,
    };
  } catch (err) {
    failed += 1;
    console.error(`! ${id}: ${err.message}`);
  }
  await sleep(400);
}
writeFileSync(OUT, JSON.stringify({
  schema_version: "0.1.0",
  fetched_at: new Date().toISOString(),
  source_label: "Democracy Club, EveryElection",
  source: API,
  timetables,
}, null, 2) + "\n");
console.log(`${Object.keys(timetables).length} timetables written, ${failed} failed`);
process.exit(failed ? 2 : 0);
