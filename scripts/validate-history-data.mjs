#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { validateHistoryBundle } from "./lib/history-quality.mjs";

const boundaryPath = process.argv[2] || "data/boundary-versions.example.json";
const historyPath = process.argv[3] || "data/election-history.example.json";

const result = validateHistoryBundle({
  boundaries: JSON.parse(readFileSync(boundaryPath, "utf8")),
  history: JSON.parse(readFileSync(historyPath, "utf8"))
});

if (!result.ok) {
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  boundaries: result.boundaryResults.length,
  history: result.historyResults.length
}, null, 2));
