#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { summariseModelReadiness, validateModelReadinessAreas } from "./lib/model-readiness-quality.mjs";

const inputPath = process.argv[2] || "data/model-readiness.example.json";
const areas = JSON.parse(readFileSync(inputPath, "utf8"));
const result = validateModelReadinessAreas(areas);

if (!result.ok) {
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  ...summariseModelReadiness(areas)
}, null, 2));
