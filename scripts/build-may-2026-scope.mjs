#!/usr/bin/env node
// Build the contest spine for 2026-05-07 from Democracy Club.
// Persists data/contests/may-2026-scope.json + data/contests/may-2026-ballots.json
// + data/candidates/may-2026/{election_group}.json per council/group.
//
// Provenance: snapshot_id, source_url, retrieved_at, sha256, licence on every
// upstream call. DC API is licensed CC0 for raw data; party metadata is OGL/CC-BY.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ELECTION_DATE = "2026-05-07";
const API = "https://candidates.democracyclub.org.uk/api/next/ballots/";
const USER_AGENT = "ukelections.co.uk scope inventory (contact: tom@ukelections.co.uk)";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const CACHE_DIR = path.join(ROOT, ".cache/dc-ballots-2026-05-07");
const PAGE_DELAY_MS = 2500;
const MAX_RETRIES = 6;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(url, attempt = 1) {
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "application/json" } });
  if (res.status === 429 || res.status >= 500) {
    if (attempt > MAX_RETRIES) throw new Error(`DC API ${res.status} after ${attempt} attempts on ${url}`);
    const wait = Math.min(60000, 5000 * 2 ** (attempt - 1));
    process.stderr.write(`  rate-limited (${res.status}), backing off ${wait}ms (attempt ${attempt})\n`);
    await sleep(wait);
    return fetchPage(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`DC API ${res.status} ${res.statusText} on ${url}`);
  return res.json();
}

