#!/usr/bin/env node
// Build ward identity table from D1 candidate roster files.
// Persists data/identity/wards-may-2026.json keyed by ballot_paper_id.
// Fields: ballot_paper_id, gss_code, ward_name, ward_slug, council_slug,
//   council_name, tier, model_family_hint, winner_count, cancelled,
//   sopn_url, sopn_source_url, candidate_count, parties_standing.
//
// PCON parent constituency join is deferred to D3 (added when history
// ingest needs it for the stale-baseline GE2024 fallback).

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const ROSTER_DIR = path.join(ROOT, "data/candidates/may-2026");
const OUT = path.join(ROOT, "data/identity/wards-may-2026.json");

function stripGss(postId) {
  return String(postId || "").replace(/^gss:/, "") || null;
}

function councilNameFromElection(name) {
  // "Adur local election" → "Adur"; "Mayor of Croydon" → "Croydon" etc.
  return String(name || "")
    .replace(/\s+local\s+election$/i, "")
    .replace(/^Mayor of\s+/i, "")
    .replace(/\s+elections?$/i, "")
    .trim();
}

function partiesStandingIn(ballot) {
  const parties = new Set();
  for (const c of ballot.candidates || []) {
    if (c.party_name) parties.add(c.party_name);
  }
  return [...parties].sort();
}

function main() {
  const files = readdirSync(ROSTER_DIR).filter((f) => f.endsWith(".json")).sort();
  const wards = [];
  let totalCancelled = 0;
  let totalCandidates = 0;

  for (const file of files) {
    const roster = JSON.parse(readFileSync(path.join(ROSTER_DIR, file), "utf8"));
    const eg = roster.election_group;
    const councilName = councilNameFromElection(eg.name);
    for (const b of roster.ballots) {
      totalCandidates += (b.candidates || []).length;
      if (b.cancelled) totalCancelled += 1;
      wards.push({
        ballot_paper_id: b.ballot_paper_id,
        gss_code: stripGss(b.post?.id),
        ward_name: b.post?.label || null,
        ward_slug: b.post?.slug || null,
        council_slug: eg.classification.tier === "local"
          ? eg.election_id.split(".")[1]
          : eg.election_id.split(".").slice(1, -1).join("."),
        council_name: councilName,
        election_group_id: eg.election_id,
        tier: eg.classification.tier,
        model_family_hint: eg.classification.model_family_hint,
        winner_count: b.winner_count,
        cancelled: b.cancelled,
        candidates_locked: b.candidates_locked,
        sopn_url: b.sopn_url || null,
        sopn_source_url: b.sopn_source_url || null,
        candidate_count: (b.candidates || []).length,
        parties_standing: partiesStandingIn(b),
      });
    }
  }

  // Index for fast joins downstream
  const byBallot = Object.fromEntries(wards.map((w) => [w.ballot_paper_id, w]));
  const byGss = {};
  for (const w of wards) {
    if (!w.gss_code) continue;
    if (!byGss[w.gss_code]) byGss[w.gss_code] = [];
    byGss[w.gss_code].push(w.ballot_paper_id);
  }
  const duplicateGss = Object.fromEntries(Object.entries(byGss).filter(([, v]) => v.length > 1));

  // Council inventory (one row per council)
  const councilMap = new Map();
  for (const w of wards) {
    const key = `${w.tier}::${w.council_slug}`;
    if (!councilMap.has(key)) {
      councilMap.set(key, {
        council_slug: w.council_slug,
        council_name: w.council_name,
        tier: w.tier,
        model_family_hint: w.model_family_hint,
        ballot_count: 0,
        ward_count: new Set(),
        cancelled: 0,
        seats_up: 0,
        candidate_count: 0,
        parties: new Set(),
      });
    }
    const c = councilMap.get(key);
    c.ballot_count += 1;
    c.ward_count.add(w.gss_code || w.ward_slug);
    if (w.cancelled) c.cancelled += 1;
    c.seats_up += w.winner_count || 0;
    c.candidate_count += w.candidate_count;
    for (const p of w.parties_standing) c.parties.add(p);
  }
  const councils = [...councilMap.values()].map((c) => ({
    ...c,
    ward_count: c.ward_count.size,
    parties: [...c.parties].sort(),
  })).sort((a, b) => a.tier.localeCompare(b.tier) || a.council_slug.localeCompare(b.council_slug));

  const payload = {
    generated_at: new Date().toISOString(),
    election_date: "2026-05-07",
    sha256_inputs: createHash("sha256").update(JSON.stringify(wards)).digest("hex"),
    totals: {
      ballots: wards.length,
      cancelled: totalCancelled,
      candidates: totalCandidates,
      councils: councils.length,
      gss_with_duplicates: Object.keys(duplicateGss).length,
    },
    wards,
    by_ballot: byBallot,
    by_gss_index: byGss,
    duplicate_gss: duplicateGss,
    councils,
  };

  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(payload, null, 2));

  process.stdout.write(`Wrote ${OUT}\n`);
  process.stdout.write(`  ${wards.length} ballots / ${councils.length} councils / ${totalCandidates} candidates\n`);
  process.stdout.write(`  ${Object.keys(duplicateGss).length} GSS codes appearing in multiple ballots`);
  if (Object.keys(duplicateGss).length) {
    process.stdout.write(` — first 5: ${Object.entries(duplicateGss).slice(0, 5).map(([g, ids]) => `${g}(${ids.length})`).join(", ")}`);
  }
  process.stdout.write(`\n`);
  // Tier breakdown
  const byTier = {};
  for (const c of councils) byTier[c.tier] = (byTier[c.tier] || 0) + 1;
  process.stdout.write(`\nCouncils by tier:\n`);
  for (const [t, n] of Object.entries(byTier).sort((a, b) => b[1] - a[1])) {
    process.stdout.write(`  ${t.padEnd(20)} ${n}\n`);
  }
}

main();
