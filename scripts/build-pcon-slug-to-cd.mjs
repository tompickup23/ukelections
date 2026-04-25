#!/usr/bin/env node
// P2 prep: derive a PCON24CD ↔ DC ballot slug lookup by fetching one DC
// ballot per Welsh+English parliamentary constituency and reading the
// `post.id` (gss:E14...) field. This gives us the missing join key so we
// can aggregate GE2024 results to LAD24 via Codex's PCON-LAD crosswalk.
//
// Heuristic: we already have all 650 GE2024 ballot IDs in the historic
// bundle. For each, fetch the corresponding ballot meta from the cached
// DC scope payload (or from the cache pages of the original ingest).

import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const CACHE = path.join(ROOT, ".cache/dc-results");
const OUT = path.join(ROOT, "data/identity/pcon24cd-to-ballot-slug.json");

function main() {
  if (!existsSync(CACHE)) {
    console.error(`Cache directory ${CACHE} not found — run ingest-dc-historic-results first`);
    process.exit(1);
  }
  const map = {}; // pcon24cd → ballot_slug (and reverse stored too)
  const reverse = {};
  let scanned = 0;
  for (const f of readdirSync(CACHE)) {
    if (!f.endsWith(".json")) continue;
    const page = JSON.parse(readFileSync(path.join(CACHE, f), "utf8"));
    for (const r of page.results || []) {
      const bid = r.ballot?.ballot_paper_id || "";
      if (!bid.startsWith("parl.")) continue;
      if (!bid.endsWith(".2024-07-04")) continue;
      // ballot_paper_id parl.<slug>.2024-07-04 — slug is everything between
      const slug = bid.slice("parl.".length, -".2024-07-04".length);
      // post id lives in the ballot.post field. The results endpoint embeds
      // ballot.post in some responses; if absent we'll try the ballot URL.
      // For now, use the ballot.url where post id may be present in cached
      // ballot pages. Cleanest: derive from the BALLOTS cache, not RESULTS.
      // Defer to a second pass that reads .cache/dc-ballots-2026-05-07 (which
      // we have for 2026 ballots, but we need 2024 PCON ballots).
      // This script writes a placeholder map keyed by slug only.
      reverse[slug] = bid;
      scanned += 1;
    }
  }
  console.log(`Scanned ${scanned} GE2024 ballots; ${Object.keys(reverse).length} unique slugs.`);

  // For Stage 1 of P2 we ship the slug → ballot_paper_id reverse map even
  // without PCON24CDs — downstream aggregation will be added in a follow-up
  // when we wire ONS PCON name lookup.
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({
    snapshot: { generated_at: new Date().toISOString(), scanned, source: "DC results cache pages (parl.*.2024-07-04)" },
    note: "Stage 1: slug-only map. PCON24CD join requires ONS PCON names → PCON24CD lookup (deferred). Downstream code uses slug-similarity heuristics where the precise CD isn't available.",
    slug_to_ballot: reverse,
  }, null, 2));
  console.log(`Wrote ${OUT}`);
}

main();
