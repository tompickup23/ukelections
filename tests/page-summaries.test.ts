import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { loadGePredictions } from "../src/lib/predictions";
import {
  constituencySummary,
  seatSwings,
  byElectionResultSummary,
  wardSummary,
  regionSummary,
} from "../src/lib/pageSummaries";

const ge = (loadGePredictions() as any).predictions;
const records = Object.values(ge).filter((r: any) => r?.prediction) as any[];
const contestDir = path.join(process.cwd(), "data/contests/local-byelections");
const contests = readdirSync(contestDir)
  .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
  .map((f) => JSON.parse(readFileSync(path.join(contestDir, f), "utf8")));

// House style: no em or en dashes, and no spaced hyphen used as a dash.
const DASHES = /\u2014|\u2013| - /;

describe("constituency swing", () => {
  it("compares like with like when the 2024 ballot label differs from the model's party name", () => {
    // Burnley 2024: Labour and Co-operative 31.7%. The swing bar showed +27.2pp.
    const swing = seatSwings(ge.burnley);
    const projected = ge.burnley.prediction.Labour.pct;
    expect(swing.Labour).toBeCloseTo(projected - 0.3171781766912561, 6);
    expect(swing.Labour).toBeLessThan(0);
  });
});

describe("constituency summary", () => {
  it("is 35 to 150 words on every seat before the backtest line, dash-free, and names no one", () => {
    for (const r of records) {
      const text = constituencySummary(r, null).join(" ");
      const words = text.split(/\s+/).length;
      expect(words, r.slug).toBeGreaterThanOrEqual(35);
      expect(words, r.slug).toBeLessThanOrEqual(150);
      expect(DASHES.test(text), r.slug).toBe(false);
      if (r.mp?.name) expect(text.includes(r.mp.name), r.slug).toBe(false);
    }
  });

  it("states the 2024 result and the projection from the record", () => {
    const text = constituencySummary(ge.burnley, {
      predictedWinner: "Labour",
      actualWinner: "Labour",
      winnerCorrect: true,
      mae: 0.0431,
    }).join(" ");
    expect(text).toContain("At the 2024 general election Labour won Burnley with 31.7% of the vote, 8.6 points ahead of the Liberal Democrats.");
    expect(text).toContain(`on ${(ge.burnley.prediction[ge.burnley.winner].pct * 100).toFixed(1)}%`);
    expect(text).toContain("called this seat correctly for Labour");
    expect(text).toContain("4.31 points");
  });

  it("never paraphrases a demographic model step", () => {
    for (const r of records) {
      const text = constituencySummary(r, null).join(" ").toLowerCase();
      for (const word of ["muslim", "identity", "english", "age", "ceiling", "65+"]) {
        expect(text.includes(word) && !r.name.toLowerCase().includes(word), `${r.slug}: ${word}`).toBe(false);
      }
    }
  });
});

describe("by-election result summary", () => {
  it("leads with winner, share, majority, change and source", () => {
    const bray = contests.find((d) => d.slug === "windsor-and-maidenhead-bray-2026-09-24");
    expect(byElectionResultSummary(bray)).toEqual([
      "The Conservatives won the Bray by-election in Windsor and Maidenhead on 24 September 2026 with 36.1% of the vote, 26 votes ahead of the Liberal Democrats.",
      "Against the ward's May 2023 result, the Conservative share rose 1.3 points and the Liberal Democrat share rose 20.1 points.",
      "In all, 2,063 votes were cast. The result is taken from the returning officer's declaration, checked on 28 September 2026.",
    ]);
  });

  it("is empty for upcoming contests, dash-free, and never names a candidate", () => {
    for (const d of contests) {
      const text = byElectionResultSummary(d).join(" ");
      if (d.status === "upcoming") expect(text, d.slug).toBe("");
      expect(DASHES.test(text), d.slug).toBe(false);
      for (const name of [d.result?.winner_candidate, d.declaration?.winner_candidate]) {
        if (name) expect(text.includes(name), d.slug).toBe(false);
      }
    }
  });
});

describe("ward and region summaries", () => {
  it("ward summary reports the result and the forecast call", () => {
    const text = wardSummary({
      wardName: "Bank Hall",
      councilName: "Burnley",
      seatsWon: "Reform UK",
      seats: 1,
      turnoutPct: 0.281,
      majority: 212,
      majorityOverParty: "Labour",
      incomplete: false,
      backtest: { predicted_winner: "Labour", actual_winner: "Reform UK", winner_match: false, major_party_mae: 0.0912 },
    }).join(" ");
    expect(text).toBe(
      "Bank Hall in Burnley elected one councillor on 7 May 2026: Reform UK. Turnout was 28.1%. The winner was decided by 212 votes over Labour. The forecast published before polling day had Labour ahead here, but Reform UK won; its mean error across the major parties was 9.12 points.",
    );
  });

  it("region summary counts every seat", () => {
    const text = regionSummary("the North East", records.filter((r) => r.region === "north_east")).join(" ");
    expect(text.startsWith("The North East has 27 parliamentary constituencies.")).toBe(true);
    expect(text).toContain("At the 2024 general election the seats went Labour 26 and the Conservatives 1.");
  });
});
