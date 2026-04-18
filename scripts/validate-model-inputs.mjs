#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { validateModelInputs } from "./lib/model-input-quality.mjs";

const pollPath = process.argv[2] || "data/poll-aggregate.example.json";
const featurePath = process.argv[3] || "data/model-features.example.json";

const pollInput = JSON.parse(readFileSync(pollPath, "utf8"));
const featureInput = JSON.parse(readFileSync(featurePath, "utf8"));

const result = validateModelInputs({
  pollAggregates: Array.isArray(pollInput) ? pollInput : [pollInput],
  featureSnapshots: featureInput
});

if (!result.ok) {
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  pollAggregates: result.pollResults.length,
  featureSnapshots: result.featureResults.length
}, null, 2));
