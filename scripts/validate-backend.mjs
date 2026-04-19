#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const commands = [
  ["node", ["scripts/validate-source-snapshots.mjs"]],
  ["node", ["scripts/validate-history-data.mjs"]],
  ["node", ["scripts/validate-model-inputs.mjs"]],
  ["node", ["scripts/validate-candidate-rosters.mjs"]],
  ["node", ["scripts/validate-boundary-mappings.mjs"]],
  ["node", ["scripts/validate-model-runs.mjs"]]
];

for (const [command, args] of commands) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

console.log("Backend validation complete.");
