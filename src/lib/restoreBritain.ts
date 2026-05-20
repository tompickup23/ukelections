/**
 * Restore Britain. per-seat overlay lookup.
 *
 * Where Wikipedia (or another verifiable public source) records an RB
 * candidate result for a constituency, we surface that share directly.
 * Every other PCON falls back to the national overlay applied in
 * `nationalPolling.js` (currently 4%). The fallback share + sourcing
 * sit alongside the per-seat map in `data/restore-britain/seat-shares.json`.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

interface SeatShare {
  share: number;
  source: string;
  wikipedia?: string;
  scanned_at?: string;
}

interface RbFile {
  metadata: {
    national_fallback_share?: number;
    national_fallback_source?: string;
    generated_at?: string;
  };
  constituency_shares: Record<string, SeatShare>;
  county_council_results?: Record<string, unknown>;
}

const ROOT = process.cwd();
let _cached: RbFile | null = null;

function load(): RbFile {
  if (_cached) return _cached;
  const p = path.join(ROOT, "data/restore-britain/seat-shares.json");
  _cached = JSON.parse(readFileSync(p, "utf8")) as RbFile;
  return _cached!;
}

export function nationalFallbackShare(): number {
  return load().metadata.national_fallback_share ?? 0.04;
}

export function nationalFallbackSource(): string | undefined {
  return load().metadata.national_fallback_source;
}

/**
 * Look up the Restore Britain share for a constituency by PCON24CD. Returns
 * the per-seat share when known, otherwise the national fallback. Pass
 * `strict: true` to get `null` instead of the fallback when no per-seat
 * data exists. useful when you want to render UI only where the override
 * actually fired.
 */
export function shareFor(pcon24cd: string | null | undefined, opts?: { strict?: boolean }): number | null {
  if (!pcon24cd) return opts?.strict ? null : nationalFallbackShare();
  const seat = load().constituency_shares[pcon24cd];
  if (seat && typeof seat.share === "number") return seat.share;
  return opts?.strict ? null : nationalFallbackShare();
}

export function seatRecordFor(pcon24cd: string | null | undefined): SeatShare | null {
  if (!pcon24cd) return null;
  return load().constituency_shares[pcon24cd] || null;
}

export function countOverrides(): number {
  return Object.keys(load().constituency_shares).length;
}

export function listOverrides(): Array<{ pcon24cd: string } & SeatShare> {
  return Object.entries(load().constituency_shares).map(([pcon24cd, v]) => ({
    pcon24cd,
    ...v,
  }));
}
