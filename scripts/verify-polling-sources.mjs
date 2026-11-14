#!/usr/bin/env node
/**
 * Build the public audit ledger for the live polling candidate manifest.
 *
 * The nightly writes current-polls.json from the Wikipedia table, so every row
 * carries the Wikipedia URL and no fieldwork start. A first-party check lives
 * in primary-verifications.json and is joined to the row here, by pollster and
 * fieldwork end date:
 *
 *   - shares agree with the pollster's own table: the row takes the
 *     pollster's URL, fieldwork start, sample size and geography from the
 *     evidence, keeps the Wikipedia URL as `discovered_via`, and the ledger
 *     then marks it primary_verified through the unchanged policy checks;
 *   - shares disagree: the row is left exactly as Wikipedia has it, stays
 *     pending, and the disagreement is printed and written to the ledger.
 *     The Wikipedia figure is never edited to match.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertPublicationReady, buildVerificationLedger, PRIMARY_VERIFICATION } from "./lib/polling-verification.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (file) => JSON.parse(readFileSync(resolve(ROOT, file), "utf8"));
const writeJson = (file, value) => writeFileSync(resolve(ROOT, file), `${JSON.stringify(value, null, 2)}\n`);

const SHARE_TOLERANCE = 0.000001;

function shareDifferences(left = {}, right = {}) {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  const differences = [];
  for (const key of keys) {
    const a = left[key];
    const b = right[key];
    if (typeof a !== "number" || typeof b !== "number" || Math.abs(a - b) >= SHARE_TOLERANCE) {
      differences.push({ party: key, pollster_table: a ?? null, wikipedia_row: b ?? null });
    }
  }
  return differences;
}

/** @returns {{ current: object, disagreements: object[], unmatched: object[], attached: number }} */
export function attachPrimaryEvidence(current, verifications) {
  const evidence = (verifications?.records || []).filter((v) => v.status === PRIMARY_VERIFICATION);
  const used = new Set();
  const disagreements = [];
  let attached = 0;
  const records = (current.records || []).map((record) => {
    const match = evidence.find((v) => v.pollster === record.pollster && v.fieldwork_end === record.fieldwork_end);
    if (!match) return record;
    used.add(match);
    const differences = shareDifferences(match.shares, record.shares);
    if (differences.length) {
      disagreements.push({
        pollster: record.pollster,
        fieldwork_end: record.fieldwork_end,
        primary_url: match.primary_url,
        differences,
      });
      return { ...record, primary_disagreement: { primary_url: match.primary_url, differences } };
    }
    attached += 1;
    return {
      ...record,
      fieldwork_start: match.fieldwork_start,
      sample_size: match.sample_size ?? record.sample_size ?? null,
      client: match.client ?? record.client ?? null,
      geography: match.geography,
      source_name: `${record.pollster} published tables`,
      source_url: match.primary_url,
      source_status: "primary_verified",
      discovered_via: record.source_url,
    };
  });
  const unmatched = evidence
    .filter((v) => !used.has(v))
    .map((v) => ({ pollster: v.pollster, fieldwork_end: v.fieldwork_end, primary_url: v.primary_url }));
  return { current: { ...current, records }, disagreements, unmatched, attached };
}

function main() {
  const requirePrimary = process.argv.includes("--require-primary");
  const current = readJson("data/polling/current-polls.json");
  const registry = readJson("data/polling/source-registry.json");
  const verifications = readJson("data/polling/primary-verifications.json");
  const joined = attachPrimaryEvidence(current, verifications);
  const ledger = {
    ...buildVerificationLedger(joined.current, registry, verifications),
    primary_disagreements: joined.disagreements,
  };

  writeJson("data/polling/verification-ledger.json", ledger);
  console.log(`Wrote polling verification ledger: ${ledger.counts.primary_verified || 0} primary-verified, ${ledger.counts.pending_primary_verification || 0} pending, ${ledger.counts.not_comparable || 0} not comparable.`);
  for (const d of joined.disagreements) {
    const detail = d.differences.map((x) => `${x.party} table ${x.pollster_table ?? "absent"} vs Wikipedia ${x.wikipedia_row ?? "absent"}`).join("; ");
    console.log(`! ${d.pollster} ${d.fieldwork_end}: pollster's table disagrees with the Wikipedia row (${detail}). Wikipedia figure left unchanged; row stays pending.`);
  }
  if (joined.unmatched.length) {
    console.log(`  ${joined.unmatched.length} verification record(s) not in the current window: ${joined.unmatched.map((u) => `${u.pollster} ${u.fieldwork_end}`).join(", ")}`);
  }
  if (requirePrimary) assertPublicationReady(ledger);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
