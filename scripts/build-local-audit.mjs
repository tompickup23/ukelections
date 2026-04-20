#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";

const DEFAULT_OUTPUT = "/tmp/ukelections-local-upstreams";

function parseArgs(argv) {
  const args = {
    output: DEFAULT_OUTPUT,
    importArgs: []
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--output") args.output = argv[++index];
    else if (arg === "--help") args.help = true;
    else args.importArgs.push(arg);
  }
  return args;
}

function run(label, scriptPath, args) {
  console.log(`\n== ${label} ==`);
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: "inherit"
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(`Build the local upstream audit bundle.

Usage:
  node scripts/build-local-audit.mjs --output /tmp/ukelections-local-upstreams

Unknown options are passed through to import-local-upstreams.mjs, for example:
  node scripts/build-local-audit.mjs --output /tmp/ukelections-audit --council burnley
`);
  process.exit(0);
}

const output = path.resolve(args.output);
run("Import local upstreams", "scripts/import-local-upstreams.mjs", ["--output", output, ...args.importArgs]);
run("Build baseline backtests", "scripts/build-baseline-backtests.mjs", [
  "--input",
  output,
  "--output",
  path.join(output, "baseline-backtests.json")
]);
run("Build model readiness", "scripts/build-model-readiness.mjs", [
  "--input",
  output,
  "--output",
  path.join(output, "model-readiness.json")
]);
run("Audit local data", "scripts/audit-local-data.mjs", [
  "--input",
  output,
  "--output",
  path.join(output, "data-audit.json")
]);
run("Build review workflows", "scripts/build-review-workflows.mjs", [
  "--input",
  path.join(output, "data-audit.json"),
  "--output",
  path.join(output, "review-workflows.json"),
  "--markdown-output",
  path.join(output, "review-workflows.md")
]);
