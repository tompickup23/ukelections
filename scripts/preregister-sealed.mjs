#!/usr/bin/env node
/**
 * preregister-sealed.mjs: lock one vintage of a forecast pre-registration in
 * which some forecasts are published and others are sealed. Every file's
 * sha256 goes into a public manifest; a sealed file's contents stay out of
 * this repository until the election is scored, when anyone can check it
 * against the hash recorded here. Protocol: docs/preregistration-2027.md.
 *
 * Usage:
 *   node scripts/preregister-sealed.mjs --vintage=2027-v1
 *     --published=<path>[,<path>...] --sealed=<label>=<path>[,<label>=<path>...]
 *     [--inputs=<path>[,<path>...]] [--out=data/transparency/preregistration-2027-v1.json]
 *
 * A sealed entry names a label and the file's location outside the repo; only
 * the label, hash and size are written to the manifest.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function digest(buf) {
  return { sha256: createHash("sha256").update(buf).digest("hex"), size_bytes: buf.byteLength };
}

const list = (v) => (v ? String(v).split(",").map((s) => s.trim()).filter(Boolean) : []);

export function buildManifest({ vintage, published = [], sealed = [], inputs = [], read = readFileSync, now = new Date() }) {
  if (!/^[0-9]{4}-v[0-9]+$/.test(vintage || "")) throw new Error(`--vintage must look like 2027-v1, got ${vintage}`);
  if (!published.length && !sealed.length) throw new Error("nothing to pre-register");
  const entry = (path) => ({ path, ...digest(read(path)) });
  return {
    snapshot_id: `preregistration-${vintage}`,
    vintage,
    pre_registered_at: now.toISOString(),
    protocol: "docs/preregistration-2027.md",
    published: published.map(entry),
    sealed: sealed.map((s) => {
      const i = s.indexOf("=");
      if (i < 1) throw new Error(`sealed entries are label=path, got ${s}`);
      const label = s.slice(0, i);
      return { label, ...digest(read(s.slice(i + 1))), note: "contents withheld until the election is scored; check against this hash" };
    }),
    inputs: inputs.map(entry),
  };
}

function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)=(.*)$/s); return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true]; }));
  const toRepo = (p) => relative(REPO, resolve(REPO, p));
  const published = list(args.published).map(toRepo);
  const inputs = list(args.inputs).map(toRepo);
  for (const p of [...published, ...inputs]) if (!existsSync(resolve(REPO, p))) throw new Error(`missing ${p}`);
  const manifest = buildManifest({
    vintage: args.vintage,
    published,
    sealed: list(args.sealed),
    inputs,
    read: (p) => readFileSync(resolve(REPO, p)),
  });
  const out = resolve(REPO, args.out || `data/transparency/preregistration-${args.vintage}.json`);
  if (existsSync(out)) throw new Error(`${relative(REPO, out)} exists: each vintage is locked once and never rewritten`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`locked ${manifest.vintage}: ${manifest.published.length} published, ${manifest.sealed.length} sealed, ${manifest.inputs.length} inputs -> ${relative(REPO, out)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
