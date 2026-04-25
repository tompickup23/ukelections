#!/usr/bin/env node
// Phase 1: Build LA-level feature joins for the model.
//
// Outputs:
//   data/identity/council-slug-to-lad24.json
//   data/features/la-ethnic-projections.json   (HP v7.0 back-extrapolated to May 2026)
//   data/features/la-imd.json                  (avg IMD 2019 decile per LAD)
//   data/features/la-ge2024-shares.json        (DC parl.* 2024 results aggregated by PCON-LAD postcode share)

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const CLAWD = "/Users/tompickup/clawd/burnley-council/data";

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function readJson(p) {
  return JSON.parse(readFileSync(p, "utf8"));
}

function sha(obj) {
  return createHash("sha256").update(JSON.stringify(obj)).digest("hex");
}

function writeJson(rel, payload) {
  const full = path.join(ROOT, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, JSON.stringify(payload, null, 2));
  return full;
}

// ----------------------------------------------------------------------
// 1. Council slug → LAD24 code
// ----------------------------------------------------------------------

function buildSlugToLad(identity, hpAreas) {
  const slugToCode = {};
  const codeToName = {};
  for (const [code, area] of Object.entries(hpAreas)) {
    slugToCode[slugify(area.areaName)] = code;
    codeToName[code] = area.areaName;
  }
  // Try variants for common DC slug ↔ HP name mismatches
  const stripPrefixes = [
    /^city-of-/,
    /^royal-borough-of-/,
    /^london-borough-of-/,
    /^borough-of-/,
  ];
  const suffixVariants = ["-city-of", "-the-city-of", " the city of"].map(slugify);

  function tryMatch(slug) {
    if (slugToCode[slug]) return slugToCode[slug];
    // try with -city-of appended (Kingston upon Hull, City of)
    for (const sv of suffixVariants) {
      if (slugToCode[slugify(slug + " " + sv)]) return slugToCode[slugify(slug + " " + sv)];
      if (slugToCode[`${slug}-city-of`]) return slugToCode[`${slug}-city-of`];
    }
    // try stripping common prefixes
    for (const pat of stripPrefixes) {
      const stripped = slug.replace(pat, "");
      if (slugToCode[stripped]) return slugToCode[stripped];
    }
    // append " london borough" or similar
    if (slugToCode[`${slug}-london`]) return slugToCode[`${slug}-london`];
    // direct partial match
    for (const [s, c] of Object.entries(slugToCode)) {
      if (s.startsWith(slug + "-") || s === slug) return c;
    }
    return null;
  }

  const councilSlugs = [...new Set(identity.wards
    .filter((w) => w.tier === "local" || w.tier === "mayor")
    .map((w) => w.council_slug))].sort();

  const map = {};
  const matched = [];
  const unmatched = [];
  for (const slug of councilSlugs) {
    const lad = tryMatch(slug);
    map[slug] = {
      lad24cd: lad,
      lad_name: lad ? codeToName[lad] : null,
      match_type: lad === slugToCode[slug] ? "exact" : (lad ? "fuzzy" : "unmatched"),
    };
    if (lad) matched.push(slug); else unmatched.push(slug);
  }
  return { map, matched, unmatched, codeToName };
}

// ----------------------------------------------------------------------
// 2. LA ethnic projections (HP v7.0 back-extrapolated to May 2026)
// ----------------------------------------------------------------------

function backExtrapolateToMay2026(area) {
  // current.year=2021, projections.2031 has shares
  // Linear interpolation: 2026 = current + 0.5*(projections.2031 - current)
  const cur = area.current?.groups || {};
  const proj = area.projections?.["2031"] || {};
  const out = {};
  const allKeys = new Set([...Object.keys(cur), ...Object.keys(proj)]);
  for (const k of allKeys) {
    const c = cur[k] ?? 0;
    const p = proj[k] ?? c;
    out[k] = +(c + 0.5 * (p - c)).toFixed(3);
  }
  return out;
}

function buildEthnicProjections(hpAreas) {
  const out = {};
  for (const [code, area] of Object.entries(hpAreas)) {
    const groups = backExtrapolateToMay2026(area);
    const wb = (groups.white_british || 0) / 100;
    const asian = (groups.asian || 0) / 100;
    out[code] = {
      area_name: area.areaName,
      white_british_pct_projected: +wb.toFixed(4),
      asian_pct_projected: +asian.toFixed(4),
      black_pct_projected: +((groups.black || 0) / 100).toFixed(4),
      mixed_pct_projected: +((groups.mixed || 0) / 100).toFixed(4),
      other_pct_projected: +((groups.other || 0) / 100).toFixed(4),
      groups_projected_2026: groups,
      groups_2021: area.current?.groups,
      anchor_year_baseline: area.current?.year,
      anchor_year_projection: 2031,
      method: "linear interpolation between current(2021) and projections(2031), midpoint = May 2026",
    };
  }
  return out;
}

