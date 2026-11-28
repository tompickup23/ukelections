#!/usr/bin/env node
/**
 * Write a copy of the Democracy Club history bundle as the engine would have
 * seen it on 7 May 2026 (contests dated before that day only), optionally with
 * the notional previous results from cache/engine_notional.json added for the
 * bridged wards. ENGINE_NOTIONAL_SPEC.md.
 *
 * Usage: node engine_notional_history.mjs <history.json> <out.json> [--inject]
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const [src, out, flag] = process.argv.slice(2);
const HERE = path.dirname(new URL(import.meta.url).pathname);
const h = JSON.parse(readFileSync(src, "utf8"));
const CUT = "2026-05-07";
const byBallot = Object.fromEntries(Object.entries(h.by_ballot).filter(([, r]) => r.election_date < CUT));
const byWard = {};
for (const [k, ids] of Object.entries(h.by_ward_slug)) {
  const keep = ids.filter((id) => byBallot[id]);
  if (keep.length) byWard[k] = keep;
}
let added = 0;
let clash = 0;
if (flag === "--inject") {
  const notional = JSON.parse(readFileSync(path.join(HERE, "cache/engine_notional.json"), "utf8"));
  for (const [bid, n] of Object.entries(notional)) {
    const [tier, council, ward] = bid.split(".");
    const key = `${tier}::${council}::${ward}`;
    if (byWard[key]?.length) { clash += 1; continue; }
    const id = `notional.${council}.${ward}.${n.date}`;
    const parties = Object.entries(n.shares);
    byBallot[id] = {
      ballot_paper_id: id, election_date: n.date, year: Number(n.date.slice(0, 4)), tier, council_slug: council, ward_slug: ward,
      is_by_election: false, turnout_votes: n.ballots, turnout_pct: null, electorate: null, source: "notional, research/ward-model-2026-11",
      candidates: parties.map(([party, share], i) => ({ name: `Notional ${party}`, party_name: party, votes: Math.round(share * n.ballots), elected: i === 0 })),
    };
    byWard[key] = [id];
    added += 1;
  }
}
writeFileSync(out, JSON.stringify({ ...h, results: (h.results || []).filter((r) => r.election_date < CUT), by_ballot: byBallot, by_ward_slug: byWard }));
console.log(`contests kept ${Object.keys(byBallot).length - added} of ${Object.keys(h.by_ballot).length}; notional results added ${added}; wards that already had history ${clash}`);
