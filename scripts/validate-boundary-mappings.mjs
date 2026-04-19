#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { validateBoundaryMappings } from "./lib/boundary-mapping-quality.mjs";

const mappingsPath = process.argv[2] || "data/boundary-mappings.example.json";
const result = validateBoundaryMappings(JSON.parse(readFileSync(mappingsPath, "utf8")));

if (!result.ok) {
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, mappings: result.results.filter((row) => row.index >= 0).length }, null, 2));
