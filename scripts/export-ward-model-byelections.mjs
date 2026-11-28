#!/usr/bin/env node
/**
 * Copy the research ward model's live by-election forecasts into the small
 * tracked file the contest pages read.
 *
 *   node scripts/export-ward-model-byelections.mjs            # write data/forecasts/ward-model-byelections.json
 *   node scripts/export-ward-model-byelections.mjs --check    # exit 1 if the file is out of date
 *   node scripts/export-ward-model-byelections.mjs --from=<file>
 *
 * Refuses, writing nothing, if any forecast record was captured after its
 * polls opened, carries no clean code commit, or is malformed. Idempotent: the
 * output holds no build-clock time, so a rerun on the same input changes no byte.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { OUTPUT_FILE, SOURCE_FILE, buildExport, serialise } from "./lib/ward-model-export.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.length ? v.join("=") : true];
  }),
);
const from = typeof args.from === "string" ? args.from : SOURCE_FILE;
const out = typeof args.out === "string" ? args.out : OUTPUT_FILE;

if (!existsSync(from)) {
  console.error(`No runner file at ${from}.`);
  process.exit(1);
}

let text;
try {
  text = serialise(buildExport(JSON.parse(readFileSync(from, "utf8")), from));
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const current = existsSync(out) ? readFileSync(out, "utf8") : null;
if (args.check) {
  if (current !== text) {
    console.error(`${out} is out of date with ${from}. Run node scripts/export-ward-model-byelections.mjs.`);
    process.exit(1);
  }
  console.log(`${out} matches ${from}.`);
  process.exit(0);
}
if (current === text) {
  console.log(`${out} unchanged.`);
} else {
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, text);
  const n = Object.keys(JSON.parse(text).forecasts).length;
  console.log(`Wrote ${out}: ${n} ${n === 1 ? "forecast" : "forecasts"}.`);
}
