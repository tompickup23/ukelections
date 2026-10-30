import { describe, expect, it } from "vitest";
import { repairYearTypos } from "../scripts/lib/poll-date-sequence.mjs";

const d = (s) => new Date(`${s}T00:00:00Z`);
const iso = (xs) => xs.map((x) => (x ? x.toISOString().slice(0, 10) : null));

describe("poll table year repair", () => {
  it("moves a run of rows written a year early back into sequence", () => {
    // Table order, newest first, as in the October 2026 Wikipedia table.
    const rows = [d("2026-02-05"), d("2025-02-02"), d("2025-01-25"), null, d("2025-01-19"), d("2025-12-31"), d("2025-12-24")];
    expect(iso(repairYearTypos(rows))).toEqual(["2026-02-05", "2026-02-02", "2026-01-25", null, "2026-01-19", "2025-12-31", "2025-12-24"]);
  });

  it("repairs a typo in the last row of the table", () => {
    const rows = [d("2026-01-19"), d("2026-01-13"), d("2025-01-05")];
    expect(iso(repairYearTypos(rows))).toEqual(["2026-01-19", "2026-01-13", "2026-01-05"]);
  });

  it("leaves a genuine gap at the end of the table alone", () => {
    const rows = [d("2026-02-05"), d("2025-03-01"), d("2025-02-20")];
    expect(iso(repairYearTypos(rows))).toEqual(["2026-02-05", "2025-03-01", "2025-02-20"]);
  });

  it("does not shift a row past the row above it", () => {
    const rows = [d("2026-01-10"), d("2025-03-01"), d("2025-12-01")];
    expect(iso(repairYearTypos(rows))).toEqual(["2026-01-10", "2025-03-01", "2025-12-01"]);
  });
});
