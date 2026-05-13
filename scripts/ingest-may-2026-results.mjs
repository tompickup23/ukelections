#!/usr/bin/env node
/**
 * ingest-may-2026-results.mjs — fetch the actual May 7 2026 results from the
 * Democracy Club results API, normalise per ballot_paper_id, and write to
 * data/results/may-2026/local-and-mayor.json.
 *
 * Separate from ingest-dc-historic-results.mjs because:
 *   - This is a small, time-sensitive cohort (~3,000 ballots)
 *   - It re-runs daily until coverage stabilises
 *   - Its output is the input to the post-audit harness, not the prediction
 *     pipeline. Mixing the two caches would risk a stale .cache hiding new
 *     declarations.
 *
 * Output schema (per ballot_paper_id):
 *   {
 *     ballot_paper_id, election_date, tier, council_slug, ward_slug,
 *     winner_count, electorate, turnout_votes, turnout_pct, spoilt_ballots,
 *     candidates: [{name, party_name, party_canonical, votes, elected}],
 *     vote_shares: {party_canonical: pct},
 *     winner_party_canonical,
 *     winners: [{name, party_canonical}],
 *     source, declared_at, ingested_at
 *   }
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const API = "https://candidates.democracyclub.org.uk/api/next/results/";
const ELECTION_DATE = "2026-05-07";
const PAGE_SIZE = 200;
const PAGE_DELAY_MS = 2500;
const MAX_RETRIES = 6;
const USER_AGENT = "ukelections.co.uk may-2026 results ingest (contact: tom@ukelections.co.uk)";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const CACHE_DIR = path.join(ROOT, ".cache/dc-results-may2026");
const SCOPE_PATH = path.join(ROOT, "data/identity/wards-may-2026.json");
const OUT = path.join(ROOT, "data/results/may-2026/local-and-mayor.json");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function canonParty(p) {
  if (!p) return "Unknown";
  const s = String(p).trim();
  if (/^Labour Party$/i.test(s)) return "Labour";
  if (/^Labour and Co-?operative Party$/i.test(s)) return "Labour";
  if (/^Conservative and Unionist Party$/i.test(s)) return "Conservative";
  if (/^Conservative$/i.test(s)) return "Conservative";
  if (/^Liberal Democrats?$/i.test(s)) return "Liberal Democrats";
  if (/^Reform UK$/i.test(s)) return "Reform UK";
  if (/^Green Party$/i.test(s)) return "Green Party";
  if (/^Plaid Cymru/i.test(s)) return "Plaid Cymru";
  if (/^Scottish National/i.test(s)) return "SNP";
  if (/^Independent/i.test(s)) return "Independent";
  if (/^Local/i.test(s)) return "Local";
  return s;
}

function classifyBallotId(ballotId) {
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
  }
  return { tier, council, ward, date, is_by_election: isBy };
}

async function fetchPage(url, attempt = 1) {
  const res = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "application/json" },
  });
  if (res.status === 429 || res.status >= 500) {
    if (attempt > MAX_RETRIES) {
      throw new Error(`DC results API ${res.status} after ${attempt} attempts on ${url}`);
    }
    const wait = Math.min(60000, 5000 * 2 ** (attempt - 1));
    process.stderr.write(`  rate-limited (${res.status}), backing off ${wait}ms (attempt ${attempt})\n`);
    await sleep(wait);
    return fetchPage(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`DC results API ${res.status} ${res.statusText} on ${url}`);
  return res.json();
}

async function fetchAll({ refresh = false } = {}) {
  mkdirSync(CACHE_DIR, { recursive: true });
  let url = `${API}?election_date=${ELECTION_DATE}&page_size=${PAGE_SIZE}`;
  const all = [];
  let page = 0;
  while (url) {
    page += 1;
    const cachePath = path.join(CACHE_DIR, `page-${String(page).padStart(4, "0")}.json`);
    let body;
    if (!refresh && existsSync(cachePath)) {
      body = JSON.parse(readFileSync(cachePath, "utf8"));
      process.stderr.write(`page ${page}: cached (${body.results.length})\n`);
    } else {
      body = await fetchPage(url);
      writeFileSync(cachePath, JSON.stringify(body));
      process.stderr.write(`page ${page}: +${body.results.length} (running total ${all.length + body.results.length}/${body.count})\n`);
      await sleep(PAGE_DELAY_MS);
    }
    all.push(...body.results);
    url = body.next ? body.next.replace(/^http:/, "https:") : null;
  }
  return all;
}

function compactResult(r, ingestedAt) {
  const ballotId = r.ballot?.ballot_paper_id || null;
  const cls = ballotId ? classifyBallotId(ballotId) : null;
  if (!ballotId || !cls) return null;

  const candidates = (r.candidate_results || []).map((c) => {
    const partyName = c.party?.name || null;
    return {
      person_id: c.person?.id ?? null,
      name: c.person?.name || null,
      party_name: partyName,
      party_canonical: canonParty(partyName),
      party_ec_id: c.party?.ec_id || null,
      votes: c.num_ballots ?? null,
      elected: !!c.elected,
    };
  });

  const totalVotes = candidates.reduce((s, c) => s + (c.votes || 0), 0);
  const voteShares = {};
  if (totalVotes > 0) {
    for (const c of candidates) {
      const p = c.party_canonical;
      voteShares[p] = (voteShares[p] || 0) + (c.votes || 0) / totalVotes;
    }
  }

  // Winners: those flagged elected by DC. Where DC elected flag is missing or
  // ambiguous, fall back to top N by votes where N = winner_count derived from
  // the number of candidates flagged elected (or 1 for single-member wards).
  let winners = candidates.filter((c) => c.elected);
  if (winners.length === 0 && candidates.length) {
    const sorted = [...candidates].sort((a, b) => (b.votes || 0) - (a.votes || 0));
    winners = [sorted[0]];
  }

  // Winning party = top vote-share party (mirrors winner-accuracy semantics
  // used by the post-audit harness; we record the elected-candidate party
  // separately in `winners[]`).
  const winnerEntry = Object.entries(voteShares).sort((a, b) => b[1] - a[1])[0];
  const winnerPartyCanonical = winnerEntry ? winnerEntry[0] : null;

  return {
    ballot_paper_id: ballotId,
    election_date: cls.date,
    tier: cls.tier,
    council_slug: cls.council,
    ward_slug: cls.ward,
    is_by_election: cls.is_by_election,
    winner_count: winners.length || 1,
    electorate: r.total_electorate ?? null,
    turnout_votes: r.num_turnout_reported ?? null,
    turnout_pct: r.turnout_percentage ? Number(r.turnout_percentage) / 100 : null,
    spoilt_ballots: r.num_spoilt_ballots ?? null,
    total_valid_votes: totalVotes,
    candidates,
    vote_shares: voteShares,
    winner_party_canonical: winnerPartyCanonical,
    winners: winners.map((c) => ({
      name: c.name,
      party_canonical: c.party_canonical,
      person_id: c.person_id,
      votes: c.votes,
    })),
    source: r.source || null,
    ingested_at: ingestedAt,
  };
}

async function main() {
  const refresh = process.argv.includes("--refresh");
  const ingestedAt = new Date().toISOString();

  process.stderr.write(`Loading scope identity from ${SCOPE_PATH} ...\n`);
  const identity = JSON.parse(readFileSync(SCOPE_PATH, "utf8"));
  const targetBallots = new Set(identity.wards.filter((w) => !w.cancelled).map((w) => w.ballot_paper_id));
  const targetByCouncil = {};
  for (const w of identity.wards) {
    if (w.cancelled) continue;
    targetByCouncil[w.council_slug] = (targetByCouncil[w.council_slug] || 0) + 1;
  }
  process.stderr.write(`Target: ${targetBallots.size} ballots across ${Object.keys(targetByCouncil).length} councils.\n`);

  process.stderr.write(`Fetching DC results (election_date=${ELECTION_DATE}${refresh ? ", refreshing cache" : ""}) ...\n`);
  const raw = await fetchAll({ refresh });
  process.stderr.write(`Fetched ${raw.length} raw results.\n`);

  const compact = raw.map((r) => compactResult(r, ingestedAt)).filter(Boolean);

  // Filter to in-scope ballots (drop by-elections etc that aren't in our prediction set)
  const inScope = compact.filter((r) => targetBallots.has(r.ballot_paper_id));
  const outOfScope = compact.length - inScope.length;
  process.stderr.write(`In-scope ballots: ${inScope.length} (${outOfScope} out-of-scope dropped)\n`);

  // Coverage diagnostics
  const covered = new Set(inScope.map((r) => r.ballot_paper_id));
  const missing = [];
  for (const w of identity.wards) {
    if (w.cancelled) continue;
    if (!covered.has(w.ballot_paper_id)) {
      missing.push({
        ballot_paper_id: w.ballot_paper_id,
        council_slug: w.council_slug,
        council_name: w.council_name,
        ward_name: w.ward_name,
        tier: w.tier,
      });
    }
  }
  const coverageByCouncil = {};
  for (const r of inScope) {
    coverageByCouncil[r.council_slug] = (coverageByCouncil[r.council_slug] || 0) + 1;
  }
  const partialCouncils = [];
  for (const [slug, target] of Object.entries(targetByCouncil)) {
    const got = coverageByCouncil[slug] || 0;
    if (got < target) {
      partialCouncils.push({ council_slug: slug, declared: got, expected: target, missing: target - got });
    }
  }
  partialCouncils.sort((a, b) => b.missing - a.missing);

  // Index
  const byBallot = {};
  for (const r of inScope) byBallot[r.ballot_paper_id] = r;

  // Source provenance hash on the in-scope payload only
  const sha = createHash("sha256").update(JSON.stringify(inScope)).digest("hex");

  const out = {
    snapshot: {
      snapshot_id: `may-2026-results-${sha.slice(0, 12)}`,
      source_name: "Democracy Club Candidates API — results endpoint",
      source_url: `${API}?election_date=${ELECTION_DATE}`,
      election_date: ELECTION_DATE,
      ingested_at: ingestedAt,
      sha256: sha,
      licence: "CC0 1.0 (Democracy Club raw fields); party metadata sourced from Electoral Commission (OGL).",
    },
    coverage: {
      target_ballots: targetBallots.size,
      declared_ballots: inScope.length,
      coverage_pct: targetBallots.size ? Math.round((inScope.length / targetBallots.size) * 1000) / 10 : 0,
      missing_count: missing.length,
      councils_partial: partialCouncils.length,
      councils_complete: Object.keys(targetByCouncil).length - partialCouncils.length,
    },
    partial_councils: partialCouncils,
    missing_ballots: missing,
    results: inScope,
    by_ballot: byBallot,
  };

  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out, null, 2));
  process.stdout.write(`\nWrote ${OUT}\n`);
  process.stdout.write(`  Target ballots: ${targetBallots.size}\n`);
  process.stdout.write(`  Declared: ${inScope.length} (${out.coverage.coverage_pct}%)\n`);
  process.stdout.write(`  Missing: ${missing.length}\n`);
  process.stdout.write(`  Councils complete: ${out.coverage.councils_complete}/${Object.keys(targetByCouncil).length}\n`);
  if (partialCouncils.length) {
    process.stdout.write(`\n  Top 10 councils with missing wards:\n`);
    for (const p of partialCouncils.slice(0, 10)) {
      process.stdout.write(`    ${p.council_slug}: ${p.declared}/${p.expected} declared (${p.missing} missing)\n`);
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
