#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { validateSourceSnapshots, summariseSourceQuality } from "./lib/source-quality.mjs";

const manifestPath = process.argv[2] || "data/source-snapshots.example.json";
const snapshots = JSON.parse(readFileSync(manifestPath, "utf8"));
const summary = summariseSourceQuality(validateSourceSnapshots(snapshots));

if (summary.failed > 0) {
  console.error(JSON.stringify(summary, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(summary, null, 2));
