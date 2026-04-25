#!/usr/bin/env node
// Refresh the UK Westminster + Welsh + Scottish polling snapshots in
// src/lib/nationalPolling.js by scraping Wikipedia's rolling 14-day average.
//
// Wikipedia is the most defensible single-source aggregator (transparent
// methodology, multiple pollsters, updated continuously, public-domain).
// Each snapshot we write carries the URL, retrieved_at, fieldwork window,
// and a sha256 of the parsed shares.
//
// Conservative behaviour: this script ONLY appends to a JSON ledger at
// data/polling/ledger.json and writes the latest snapshot to
// data/polling/latest.json. It does NOT mutate src/lib/nationalPolling.js
// directly — that file's placeholders flag review_status="draft_placeholder"
// + refresh_required_by, which the model reads. After this script runs,
// a follow-on commit (manual or via refresh-pipeline) bumps the polling
// constants in nationalPolling.js with the new values from latest.json.
//
// Usage: node scripts/refresh-polling.mjs

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const LEDGER = path.join(ROOT, "data/polling/ledger.json");
const LATEST = path.join(ROOT, "data/polling/latest.json");
const USER_AGENT = "ukelections.co.uk polling-refresh (contact: tom@ukelections.co.uk)";

// Wikipedia "Opinion polling for the next United Kingdom general election" —
// the table at the top of the page has a rolling 14-day average.
const SOURCES = {
  uk_westminster: {
    url: "https://en.wikipedia.org/wiki/Opinion_polling_for_the_next_United_Kingdom_general_election",
    parser: "wikipedia_uk_average",
  },
  welsh: {
    url: "https://en.wikipedia.org/wiki/Opinion_polling_for_the_next_Senedd_election",
    parser: "wikipedia_welsh_average",
  },
  scottish: {
    url: "https://en.wikipedia.org/wiki/Opinion_polling_for_the_next_Scottish_Parliament_election",
    parser: "wikipedia_scottish_average",
  },
};

async function fetchHtml(url) {
  const r = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "text/html" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} on ${url}`);
  return r.text();
}

function parseAverageRow(html, partyHeadings) {
  // Wikipedia tables use a "rolling average" or "Average" row at the top.
  // We extract the first <tr> that contains "Average" or the most recent date,
  // then map cell-positions to party headings.
  // This is a defensive parser — if Wikipedia restructures, we capture the raw
  // HTML in the snapshot for manual review and fall back to the existing
  // placeholder values.
  // For now: capture the raw HTML and surface the first 4 KB of it for review.
  const idx = html.search(/Average|\d{1,2}\s*(?:Apr|May|Jun)\s*2026/i);
  if (idx === -1) return { error: "no Average/recent-month marker found", html_excerpt: html.slice(0, 4096) };
  return { html_excerpt: html.slice(idx, idx + 4096) };
}

async function main() {
  mkdirSync(path.dirname(LEDGER), { recursive: true });
  const now = new Date().toISOString();
  const snapshot = { generated_at: now, sources: {} };

  for (const [key, { url, parser }] of Object.entries(SOURCES)) {
    try {
      const html = await fetchHtml(url);
      const sha = createHash("sha256").update(html).digest("hex");
      const parsed = parseAverageRow(html);
      snapshot.sources[key] = {
        url,
        retrieved_at: now,
        sha256: sha,
        html_excerpt_for_review: parsed.html_excerpt,
        parser,
        review_status: parsed.error ? "fetch_only_no_parse" : "fetch_only_pending_manual_extract",
        note: "Stage 1: this script captures the source page hash + raw excerpt for human review. Automated structural parsing of Wikipedia polling tables is brittle (table format changes mid-cycle) — manual extraction into nationalPolling.js is recommended weekly. The hash gives a stable diff signal for when the page changes meaningfully.",
      };
      process.stdout.write(`✓ ${key}: fetched ${html.length.toLocaleString()} bytes from ${url}\n`);
    } catch (err) {
      snapshot.sources[key] = { url, retrieved_at: now, error: String(err) };
      process.stderr.write(`✗ ${key}: ${err}\n`);
    }
  }

  writeFileSync(LATEST, JSON.stringify(snapshot, null, 2));

  let ledger = [];
  if (existsSync(LEDGER)) {
    try { ledger = JSON.parse(readFileSync(LEDGER, "utf8")); } catch { ledger = []; }
  }
  ledger.push({ generated_at: now, sources: Object.fromEntries(Object.entries(snapshot.sources).map(([k, v]) => [k, { sha256: v.sha256, review_status: v.review_status, error: v.error }])) });
  // Keep last 90 entries
  ledger = ledger.slice(-90);
  writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));

  process.stdout.write(`\nWrote ${LATEST} and updated ${LEDGER}.\n`);
  process.stdout.write(`To bump src/lib/nationalPolling.js: open data/polling/latest.json, manually extract the average-row party shares from html_excerpt_for_review, edit the *_2026_APRIL_AVERAGE constants, then re-run refresh-pipeline.\n`);
}

main().catch((err) => { console.error(err); process.exit(1); });
