#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildBaselineBacktests } from "./lib/baseline-backtest-builder.mjs";

function parseArgs(argv) {
  const args = {
    input: "/tmp/ukelections-local-upstreams",
    output: "/tmp/ukelections-local-upstreams/baseline-backtests.json"
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

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(`Build baseline historical persistence backtests.

Usage:
  node scripts/build-baseline-backtests.mjs --input /tmp/ukelections-local-upstreams --output /tmp/ukelections-local-upstreams/baseline-backtests.json
`);
  process.exit(0);
}

const backtests = buildBaselineBacktests({
  history: readJson(path.join(args.input, "election-history.json")),
  featureSnapshots: readJson(path.join(args.input, "model-features.json"))
});

mkdirSync(path.dirname(args.output), { recursive: true });
writeFileSync(args.output, `${JSON.stringify(backtests, null, 2)}\n`, "utf8");

const byStatus = {};
for (const row of backtests) byStatus[row.status] = (byStatus[row.status] || 0) + 1;
console.log(JSON.stringify({
  ok: true,
  output: path.resolve(args.output),
  total: backtests.length,
  byStatus
}, null, 2));
