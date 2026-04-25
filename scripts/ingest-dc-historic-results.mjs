#!/usr/bin/env node
// Bulk ingest historic election results from Democracy Club results API.
// Filter to our 165 May 2026 council/area groups, parse out ward + date,
// persist as data/history/dc-historic-results.json keyed by ballot_paper_id.
//
// Provenance: snapshot_id + sha256 + retrieved_at + licence on the bundle.
// Per-result `source` URL is the official council declaration PDF.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const API = "https://candidates.democracyclub.org.uk/api/next/results/";
const PAGE_SIZE = 200;
const PAGE_DELAY_MS = 2500;
const MAX_RETRIES = 6;
const USER_AGENT = "ukelections.co.uk historic results ingest (contact: tom@ukelections.co.uk)";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const CACHE_DIR = path.join(ROOT, ".cache/dc-results");
const SCOPE_PATH = path.join(ROOT, "data/identity/wards-may-2026.json");
const OUT = path.join(ROOT, "data/history/dc-historic-results.json");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function classifyBallotId(ballotId) {
  // local.adur.buckingham.2022-05-05 → tier=local council=adur ward=buckingham date=2022-05-05
  // local.adur.buckingham.by.2024-03-14 → tier=local council=adur ward=buckingham date=2024-03-14 by-election=true
  // mayor.croydon.2022-05-05 → tier=mayor council=croydon date=2022-05-05
  // sp.c.aberdeen-central.2021-05-06 → tier=sp.c council=null ward=aberdeen-central date=2021-05-06
  const parts = String(ballotId || "").split(".");
  const date = parts[parts.length - 1];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const isBy = parts[parts.length - 2] === "by";
  const tier = parts[0];
  let council = null;
  let ward = null;
  if (tier === "local") {
    council = parts[1];
    ward = parts.slice(2, isBy ? -2 : -1).join(".");
  } else if (tier === "mayor" || tier === "pcc") {
    council = parts[1];
  } else if (tier === "senedd" || tier === "sp" || tier === "parl") {
    ward = parts.slice(1, isBy ? -2 : -1).join(".");
  }
  return { tier, council, ward, date, year: parseInt(date.slice(0, 4), 10), is_by_election: isBy };
}

async function fetchPage(url, attempt = 1) {
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "application/json" } });
  if (res.status === 429 || res.status >= 500) {
    if (attempt > MAX_RETRIES) throw new Error(`DC results API ${res.status} after ${attempt} attempts on ${url}`);
    const wait = Math.min(60000, 5000 * 2 ** (attempt - 1));
    process.stderr.write(`  rate-limited (${res.status}), backing off ${wait}ms (attempt ${attempt})\n`);
    await sleep(wait);
    return fetchPage(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`DC results API ${res.status} ${res.statusText} on ${url}`);
  return res.json();
}

async function fetchAll() {
  mkdirSync(CACHE_DIR, { recursive: true });
  let url = `${API}?page_size=${PAGE_SIZE}`;
  const all = [];
  let page = 0;
  while (url) {
    page += 1;
    const cachePath = path.join(CACHE_DIR, `page-${String(page).padStart(4, "0")}.json`);
    let body;
    if (existsSync(cachePath)) {
      body = JSON.parse(readFileSync(cachePath, "utf8"));
      process.stderr.write(`page ${page}: cached (${body.results.length})\n`);
    } else {
      body = await fetchPage(url);
      writeFileSync(cachePath, JSON.stringify(body));
      process.stderr.write(`page ${page}: +${body.results.length} (total ${all.length + body.results.length}/${body.count})\n`);
      await sleep(PAGE_DELAY_MS);
    }
    all.push(...body.results);
    url = body.next ? body.next.replace(/^http:/, "https:") : null;
  }
  return all;
}

function compactCandidate(c) {
  return {
    person_id: c.person?.id ?? null,
    name: c.person?.name || null,
    party_name: c.party?.name || null,
    party_ec_id: c.party?.ec_id || null,
    votes: c.num_ballots ?? null,
    elected: c.elected,
  };
}

function compactResult(r) {
  const ballotId = r.ballot?.ballot_paper_id || null;
  const cls = ballotId ? classifyBallotId(ballotId) : null;
  return {
    ballot_paper_id: ballotId,
    election_date: cls?.date || null,
    year: cls?.year || null,
    tier: cls?.tier || null,
    council_slug: cls?.council || null,
    ward_slug: cls?.ward || null,
    is_by_election: cls?.is_by_election || false,
    turnout_votes: r.num_turnout_reported ?? null,
    turnout_pct: r.turnout_percentage ? Number(r.turnout_percentage) / 100 : null,
    spoilt_ballots: r.num_spoilt_ballots ?? null,
    electorate: r.total_electorate ?? null,
    source: r.source || null,
    candidates: (r.candidate_results || []).map(compactCandidate),
  };
}

