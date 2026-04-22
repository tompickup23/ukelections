#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_FEATURE_SERVER, fetchPconLadCrosswalk } from "./lib/ons-postcode-directory-crosswalk.mjs";

function parseArgs(argv) {
  const args = {
    output: "data/ons-pcon24-lad25-postcode-crosswalk.json",
    endpoint: DEFAULT_FEATURE_SERVER
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--output") args.output = argv[++index];
    else if (arg === "--endpoint") args.endpoint = argv[++index];
    else if (arg === "--help") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(`Build a PCON24-to-LAD25 live-postcode-count crosswalk from ONS Open Geography ONSPD Live.

Usage:
  node scripts/build-ons-pcon-lad-crosswalk.mjs --output data/ons-pcon24-lad25-postcode-crosswalk.json
`);
  process.exit(0);
}

const crosswalk = await fetchPconLadCrosswalk({ endpoint: args.endpoint });
mkdirSync(path.dirname(args.output), { recursive: true });
writeFileSync(args.output, `${JSON.stringify(crosswalk, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  ok: true,
  output: path.resolve(args.output),
  constituencies: crosswalk.totals.constituencies,
  local_authorities: crosswalk.totals.local_authorities,
  postcode_pairs: crosswalk.totals.postcode_pairs,
  live_postcodes: crosswalk.totals.live_postcodes
}, null, 2));
