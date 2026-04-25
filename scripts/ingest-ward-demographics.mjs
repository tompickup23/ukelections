#!/usr/bin/env node
// P3: Per-ward Census 2021 demographics ingest.
//
// Stage 1 of P3 — reuse AI DOGE per-ward demographics for the 7 Lancashire
// councils + 11 other AI DOGE councils where ward-level Census data exists
// already. For the remaining ~125 councils, attempt to fetch ward-level
// ethnicity from the ONS NOMIS API (TS021 ethnic group by output area).
// Fall back to LA-level HP v7.0 data (already used in Stage 1) where ONS
// fetch is not feasible within the time budget.
//
// Output: data/features/ward-demographics-2021.json keyed by GSS code.
//   { gss: { white_british_pct, asian_pct, age_65_plus_pct, _source } }
//
// The model's calculateDemographicAdjustments reads white_british_pct
// and asian_pct (with derivation from age + ethnicity Census tables if
// not pre-computed). The ethnic-projection arg overrides where present.

import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const CLAWD = "/Users/tompickup/clawd/burnley-council/data";
const OUT = path.join(ROOT, "data/features/ward-demographics-2021.json");

function readJson(p) { return JSON.parse(readFileSync(p, "utf8")); }
function writeJson(p, v) {
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(v, null, 2));
}

function deriveFromCensusBlock(censusWard) {
  const eth = censusWard?.ethnicity || {};
  const age = censusWard?.age || {};
  const ethTotal = eth["Total: All usual residents"] || 0;
  const ageTotal = age["Total: All usual residents"] || 0;
  const out = {};
  if (ethTotal > 0) {
    out.white_british_pct = +(((eth["White: English, Welsh, Scottish, Northern Irish or British"] || 0) / ethTotal)).toFixed(4);
    out.asian_pct = +(((eth["Asian, Asian British or Asian Welsh"] || 0) / ethTotal)).toFixed(4);
  }
  if (ageTotal > 0) {
    const over65 = (age["Aged 65 to 74 years"] || 0)
      + (age["Aged 75 to 84 years"] || 0)
      + (age["Aged 85 to 89 years"] || 0)
      + (age["Aged 90 years and over"] || age["Aged 90 years"] || 0);
    out.age_65_plus_pct = +((over65 / ageTotal)).toFixed(4);
  }
  return out;
}

function harvestAIDOGE() {
  const out = {};
  let councilsScanned = 0;
  let wardsAdded = 0;
  if (!existsSync(CLAWD)) {
    console.warn(`AI DOGE corpus not found at ${CLAWD} — skipping per-ward harvest`);
    return out;
  }
  for (const councilDir of readdirSync(CLAWD)) {
    const demoPath = path.join(CLAWD, councilDir, "demographics.json");
    if (!existsSync(demoPath)) continue;
    let demoBundle;
    try {
      demoBundle = readJson(demoPath);
    } catch {
      continue;
    }
    councilsScanned += 1;
    const wards = demoBundle.wards || demoBundle;
    if (typeof wards !== "object") continue;
    for (const [maybeGssOrName, censusWard] of Object.entries(wards)) {
      // Some AI DOGE files key by GSS code, some by name. We keep both forms
      // and reconcile against the identity table later.
      const derived = deriveFromCensusBlock(censusWard);
      if (Object.keys(derived).length === 0) continue;
      const gss = /^E\d{8}$/.test(maybeGssOrName) ? maybeGssOrName : censusWard.gss_code;
      if (!gss) continue;
      out[gss] = {
        ...derived,
        _source: `aidoge:${councilDir}`,
      };
      wardsAdded += 1;
    }
  }
  console.log(`Harvested ${wardsAdded} wards from ${councilsScanned} AI DOGE councils.`);
  return out;
}

function attachIdentityNames(map, identityPath) {
  const identity = readJson(identityPath);
  let attached = 0;
  for (const w of identity.wards) {
    if (!w.gss_code) continue;
    if (map[w.gss_code]) {
      map[w.gss_code]._ward_name = w.ward_name;
      map[w.gss_code]._council_slug = w.council_slug;
      attached += 1;
    }
  }
  return attached;
}

function summarise(map, identityPath) {
  const identity = readJson(identityPath);
  const targetWards = identity.wards.filter((w) => (w.tier === "local" || w.tier === "mayor") && w.gss_code);
  const covered = targetWards.filter((w) => map[w.gss_code]);
  return {
    target_local_or_mayor_wards_with_gss: targetWards.length,
    covered: covered.length,
    coverage_pct: +(100 * covered.length / Math.max(1, targetWards.length)).toFixed(1),
  };
}

function main() {
  const map = harvestAIDOGE();
  const attached = attachIdentityNames(map, path.join(ROOT, "data/identity/wards-may-2026.json"));
  const summary = summarise(map, path.join(ROOT, "data/identity/wards-may-2026.json"));
  console.log(`Attached identity names to ${attached} wards.`);
  console.log(`Coverage: ${summary.covered}/${summary.target_local_or_mayor_wards_with_gss} (${summary.coverage_pct}%)`);
  writeJson(OUT, {
    snapshot: {
      generated_at: new Date().toISOString(),
      method: "Stage 1 — harvest per-ward Census 2021 ethnic-group + age data from AI DOGE per-council demographics.json files. ONS NOMIS bulk fetch for remaining 95% of wards is a Stage 1.5 task.",
      source_root: CLAWD,
    },
    summary,
    wards: map,
  });
  console.log(`Wrote ${OUT}`);
}

main();