async function main() {
  process.stderr.write(`Loading scope identity ...\n`);
  const identity = JSON.parse(readFileSync(SCOPE_PATH, "utf8"));
  const targetCouncils = new Set(identity.wards.map((w) => w.council_slug).filter(Boolean));
  const targetTiers = new Set(identity.wards.map((w) => w.tier));
  process.stderr.write(`Targeting ${targetCouncils.size} council slugs across ${targetTiers.size} tiers.\n`);

  process.stderr.write(`Fetching DC results ...\n`);
  const raw = await fetchAll();
  process.stderr.write(`Fetched ${raw.length} raw results.\n`);

  // Filter + compact
  const compact = raw.map(compactResult).filter((r) => r.ballot_paper_id && r.election_date);
  const inScope = compact.filter((r) => {
    if (!targetTiers.has(r.tier)) {
      // Also allow tiers like sp.c, sp.r, senedd which our identity has as 'holyrood' / 'senedd'
      if (r.tier === "sp" && targetTiers.has("holyrood")) return true;
      if (r.tier === "senedd" && targetTiers.has("senedd")) return true;
      return false;
    }
    if (r.tier === "local" || r.tier === "mayor" || r.tier === "pcc") {
      return targetCouncils.has(r.council_slug);
    }
    return true; // senedd / holyrood — keep all (national)
  });

  // Index
  const byBallot = {};
  const byCouncil = {};
  const byWardSlug = {};
  for (const r of inScope) {
    byBallot[r.ballot_paper_id] = r;
    if (r.council_slug) {
      const k = `${r.tier}::${r.council_slug}`;
      if (!byCouncil[k]) byCouncil[k] = [];
      byCouncil[k].push(r.ballot_paper_id);
    }
    if (r.council_slug && r.ward_slug) {
      const k = `${r.tier}::${r.council_slug}::${r.ward_slug}`;
      if (!byWardSlug[k]) byWardSlug[k] = [];
      byWardSlug[k].push(r.ballot_paper_id);
    }
  }

  // Coverage stats vs identity
  const wardsWithAnyHistory = new Set();
  const wardsWithCycleHistory = new Set(); // had a non-by-election result
  for (const r of inScope) {
    if (r.council_slug && r.ward_slug) {
      const k = `${r.tier}::${r.council_slug}::${r.ward_slug}`;
      wardsWithAnyHistory.add(k);
      if (!r.is_by_election) wardsWithCycleHistory.add(k);
    }
  }

  const targetWardKeys = identity.wards.filter((w) => w.tier === "local" || w.tier === "mayor")
    .map((w) => `${w.tier}::${w.council_slug}::${w.ward_slug}`);
  const targetWardSet = new Set(targetWardKeys);
  const matchedAny = [...targetWardSet].filter((k) => wardsWithAnyHistory.has(k)).length;
  const matchedCycle = [...targetWardSet].filter((k) => wardsWithCycleHistory.has(k)).length;

  // Per-year breakdown
  const byYear = {};
  for (const r of inScope) {
    byYear[r.year] = (byYear[r.year] || 0) + 1;
  }

  const sha = createHash("sha256").update(JSON.stringify(inScope)).digest("hex");
  const out = {
    snapshot: {
      snapshot_id: `dc-historic-results-${sha.slice(0, 12)}`,
      source_name: "Democracy Club Candidates API — results endpoint",
      source_url: API,
      retrieved_at: new Date().toISOString(),
      sha256: sha,
      licence: "Democracy Club election data is published under CC0 1.0 for raw fields; party metadata sourced from Electoral Commission (OGL).",
      quality_status: "imported_quarantined",
      review_notes: "Bulk fetch of all DC results, filtered to May 2026 scope councils + national tiers. Per-result `source` is the official declaration PDF.",
    },
    election_date_target: identity.election_date,
    totals: {
      raw_results_fetched: raw.length,
      in_scope_results: inScope.length,
      target_local_or_mayor_wards: targetWardKeys.length,
      target_wards_with_any_dc_history: matchedAny,
      target_wards_with_cycle_history: matchedCycle,
      coverage_pct_any: targetWardKeys.length ? Math.round((matchedAny / targetWardKeys.length) * 1000) / 10 : 0,
      coverage_pct_cycle: targetWardKeys.length ? Math.round((matchedCycle / targetWardKeys.length) * 1000) / 10 : 0,
    },
    by_year: byYear,
    results: inScope,
    by_ballot: byBallot,
    by_council: byCouncil,
    by_ward_slug: byWardSlug,
  };

  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out, null, 2));
  process.stdout.write(`\nWrote ${OUT}\n`);
  process.stdout.write(`  Raw results: ${raw.length}\n`);
  process.stdout.write(`  In-scope results: ${inScope.length}\n`);
  process.stdout.write(`  Target wards (local + mayor): ${targetWardKeys.length}\n`);
  process.stdout.write(`  Target wards with ANY DC history: ${matchedAny} (${out.totals.coverage_pct_any}%)\n`);
  process.stdout.write(`  Target wards with cycle history: ${matchedCycle} (${out.totals.coverage_pct_cycle}%)\n`);
  process.stdout.write(`\nResults by year:\n`);
  for (const [y, n] of Object.entries(byYear).sort()) process.stdout.write(`  ${y}: ${n}\n`);
}

main().catch((err) => { console.error(err); process.exit(1); });
