#!/usr/bin/env node
/**
 * merge-may2026-results.mjs — combine DC API actuals with Wikipedia
 * supplements into a single merged actuals file with per-ballot source
 * attribution.
 *
 * Inputs:
 *   data/results/may-2026/local-and-mayor.json (DC API)
 *   data/results/may-2026/wikipedia-supplement.json (Wikipedia)
 *
 * Output:
 *   data/results/may-2026/local-and-mayor.merged.json
 *
 * Precedence: DC API wins where both exist (it's the authoritative declaration
 * pipe and includes turnout/electorate/spoilt-ballot counts that Wikipedia
 * usually lacks). Wikipedia fills gaps where DC has no record.
 *
 * Provenance: every ballot in the merged file carries `source` (already on
 * each input record) plus `source_provider` ("dc-api" | "wikipedia") so
 * downstream consumers can filter by tier of trust.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync as fsExistsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");

function readJson(p) { return JSON.parse(readFileSync(join(REPO, p), "utf8")); }
function sha256(s) { return createHash("sha256").update(s).digest("hex"); }

function tagProvider(record, provider) {
  return { ...record, source_provider: provider };
}

function main() {
  const dc = readJson("data/results/may-2026/local-and-mayor.json");
  const wikiPath = "data/results/may-2026/wikipedia-supplement.json";
  const wiki = fsExistsSync(join(REPO, wikiPath)) ? readJson(wikiPath) : null;
  // Council-PDF supplement (signed declarations, multiple councils)
  const pdfNew = "data/results/may-2026/council-pdf-supplement.json";
  const pdfOld = "data/results/may-2026/suffolk-pdf-supplement.json";
  const pdfPath = fsExistsSync(join(REPO, pdfNew)) ? pdfNew
                : fsExistsSync(join(REPO, pdfOld)) ? pdfOld
                : null;
  const pdf = pdfPath ? readJson(pdfPath) : null;
  const identity = readJson("data/identity/wards-may-2026.json");

  // Trust precedence (highest to lowest):
  //   1. council-pdf-declaration — signed deputy-returning-officer declarations
  //   2. dc-api                 — Democracy Club (typically identical to PDFs)
  //   3. wikipedia              — community-maintained mirror
  //
  // Council PDFs CAN override DC if both exist, because the PDF is the
  // legally authoritative source. In practice they'll match for any ballot
  // both have, so the override is a no-op except in the (rare) case of DC
  // having a stale/wrong row.
  const merged = {};

  // Start from DC.
  for (const r of dc.results) merged[r.ballot_paper_id] = tagProvider(r, "dc-api");

  // Council PDF declarations: override DC where both exist; fill gaps otherwise.
  let pdfAdded = 0;
  let pdfOverride = 0;
  if (pdf) {
    for (const r of pdf.results) {
      if (merged[r.ballot_paper_id]) pdfOverride += 1;
      else pdfAdded += 1;
      merged[r.ballot_paper_id] = tagProvider(r, "council-pdf-declaration");
    }
  }

  // Wikipedia: fills remaining gaps only.
  let wikiAdded = 0;
  let wikiOverlap = 0;
  if (wiki) {
    for (const r of wiki.results) {
      if (merged[r.ballot_paper_id]) {
        wikiOverlap += 1;
        continue;
      }
      merged[r.ballot_paper_id] = tagProvider(r, "wikipedia");
      wikiAdded += 1;
    }
  }

  const mergedList = Object.values(merged);

  // Coverage diagnostics against the identity scope (locals + mayors only;
  // Senedd/Holyrood are 2027, ignore them in coverage stats).
  const targetBallots = new Set(
    identity.wards.filter((w) => !w.cancelled && (w.tier === "local" || w.tier === "mayor"))
      .map((w) => w.ballot_paper_id)
  );
  const declared = new Set(mergedList.filter((r) => targetBallots.has(r.ballot_paper_id)).map((r) => r.ballot_paper_id));
  const missing = [];
  for (const w of identity.wards) {
    if (w.cancelled) continue;
    if (w.tier !== "local" && w.tier !== "mayor") continue;
    if (!declared.has(w.ballot_paper_id)) {
      missing.push({
        ballot_paper_id: w.ballot_paper_id,
        council_slug: w.council_slug,
        council_name: w.council_name,
        ward_name: w.ward_name,
        tier: w.tier,
      });
    }
  }

  // Per-source counts and per-council coverage
  const bySource = { "dc-api": 0, "council-pdf-declaration": 0, "wikipedia": 0 };
  for (const r of mergedList) bySource[r.source_provider] = (bySource[r.source_provider] || 0) + 1;

  const seatsUpByCouncil = {};
  const declaredByCouncil = {};
  for (const w of identity.wards) {
    if (w.cancelled) continue;
    if (w.tier !== "local") continue;
    const slug = w.council_slug;
    if (!slug) continue;
    seatsUpByCouncil[slug] = (seatsUpByCouncil[slug] || 0) + (w.winner_count || 1);
  }
  for (const r of mergedList) {
    if (r.tier !== "local") continue;
    const slug = r.council_slug;
    if (!slug) continue;
    const nWinners = (r.winners || []).length || 1;
    declaredByCouncil[slug] = (declaredByCouncil[slug] || 0) + nWinners;
  }
  const partialCouncils = [];
  for (const [slug, target] of Object.entries(seatsUpByCouncil)) {
    const got = declaredByCouncil[slug] || 0;
    if (got < target) {
      partialCouncils.push({ council_slug: slug, declared: got, expected: target, missing: target - got });
    }
  }
  partialCouncils.sort((a, b) => b.missing - a.missing);

  const sha = sha256(JSON.stringify(mergedList));

  const out = {
    snapshot: {
      snapshot_id: `may-2026-merged-${sha.slice(0, 12)}`,
      sources: [
        { provider: "dc-api", source: dc.snapshot.source_url, sha256: dc.snapshot.sha256, ballot_count: bySource["dc-api"] },
        pdf ? { provider: "council-pdf-declaration", source: pdf.snapshot.source_name, sha256: pdf.snapshot.sha256, ballot_count: bySource["council-pdf-declaration"] } : null,
        wiki ? { provider: "wikipedia", source: wiki.snapshot.source_pattern, sha256: wiki.snapshot.sha256, ballot_count: bySource["wikipedia"] } : null,
      ].filter(Boolean),
      election_date: dc.snapshot.election_date,
      merged_at: new Date().toISOString(),
      sha256: sha,
      precedence: "council-pdf-declaration > dc-api > wikipedia",
    },
    coverage: {
      target_ballots: targetBallots.size,
      declared_ballots: mergedList.filter((r) => targetBallots.has(r.ballot_paper_id)).length,
      coverage_pct: targetBallots.size ? Math.round((declared.size / targetBallots.size) * 1000) / 10 : 0,
      by_source: bySource,
      missing_count: missing.length,
      councils_partial: partialCouncils.length,
    },
    partial_councils: partialCouncils,
    missing_ballots: missing,
    results: mergedList,
    by_ballot: Object.fromEntries(mergedList.map((r) => [r.ballot_paper_id, r])),
  };

  const OUT = "data/results/may-2026/local-and-mayor.merged.json";
  mkdirSync(dirname(join(REPO, OUT)), { recursive: true });
  writeFileSync(join(REPO, OUT), JSON.stringify(out, null, 2));

  console.log(`Wrote ${OUT}`);
  console.log(`  Total ballots: ${mergedList.length}`);
  console.log(`    DC API:      ${bySource["dc-api"]}`);
  console.log(`    Council PDF: ${bySource["council-pdf-declaration"]}`);
  console.log(`    Wikipedia:   ${bySource["wikipedia"]}`);
  console.log(`  Council PDF overrides of DC: ${pdfOverride}`);
  console.log(`  Wiki overlap (skipped, higher-tier source wins): ${wikiOverlap}`);
  console.log(``);
  console.log(`Coverage: ${declared.size}/${targetBallots.size} (${out.coverage.coverage_pct}%)`);
  console.log(`Missing: ${missing.length} ballots, ${partialCouncils.length} councils partial`);
  if (partialCouncils.length) {
    console.log(`\n  Top 10 councils still missing wards:`);
    for (const p of partialCouncils.slice(0, 10)) {
      console.log(`    ${p.council_slug}: ${p.declared}/${p.expected} declared (${p.missing} missing)`);
    }
  }
}

main();
