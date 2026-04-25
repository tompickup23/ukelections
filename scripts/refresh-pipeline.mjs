#!/usr/bin/env node
// Single-command full refresh: ingest → features → predictions → backtest →
// Senedd → Holyrood → build → deploy.
//
// Usage:
//   node scripts/refresh-pipeline.mjs              # all phases
//   node scripts/refresh-pipeline.mjs --skip-fetch # skip remote ingest, reuse cache
//   node scripts/refresh-pipeline.mjs --no-deploy  # build but don't push to CF Pages
//
// Designed to be run from cron (vps-main, daily) or manually before launch.
// Exits non-zero on first failure so cron sends an alert.

import { spawnSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const args = new Set(process.argv.slice(2));
const skipFetch = args.has("--skip-fetch");
const noDeploy = args.has("--no-deploy");

function step(label, cmd, cmdArgs = [], opts = {}) {
  process.stdout.write(`\n=== [${new Date().toISOString()}] ${label} ===\n`);
  const r = spawnSync(cmd, cmdArgs, { cwd: ROOT, stdio: "inherit", env: process.env, ...opts });
  if (r.status !== 0) {
    process.stderr.write(`\n!!! FAIL [${label}] exit=${r.status} signal=${r.signal}\n`);
    process.exit(r.status || 1);
  }
}

function run(label, scriptPath) {
  if (scriptPath === null) {
    // Python step
    step(label, "python3", ["scripts/aggregate-lsoa-to-ward-demographics.py"]);
  } else {
    step(label, "node", [scriptPath]);
  }
}

const phases = [];

if (!skipFetch) {
  phases.push(["1a. Refresh Democracy Club ballot scope (May 7 2026)", "scripts/build-may-2026-scope.mjs"]);
  phases.push(["1b. Refresh Democracy Club historic results", "scripts/ingest-dc-historic-results.mjs"]);
} else {
  process.stdout.write("(skipping remote DC fetches — reusing cached ingest files)\n");
}
phases.push(["2. Build ward identity table", "scripts/build-ward-identity.mjs"]);
phases.push(["3. Build LA features (HP v7.0 + IMD + GE2024)", "scripts/build-la-features.mjs"]);
phases.push(["3b. Aggregate Census 2021 + IMD LSOA → ward (P3)", null /* python */ ]);
phases.push(["3c. Calibrate regional dampening (P5)", "scripts/calibrate-regional-dampening.mjs"]);
phases.push(["4. Run bulk ward predictions (locals + mayors)", "scripts/run-bulk-predictions.mjs"]);
phases.push(["5. Run 2024 backtest", "scripts/run-2024-backtest.mjs"]);
phases.push(["6. Run Senedd 2026 predictions", "scripts/run-senedd-predictions.mjs"]);
phases.push(["7. Run Holyrood 2026 predictions", "scripts/run-holyrood-predictions.mjs"]);

for (const [label, scriptPath] of phases) run(label, scriptPath);

step("8. Run vitest suite", "npm", ["test", "--silent"]);
step("9. Build Astro static site", "npm", ["run", "build"]);

if (!noDeploy) {
  process.stdout.write("\n=== 10. Deploy to Cloudflare Pages via vps-main ===\n");
  step("10a. rsync dist to vps-main", "rsync", ["-az", "--delete", "dist/", "vps-main:/tmp/ukelections-dist/"]);
  step(
    "10b. wrangler pages deploy",
    "ssh",
    [
      "vps-main",
      "set -a; . /opt/dashboard/.env; set +a; wrangler pages deploy /tmp/ukelections-dist --project-name ukelections --branch main --commit-dirty=true",
    ],
  );
} else {
  process.stdout.write("\n(skipping deploy — --no-deploy set)\n");
}

process.stdout.write(`\n=== Pipeline complete [${new Date().toISOString()}] ===\n`);
