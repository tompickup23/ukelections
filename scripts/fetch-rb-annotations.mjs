#!/usr/bin/env node
/*
 * fetch-rb-annotations.mjs
 *
 * Crawls public Wikipedia constituency pages looking for Restore Britain
 * candidate results, and writes any hits to `data/restore-britain/seat-shares.json`.
 *
 * The May-26 RB picture is sparse: the party was founded November 2025 and
 * stood candidates in a small number of constituencies. Where Wikipedia has
 * tabulated a result with party "Restore Britain" or "Great Yarmouth First"
 * (the RB-affiliated local brand), we capture { share, source, wikipedia }
 * keyed by PCON24CD.
 *
 * Run: `npm run refresh:rb`
 *
 * The script is intentionally conservative: it only updates `constituency_shares`,
 * never overwriting the file's metadata or `county_council_results` block. Any
 * existing hand-curated entries are preserved unless a fresh Wikipedia scrape
 * returns a more recent / different share for the same code.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const OUT_PATH = path.join(ROOT, "data/restore-britain/seat-shares.json");
const IDENTITY_PATH = path.join(ROOT, "data/identity/wards-may-2026.json");
const GE_IDENTITY_PATH = path.join(ROOT, "data/identity/pcons-ge-next.json");

// Wikipedia rate-limit: stay under 200 requests/minute. We sleep 400ms between
// fetches by default.
const FETCH_DELAY_MS = 400;
const USER_AGENT =
  "ukelections.co.uk RB annotation refresher (open source; contact via repository issue tracker)";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Pull the wikitext (raw markup) for an article via the Action API. We use
 * wikitext rather than parsed HTML because the result tables are easier to
 * scan with regex on the raw source.
 */
async function fetchWikitext(title) {
  const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(
    title,
  )}&prop=wikitext&format=json&formatversion=2&redirects=1`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) return null;
  const body = await res.json();
  return body?.parse?.wikitext || null;
}

/**
 * Scan a wikitext blob for a row reporting a Restore Britain candidate. The
 * pattern matches the common election-table row format used by Wikipedia
 * constituency pages, e.g.
 *
 *   |Restore Britain
 *   |[[Some Candidate]]
 *   |123
 *   |1.4
 *   |+1.4
 *
 * Both "Restore Britain" and "Great Yarmouth First" (the RB-affiliated local
 * brand) are accepted. Returns { share: 0..1 } on the first match or null.
 */
function extractRestoreBritainShare(wikitext) {
  if (!wikitext) return null;
  const patterns = [
    /Restore Britain[\s\S]{0,400}?\|\s*([0-9]+\.[0-9]+)\s*(?:\||\n)/i,
    /Great Yarmouth First[\s\S]{0,400}?\|\s*([0-9]+\.[0-9]+)\s*(?:\||\n)/i,
  ];
  for (const p of patterns) {
    const m = wikitext.match(p);
    if (m) {
      const pct = parseFloat(m[1]);
      if (Number.isFinite(pct) && pct >= 0 && pct <= 100) {
        return { share: pct / 100 };
      }
    }
  }
  return null;
}

function loadJson(p) {
  return JSON.parse(readFileSync(p, "utf8"));
}

async function main() {
  const out = loadJson(OUT_PATH);
  const existing = out.constituency_shares || {};

  // Source the list of PCONs we want to probe. Prefer the dedicated GE
  // identity table if it exists; fall back to the ward identity for a small
  // hand-picked test slate.
  let pcons = [];
  try {
    const ge = loadJson(GE_IDENTITY_PATH);
    pcons = (ge.pcons || []).filter((p) => p.pcon24cd && p.name);
  } catch (_) {
    console.warn("No pcons-2024.json — falling back to a small smoke-test slate");
    pcons = [
      { pcon24cd: "E14001352", name: "Great Yarmouth" },
      { pcon24cd: "E14001017", name: "Clacton" },
    ];
  }

  const updates = {};
  let scanned = 0;
  for (const pcon of pcons) {
    const title = `${pcon.name} (UK Parliament constituency)`;
    try {
      const wt = await fetchWikitext(title);
      const hit = extractRestoreBritainShare(wt || "");
      if (hit) {
        updates[pcon.pcon24cd] = {
          share: hit.share,
          source: `Wikipedia (auto-parsed) — ${pcon.name}`,
          wikipedia: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/\s/g, "_"))}`,
          scanned_at: new Date().toISOString(),
        };
        console.log(`  ${pcon.pcon24cd} ${pcon.name}: RB ${(hit.share * 100).toFixed(2)}%`);
      }
    } catch (err) {
      console.warn(`  ${pcon.pcon24cd} ${pcon.name}: ${err.message || err}`);
    }
    scanned += 1;
    await sleep(FETCH_DELAY_MS);
  }

  const next = { ...existing, ...updates };
  out.constituency_shares = next;
  out.metadata = {
    ...(out.metadata || {}),
    generated_at: new Date().toISOString(),
    last_scanned_pcons: scanned,
    last_scanned_hits: Object.keys(updates).length,
  };
  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + "\n");
  console.log(`Wrote ${Object.keys(updates).length} updates (scanned ${scanned} pcons) to ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
