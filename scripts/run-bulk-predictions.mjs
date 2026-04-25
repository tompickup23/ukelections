#!/usr/bin/env node
// Phase 2: bulk-run electionModel.predictWard() across all 2,977 local + 6 mayor wards.
// Persist data/predictions/may-2026/local-and-mayor.json + summary.json.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { buildWardData, partiesOnBallotCanonical, restrictToBallot } from "../src/lib/adaptDcToWardData.js";
import { predictWard, DEFAULT_ASSUMPTIONS, normalizePartyName } from "../src/lib/electionModel.js";
import { pollingPair } from "../src/lib/nationalPolling.js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const MODEL_VERSION = "ukelections.local.v0.1.0-may2026";

function readJson(p) { return JSON.parse(readFileSync(path.join(ROOT, p), "utf8")); }

function writeJson(rel, payload) {
  const full = path.join(ROOT, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, JSON.stringify(payload, null, 2));
  return full;
}

function buildLaContext(ladCode, laProj, laImd, laGe24) {
  const proj = laProj.projections[ladCode];
  const imd = laImd.imd[ladCode];
  // Demographics (pre-computed percentages) — model skips derivation when these are set.
  const demographics = proj
    ? {
        white_british_pct: proj.white_british_pct_projected,
        asian_pct: proj.asian_pct_projected,
        // age_65_plus_pct intentionally omitted — HP carries ethnicity, not age structure.
        // The model only fires age adjustments when > 0.25, so omission == no adjustment.
        _source: "HP_v7.0_LA_2026",
      }
    : null;
  const deprivation = imd ? { avg_imd_decile: imd.avg_imd_decile, _source: "IMD2019_LSOA_to_LAD_avg" } : null;
  const ethnicProjections = proj
    ? {
        white_british_pct_projected: proj.white_british_pct_projected,
        asian_pct_projected: proj.asian_pct_projected,
        _source: "HP_v7.0_LA_2026_back_extrapolated",
      }
    : null;
  // ConstituencyResult: use LA-aggregated GE2024 if we have a per-PCON join, else fall back to national.
  // For Stage 1 we use national average for all (per-PCON join via ballot slug requires a PCON-CD lookup we don't have).
  const constituencyResult = laGe24.national;
  return { demographics, deprivation, ethnicProjections, constituencyResult };
}

function classifyConfidence(wardData, prediction) {
  if (!prediction) return "none";
  const cycleHistory = (wardData.history || []).filter((h) => h.type !== "by-election");
  const latest = wardData.history[wardData.history.length - 1];
  const yearsAgo = latest ? new Date().getFullYear() - (latest.year || 0) : 99;
  if (cycleHistory.length >= 3 && yearsAgo <= 4) return "high";
  if (cycleHistory.length >= 1 && yearsAgo <= 8) return "medium";
  if (yearsAgo > 8) return "low";
  return "low";
}

function rolledUpByCouncil(predictions, identity) {
  const byCouncil = {};
  for (const ward of identity.wards) {
    if (ward.tier !== "local") continue;
    const p = predictions[ward.ballot_paper_id];
    if (!p?.prediction) continue;
    const council = `${ward.tier}::${ward.council_slug}`;
    if (!byCouncil[council]) byCouncil[council] = {
      council_slug: ward.council_slug,
      council_name: ward.council_name,
      tier: ward.tier,
      ward_count: 0,
      seats_up: 0,
      predicted_seat_winners: {},
    };
    byCouncil[council].ward_count += 1;
    byCouncil[council].seats_up += ward.winner_count || 1;
    // Predicted top party for this ward (winner-take-seats simplification for the rollup;
    // multi-seat wards in Stage 1 are awarded to the top N parties by predicted share)
    const ranked = Object.entries(p.prediction).sort((a, b) => (b[1].pct || 0) - (a[1].pct || 0));
    const seatsContested = ward.winner_count || 1;
    const winners = ranked.slice(0, seatsContested);
    for (const [party, _data] of winners) {
      byCouncil[council].predicted_seat_winners[party] = (byCouncil[council].predicted_seat_winners[party] || 0) + 1;
    }
  }
  return Object.values(byCouncil);
}