async function fetchAllBallots() {
  mkdirSync(CACHE_DIR, { recursive: true });
  let url = `${API}?election_date=${ELECTION_DATE}`;
  const all = [];
  let page = 0;
  while (url) {
    page += 1;
    const cachePath = path.join(CACHE_DIR, `page-${String(page).padStart(3, "0")}.json`);
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

function classifyElection(electionId) {
  const prefix = electionId.split(".")[0];
  return {
    local: { tier: "local", model_family_hint: "local_fptp" },
    "local-by": { tier: "local-by", model_family_hint: "local_fptp" },
    parl: { tier: "westminster", model_family_hint: "westminster_fptp" },
    "parl-by": { tier: "westminster-by", model_family_hint: "westminster_fptp" },
    senedd: { tier: "senedd", model_family_hint: "senedd_closed_list_pr" },
    "senedd-c": { tier: "senedd_constituency", model_family_hint: "senedd_constituency_fptp" },
    "senedd-r": { tier: "senedd_region", model_family_hint: "senedd_closed_list_pr" },
    sp: { tier: "holyrood", model_family_hint: "scottish_ams" },
    "sp-c": { tier: "holyrood_constituency", model_family_hint: "scottish_ams_constituency" },
    "sp-r": { tier: "holyrood_region", model_family_hint: "scottish_ams_region" },
    "nia": { tier: "stormont", model_family_hint: "stv" },
    mayor: { tier: "mayor", model_family_hint: "mayor_supplementary" },
    pcc: { tier: "pcc", model_family_hint: "pcc_supplementary" },
    "ref": { tier: "referendum", model_family_hint: "referendum" },
  }[prefix] || { tier: prefix, model_family_hint: "unknown" };
}

function councilSlug(electionId) {
  // local.adur.2026-05-07 → adur ; senedd-c.cardiff-central.2026-05-07 → cardiff-central
  const parts = electionId.split(".");
  if (parts.length >= 3) return parts.slice(1, -1).join(".");
  return null;
}

function makeSnapshot(content, sourceUrl, name) {
  const sha = createHash("sha256").update(content).digest("hex");
  return {
    snapshot_id: `${name}-${sha.slice(0, 12)}`,
    source_name: "Democracy Club Candidates API",
    source_url: sourceUrl,
    retrieved_at: new Date().toISOString(),
    licence: "Democracy Club election data is published under CC0 1.0 for raw fields; party metadata sourced from Electoral Commission (OGL).",
    sha256: sha,
    quality_status: "imported_quarantined",
    review_notes: "Bulk DC API fetch. Verify candidate locks + cancellations + SoPN URLs before any per-contest publication.",
  };
}

function writeJson(relPath, data) {
  const fullPath = path.join(ROOT, relPath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, JSON.stringify(data, null, 2));
  return fullPath;
}

async function main() {
  process.stderr.write(`Fetching all ballots for ${ELECTION_DATE} ...\n`);
  const ballots = await fetchAllBallots();
  const ballotsJson = JSON.stringify({ generated_at: new Date().toISOString(), election_date: ELECTION_DATE, count: ballots.length, ballots });
  const snapshot = makeSnapshot(ballotsJson, `${API}?election_date=${ELECTION_DATE}`, "dc-ballots-2026-05-07");

  // raw archive (full payload, with provenance wrapper)
  writeJson("data/contests/may-2026-ballots.json", { snapshot, ballots });

  // group by election_group (one per council per tier)
  const groups = new Map();
  for (const b of ballots) {
    const eid = b.election.election_id;
    if (!groups.has(eid)) groups.set(eid, { election: b.election, ballots: [] });
    groups.get(eid).ballots.push(b);
  }

  // build scope summary
  const tierCounts = {};
  const partyCounts = {};
  const cancelledCount = ballots.filter((b) => b.cancelled).length;
  const sopnCount = ballots.filter((b) => b.sopn?.uploaded_file).length;
  const lockedCount = ballots.filter((b) => b.candidates_locked).length;
  let candidacyCount = 0;
  const councilSlugs = new Set();

  for (const b of ballots) {
    const cls = classifyElection(b.election.election_id);
    tierCounts[cls.tier] = (tierCounts[cls.tier] || 0) + 1;
    candidacyCount += (b.candidacies || []).length;
    const slug = councilSlug(b.election.election_id);
    if (slug) councilSlugs.add(`${cls.tier}/${slug}`);
    for (const c of b.candidacies || []) {
      const pn = c.party?.name || c.party_name || "Unknown";
      partyCounts[pn] = (partyCounts[pn] || 0) + 1;
    }
  }

  const scope = {
    snapshot,
    election_date: ELECTION_DATE,
    totals: {
      ballots: ballots.length,
      cancelled: cancelledCount,
      candidates_locked: lockedCount,
      sopn_attached: sopnCount,
      candidacies: candidacyCount,
      election_groups: groups.size,
      council_or_area_slugs: councilSlugs.size,
    },
    by_tier: Object.fromEntries(Object.entries(tierCounts).sort((a, b) => b[1] - a[1])),
    party_candidacies_top_30: Object.fromEntries(
      Object.entries(partyCounts).sort((a, b) => b[1] - a[1]).slice(0, 30)
    ),
    election_groups: [...groups.entries()].map(([eid, g]) => ({
      election_id: eid,
      name: g.election.name,
      ballots: g.ballots.length,
      candidates_locked_all: g.ballots.every((b) => b.candidates_locked),
      cancelled: g.ballots.filter((b) => b.cancelled).length,
      sopn_attached: g.ballots.filter((b) => b.sopn?.uploaded_file).length,
      classification: classifyElection(eid),
      council_slug: councilSlug(eid),
    })).sort((a, b) => a.election_id.localeCompare(b.election_id)),
  };

  writeJson("data/contests/may-2026-scope.json", scope);

  // per-group candidate roster files (Codex's candidate_roster schema-compatible-ish)
  for (const [eid, g] of groups.entries()) {
    const roster = {
      snapshot,
      election_group: { election_id: eid, name: g.election.name, classification: classifyElection(eid) },
      ballots: g.ballots.map((b) => ({
        ballot_paper_id: b.ballot_paper_id,
        post: b.post,
        winner_count: b.winner_count,
        cancelled: b.cancelled,
        candidates_locked: b.candidates_locked,
        sopn_url: b.sopn?.uploaded_file || null,
        sopn_source_url: b.sopn?.source_url || null,
        candidates: (b.candidacies || []).map((c) => ({
          person_id: c.person?.id ?? null,
          name: [c.sopn_first_names, c.sopn_last_name].filter(Boolean).join(" ") || c.person?.name || null,
          party_name: c.party?.name || c.party_name || null,
          party_ec_id: c.party?.ec_id || null,
          party_description_text: c.party_description_text || null,
          party_list_position: c.party_list_position,
          deselected: c.deselected || false,
          elected: c.elected,
        })),
      })),
    };
    const safe = eid.replace(/[^a-z0-9._-]/gi, "_");
    writeJson(`data/candidates/may-2026/${safe}.json`, roster);
  }

  // human-readable summary
  process.stdout.write(`\n=== May 7 2026 scope ===\n`);
  process.stdout.write(`Ballots: ${ballots.length}  (cancelled ${cancelledCount}, locked ${lockedCount}, SoPN ${sopnCount})\n`);
  process.stdout.write(`Election groups (council × tier): ${groups.size}\n`);
  process.stdout.write(`Distinct council/area slugs: ${councilSlugs.size}\n`);
  process.stdout.write(`Total candidacies: ${candidacyCount}\n`);
  process.stdout.write(`\nBy tier:\n`);
  for (const [t, n] of Object.entries(scope.by_tier)) process.stdout.write(`  ${t.padEnd(28)} ${n}\n`);
  process.stdout.write(`\nTop 15 parties by candidacies:\n`);
  for (const [p, n] of Object.entries(scope.party_candidacies_top_30).slice(0, 15)) {
    process.stdout.write(`  ${p.slice(0, 50).padEnd(52)} ${n}\n`);
  }
  process.stdout.write(`\nWrote:\n  data/contests/may-2026-ballots.json (raw)\n  data/contests/may-2026-scope.json (summary)\n  data/candidates/may-2026/*.json (${groups.size} files)\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
