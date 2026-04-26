#!/usr/bin/env node
/**
 * preregister-forecasts.mjs — record SHA256 of every forecast file in a
 * pre-registration manifest, so subsequent edits can be audited as
 * after-the-fact changes rather than original predictions.
 *
 * Run before each headline forecast publication (≥48h before any election
 * we're forecasting). Output: data/transparency/preregistration-{date}.json
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");

const TARGETS = [
  "data/predictions/ge-next/constituencies.json",
  "data/predictions/ge-next/summary.json",
  "data/predictions/ge-next/assumptions.json",
  "data/predictions/may-2026/local-and-mayor.json",
  "data/predictions/may-2026/summary.json",
  "data/predictions/may-2026/senedd.json",
  "data/predictions/may-2026/holyrood.json",
  "data/identity/pcons-ge-next.json",
  "data/identity/wards-may-2026.json",
  "data/backtests/ge-2024.json",
  "data/backtests/may-2024-summary.json",
];

function sha256(buf) { return createHash("sha256").update(buf).digest("hex"); }

const date = new Date().toISOString().slice(0, 10);
const manifest = {
  snapshot_id: `preregistration-${date}`,
  pre_registered_at: new Date().toISOString(),
  scope: "ukelections.co.uk forecast portfolio",
  files: [],
};
let total = 0;
let missing = 0;
for (const path of TARGETS) {
  const full = join(REPO, path);
  if (!existsSync(full)) {
    manifest.files.push({ path, status: "missing" });
    missing += 1;
    continue;
  }
  const buf = readFileSync(full);
  manifest.files.push({
    path,
    sha256: sha256(buf),
    size_bytes: buf.byteLength,
    status: "ok",
  });
  total += 1;
}

const outPath = `data/transparency/preregistration-${date}.json`;
mkdirSync(dirname(join(REPO, outPath)), { recursive: true });
writeFileSync(join(REPO, outPath), JSON.stringify(manifest, null, 2));
console.log(`Pre-registered ${total} files (${missing} missing) → ${outPath}`);
for (const f of manifest.files) {
  console.log(`  ${f.status === "ok" ? "✓" : "✗"} ${f.path}${f.sha256 ? "  " + f.sha256.slice(0, 12) : ""}`);
}
