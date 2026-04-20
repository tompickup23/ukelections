#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { auditLocalDataBundle } from "./lib/local-data-auditor.mjs";

function parseArgs(argv) {
  const args = {
    input: "/tmp/ukelections-local-upstreams",
    output: "/tmp/ukelections-local-upstreams/data-audit.json"
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--input") args.input = argv[++index];
    else if (arg === "--output") args.output = argv[++index];
    else if (arg === "--help") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function readJson(filePath, fallback = []) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(`Audit imported local model data.

Usage:
  node scripts/audit-local-data.mjs --input /tmp/ukelections-local-upstreams --output /tmp/ukelections-local-upstreams/data-audit.json
`);
  process.exit(0);
}

const audit = auditLocalDataBundle({
  boundaries: readJson(path.join(args.input, "boundary-versions.json")),
  history: readJson(path.join(args.input, "election-history.json")),
  sourceSnapshots: readJson(path.join(args.input, "source-snapshots.json")),
  featureSnapshots: readJson(path.join(args.input, "model-features.json")),
  backtests: readJson(path.join(args.input, "baseline-backtests.json")),
  readiness: readJson(path.join(args.input, "model-readiness.json")),
  candidateRosters: readJson(path.join(args.input, "candidate-rosters.json")),
  boundaryMappings: readJson(path.join(args.input, "boundary-mappings.json"))
});

mkdirSync(path.dirname(args.output), { recursive: true });
writeFileSync(args.output, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  ok: true,
  output: path.resolve(args.output),
  ...audit.summary,
  high_issue_codes: audit.issues.filter((row) => row.severity === "high").map((row) => `${row.code}:${row.count}`),
  medium_issue_codes: audit.issues.filter((row) => row.severity === "medium").map((row) => `${row.code}:${row.count}`)
}, null, 2));
