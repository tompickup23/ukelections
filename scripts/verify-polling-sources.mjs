#!/usr/bin/env node
/** Build the public audit ledger for the live polling candidate manifest. */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertPublicationReady, buildVerificationLedger } from "./lib/polling-verification.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (file) => JSON.parse(readFileSync(resolve(ROOT, file), "utf8"));
const writeJson = (file, value) => writeFileSync(resolve(ROOT, file), `${JSON.stringify(value, null, 2)}\n`);

const requirePrimary = process.argv.includes("--require-primary");
const current = readJson("data/polling/current-polls.json");
const registry = readJson("data/polling/source-registry.json");
const verifications = readJson("data/polling/primary-verifications.json");
const ledger = buildVerificationLedger(current, registry, verifications);

writeJson("data/polling/verification-ledger.json", ledger);
console.log(`Wrote polling verification ledger: ${ledger.counts.primary_verified || 0} primary-verified, ${ledger.counts.pending_primary_verification || 0} pending, ${ledger.counts.not_comparable || 0} not comparable.`);
if (requirePrimary) assertPublicationReady(ledger);