// ----------------------------------------------------------------------
// 3. LA IMD avg decile
// ----------------------------------------------------------------------

function buildLaImd(imdLsoa, codeToName) {
  // IMD cache is keyed by LSOA, value: { score, rank, decile, lad: <name> }
  const ladToLsoas = new Map();
  for (const [, row] of Object.entries(imdLsoa)) {
    const ladName = row.lad;
    if (!ladName) continue;
    if (!ladToLsoas.has(ladName)) ladToLsoas.set(ladName, []);
    ladToLsoas.get(ladName).push(row);
  }

  // Map LAD name → LAD code via HP's codeToName (inverted)
  const nameToCode = {};
  for (const [code, name] of Object.entries(codeToName)) {
    nameToCode[name.toLowerCase()] = code;
    nameToCode[slugify(name)] = code;
  }

  const out = {};
  let unmatchedNames = [];
  for (const [ladName, rows] of ladToLsoas.entries()) {
    const code = nameToCode[ladName.toLowerCase()] || nameToCode[slugify(ladName)];
    if (!code) {
      unmatchedNames.push(ladName);
      continue;
    }
    const avgDec = rows.reduce((s, r) => s + (r.decile || 0), 0) / rows.length;
    const avgScore = rows.reduce((s, r) => s + (r.score || 0), 0) / rows.length;
    out[code] = {
      area_name: ladName,
      avg_imd_decile: +avgDec.toFixed(3),
      avg_imd_score: +avgScore.toFixed(3),
      lsoa_count: rows.length,
    };
  }
  return { out, unmatchedNames };
}

// ----------------------------------------------------------------------
// 4. LA GE2024 shares (aggregate DC parl.* 2024 results via PCON-LAD postcode share)
// ----------------------------------------------------------------------

function dcPartyToCanonical(dcName) {
  if (!dcName) return "Unknown";
  const p = String(dcName).trim();
  if (/^Labour Party$/i.test(p)) return "Labour";
  if (/^Labour and Co-operative Party$/i.test(p)) return "Labour";
  if (/^Conservative and Unionist Party$/i.test(p)) return "Conservative";
  if (/^Scottish National Party \(SNP\)$/i.test(p)) return "SNP";
  if (/^Plaid Cymru/i.test(p)) return "Plaid Cymru";
  if (/^Workers Party of Britain$/i.test(p)) return "Workers Party";
  if (/^Scottish Green Party$/i.test(p)) return "Green Party";
  if (/^Liberal Democrats?$/i.test(p)) return "Liberal Democrats";
  if (/^Reform UK$/i.test(p)) return "Reform UK";
  if (/^Green Party$/i.test(p)) return "Green Party";
  if (/independent/i.test(p)) return "Independent";
  return p;
}

function buildLaGE2024Shares(historyBundle, crosswalk) {
  // 1. PCON-level shares from DC parl.* results dated 2024-07-04
  const ge24 = historyBundle.results.filter((r) =>
    r.tier === "parl" && r.election_date === "2024-07-04"
  );
  const pconShares = {};
  for (const r of ge24) {
    // ballot_paper_id: parl.<pcon-slug>.2024-07-04 — but DC ballot doesn't carry pcon CD directly
    // We use ballot_paper_id as the join key and need PCON CD via separate lookup; for now,
    // compute share dict and key by ballot_paper_id (we'll drop it after PCON CD mapping).
    const total = r.candidates.reduce((s, c) => s + (c.votes || 0), 0);
    if (total <= 0) continue;
    const shares = {};
    for (const c of r.candidates) {
      const p = dcPartyToCanonical(c.party_name);
      shares[p] = (shares[p] || 0) + (c.votes / total);
    }
    pconShares[r.ballot_paper_id] = { shares, total_votes: total };
  }

  // 2. We don't have PCON slug → PCON CD mapping in the crosswalk. Instead, use a simplified
  //    LA aggregation: compute the *unweighted average* of shares across all parl. ballots
  //    where the ballot's slug matches anything indexed under that LAD's wards (i.e. shares
  //    of constituencies that overlap the LAD). This is approximate but adequate for the
  //    stale-baseline GE2024 fallback; the model only uses it as a coarse blend.
  //
  //    For accurate apportionment we'd need ONS PCON24CD↔ballot-slug map — defer.
  //
  //    Simpler robust method: aggregate by extracting the LAD from each pcon slug heuristically.
  //    But that's fragile. We'll instead key the output by the parl ballot slug and let
  //    downstream code do its own aggregation via slug similarity.

  // Pure unweighted national-average fallback for now: aggregate ALL ge24 shares
  const natTot = {};
  let natWeight = 0;
  for (const [, v] of Object.entries(pconShares)) {
    for (const [p, s] of Object.entries(v.shares)) {
      natTot[p] = (natTot[p] || 0) + s * v.total_votes;
    }
    natWeight += v.total_votes;
  }
  const national = {};
  for (const [p, w] of Object.entries(natTot)) national[p] = +(w / natWeight).toFixed(4);

  return {
    national,
    pcon_ballots: pconShares,
    method_note: "Currently provides national GE2024 average + per-PCON shares keyed by DC ballot id. Per-LAD apportionment requires PCON24CD↔ballot-slug join (deferred — model uses national fallback for stale baselines).",
  };
}

