#!/usr/bin/env node
/**
 * Publish the dynamic Westminster polling update without running unrelated
 * static-source jobs. The full nightly refresh still exists for scheduled
 * model/data maintenance; this path is intentionally narrow so a missing
 * Census cache cannot block fresh, validated national polling from reaching
 * the live site.
 *
 * Usage:
 *   node scripts/publish-polling-update.mjs
 *   node scripts/publish-polling-update.mjs --no-deploy
 */

import { cpSync, existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const noDeploy = process.argv.includes("--no-deploy");

function step(label, command, args, options = {}) {
  process.stdout.write(`\n=== [${new Date().toISOString()}] ${label} ===\n`);
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, ...options.env },
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed (exit ${result.status ?? "unknown"})`);
  }
}

function onVpsMain() {
  if (process.env.UKE_ON_VPS_MAIN === "1") return true;
  const result = spawnSync("hostname", [], { encoding: "utf8" });
  return /vps-main|hostinger|srv\d+/i.test(result.stdout || "");
}

function deploy() {
  const deploymentId = `uke-polling-${Date.now()}`;
  if (onVpsMain()) {
    const snapshot = join("/tmp", deploymentId);
    mkdirSync(snapshot, { recursive: true });
    cpSync(join(ROOT, "dist"), join(snapshot, "dist"), { recursive: true });
    step("Deploy immutable build snapshot to Cloudflare Pages", "bash", [
      "-lc",
      `set -a; . /opt/dashboard/.env; set +a; wrangler pages deploy ${join(snapshot, "dist")} --project-name ukelections --branch main --commit-dirty=true`,
    ]);
    return;
  }

  const remoteSnapshot = `/tmp/${deploymentId}`;
  step("Copy immutable build snapshot to vps-main", "rsync", [
    "-az",
    "dist/",
    `vps-main:${remoteSnapshot}/`,
  ]);
  step("Deploy immutable build snapshot to Cloudflare Pages", "ssh", [
    "vps-main",
    `set -a; . /opt/dashboard/.env; set +a; wrangler pages deploy ${remoteSnapshot} --project-name ukelections --branch main --commit-dirty=true`,
  ]);
}

async function main() {
  step("Refresh source-linked Westminster polling and GE outputs", "node", ["scripts/ge-refresh.mjs"]);
  if (!existsSync(join(ROOT, "data/polling/current-polls.json"))) {
    throw new Error("Current poll-record audit was not written; refusing to publish an update without a run manifest");
  }
  const verificationArgs = ["scripts/verify-polling-sources.mjs"];
  if (process.env.UKE_REQUIRE_PRIMARY_POLLING === "1") verificationArgs.push("--require-primary");
  step(
    process.env.UKE_REQUIRE_PRIMARY_POLLING === "1"
      ? "Require primary-verified comparable Westminster polling"
      : "Build Westminster polling source-check ledger",
    "node",
    verificationArgs,
  );
  // This is a narrowly-scoped publisher. Its gate covers the refreshed
  // aggregate and model-input contract, while the separate broad pipeline
  // continues to own unrelated local-election and static-data tests.
  step("Run polling publication tests", "npm", ["run", "test:polling-publish", "--silent"]);
  step("Build static site", "npm", ["run", "build"], { env: { BUILD_OG: "1" } });
  step("Run rendered-site gate", "node", ["scripts/audit-seo.mjs", "dist"]);
  if (noDeploy) {
    process.stdout.write("\n(no deploy requested)\n");
  } else {
    deploy();
  }
  process.stdout.write("\n✓ Polling publication path complete.\n");
}

main().catch((error) => {
  process.stderr.write(`\n✗ Polling publication path failed: ${error.message}\n`);
  process.exit(1);
});
