#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { importHomeOfficeLocalAuthorityAsylum } from "./lib/home-office-local-authority-asylum-importer.mjs";

function parseArgs(argv) {
  const args = {
    input: "/Users/tompickup/asylumstats/data/raw/uk_routes/regional-and-local-authority-dataset-dec-2025.ods",
    output: "/tmp/ukelections-local-upstreams/home-office-local-asylum.json",
    sourceUrl: "https://assets.publishing.service.gov.uk/media/69959e60a58a315dbe72bf10/regional-and-local-authority-dataset-dec-2025.ods"
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--input") args.input = argv[++index];
    else if (arg === "--output") args.output = argv[++index];
    else if (arg === "--source-url") args.sourceUrl = argv[++index];
    else if (arg === "--help") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(`Build official Home Office local-authority asylum context JSON.

Usage:
  node scripts/build-home-office-local-asylum.mjs --input <regional-and-local-authority.ods> --output <local-asylum.json>
`);
  process.exit(0);
}

const imported = importHomeOfficeLocalAuthorityAsylum({
  odsPath: args.input,
  sourceUrl: args.sourceUrl
});
mkdirSync(path.dirname(args.output), { recursive: true });
writeFileSync(args.output, `${JSON.stringify(imported, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  ok: true,
  output: path.resolve(args.output),
  snapshot_date: imported.snapshotDate,
  areas: imported.areas.length,
  supported_asylum_total: imported.areas.reduce((sum, row) => sum + (row.supportedAsylum || 0), 0)
}, null, 2));
