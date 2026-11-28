import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  MIN_CONTESTS,
  WINDOW_FROM,
  barometerSummary,
  buildBarometer,
  pointsAt,
} from "../scripts/lib/byelection-barometer.mjs";
import { logit } from "../scripts/lib/local-byelection-model.mjs";

const doc = JSON.parse(readFileSync(new URL("../data/transparency/byelection-barometer.json", import.meta.url), "utf8"));

// A contest where Labour goes 40% -> 30% and the Conservatives 30% -> 40%.
let seq = 0;
const row = (date, from, to) => ({ ballot_paper_id: `local.x.w${seq++}.by.${date}`, date, prior_date: "2024-05-02", from, to });

describe("barometer rules", () => {
  it("leaves a party's month blank below the minimum, never interpolated", () => {
    const corpus = [];
    for (let i = 0; i < MIN_CONTESTS; i++) corpus.push(row("2024-07-10", { Labour: 0.4, Conservative: 0.3 }, { Labour: 0.3, Conservative: 0.4 }));
    // August: one fewer than the minimum
    for (let i = 0; i < MIN_CONTESTS - 1; i++) corpus.push(row("2024-08-10", { Labour: 0.4, Conservative: 0.3 }, { Labour: 0.3, Conservative: 0.4 }));
    for (let i = 0; i < MIN_CONTESTS; i++) corpus.push(row("2024-09-10", { Labour: 0.4, Conservative: 0.3 }, { Labour: 0.3, Conservative: 0.4 }));
    const b = buildBarometer(corpus);
    const months = Object.fromEntries(b.months.map((m) => [m.month, m]));
    expect(months["2024-07"].parties.Labour.median_logit_change).toBeCloseTo(logit(0.3) - logit(0.4), 3);
    expect(months["2024-08"].parties.Labour.median_logit_change).toBeNull();
    expect(months["2024-08"].parties.Labour.contests).toBe(MIN_CONTESTS - 1);
    expect(months["2024-09"].parties.Labour.median_logit_change).not.toBeNull();
  });

  it("counts a party only where it stood both times (2% or more)", () => {
    const corpus = [];
    for (let i = 0; i < MIN_CONTESTS; i++) corpus.push(row("2024-07-10", { Labour: 0.5, "Reform UK": 0.01 }, { Labour: 0.4, "Reform UK": 0.2 }));
    const b = buildBarometer(corpus);
    expect(b.months[0].parties["Reform UK"].contests).toBe(0);
    expect(b.parties_shown).not.toContain("Reform UK");
    expect(b.parties_not_shown.map((p) => p.party)).toContain("Reform UK");
  });

  it("ignores contests before the window", () => {
    const b = buildBarometer([row("2024-06-10", { Labour: 0.4 }, { Labour: 0.3 }), row("2024-07-02", { Labour: 0.4 }, { Labour: 0.3 })]);
    expect(b.months[0].month).toBe(WINDOW_FROM.slice(0, 7));
    expect(b.contests_in_window).toBe(1);
  });

  it("converts log-odds to points at the stated starting share", () => {
    expect(pointsAt(0)).toBe(0);
    expect(pointsAt(logit(0.3) - logit(0.25))).toBeCloseTo(5, 6);
  });

  it("treats every entrant by one rule and compares the same months", () => {
    const corpus = [];
    for (let i = 0; i < MIN_CONTESTS; i++) corpus.push(row("2024-07-10", { Labour: 0.4 }, { Labour: 0.3 }));
    for (let i = 0; i < MIN_CONTESTS; i++) corpus.push(row("2026-08-10", { Labour: 0.4 }, { Labour: 0.3, "Restore Britain": 0.1 }));
    for (let i = 0; i < MIN_CONTESTS; i++) corpus.push(row("2026-08-11", { Labour: 0.4 }, { Labour: 0.45 }));
    const b = buildBarometer(corpus);
    const e = b.entrants.find((x) => x.party === "Restore Britain");
    expect(e.qualifies).toBe(true);
    expect(e.by_elections_since_first_seen).toBe(2 * MIN_CONTESTS);
    const lab = e.comparisons.find((c) => c.party === "Labour");
    expect(lab.with_entrant.contests).toBe(MIN_CONTESTS);
    expect(lab.without_entrant.contests).toBe(MIN_CONTESTS);
  });
});

describe("committed barometer", () => {
  it("records its dates and rules", () => {
    expect(doc.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(doc.latest_contest_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(doc.min_contests).toBe(MIN_CONTESTS);
    expect(doc.months.at(-1).month).toBe(doc.latest_contest_date.slice(0, 7));
  });

  it("never publishes a figure below the minimum", () => {
    for (const m of doc.months) {
      for (const [, c] of Object.entries(m.parties)) {
        if (c.contests < doc.min_contests) expect(c.median_logit_change).toBeNull();
        else expect(c.median_logit_change).not.toBeNull();
        expect(c.contests).toBeLessThanOrEqual(m.contests);
      }
      expect(m.hand_verified_declaration + m.hand_verified_two_sources).toBeLessThanOrEqual(m.contests);
    }
  });

  it("lists entrants alphabetically and excludes pooled lanes", () => {
    const names = doc.entrants.map((e) => e.party);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(doc.parties_shown).not.toContain("Independent");
    expect(doc.parties_shown).not.toContain("Other");
  });

  it("writes a neutral summary naming no individual", () => {
    const s = barometerSummary(doc);
    expect(s).toContain(doc.months.at(-1).contests.toString());
    expect(s).not.toMatch(/collapse|surge|slump|soar|plunge|crash|boom/i);
    expect(s).not.toMatch(/[–—]| - /);
  });
});
