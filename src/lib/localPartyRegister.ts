/**
 * Local-party register.
 *
 * The 7 May 2026 post-audit identified Independent (including local-bloc
 * parties) as the worst major-bucket MAE at 10.25pp. The flat 8% cap on
 * Independent vote share in the model is wrong wherever a council has an
 * organised local-bloc party (Garforth Independents, Merton Park Ward
 * Independent Residents, Great Yarmouth First, etc.).
 *
 * `data/identity/local-party-register.json` records every party that
 * (a) is not a major national brand, (b) cleared 5% share in at least
 * two wards on 7 May 2026, with the LAD-level mean and max share. The
 * Independent allocation step can use this to set a per-LAD ceiling
 * instead of a national one.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

interface RegisterEntry {
  party_name: string;
  lad24cd: string;
  lad_name: string;
  ward_count: number;
  mean_share: number;
  max_share: number;
  seats_won: number;
}

interface RegisterFile {
  snapshot: Record<string, unknown>;
  register: RegisterEntry[];
}

const ROOT = process.cwd();
let _cached: RegisterFile | null = null;
let _byLad: Map<string, RegisterEntry[]> | null = null;

function load(): RegisterFile {
  if (_cached) return _cached;
  const p = path.join(ROOT, "data/identity/local-party-register.json");
  _cached = JSON.parse(readFileSync(p, "utf8")) as RegisterFile;
  return _cached!;
}

function index(): Map<string, RegisterEntry[]> {
  if (_byLad) return _byLad;
  const m = new Map<string, RegisterEntry[]>();
  for (const e of load().register) {
    const arr = m.get(e.lad24cd) || [];
    arr.push(e);
    m.set(e.lad24cd, arr);
  }
  _byLad = m;
  return m;
}

/**
 * All local-party entries for a given LAD24CD, sorted by mean_share desc.
 * Empty array if the LAD has no registered local parties.
 */
export function localPartiesForLad(lad24cd: string | null | undefined): RegisterEntry[] {
  if (!lad24cd) return [];
  return (index().get(lad24cd) || []).slice().sort((a, b) => b.mean_share - a.mean_share);
}

/**
 * Suggested Independent + local-party ceiling for a ward in this LAD.
 * Returns max_share of the strongest local party, with a floor of 0.08
 * (the previous global default). Used by the per-ward Independent
 * allocation step.
 */
export function independentCeilingFor(lad24cd: string | null | undefined): number {
  const entries = localPartiesForLad(lad24cd);
  if (entries.length === 0) return 0.08;
  return Math.max(0.08, entries[0].max_share);
}

export function registerSize(): number {
  return load().register.length;
}
