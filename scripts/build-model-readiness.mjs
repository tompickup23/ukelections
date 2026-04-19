#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildModelReadinessAreas } from "./lib/model-readiness-builder.mjs";
import { summariseModelReadiness, validateModelReadinessAreas } from "./lib/model-readiness-quality.mjs";

function parseArgs(argv) {
  const args = {
    input: "/tmp/ukelections-local-upstreams",
    output: "/tmp/ukelections-local-upstreams/model-readiness.json"
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
  console.log(`Build model readiness from imported backend manifests.

Usage:
  node scripts/build-model-readiness.mjs --input /tmp/ukelections-local-upstreams --output /tmp/ukelections-local-upstreams/model-readiness.json
`);
  process.exit(0);
}

const areas = buildModelReadinessAreas({
  boundaries: readJson(path.join(args.input, "boundary-versions.json")),
  history: readJson(path.join(args.input, "election-history.json")),
  candidateRosters: readJson(path.join(args.input, "candidate-rosters.json")),
  featureSnapshots: readJson(path.join(args.input, "model-features.json")),
  pollAggregates: readJson(path.join(args.input, "poll-aggregate.json")),
  backtests: readJson(path.join(args.input, "baseline-backtests.json")),
  boundaryMappings: readJson(path.join(args.input, "boundary-mappings.json")),
  sourceSnapshots: readJson(path.join(args.input, "source-snapshots.json"))
});
const validation = validateModelReadinessAreas(areas);
if (!validation.ok) {
  console.error(JSON.stringify(validation, null, 2));
  process.exit(1);
}

mkdirSync(path.dirname(args.output), { recursive: true });
writeFileSync(args.output, `${JSON.stringify(areas, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  ok: true,
  output: path.resolve(args.output),
  ...summariseModelReadiness(areas)
}, null, 2));
