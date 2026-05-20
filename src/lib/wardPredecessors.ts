/**
 * Predecessor-ward inheritance.
 *
 * When a ward has been redrawn by an LGBCE boundary review and has no
 * historical vote-share baseline of its own, the model falls back to the
 * generic GE2024 constituency share. That dampens the per-ward signal in
 * exactly the seats where a granular forecast matters most (Makerfield's
 * Bryn-with-Ashton-North over-performed by +5pp in the 7 May audit
 * because the model couldn't anchor it).
 *
 * The map at `data/identity/ward-predecessors.json` lets us inherit a
 * weighted blend of predecessor wards' historical results. New entries
 * land there as each boundary review is documented.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

interface PredecessorEntry {
  predecessors: string[];
  mix_weights: number[];
  source: string;
}

interface PredecessorFile {
  snapshot: Record<string, unknown>;
  predecessors: Record<string, PredecessorEntry>;
}

const ROOT = process.cwd();
let _cached: PredecessorFile | null = null;

function load(): PredecessorFile {
  if (_cached) return _cached;
  const p = path.join(ROOT, "data/identity/ward-predecessors.json");
  _cached = JSON.parse(readFileSync(p, "utf8")) as PredecessorFile;
  return _cached!;
}

/**
 * Returns the predecessor mapping for `wardKey` (format: `<council>/<ward>`)
 * or null if the ward has no known predecessor (i.e., not affected by a
 * documented boundary review).
 */
export function predecessorsFor(wardKey: string): PredecessorEntry | null {
  const file = load();
  return file.predecessors[wardKey] || null;
}

/**
 * Blend per-party shares across predecessor wards using the recorded mix
 * weights. `lookup(predecessorKey)` should return the most recent ward
 * shares for the predecessor or null if unavailable.
 */
export function blendPredecessorShares(
  wardKey: string,
  lookup: (key: string) => Record<string, number> | null,
): Record<string, number> | null {
  const entry = predecessorsFor(wardKey);
  if (!entry) return null;
  const totalWeight = entry.mix_weights.reduce((s, w) => s + w, 0);
  if (totalWeight <= 0) return null;
  const blend: Record<string, number> = {};
  let foundAny = false;
  for (let i = 0; i < entry.predecessors.length; i += 1) {
    const pk = entry.predecessors[i];
    const w = (entry.mix_weights[i] ?? 0) / totalWeight;
    const shares = lookup(pk);
    if (!shares) continue;
    foundAny = true;
    for (const [party, share] of Object.entries(shares)) {
      blend[party] = (blend[party] || 0) + (share || 0) * w;
    }
  }
  return foundAny ? blend : null;
}

export function predecessorCoverage(): number {
  return Object.keys(load().predecessors).length;
}
