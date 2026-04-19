#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { validateCandidateRosters } from "./lib/candidate-quality.mjs";

const rostersPath = process.argv[2] || "data/candidate-roster.example.json";
const result = validateCandidateRosters(JSON.parse(readFileSync(rostersPath, "utf8")));

if (!result.ok) {
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, rosters: result.results.length }, null, 2));
