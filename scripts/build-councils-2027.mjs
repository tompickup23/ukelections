#!/usr/bin/env node
/**
 * build-councils-2027.mjs: the data behind /elections/2027/, one record per
 * council voting on Thursday 6 May 2027.
 *
 * Inputs:
 *   data/identity/council-next-elections.json  which councils vote in 2027, and
 *     the order or council page that says so (status "verified" only)
 *   data/identity/council-2027-sources.json    seats, control and last election
 *     for each of them, each with the council page, order or statute it was read
 *     from and the words quoted; a value with no source is null with a note
 *   --ocd=<file>  optional: Open Council Data's 2027 table, parsed, used only as
 *     a cross-check. Its site content is CC BY-SA 4.0, so none of its values is
 *     copied into the output: each council gets agree or disagree flags, and the
 *     totals are quoted with attribution.
 *
 * Output: data/identity/councils-2027.json
 *
 *   node scripts/build-councils-2027.mjs [--ocd=<file>]
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const p = (rel) => path.join(ROOT, rel);
const readJson = (rel) => JSON.parse(readFileSync(path.isAbsolute(rel) ? rel : p(rel), "utf8"));
const OUT = "data/identity/councils-2027.json";

// The four councils whose own pages contradict the MHCLG letter of 7 September 2026.
export const CONFLICT_SLUGS = ["lichfield", "tewkesbury", "wychavon", "derbyshire-dales"];
// Public counts used only to reconcile, never as a source.
export const POLLCHECK_CHECK = { councils: 269, seats: 10018, note: "Pollcheck's public count for 6 May 2027, as reported to us; its robots.txt disallows our crawler, so we did not fetch it. Used as a check only." };

const CYCLE = { whole: "All out", thirds: "Thirds", halves: "Halves" };

export function normName(s) {
  return String(s || "").toLowerCase().replace(/&/g, "and").replace(/\b(city|council|borough|district|county|of|the)\b/g, "").replace(/[^a-z]/g, "");
}

// Majority control from seat counts, when the cited page gives counts but no statement.
export function controlFromCounts(counts, totalSeats) {
  if (!counts || !totalSeats) return null;
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return null;
  const [party, seats] = entries[0];
  return seats > totalSeats / 2 ? party : "No overall control";
}

export function buildRecord(slug, cal, src) {
  const total = src?.total_seats?.value ?? null;
  const control = src?.control || null;
  let controlLabel = control?.value ?? null;
  let controlBasis = controlLabel ? "stated on the cited page" : null;
  if (!controlLabel && control?.seat_counts) {
    controlLabel = controlFromCounts(control.seat_counts, total);
    controlBasis = controlLabel ? "worked out from the seat counts on the cited page" : null;
  }
  return {
    slug,
    name: cal.name,
    nation: cal.nation,
    cycle: CYCLE[cal.pattern] || null,
    year_source: { label: cal.source_label, url: cal.source_url, quote: cal.quote },
    seats_up: src?.seats_up_2027 ?? { value: null, note: "Not yet sourced." },
    total_seats: src?.total_seats ?? { value: null, note: "Not yet sourced." },
    // The administration text the sources recorded is not consistently the council's own wording, so it is not published.
    control: control ? { ...Object.fromEntries(Object.entries(control).filter(([k]) => k !== "administration")), label: controlLabel, basis: controlBasis } : { value: null, label: null, note: "Not yet sourced." },
    last_election: src?.last_election ?? { date: null, note: "Not yet sourced." },
    notes: src?.notes || null,
  };
}

export function ocdCheck(records, ocdRows) {
  const byName = new Map(ocdRows.map((r) => [normName(r.council), r]));
  const ourNames = new Set(records.map((r) => normName(r.name)));
  const flags = {};
  for (const r of records) {
    const o = byName.get(normName(r.name));
    if (!o) { flags[r.slug] = { listed: false }; continue; }
    const num = (x) => (/^\d+$/.test(x) ? Number(x) : null);
    const cmp = (ours, theirs) => (ours == null || theirs == null ? null : ours === theirs);
    flags[r.slug] = {
      listed: true,
      cycle_agrees: r.cycle == null ? null : (o.cycle === "All-up") === (r.cycle === "All out"),
      total_seats_agrees: cmp(r.total_seats.value, num(o.total_seats)),
      seats_up_agrees: cmp(r.seats_up.value, num(o.seats_ending_2027)),
    };
  }
  const onlyOcd = ocdRows.filter((o) => !ourNames.has(normName(o.council))).map((o) => o.council).sort();
  const seatsEnding = ocdRows.reduce((a, o) => a + (/^\d+$/.test(o.seats_ending_2027) ? Number(o.seats_ending_2027) : 0), 0);
  return { flags, listed_by_ocd_not_verified_by_us: onlyOcd, ocd_totals: { councils: ocdRows.length, seats_ending_2027: seatsEnding } };
}

function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true]; }));
  const calendar = readJson("data/identity/council-next-elections.json");
  const sources = readJson("data/identity/council-2027-sources.json");
  const srcBySlug = new Map(sources.councils.map((c) => [c.slug, c]));

  const voting = Object.entries(calendar.councils).filter(([, c]) => c.status === "verified" && c.next_year === 2027);
  const records = voting.map(([slug, cal]) => buildRecord(slug, cal, srcBySlug.get(slug))).sort((a, b) => a.nation.localeCompare(b.nation) || a.name.localeCompare(b.name, "en-GB"));
  const notVerified = Object.entries(calendar.councils)
    .filter(([, c]) => c.nation === "E" && c.status === "unverified")
    .map(([slug, c]) => ({ slug, name: c.name, cycle: CYCLE[c.pattern] || null, note: c.notes, conflict: CONFLICT_SLUGS.includes(slug) ? sources.conflicts?.find((x) => x.slug === slug) ?? null : null }))
    .sort((a, b) => a.name.localeCompare(b.name, "en-GB"));

  const withSeats = records.filter((r) => r.seats_up.value != null);
  const totals = {
    councils_verified: records.length,
    by_nation: Object.fromEntries(["E", "S", "W"].map((n) => [n, records.filter((r) => r.nation === n).length])),
    seats_up_sourced: withSeats.reduce((a, r) => a + r.seats_up.value, 0),
    councils_with_seats_up: withSeats.length,
    councils_seats_up_blank: records.length - withSeats.length,
    english_councils_not_verified: notVerified.length,
  };

  const out = {
    checked_at: sources.checked_at,
    method: "Councils are those whose 2027 election is verified in council-next-elections.json. Seats, control and last election are each read from the council's own page, its electoral change order or the governing statute, and quoted. A value we could not source is blank with a note. Nothing is estimated: where a council elects by thirds or halves and no source states the 2027 seats, the seats up are blank.",
    totals,
    reconciliation: { pollcheck: POLLCHECK_CHECK },
    councils: records,
    not_verified: notVerified,
  };
  if (args.ocd) {
    const ocd = readJson(args.ocd);
    const check = ocdCheck(records, ocd);
    out.reconciliation.open_council_data = {
      source: "Open Council Data UK, May 2027 elections table, http://opencouncildata.co.uk/elections.php",
      retrieved: sources.ocd_retrieved || null,
      licence: "Site content CC BY-SA 4.0 (opencouncildata.co.uk/aboutthissite.php); used as a cross-check only, no value copied per council",
      totals: check.ocd_totals,
      listed_by_ocd_not_verified_by_us: check.listed_by_ocd_not_verified_by_us,
    };
    for (const r of out.councils) r.ocd_check = check.flags[r.slug];
  }
  writeFileSync(p(OUT), JSON.stringify(out, null, 2) + "\n");
  console.log(JSON.stringify(totals));
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main();
