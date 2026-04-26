/**
 * snapshot.js — shared helpers for audit-grade snapshot blocks.
 *
 * Every prediction or feature file should embed a snapshot like:
 *   {
 *     snapshot: {
 *       snapshot_id, generated_at, sha256,
 *       sources: [{ path, sha256, retrieved_at, role }, ...],
 *       licence
 *     },
 *     ...
 *   }
 *
 * Pure functions; no I/O outside of explicit reads passed in by the caller.
 */

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";

export function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Build a sources list for a snapshot block.
 * inputs: [{ path: 'data/...', role: 'description' }]
 * Returns the same array enriched with sha256 + retrieved_at + size_bytes.
 */
export function buildSources(inputs) {
  return inputs.map((src) => {
    let sha = null;
    let size = null;
    let mtime = null;
    try {
      const buf = readFileSync(src.path);
      sha = sha256(buf);
      size = buf.byteLength;
      mtime = statSync(src.path).mtime.toISOString();
    } catch {
      // Source missing — surface in the snapshot so downstream code can warn
    }
    return {
      ...src,
      sha256: sha,
      size_bytes: size,
      retrieved_at: mtime,
    };
  });
}

/**
 * Build a snapshot block ready to embed into an output file.
 * payload should be the rest of the JSON (pre-snapshot). After the call,
 * write the file with both the snapshot AND the payload — the snapshot's
 * own sha256 represents the FULL file (snapshot + payload).
 */
export function buildSnapshot({ snapshot_id, sources = [], licence = null, extra = {}, payload = {} }) {
  const enriched = buildSources(sources);
  const draft = {
    snapshot_id,
    generated_at: new Date().toISOString(),
    sha256: null, // filled in by buildOutput()
    sources: enriched,
    licence,
    ...extra,
  };
  return draft;
}

/**
 * Wrap a snapshot + payload into a final JSON object whose snapshot.sha256
 * equals the sha256 of the JSON-stringified output (with that field zeroed
 * during hashing). Returns the final stringified JSON ready to write to disk.
 */
export function finaliseSnapshot(snapshot, payload) {
  const draftObj = { snapshot, ...payload };
  // Hash with sha256 set to placeholder so the field is deterministic
  draftObj.snapshot.sha256 = "0".repeat(64);
  const draftJson = JSON.stringify(draftObj, null, 2);
  const realSha = sha256(draftJson.replace(/"sha256": "0{64}"/, '"sha256": ""'));
  draftObj.snapshot.sha256 = realSha;
  return JSON.stringify(draftObj, null, 2);
}
