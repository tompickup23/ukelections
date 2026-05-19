#!/usr/bin/env node
/**
 * ge-refresh.mjs — single entrypoint for refreshing the GE seat forecast.
 *
 * Chains:
 *   1. scripts/refresh-polling.mjs       — Wikipedia 14-day rolling average
 *                                          for UK / Welsh / Scottish Westminster
 *   2. scripts/run-ge-predictions.mjs    — re-predicts all 650 PCONs from the
 *                                          fresh national snapshot
 *   3. scripts/apply-restore-britain-overlay.mjs
 *                                       — Lowe defection flip + Restore
 *                                          seat-tally adjustment (idempotent)
 *
 * Each step runs sequentially; a non-zero exit from any step aborts the
 * chain. After the chain, asserts that summary.json.snapshot.generated_at
 * is within the last 5 minutes — surfaces the silent-failure case where
 * the predict script wrote nothing.
 *
 * Designed to be the cron entrypoint on vps-main. Suggested crontab:
 *   30 04 * * *  cd /root/ukelections && /usr/bin/node scripts/ge-refresh.mjs >> /var/log/ukelections/ge-refresh.log 2>&1
 *
 * Or via npm: `npm run ge:refresh`
 */

import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");
const FRESHNESS_WINDOW_MS = 5 * 60 * 1000;

const STEPS = [
  { name: "refresh-polling", script: "scripts/refresh-polling.mjs" },
  { name: "run-ge-predictions", script: "scripts/run-ge-predictions.mjs" },
  { name: "apply-restore-britain-overlay", script: "scripts/apply-restore-britain-overlay.mjs" },
];

function runStep(step) {
  return new Promise((resolveStep, rejectStep) => {
    const t0 = Date.now();
    console.log(`\n▶ ${step.name} — ${step.script}`);
    const child = spawn("node", [join(REPO, step.script)], {
      cwd: REPO,
      stdio: "inherit",
    });
    child.on("error", (err) => rejectStep(err));
    child.on("exit", (code) => {
      const ms = Date.now() - t0;
      if (code === 0) {
        console.log(`✓ ${step.name} completed in ${ms}ms`);
        resolveStep();
      } else {
        rejectStep(new Error(`${step.name} exited ${code} after ${ms}ms`));
      }
    });
  });
}

function assertFreshness() {
  const summaryPath = join(REPO, "data/predictions/ge-next/summary.json");
  if (!existsSync(summaryPath)) {
    throw new Error("summary.json missing after refresh chain");
  }
  const s = JSON.parse(readFileSync(summaryPath, "utf8"));
  const generatedAt = s?.snapshot?.generated_at;
  if (!generatedAt) {
    throw new Error("summary.json.snapshot.generated_at missing");
  }
  const age = Date.now() - new Date(generatedAt).getTime();
  if (age > FRESHNESS_WINDOW_MS) {
    throw new Error(
      `summary.json.snapshot.generated_at is ${(age / 1000).toFixed(0)}s old — ` +
      `run-ge-predictions may have failed silently. (${generatedAt})`,
    );
  }
  // Also check the Restore Britain overlay was applied.
  const overlay = s?.snapshot?.restore_britain_overlay;
  if (!overlay) {
    console.warn(
      "⚠ summary.json missing snapshot.restore_britain_overlay — " +
        "apply-restore-britain-overlay may not have run. Continuing anyway.",
    );
  }
  console.log(`\n✓ Freshness check: summary.json generated ${(age / 1000).toFixed(0)}s ago`);
  console.log(`  Restore Britain seats: ${s.seat_tallies_by_party?.["Restore Britain"] ?? "—"}`);
  console.log(`  Reform UK seats:       ${s.seat_tallies_by_party?.["Reform UK"] ?? "—"}`);
  console.log(`  Polling fieldwork:     ${s.snapshot?.input_meta?.fieldwork || s.snapshot?.polling_fieldwork_window || "(see polling override)"}`);
}

async function main() {
  console.log(`▶ ge-refresh: chaining ${STEPS.length} steps in ${REPO}`);
  for (const step of STEPS) {
    await runStep(step);
  }
  assertFreshness();
  console.log("\n✓ ge-refresh complete.");
}

main().catch((err) => {
  console.error(`\n✗ ge-refresh failed: ${err.message}`);
  process.exit(1);
});
