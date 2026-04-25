#!/usr/bin/env node
// Ingest OpenCouncilData history (1973-2025) — council-level seat counts per
// year. Used as a council-level historical-trend prior + tracks party
// composition stability over time.
//
// Persists data/features/council-composition-history.json keyed by council
// name with per-year seat dicts.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const FILES = [".cache/opencouncildata/history2016-2025.csv", ".cache/opencouncildata/history1973-2015.csv"];
const OUT = path.join(ROOT, "data/features/council-composition-history.json");

function parseCsv(text) {
  const rows = [];
  const lines = text.split(/\r?\n/);
  const header = lines[0].split(",").map((h) => h.trim());
  for (let i = 1; i < lines.length; i += 1) {
    if (!lines[i]) continue;
    const cells = lines[i].split(",");
    const r = {};
    for (let j = 0; j < header.length; j += 1) r[header[j]] = cells[j];
    rows.push(r);
  }
  return rows;
}

function slugify(s) {
  return String(s || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function main() {
  const out = {}; // council slug → year → {con, lab, ld, green, ref, other, total, majority}
  for (const rel of FILES) {
    const fp = path.join(ROOT, rel);
    if (!existsSync(fp)) { console.warn(`skip ${rel}: missing`); continue; }
    const rows = parseCsv(readFileSync(fp, "utf8"));
    console.log(`  ${rel}: ${rows.length} rows`);
    for (const r of rows) {
      const slug = slugify(r.authority);
      if (!slug) continue;
      const year = parseInt(r.year, 10);
      if (!year) continue;
      if (!out[slug]) out[slug] = { authority: r.authority, history: {} };
      out[slug].history[year] = {
        total: parseInt(r.total, 10) || 0,
        con: parseInt(r.con, 10) || 0,
        lab: parseInt(r.lab, 10) || 0,
        ld: parseInt(r.ld, 10) || 0,
        green: parseInt(r.green, 10) || 0,
        ref: parseInt(r.ref || 0, 10) || 0,
        ukip: parseInt(r.ukip || 0, 10) || 0,
        snp: parseInt(r.snp || 0, 10) || 0,
        pc: parseInt(r.pc || 0, 10) || 0,
        nat: parseInt(r.nat || 0, 10) || 0,
        other: parseInt(r.other, 10) || 0,
        majority: r.majority || r.plurality || "",
      };
    }
  }
  // Compute trend signals per council
  const signals = {};
  for (const [slug, data] of Object.entries(out)) {
    const years = Object.keys(data.history).map(Number).sort();
    if (years.length === 0) continue;
    const last = data.history[years[years.length - 1]];
    const decadeAgo = data.history[years.find((y) => y >= years[years.length - 1] - 10) || years[0]];
    const totalLast = last.total || 1;
    signals[slug] = {
      authority: data.authority,
      years_present: years.length,
      latest_year: years[years.length - 1],
      latest_majority: last.majority,
      latest_share_seats: {
        con: +(100 * last.con / totalLast).toFixed(1),
        lab: +(100 * last.lab / totalLast).toFixed(1),
        ld: +(100 * last.ld / totalLast).toFixed(1),
        green: +(100 * last.green / totalLast).toFixed(1),
        ref: +(100 * last.ref / totalLast).toFixed(1),
        snp: +(100 * last.snp / totalLast).toFixed(1),
        other: +(100 * last.other / totalLast).toFixed(1),
      },
      decade_change_seats: {
        con: last.con - (decadeAgo?.con || 0),
        lab: last.lab - (decadeAgo?.lab || 0),
        ld: last.ld - (decadeAgo?.ld || 0),
      },
    };
  }
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({
    snapshot: { generated_at: new Date().toISOString(), source: "OpenCouncilData (CC BY-SA, public domain CSVs) — UK council seat composition 1973-2025" },
    summary: { councils: Object.keys(out).length, signals_built: Object.keys(signals).length },
    per_council: out,
    signals,
  }, null, 2));
  console.log(`Wrote ${OUT}: ${Object.keys(out).length} councils, ${Object.keys(signals).length} signals`);
}
main();
