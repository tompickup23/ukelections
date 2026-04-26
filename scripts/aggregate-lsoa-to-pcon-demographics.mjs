#!/usr/bin/env node
/**
 * aggregate-lsoa-to-pcon-demographics.mjs — roll the cached LSOA-level
 * Census 2021 tables up to PCON24 boundaries using the existing
 * lsoa21-to-pcon24 lookup.
 *
 * Output: data/features/pcon-demographics.json
 *
 * Tables consumed (cached at ~/ukelections/.cache/census/):
 *   TS021 — Ethnic group (20 categories)
 *   TS030 — Religion (10 categories)
 *   TS054 — Tenure (with breakdowns)
 *   TS066 — Economic activity (status)
 *   TS067 — Highest qualification
 *
 * Per-PCON output is the SUM of LSOA counts (LSOAs entirely within the PCON;
 * boundary-crossing LSOAs are assigned to their primary PCON in the lookup).
 *
 * Pure data aggregation; no I/O outside the cached files.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");
const CACHE = process.env.CENSUS_CACHE || join(homedir(), "ukelections/.cache/census");
const OUT = "data/features/pcon-demographics.json";

function readJson(p) { return JSON.parse(readFileSync(join(REPO, p), "utf8")); }
function sha256(buf) { return createHash("sha256").update(buf).digest("hex"); }

function parseLine(line) {
  const fields = [];
  let buf = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { buf += '"'; i++; } else { inQ = false; }
      } else buf += c;
      continue;
    }
    if (c === '"') { inQ = true; continue; }
    if (c === ",") { fields.push(buf); buf = ""; continue; }
    buf += c;
  }
  fields.push(buf);
  return fields;
}

function* readCsv(path) {
  const text = readFileSync(path, "utf8");
  const lines = text.split(/\r?\n/);
  const headers = parseLine(lines[0]).map((h) => h.trim().replace(/"/g, ""));
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const f = parseLine(lines[i]);
    yield Object.fromEntries(headers.map((h, j) => [h, f[j]]));
  }
}

function aggregate(table, lsoaToPcon, columns) {
  const path = join(CACHE, `census2021-${table}-lsoa.csv`);
  if (!existsSync(path)) return null;
  const acc = new Map();
  for (const row of readCsv(path)) {
    const lsoa = row["geography code"]?.trim();
    if (!lsoa) continue;
    const pcon = lsoaToPcon.lookup?.[lsoa]?.pcon24cd;
    if (!pcon) continue;
    let bucket = acc.get(pcon);
    if (!bucket) {
      bucket = {};
      for (const c of columns) bucket[c] = 0;
      acc.set(pcon, bucket);
    }
    for (const c of columns) {
      const v = Number(row[c]);
      if (Number.isFinite(v)) bucket[c] += v;
    }
  }
  return acc;
}

function findColumn(headers, regex) {
  return headers.find((h) => regex.test(h)) || null;
}

function main() {
  const lsoaToPcon = readJson("data/features/lsoa21-to-pcon24.json");
  const lsoaCount = Object.keys(lsoaToPcon.lookup || {}).length;
  console.log(`Loaded LSOA→PCON lookup: ${lsoaCount} LSOAs`);

  const out = {
    snapshot: {
      snapshot_id: `pcon-demographics-${new Date().toISOString().slice(0, 10)}`,
      generated_at: new Date().toISOString(),
      sources: [
        { path: "Census 2021 TS021 (LSOA)", role: "Ethnic group (20 categories)" },
        { path: "Census 2021 TS030 (LSOA)", role: "Religion (10 categories)" },
        { path: "Census 2021 TS054 (LSOA)", role: "Tenure" },
        { path: "Census 2021 TS066 (LSOA)", role: "Economic activity" },
        { path: "Census 2021 TS067 (LSOA)", role: "Highest qualification" },
      ],
      method: "LSOA primary-assignment to PCON via lsoa21-to-pcon24 lookup; counts summed.",
      licence: "ONS OGL v3",
    },
    by_pcon: {},
  };

  // Read header row from each table to find named columns
  const tableSpecs = [
    {
      key: "ethnicity",
      file: "ts021",
      cols: (headers) => ({
        total: findColumn(headers, /Total: All usual residents/i),
        white: findColumn(headers, /^Ethnic group: White$/i),
        white_british: findColumn(headers, /English, Welsh, Scottish, Northern Irish or British/i),
        white_other: findColumn(headers, /Other White/i),
        asian: findColumn(headers, /^Ethnic group: Asian.*?$/i),
        asian_indian: findColumn(headers, /Asian.*Indian$/i),
        asian_pakistani: findColumn(headers, /Asian.*Pakistani$/i),
        asian_bangladeshi: findColumn(headers, /Asian.*Bangladeshi$/i),
        black: findColumn(headers, /^Ethnic group: Black,/i),
        mixed: findColumn(headers, /^Ethnic group: Mixed/i),
        other: findColumn(headers, /^Ethnic group: Other ethnic group$/i),
      }),
    },
    {
      key: "religion",
      file: "ts030",
      cols: (headers) => ({
        total: findColumn(headers, /Total: All usual residents/i),
        no_religion: findColumn(headers, /No religion/i),
        christian: findColumn(headers, /Christian/i),
        muslim: findColumn(headers, /Muslim/i),
        hindu: findColumn(headers, /Hindu/i),
        sikh: findColumn(headers, /Sikh/i),
        jewish: findColumn(headers, /Jewish/i),
      }),
    },
    {
      key: "tenure",
      file: "ts054",
      cols: (headers) => ({
        total: findColumn(headers, /Total: All households/i),
        owned: findColumn(headers, /Tenure of household: Owned$/i),
        owned_outright: findColumn(headers, /Owns outright/i),
        owned_mortgage: findColumn(headers, /Owns with a mortgage or loan/i),
        social_rented: findColumn(headers, /Tenure of household: Social rented$/i),
        private_rented: findColumn(headers, /Tenure of household: Private rented$/i),
      }),
    },
    {
      key: "economic_activity",
      file: "ts066",
      cols: (headers) => ({
        total: findColumn(headers, /Total: All usual residents aged 16 years and over/i),
        unemployed: findColumn(headers, /Economically active.*Unemployed$/i),
        retired: findColumn(headers, /Economically inactive: Retired/i),
        student: findColumn(headers, /Economically inactive: Student/i),
        sick_disabled: findColumn(headers, /Long-term sick or disabled/i),
      }),
    },
    {
      key: "qualifications",
      file: "ts067",
      cols: (headers) => ({
        total: findColumn(headers, /Total: All usual residents aged 16 years and over/i),
        no_quals: findColumn(headers, /No qualifications/i),
        level_4_plus: findColumn(headers, /Level 4 qualifications and above/i),
      }),
    },
  ];

  for (const spec of tableSpecs) {
    const path = join(CACHE, `census2021-${spec.file}-lsoa.csv`);
    if (!existsSync(path)) {
      console.log(`  ${spec.key}: cache file missing — skipping`);
      continue;
    }
    // Peek at header to resolve column names
    const text = readFileSync(path, "utf8");
    const firstLine = text.split(/\r?\n/, 1)[0];
    const headers = parseLine(firstLine).map((h) => h.trim().replace(/"/g, ""));
    const cols = spec.cols(headers);
    const colNames = Object.values(cols).filter(Boolean);
    if (colNames.length === 0) {
      console.log(`  ${spec.key}: no matching columns — skipping`);
      continue;
    }
    const aggregated = aggregate(spec.file, lsoaToPcon, colNames);
    if (!aggregated) continue;
    console.log(`  ${spec.key}: aggregated ${aggregated.size} PCONs across ${colNames.length} columns`);
    for (const [pcon, bucket] of aggregated.entries()) {
      const pconRec = out.by_pcon[pcon] || (out.by_pcon[pcon] = {});
      pconRec[spec.key] = pconRec[spec.key] || {};
      // Store both raw counts and label keys
      for (const [labelKey, csvCol] of Object.entries(cols)) {
        if (!csvCol) continue;
        pconRec[spec.key][labelKey] = bucket[csvCol] ?? null;
      }
    }
  }

  // Compute derived percentages per PCON
  for (const [pcon, payload] of Object.entries(out.by_pcon)) {
    if (payload.ethnicity?.total > 0) {
      const e = payload.ethnicity;
      payload.ethnicity_pct = {
        white: e.white / e.total,
        white_british: e.white_british / e.total,
        white_other: e.white_other / e.total,
        asian: e.asian / e.total,
        asian_pakistani: e.asian_pakistani / e.total,
        asian_bangladeshi: e.asian_bangladeshi / e.total,
        asian_indian: e.asian_indian / e.total,
        black: e.black / e.total,
        mixed: e.mixed / e.total,
        other: e.other / e.total,
      };
    }
    if (payload.religion?.total > 0) {
      const r = payload.religion;
      payload.religion_pct = {
        no_religion: r.no_religion / r.total,
        christian: r.christian / r.total,
        muslim: r.muslim / r.total,
        hindu: r.hindu / r.total,
        sikh: r.sikh / r.total,
        jewish: r.jewish / r.total,
      };
    }
    if (payload.tenure?.total > 0) {
      const t = payload.tenure;
      payload.tenure_pct = {
        owner: t.owned / t.total,
        social_rented: t.social_rented / t.total,
        private_rented: t.private_rented / t.total,
      };
    }
    if (payload.qualifications?.total > 0) {
      const q = payload.qualifications;
      payload.qualifications_pct = {
        no_quals: q.no_quals / q.total,
        level_4_plus: q.level_4_plus / q.total,
      };
    }
    if (payload.economic_activity?.total > 0) {
      const e = payload.economic_activity;
      payload.economic_activity_pct = {
        retired: e.retired / e.total,
        unemployed: e.unemployed / e.total,
        sick_disabled: e.sick_disabled / e.total,
        student: e.student / e.total,
      };
    }
  }

  out.snapshot.coverage = {
    pcons_with_data: Object.keys(out.by_pcon).length,
  };
  mkdirSync(dirname(join(REPO, OUT)), { recursive: true });
  writeFileSync(join(REPO, OUT), JSON.stringify(out, null, 2));
  console.log(`Wrote ${OUT}: ${Object.keys(out.by_pcon).length} PCONs with demographic data`);
}

main();
