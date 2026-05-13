#!/usr/bin/env node
/**
 * export-cohort-flip.mjs — produce a canonical cohort-results CSV from the
 * UKE election-results data, ready for AI DOGE / Council Intel's
 * `cohort_flip_batch.py` to consume.
 *
 * Reads:
 *   data/results/may-2026/council-control.json  (UKE post-audit per-council state)
 *
 * Writes:
 *   <CLAWD_ROOT>/data/cohort_results_2026-05-07.csv  (or --out path)
 *
 * Schema matches scripts/cohort_flip_batch.py:
 *   council_id,council_name,reform_controlled,current_status,notes
 *
 * The mapping is:
 *   - UKE `councils[].council_slug`  →  AI DOGE `council_id` (snake_case)
 *   - reform_controlled = TRUE iff reform.has_majority
 *   - notes = post-election headline (Reform x/total, +margin, was X)
 *
 * Existing rows in the target CSV are merged with the canonical UKE data.
 * AI DOGE-only rows that aren't in the UKE scope (Lancashire districts,
 * Lancashire CC, PCCs, May 2025 holdovers etc) are preserved as-is — they
 * were either off-ballot or out of UKE's scope.
 *
 * Usage:
 *   node scripts/export-cohort-flip.mjs
 *   node scripts/export-cohort-flip.mjs --out=/tmp/cohort.csv
 *   node scripts/export-cohort-flip.mjs --dry-run
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");
const CLAWD_ROOT = process.env.CLAWD_ROOT || "/Users/tompickup/clawd";
const DEFAULT_OUT = join(CLAWD_ROOT, "data", "cohort_results_2026-05-07.csv");

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)=(.*)$/);
  return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true];
}));

// UKE uses kebab-case slugs (e.g. `south-tyneside`, `essex`); AI DOGE uses
// snake_case slugs (e.g. `south_tyneside`, `essex_cc`). Most map by simple
// kebab→snake conversion + tier suffix where the council is a county.
const SLUG_MAP_OVERRIDES = {
  "essex": "essex_cc",
  "suffolk": "suffolk_cc",
  "norfolk": "norfolk_cc",
  "kent": "kent_cc",
  "warwickshire": "warwickshire_cc",
  "derbyshire": "derbyshire_cc",
  "staffordshire": "staffordshire_cc",
  "lincolnshire": "lincolnshire_cc",
  "nottinghamshire": "nottinghamshire_cc",
  "leicestershire": "leicestershire_cc",
  "worcestershire": "worcestershire_cc",
  "north-east-lincolnshire": "north_east_lincolnshire",
  "north-northamptonshire": "north_northants",
  "west-northamptonshire": "west_northants",
  "newcastle-under-lyme": "newcastle_under_lyme",
};

function ukeToAidogeSlug(ukeSlug) {
  if (SLUG_MAP_OVERRIDES[ukeSlug]) return SLUG_MAP_OVERRIDES[ukeSlug];
  return ukeSlug.replace(/-/g, "_");
}

function csvEscape(s) {
  const v = String(s ?? "");
  if (v.includes(",") || v.includes("\"") || v.includes("\n")) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function buildNote(council) {
  const r = council.reform || {};
  const total = council.cycle?.total_seats || "?";
  const seats = r.post_seats || 0;
  const margin = council.control?.lead_over_majority;
  const pre = council.control?.pre_control || "?";
  const status = council.control?.status === "majority" ? "Reform majority" : "Reform NOC";
  if (council.control?.status === "majority" && council.control?.controlling_party === "ref") {
    const marginPart = margin != null ? ` (+${margin} over majority)` : "";
    return `7 May 2026 result: Reform ${seats}/${total}${marginPart}. ${pre === "ref" ? "Held from 2025." : `Flipped from ${pre}.`}`;
  }
  if (r.is_largest && r.won_seats > 0) {
    return `7 May 2026 result: Reform largest at ${seats}/${total} (${r.seats_short_of_majority} short of majority). NOC.`;
  }
  return `7 May 2026: Reform ${seats}/${total}. Did not flip Reform-majority.`;
}

function main() {
  const dataPath = "data/results/may-2026/council-control.json";
  const data = JSON.parse(readFileSync(join(REPO, dataPath), "utf8"));

  // Build a map of canonical updates from UKE
  const ukeUpdates = new Map(); // aidoge_slug -> {reform_controlled, current_status, notes}
  for (const c of data.councils) {
    const aidogeSlug = ukeToAidogeSlug(c.council_slug);
    const isReformMajority = c.control?.status === "majority" && c.control?.controlling_party === "ref";
    ukeUpdates.set(aidogeSlug, {
      reform_controlled: isReformMajority ? "TRUE" : "FALSE",
      current_status: isReformMajority ? "Reform majority"
        : c.reform?.is_largest ? "Reform plurality NOC"
        : "Non-Reform",
      notes: buildNote(c),
      council_name: c.council_name,
    });
  }

  // Read existing CSV (if any) to preserve rows that aren't in UKE scope.
  const outPath = args.out || DEFAULT_OUT;
  const header = "council_id,council_name,reform_controlled,current_status,notes";
  const rows = [];
  if (existsSync(outPath)) {
    const existing = readFileSync(outPath, "utf8").trim().split(/\r?\n/);
    if (existing[0] === header) existing.shift();
    for (const line of existing) {
      // Parse with tolerant CSV reader (handles quoted notes)
      const cells = parseCsvLine(line);
      if (cells.length < 5) continue;
      const [cid, cname, ctrl, status, note] = cells;
      rows.push({ council_id: cid, council_name: cname, reform_controlled: ctrl, current_status: status, notes: note });
    }
  }

  const existingIds = new Set(rows.map((r) => r.council_id));
  let updated = 0;
  let added = 0;

  // Apply UKE updates with two rules:
  //   1. Always update existing rows in the AI DOGE tracker (preserves the
  //      hand-curated set of watched councils).
  //   2. Only ADD a council not already in the tracker if it became
  //      Reform-majority on May 7. Random non-Reform councils don't belong
  //      in the AI DOGE cohort tracker.
  for (const [aidogeSlug, u] of ukeUpdates) {
    const idx = rows.findIndex((r) => r.council_id === aidogeSlug);
    if (idx >= 0) {
      const before = rows[idx];
      if (before.reform_controlled !== u.reform_controlled || before.notes !== u.notes) {
        rows[idx] = {
          council_id: aidogeSlug,
          council_name: u.council_name,
          reform_controlled: u.reform_controlled,
          current_status: u.current_status,
          notes: u.notes,
        };
        updated += 1;
      }
    } else if (u.reform_controlled === "TRUE") {
      rows.push({
        council_id: aidogeSlug,
        council_name: u.council_name,
        reform_controlled: u.reform_controlled,
        current_status: u.current_status,
        notes: u.notes,
      });
      added += 1;
    }
  }

  // Stable sort: existing AI DOGE order first, then new rows alphabetical.
  // We don't reshuffle existing rows to keep diffs reviewable.

  const out = [header, ...rows.map((r) =>
    [r.council_id, r.council_name, r.reform_controlled, r.current_status, r.notes].map(csvEscape).join(",")
  )].join("\n") + "\n";

  if (args["dry-run"]) {
    console.log(`[DRY RUN] would write ${outPath}`);
    console.log(`  rows: ${rows.length} (added ${added}, updated ${updated})`);
    console.log(`  Reform-majority: ${rows.filter((r) => r.reform_controlled === "TRUE").length}`);
    return;
  }

  writeFileSync(outPath, out);
  console.log(`Wrote ${outPath}`);
  console.log(`  rows: ${rows.length} (added ${added}, updated ${updated})`);
  console.log(`  Reform-majority: ${rows.filter((r) => r.reform_controlled === "TRUE").length}`);
  console.log(`\nNext: cd ${CLAWD_ROOT} && python3 scripts/cohort_flip_batch.py data/cohort_results_2026-05-07.csv`);
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; continue; }
      if (ch === '"') { inQuote = false; continue; }
      cur += ch;
    } else {
      if (ch === '"') { inQuote = true; continue; }
      if (ch === ",") { out.push(cur); cur = ""; continue; }
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

main();
