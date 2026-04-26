#!/usr/bin/env node
/**
 * run-ge-postaudit.mjs — compare a pre-registered GE forecast against actual
 * results once they exist. Designed to run post-election (or as a dry-run
 * against the GE2024 actual results to validate the harness itself).
 *
 * Usage:
 *   node scripts/run-ge-postaudit.mjs                       # auto-pick latest pre-reg manifest
 *   node scripts/run-ge-postaudit.mjs --target=2024-07-04   # dry-run against GE2024
 *   node scripts/run-ge-postaudit.mjs --manifest=preregistration-2026-04-26.json
 *
 * Output:
 *   data/transparency/ge-postaudit-{date}.json
 *   - per-PCON delta (predicted vs actual, signed swing)
 *   - aggregate metrics (winner accuracy, MAE, RMSE, Brier)
 *   - worst-residual leaderboard
 *   - sha256 of the predictions file we audited (must match the
 *     pre-registered manifest, otherwise we flag tampering)
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)=(.*)$/);
  return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true];
}));

function readJson(p) { return JSON.parse(readFileSync(join(REPO, p), "utf8")); }
function sha256(buf) { return createHash("sha256").update(buf).digest("hex"); }

function canonParty(p) {
  if (!p) return "Unknown";
  if (/^Labour Party$/i.test(p)) return "Labour";
  if (/^Labour and Co-operative Party$/i.test(p)) return "Labour";
  if (/^Conservative and Unionist Party$/i.test(p)) return "Conservative";
  if (/^Liberal Democrats?$/i.test(p)) return "Liberal Democrats";
  if (/^Reform UK$/i.test(p)) return "Reform UK";
  if (/^Green Party$/i.test(p)) return "Green Party";
  if (/^Plaid Cymru/i.test(p)) return "Plaid Cymru";
  if (/^Scottish National/i.test(p)) return "SNP";
  if (/independent/i.test(p)) return "Independent";
  return p;
}

function pcononicalShares(candidates) {
  const total = candidates.reduce((s, c) => s + (c.votes || 0), 0);
  if (total <= 0) return {};
  const out = {};
  for (const c of candidates) {
    const p = canonParty(c.party_name || c.party);
    out[p] = (out[p] || 0) + (c.votes || 0) / total;
  }
  return out;
}

function pickLatestManifest() {
  const dir = join(REPO, "data/transparency");
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => f.startsWith("preregistration-") && f.endsWith(".json"))
    .sort()
    .reverse();
  return files[0] || null;
}

function targetDate() {
  return args.target || "2024-07-04"; // dry-run default
}

function main() {
  const manifestFile = args.manifest || pickLatestManifest();
  if (!manifestFile) {
    console.error("No pre-registration manifest found in data/transparency/");
    process.exit(1);
  }
  const manifestPath = `data/transparency/${manifestFile}`;
  const manifest = readJson(manifestPath);
  console.log(`Manifest: ${manifestFile} (pre-registered ${manifest.pre_registered_at})`);

  // Locate the predictions file in the manifest
  const predEntry = manifest.files.find((f) => f.path === "data/predictions/ge-next/constituencies.json");
  if (!predEntry || predEntry.status !== "ok") {
    console.error("Pre-registration manifest does not include a valid GE constituencies.json sha256");
    process.exit(1);
  }
  // Verify sha256 matches the file on disk
  const actualSha = sha256(readFileSync(join(REPO, predEntry.path)));
  if (actualSha !== predEntry.sha256) {
    console.warn(`⚠ TAMPERING DETECTED: ${predEntry.path}`);
    console.warn(`  Pre-registered: ${predEntry.sha256}`);
    console.warn(`  Current      : ${actualSha}`);
    // Continue but flag in output
  } else {
    console.log(`✓ ${predEntry.path} sha256 matches pre-registration`);
  }

  // Load predictions + actuals
  const ge = readJson(predEntry.path);
  const dcRaw = readJson("data/history/dc-historic-results.json");
  const target = targetDate();
  const actuals = {};
  for (const r of dcRaw.results || []) {
    if (r.tier !== "parl") continue;
    if (r.election_date !== target) continue;
    if (r.is_by_election) continue;
    actuals[r.ward_slug] = pcononicalShares(r.candidates || []);
  }
  console.log(`Target election: ${target} → ${Object.keys(actuals).length} actual PCON results`);

  // Compare
  const rows = [];
  let winnerCorrect = 0;
  let evaluated = 0;
  let brierSum = 0;
  const partyMae = {};
  const partyRmse = {};
  const partyN = {};
  for (const [slug, pred] of Object.entries(ge.predictions || {})) {
    if (!pred?.prediction) continue;
    const actual = actuals[slug];
    if (!actual) continue;
    evaluated += 1;
    const predicted = {};
    for (const [p, payload] of Object.entries(pred.prediction)) predicted[p] = payload.pct || 0;
    const allParties = new Set([...Object.keys(predicted), ...Object.keys(actual)]);
    let mae = 0; let n = 0;
    for (const p of allParties) {
      const diff = (predicted[p] || 0) - (actual[p] || 0);
      partyMae[p] = (partyMae[p] || 0) + Math.abs(diff);
      partyRmse[p] = (partyRmse[p] || 0) + diff * diff;
      partyN[p] = (partyN[p] || 0) + 1;
      if (["Labour", "Conservative", "Liberal Democrats", "Reform UK", "Green Party"].includes(p)) {
        mae += Math.abs(diff); n += 1;
      }
    }
    const predWinner = Object.entries(predicted).sort((a, b) => b[1] - a[1])[0]?.[0];
    const actWinner = Object.entries(actual).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (predWinner === actWinner) winnerCorrect += 1;
    const probActWinner = predicted[actWinner] || 0;
    brierSum += (1 - probActWinner) ** 2;
    rows.push({ slug, name: pred.name, predicted_winner: predWinner, actual_winner: actWinner, major_party_mae: n > 0 ? mae / n : 0 });
  }

  const partyMaeOut = {};
  const partyRmseOut = {};
  for (const p of Object.keys(partyN)) {
    partyMaeOut[p] = partyMae[p] / partyN[p];
    partyRmseOut[p] = Math.sqrt(partyRmse[p] / partyN[p]);
  }
  const major = ["Labour", "Conservative", "Liberal Democrats", "Reform UK", "Green Party"];
  const majorMae = major
    .filter((p) => partyMaeOut[p] != null)
    .reduce((s, p) => s + partyMaeOut[p], 0) / Math.max(1, major.filter((p) => partyMaeOut[p] != null).length);

  rows.sort((a, b) => b.major_party_mae - a.major_party_mae);

  const out = {
    snapshot: {
      snapshot_id: `ge-postaudit-${target}`,
      generated_at: new Date().toISOString(),
      target_election: target,
      manifest: manifestFile,
      tampering_detected: actualSha !== predEntry.sha256,
      sha256_match: actualSha === predEntry.sha256,
    },
    summary: {
      pcons_evaluated: evaluated,
      winner_accuracy: evaluated > 0 ? winnerCorrect / evaluated : 0,
      major_party_mae_avg: majorMae,
      brier_top_winner: evaluated > 0 ? brierSum / evaluated : 0,
      per_party_mae: partyMaeOut,
      per_party_rmse: partyRmseOut,
    },
    worst_residuals: rows.slice(0, 20),
  };

  const outPath = `data/transparency/ge-postaudit-${target}.json`;
  mkdirSync(dirname(join(REPO, outPath)), { recursive: true });
  writeFileSync(join(REPO, outPath), JSON.stringify(out, null, 2));
  console.log(`Wrote ${outPath}`);
  console.log(`Winner accuracy: ${(out.summary.winner_accuracy * 100).toFixed(1)}%`);
  console.log(`Major-party MAE: ${(out.summary.major_party_mae_avg * 100).toFixed(2)}pp`);
  console.log(`Brier (top): ${out.summary.brier_top_winner.toFixed(4)}`);
}

main();
