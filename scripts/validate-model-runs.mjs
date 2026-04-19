#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { validateModelRuns } from "./lib/model-run-quality.mjs";

const runsPath = process.argv[2] || "data/model-run.example.json";
const result = validateModelRuns(JSON.parse(readFileSync(runsPath, "utf8")));

if (!result.ok) {
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, modelRuns: result.results.length }, null, 2));