function main() {
  console.log("Loading inputs...");
  const identity = readJson("data/identity/wards-may-2026.json");
  const history = readJson("data/history/dc-historic-results.json");
  const slugMap = readJson("data/identity/council-slug-to-lad24.json");
  const laProj = readJson("data/features/la-ethnic-projections.json");
  const laImd = readJson("data/features/la-imd.json");
  const laGe24 = readJson("data/features/la-ge2024-shares.json");
  const { nationalPolling, ge2024Result } = pollingPair();

  console.log("Running bulk predictions...");
  const predictions = {};
  const tally = { ok: 0, no_history: 0, no_baseline: 0, cancelled: 0, by_confidence: { high: 0, medium: 0, low: 0, none: 0 } };

  for (const ward of identity.wards) {
    if (ward.tier !== "local" && ward.tier !== "mayor") continue;
    if (ward.cancelled) {
      predictions[ward.ballot_paper_id] = {
        prediction: null,
        confidence: "none",
        cancelled: true,
        baseline_date: null,
        model_version: MODEL_VERSION,
        methodology: [{ step: 0, name: "Cancelled", description: "Election cancelled (likely candidate-death postponement). No prediction." }],
      };
      tally.cancelled += 1;
      continue;
    }

    const wd = buildWardData(ward, history);
    if (!wd.history.length) {
      predictions[ward.ballot_paper_id] = {
        prediction: null,
        confidence: "none",
        baseline_date: null,
        model_version: MODEL_VERSION,
        methodology: [{ step: 0, name: "No history", description: "No prior contest results available for this ward in our DC history bundle. Likely a recent boundary change." }],
      };
      tally.no_history += 1;
      tally.by_confidence.none += 1;
      continue;
    }

    const ladCode = slugMap.map[ward.council_slug]?.lad24cd;
    const { demographics, deprivation, ethnicProjections, constituencyResult } = ladCode
      ? buildLaContext(ladCode, laProj, laImd, laGe24)
      : { demographics: null, deprivation: null, ethnicProjections: null, constituencyResult: laGe24.national };

    const result = predictWard(
      wd,
      DEFAULT_ASSUMPTIONS,
      nationalPolling,
      ge2024Result,
      demographics,
      deprivation,
      constituencyResult,
      null, // lcc2025 — Lancashire-specific, not used nationally
      null, // modelParams
      null, // fiscalData
      null, // candidates2026 (already in wardData)
      ethnicProjections,
    );

    if (!result.prediction) {
      predictions[ward.ballot_paper_id] = {
        prediction: null,
        confidence: "none",
        baseline_date: null,
        model_version: MODEL_VERSION,
        methodology: result.methodology,
      };
      tally.no_baseline += 1;
      tally.by_confidence.none += 1;
      continue;
    }

    // Restrict prediction to parties actually contesting this ballot in 2026.
    // Redistribute share of inherited-from-history non-standing parties pro-rata.
    const onBallot = new Set(partiesOnBallotCanonical(ward));
    const { prediction: filtered, dropped } = restrictToBallot(result.prediction, onBallot);

    const confidence = classifyConfidence(wd, filtered);
    predictions[ward.ballot_paper_id] = {
      prediction: filtered,
      confidence,
      baseline_date: wd.history[wd.history.length - 1]?.date || null,
      lad24cd: ladCode || null,
      lad_name: slugMap.map[ward.council_slug]?.lad_name || null,
      la_features_used: { demographics: !!demographics, deprivation: !!deprivation, ethnicProjections: !!ethnicProjections },
      parties_on_ballot: [...onBallot].sort(),
      dropped_from_baseline: dropped,
      model_version: MODEL_VERSION,
      methodology: [
        ...result.methodology,
        {
          step: "Final",
          name: "Restrict to ballot",
          description: dropped.length
            ? `Removed ${dropped.length} party/parties not standing in 2026 (${dropped.map((d) => `${d.party} ${(d.share * 100).toFixed(1)}pp`).join(", ")}). Their share has been redistributed pro-rata to the parties contesting this ballot.`
            : "All predicted parties are on the 2026 ballot — no redistribution needed.",
        },
      ],
    };
    tally.ok += 1;
    tally.by_confidence[confidence] = (tally.by_confidence[confidence] || 0) + 1;
  }

  console.log(`\nTally: ${JSON.stringify(tally, null, 2)}`);

  const sha = createHash("sha256").update(JSON.stringify(predictions)).digest("hex");
  const payload = {
    snapshot: {
      generated_at: new Date().toISOString(),
      model_version: MODEL_VERSION,
      sha256: sha,
      input_polling: pollingPair().nationalPolling,
      input_ge2024_baseline: pollingPair().ge2024Result,
      assumptions: DEFAULT_ASSUMPTIONS,
      method_summary: "AI DOGE election model (Lancashire-trained, RMSE 1.65) generalised. Pipeline: ward history baseline → national swing dampened 0.65 → LA-level UKD HP v7.0 demographic adjustment → IMD-based deprivation tilt → incumbency (where holders known) → Reform-entry handling → normalisation. Per-LA GE2024 deferred to Stage 1.5 — currently uses UK national.",
    },
    tally,
    predictions,
  };
  writeJson("data/predictions/may-2026/local-and-mayor.json", payload);

  console.log("\nBuilding per-council rollup...");
  const rollups = rolledUpByCouncil(predictions, identity);
  writeJson("data/predictions/may-2026/summary.json", {
    snapshot: payload.snapshot,
    council_count: rollups.length,
    councils: rollups.sort((a, b) => a.council_name.localeCompare(b.council_name)),
  });
  console.log(`  ${rollups.length} councils rolled up.`);
}

main();
