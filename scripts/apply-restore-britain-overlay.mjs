#!/usr/bin/env node
/**
 * apply-restore-britain-overlay.mjs — post-processor that re-applies the
 * Restore Britain seat-level overlay on top of the GE forecast outputs.
 *
 * Why this exists: run-ge-predictions.mjs runs the standard MRP pipeline,
 * which has no concept of Restore Britain as a contestable party at the
 * seat level (no GE2024 candidates, no historical priors). The national
 * vote share IS plumbed through nationalPolling.js (RESTORE_BRITAIN_OVERLAY
 * = 4%) so the summary's national_vote_share dict already includes Restore
 * — but the seat-by-seat allocation defaults to zero everywhere.
 *
 * This script:
 *  1. Flips Great Yarmouth from Reform UK to Restore Britain (90% of
 *     Lowe's predicted Reform vote moves with him to Restore — empirical
 *     anchor: Great Yarmouth First's 9/9 Norfolk CC sweep on 7 May 2026
 *     + 1/39 Borough Council seat).
 *  2. Decrements Reform UK's seat tally by 1 and sets Restore Britain to 1.
 *  3. Stamps the snapshot.restore_britain_overlay block so the overlay is
 *     self-documenting.
 *
 * This is intentionally narrow — no seat-by-seat Restore modelling yet,
 * just the Lowe flip. When the swing pipeline learns Restore-from-Reform
 * defection per region, this script should be retired in favour of a
 * proper party in run-ge-predictions.mjs.
 *
 * Run AFTER scripts/run-ge-predictions.mjs.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");

const SUMMARY_PATH = join(REPO, "data/predictions/ge-next/summary.json");
const PCONS_PATH = join(REPO, "data/predictions/ge-next/constituencies.json");

const summary = JSON.parse(readFileSync(SUMMARY_PATH, "utf8"));
const pcons = JSON.parse(readFileSync(PCONS_PATH, "utf8"));

const g = pcons.predictions["great-yarmouth"];
if (!g) {
  console.error("FATAL: data/predictions/ge-next/constituencies.json missing great-yarmouth");
  process.exit(1);
}

const reformShare = g.prediction["Reform UK"]?.pct ?? 0;
const reformVotes = g.prediction["Reform UK"]?.votes ?? 0;
const restoreShare = reformShare * 0.9;
const restoreVotes = Math.round(reformVotes * 0.9);

g.prediction["Reform UK"] = {
  pct: reformShare - restoreShare,
  votes: reformVotes - restoreVotes,
};
g.prediction["Restore Britain"] = {
  pct: restoreShare,
  votes: restoreVotes,
};

// Recompute winner / runner_up / majority
const ranked = Object.entries(g.prediction).sort((a, b) => b[1].pct - a[1].pct);
g.winner = ranked[0][0];
g.runner_up = ranked[1][0];
g.majority_pct = ranked[0][1].pct - ranked[1][1].pct;

if (g.mp && typeof g.mp === "object") {
  g.mp.party = "Restore Britain";
  g.mp.note =
    "Elected for Reform UK in July 2024 with 41.4%. Resigned the Reform whip in early 2025 to " +
    "sit as Independent, then founded Restore Britain in November 2025. Standing again under " +
    "his own party (locally branded 'Great Yarmouth First').";
}

if (g.ge2024) {
  g.ge2024.incumbent_party_changed = {
    from: "Reform UK",
    to: "Restore Britain",
    via: "Independent (early 2025)",
    founded_restore_britain: "2025-11",
    reason: "Split with Reform UK leadership; founded his own party.",
  };
}

g.methodology = (g.methodology || []).filter(
  (m) => m?.name !== "restore-britain-overlay",
);
g.methodology.push({
  name: "restore-britain-overlay",
  description:
    "Lowe-defection flip — 90% of the predicted Reform UK vote in Great Yarmouth " +
    "reallocated to Restore Britain (locally branded 'Great Yarmouth First'). " +
    "Empirical anchor: Lowe's personal vote took 9/9 Norfolk County Council divisions " +
    "in Great Yarmouth on 7 May 2026, and Great Yarmouth First also won 1/39 Borough " +
    "Council seats (Caister South by-election). Overlay only; will be replaced by a " +
    "full pipeline rerun that models Restore Britain as a separate national party.",
});

// Summary seat tallies + snapshot trace
summary.seat_tallies_by_party["Reform UK"] = (summary.seat_tallies_by_party["Reform UK"] || 0) - 1;
summary.seat_tallies_by_party["Restore Britain"] = (summary.seat_tallies_by_party["Restore Britain"] || 0) + 1;
summary.snapshot.restore_britain_overlay = {
  national_share: summary.national_vote_share["Restore Britain"] ?? null,
  allocated_seats: 1,
  allocated_seat_pcons: ["great-yarmouth"],
  source:
    "YouGov 17-18 May 2026 + Find Out Now 6 May 2026 — RB 4% embedded in Wikipedia 'Others' column. " +
    "Great Yarmouth First (Restore Britain's local affiliate) won 9/9 Norfolk County Council divisions " +
    "in Great Yarmouth + 1/39 Great Yarmouth Borough Council seats on 7 May 2026.",
  note:
    "Seat-by-seat Restore Britain modelling has not yet been wired through the swing pipeline; " +
    "this is an additive overlay on top of the latest model run. Only Great Yarmouth has been " +
    "flipped (Lowe was elected for Reform UK in July 2024, defected to Independent, then founded " +
    "Restore Britain in November 2025 — he stands again under his own party).",
  applied_at: new Date().toISOString(),
};

writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2) + "\n");
writeFileSync(PCONS_PATH, JSON.stringify(pcons, null, 2) + "\n");

console.log("Restore Britain overlay re-applied:");
console.log(`  Great Yarmouth winner: ${g.winner}`);
console.log(`  Reform UK share:       ${(g.prediction["Reform UK"].pct * 100).toFixed(1)}%`);
console.log(`  Restore Britain share: ${(g.prediction["Restore Britain"].pct * 100).toFixed(1)}%`);
console.log(`  Reform UK seat tally:  ${summary.seat_tallies_by_party["Reform UK"]}`);
console.log(`  Restore Britain seats: ${summary.seat_tallies_by_party["Restore Britain"]}`);
