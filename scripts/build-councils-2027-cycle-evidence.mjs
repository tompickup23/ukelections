#!/usr/bin/env node
/**
 * build-councils-2027-cycle-evidence.mjs: for each English council left
 * "not verified" in councils-2027.json, set out whether its own electoral cycle
 * puts an ordinary poll on 6 May 2027, and on what evidence.
 *
 * Why this is a separate file. Most of the 65 were left unverified because
 * reorganisation made 2027 uncertain: shadow elections, postponements, council
 * pages written before the government changed course. HCWS432 (29 October
 * 2026) settles that for every reorganisation area except Surrey: elections
 * "scheduled to take place in May 2027 would go ahead to existing councils".
 * What remains is the cycle itself, which this script reads from two
 * independent records:
 *   1. Democracy Club's ordinary local results for the council since 2016
 *      (data/identity/councils-2027-baselines.json, from
 *      `ingest-dc-historic-results.mjs --scope=2027`);
 *   2. whether Open Council Data lists the council for May 2027 (the
 *      reconciliation block of councils-2027.json; a yes/no only, no values
 *      copied, CC BY-SA 4.0).
 * A council is "due_by_cycle" only when both agree. This is not the same
 * evidence as a quoted council page or order, so it never flips a council to
 * verified: councils-2027.json and the public page are unchanged. Promoting
 * these is Tom's decision.
 *
 *   node scripts/build-councils-2027-cycle-evidence.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const readJson = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), "utf8"));
const OUT = "data/identity/councils-2027-cycle-evidence.json";

export const HCWS432 = {
  label: "UK Parliament, Written statement HCWS432, Local Government Reorganisation, made 29 October 2026 (Jim McMahon), section Elections",
  url: "https://questions-statements.parliament.uk/written-statements/detail/2026-10-29/hcws432",
  quote: "elections scheduled to take place in May 2027 would go ahead to existing councils. This remains the position for all 20 areas covered above.",
  scope_note: "The 20 areas are every reorganisation invitation area except Surrey, whose new councils go live in April 2027.",
};

// Same normalisation as build-councils-2027.mjs, so "Watford Borough Council"
// matches Open Council Data's "Watford".
const normName = (s) => String(s || "").toLowerCase().replace(/&/g, "and").replace(/\b(city|council|borough|district|county|of|the)\b/g, "").replace(/[^a-z]/g, "");

// Read the cycle off the council's ordinary polls. A council that polled in at
// least three of 2021-2026 elects in parts, and in that case a poll counts as
// whole-council only if it elected at least 1.8 times the median poll (a
// boundary-change all-out year among thirds). A council polling less often
// than that elects whole: any poll of at least 80% of its largest is whole.
export function classifyCycle(polls) {
  const byYear = new Map();
  for (const p of polls) {
    const y = Number(p.date.slice(0, 4));
    if (y < 2016) continue;
    byYear.set(y, (byYear.get(y) || 0) + p.elected);
  }
  const years = [...byYear.keys()].sort((a, b) => a - b);
  if (!years.length) return { pattern: "no_polls", due_2027: null, basis: "No ordinary poll since 2016 in Democracy Club's results." };
  const max = Math.max(...byYear.values());
  const sizes = [...byYear.values()].sort((a, b) => a - b);
  const median = sizes[Math.floor(sizes.length / 2)];
  const electsInParts = years.filter((y) => y >= 2021).length >= 3;
  // A council that polls at most twice in six years is not electing in parts,
  // so its latest poll is whole even when a boundary review shrank the chamber
  // (Fylde: 51 seats in 2019, 37 in 2023).
  const whole = years.filter((y) =>
    electsInParts ? byYear.get(y) >= 1.8 * median : byYear.get(y) >= 0.8 * max || y === years.at(-1),
  );
  const latest = years.at(-1);
  const lastWhole = whole.at(-1) ?? null;
  const partialsAfterWhole = years.filter((y) => lastWhole == null || y > lastWhole);
  const seq = years.map((y) => `${y}${whole.includes(y) ? " (whole)" : ""}`).join(", ");
  if (latest === lastWhole) {
    return {
      pattern: "whole_council",
      last_whole_council_poll: lastWhole,
      due_2027: lastWhole === 2023,
      basis: `Whole council last elected ${lastWhole}; four-year term puts the next whole-council poll in ${lastWhole + 4}. Polls: ${seq}.`,
    };
  }
  const had2023 = byYear.has(2023);
  return {
    pattern: "partial",
    last_whole_council_poll: lastWhole,
    partial_polls_since: partialsAfterWhole,
    due_2027: had2023,
    basis: had2023
      ? `Elects in parts; seats filled in 2023 fall due in 2027. Polls: ${seq}.`
      : `Elects in parts with no 2023 poll, so no seats fall due in 2027. Polls: ${seq}.`,
  };
}

function main() {
  const c27 = readJson("data/identity/councils-2027.json");
  const base = new Map(readJson("data/identity/councils-2027-baselines.json").councils.map((c) => [c.slug, c]));
  const ocdNames = new Set((c27.reconciliation?.open_council_data?.listed_by_ocd_not_verified_by_us || []).map(normName));

  const rows = c27.not_verified.map((nv) => {
    const b = base.get(nv.slug);
    const cyc = classifyCycle(b?.dc_ordinary_polls || []);
    const ocd = ocdNames.has(normName(nv.name));
    const agree = cyc.due_2027 != null && cyc.due_2027 === ocd;
    const p2023 = (b?.dc_ordinary_polls || []).filter((p) => p.date.startsWith("2023"));
    const seats2023 = p2023.reduce((s, p) => s + p.elected, 0);
    return {
      slug: nv.slug,
      name: nv.name,
      stored_cycle: nv.cycle || null,
      dc_cycle: cyc,
      listed_by_ocd_for_2027: ocd,
      status_2027: !agree ? "sources_disagree" : cyc.due_2027 ? "due_by_cycle" : "not_due_by_cycle",
      // Candidates elected at the 2023 poll, from DC's contested results. For a
      // council electing in parts these are the seats due in 2027, unless a
      // boundary change has intervened. Contested ballots only: an uncontested
      // ward is missing, so this is a floor, not a seat count to publish.
      dc_elected_2023_contested: p2023.length ? seats2023 : null,
      earlier_note: nv.note || null,
      earlier_conflict: nv.conflict || null,
    };
  });

  const count = (s) => rows.filter((r) => r.status_2027 === s).length;
  const out = {
    built_at: new Date().toISOString().slice(0, 10),
    purpose: "Evidence on the 2027 cycle of the English councils left not verified in councils-2027.json. Does not change that file or the public page.",
    reorganisation_source: HCWS432,
    method: "due_by_cycle means Democracy Club's ordinary results since 2016 put a poll in 2027 by the council's own cycle (whole council last elected 2023, or seats filled in 2023 by a council electing in parts) AND Open Council Data lists the council for May 2027. not_due_by_cycle means both say no. Anything else is sources_disagree.",
    sources: [
      "Democracy Club Candidates API, results endpoint (CC0), via data/identity/councils-2027-baselines.json",
      "Open Council Data UK, May 2027 elections table, http://opencouncildata.co.uk/elections.php, retrieved 2026-10-24 (listing only, CC BY-SA 4.0)",
    ],
    totals: { councils: rows.length, due_by_cycle: count("due_by_cycle"), not_due_by_cycle: count("not_due_by_cycle"), sources_disagree: count("sources_disagree") },
    councils: rows,
  };
  writeFileSync(path.join(ROOT, OUT), JSON.stringify(out, null, 2) + "\n");
  console.log(out.totals);
  for (const r of rows.filter((x) => x.status_2027 !== "due_by_cycle")) console.log(`${r.status_2027}: ${r.slug}: ${r.dc_cycle.basis}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