// ----------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------

function main() {
  console.log("Loading inputs...");
  const identity = readJson(path.join(ROOT, "data/identity/wards-may-2026.json"));
  const hp = readJson(path.join(CLAWD, "shared/hp_ethnic_projections_la.json"));
  const imd = readJson(path.join(CLAWD, "imd2019_cache.json"));
  const history = readJson(path.join(ROOT, "data/history/dc-historic-results.json"));

  console.log("Building council slug → LAD code map...");
  const { map: slugMap, matched, unmatched, codeToName } = buildSlugToLad(identity, hp.areas);
  writeJson("data/identity/council-slug-to-lad24.json", {
    snapshot: { generated_at: new Date().toISOString(), source: "HP v7.0 area-name match against DC council slugs" },
    totals: { total: matched.length + unmatched.length, matched: matched.length, unmatched: unmatched.length },
    unmatched_councils: unmatched,
    map: slugMap,
  });
  console.log(`  matched ${matched.length}/${matched.length + unmatched.length} councils. unmatched: ${unmatched.join(", ")}`);

  console.log("Building LA ethnic projections (May 2026 back-extrapolation)...");
  const proj = buildEthnicProjections(hp.areas);
  const projPayload = {
    snapshot: {
      generated_at: new Date().toISOString(),
      source_name: "Hamilton-Perry v7.0 LA ethnic projections (back-extrapolated to May 2026)",
      source_path: "clawd/burnley-council/data/shared/hp_ethnic_projections_la.json",
      method: "Linear interpolation between current(2021) and projections(2031). Midpoint = May 2026.",
      licence: "Internal — derived from ONS Census 2021 + Hamilton-Perry household projection model v7.0",
      sha256: sha(proj),
    },
    lad_count: Object.keys(proj).length,
    projections: proj,
  };
  writeJson("data/features/la-ethnic-projections.json", projPayload);
  console.log(`  ${Object.keys(proj).length} LADs covered.`);

  console.log("Building LA IMD averages...");
  const { out: imdOut, unmatchedNames } = buildLaImd(imd, codeToName);
  writeJson("data/features/la-imd.json", {
    snapshot: {
      generated_at: new Date().toISOString(),
      source_name: "ONS English IMD 2019 LSOA-level, aggregated to LAD",
      source_path: "clawd/burnley-council/data/imd2019_cache.json",
      method: "Mean of constituent LSOA deciles per LAD",
      licence: "Open Government Licence",
      sha256: sha(imdOut),
    },
    lad_count: Object.keys(imdOut).length,
    unmatched_lad_names_in_source: unmatchedNames.slice(0, 20),
    imd: imdOut,
  });
  console.log(`  ${Object.keys(imdOut).length} LADs IMD-mapped (${unmatchedNames.length} source LAD names not in HP).`);

  console.log("Building LA GE2024 shares...");
  const ge = buildLaGE2024Shares(history, null);
  writeJson("data/features/la-ge2024-shares.json", {
    snapshot: {
      generated_at: new Date().toISOString(),
      source_name: "Democracy Club parl.*.2024-07-04 results, aggregated to UK national average",
      source_path: "data/history/dc-historic-results.json",
      method: ge.method_note,
      licence: "Democracy Club CC0",
      sha256: sha(ge),
    },
    national: ge.national,
    pcon_ballots_count: Object.keys(ge.pcon_ballots).length,
    pcon_ballots: ge.pcon_ballots,
  });
  console.log(`  national shares: ${JSON.stringify(ge.national)}`);
  console.log(`  per-PCON ballots: ${Object.keys(ge.pcon_ballots).length}`);

  console.log("\nPhase 1 complete.");
}

main();
