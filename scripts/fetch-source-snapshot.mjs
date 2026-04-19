#!/usr/bin/env node
import { fetchSourceSnapshot } from "./lib/source-fetcher.mjs";

const [sourceName, sourceUrl, licence, outputPath] = process.argv.slice(2);

if (!sourceName || !sourceUrl || !licence || !outputPath) {
  console.error("Usage: node scripts/fetch-source-snapshot.mjs <sourceName> <sourceUrl> <licence> <outputPath>");
  process.exit(2);
}

const snapshot = await fetchSourceSnapshot({ sourceName, sourceUrl, licence, outputPath });
console.log(JSON.stringify(snapshot, null, 2));
