import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  SEATS_FILE,
  benchmarkHolder,
  byElectionRecord,
  normaliseContest,
  parsePrevious,
  partyLabel,
  sittingParties,
  thirdsDefended,
  validateSeats,
} from "../scripts/lib/seats-defended.mjs";
import { buildScoreboard, contestRecord } from "../scripts/lib/byelection-scoreboard.mjs";

const ROOT = process.cwd();
const read = (f) => JSON.parse(readFileSync(path.join(ROOT, f), "utf8"));
const doc = read(SEATS_FILE);
const handHolders = read("data/contests/local-byelection-holders.json").holders;
const handRecorded = read("data/seats/hand-recorded.json");
const contestDir = path.join(ROOT, "data/contests/local-byelections");
const contests = readdirSync(contestDir).filter((f) => f.endsWith(".json") && !f.startsWith("_")).map((f) => JSON.parse(readFileSync(path.join(contestDir, f), "utf8")));
const ledger = read("data/scoreboard/byelection-forecasts.json");

/** A normalised contest for the rule tests, built the way the generator builds them. */
const c = (id, date, winners) =>
  normaliseContest({ ballot_paper_id: id, election_date: date, council_slug: "x", ward_slug: "w", candidates: winners ? winners.map((party_name, i) => ({ name: `M${i}`, party_name, elected: true })) : [{ name: "N", party_name: "Labour", votes: 1 }] }, "test");

describe("by-election rule: one seat or one party, never a guess", () => {
  const ward = { date: "2026-10-01", seats: 3, boundary_start: "2022-05-05" };

  it("determines a one-seat ward from its last winner, by-election included", () => {
    const h = [c("local.x.w.2023-05-04", "2023-05-04", ["Labour"]), c("local.x.w.by.2024-07-11", "2024-07-11", ["Green Party"])];
    const r = sittingParties(h, { date: "2026-10-01", seats: 1, boundary_start: "2019-05-02" });
    expect(r).toMatchObject({ determined: true, parties: ["Green Party"], basis: "single_member_ward_last_byelection" });
  });

  it("determines a multi-seat ward only when every councillor elected in it is one party", () => {
    const h = [c("local.x.w.2023-05-04", "2023-05-04", ["Labour"]), c("local.x.w.2024-05-02", "2024-05-02", ["Labour"]), c("local.x.w.2026-05-07", "2026-05-07", ["Labour and Co-operative Party"])];
    expect(sittingParties(h, ward)).toMatchObject({ determined: true, parties: ["Labour"] });
  });

  it("leaves a mixed ward unresolved and names the parties", () => {
    // The Sheffield Southey shape: the ward's last ordinary winner is not who left.
    const h = [c("a.2023", "2023-05-04", ["Labour"]), c("a.2024", "2024-05-02", ["Labour"]), c("a.2026", "2026-05-07", ["Reform UK"])];
    const r = sittingParties(h, ward);
    expect(r.determined).toBe(false);
    expect(r.reason).toBe("two_or_more_parties_in_ward");
    expect(r.parties).toEqual(["Labour", "Reform UK"]);
  });

  it("refuses when the window does not fill the ward (postponed election or a missing year)", () => {
    const h = [c("a.2024", "2024-05-02", ["Labour"]), c("a.2026", "2026-05-07", ["Labour"])];
    expect(sittingParties(h, ward)).toMatchObject({ determined: false, reason: "seat_count_mismatch" });
  });

  it("ignores contests before the ward's current boundaries", () => {
    const h = [c("a.2021", "2021-05-06", ["Labour"]), c("a.2023", "2023-05-04", ["Labour"])];
    expect(sittingParties(h, { date: "2026-10-01", seats: 1, boundary_start: "2024-05-02" })).toMatchObject({ determined: false, reason: "no_election_in_window" });
  });

  it("refuses when a contest has no elected flags", () => {
    const h = [c("a.2023", "2023-05-04", null)];
    expect(sittingParties(h, { date: "2026-10-01", seats: 1, boundary_start: "2019-05-02" })).toMatchObject({ determined: false, reason: "missing_elected_flags" });
  });

  it("keeps different local groups apart while pooling Labour Co-operative", () => {
    expect(partyLabel("Labour and Co-operative Party")).toBe("Labour");
    expect(partyLabel("Residents for Uttlesford")).toBe("Residents for Uttlesford");
    expect(partyLabel("Independent")).toBe("Independent");
    expect(parsePrevious("Labour x2")).toEqual(["Labour", "Labour"]);
  });
});

describe("thirds rule: the seat filled four years earlier, adjusted for by-elections", () => {
  const row = { winner_count: 1 };

  it("defends the 2022 winner's party", () => {
    const h = [c("w.2022", "2022-05-05", ["Conservative"]), c("w.2023", "2023-05-04", ["Labour"]), c("w.2024", "2024-05-02", ["Labour"])];
    expect(thirdsDefended(h, row)).toMatchObject({ determined: true, parties: ["Conservative"], basis: "base_election" });
  });

  it("is unresolved when a by-election of another party could have filled that seat", () => {
    const h = [c("w.2022", "2022-05-05", ["Conservative"]), c("w.2023", "2023-05-04", ["Labour"]), c("w.by.2024-09-12", "2024-09-12", ["Labour"]), c("w.2024", "2024-05-02", ["Labour"])];
    expect(thirdsDefended(h, row)).toMatchObject({ determined: false, reason: "byelection_may_have_filled_seat" });
  });

  it("is determined when that by-election kept the same party", () => {
    const h = [c("w.2022", "2022-05-05", ["Conservative"]), c("w.by.2024-09-12", "2024-09-12", ["Conservative"]), c("w.2023", "2023-05-04", ["Labour"])];
    expect(thirdsDefended(h, row)).toMatchObject({ determined: true, parties: ["Conservative"], basis: "base_election_byelections_same_party" });
  });

  it("does not apply a retirement order after an all-out year", () => {
    const h = [c("w.2022", "2022-05-05", ["Conservative", "Labour", "Labour"]), c("w.2023", "2023-05-04", ["Labour"]), c("w.2024", "2024-05-02", ["Labour"])];
    expect(thirdsDefended(h, row)).toMatchObject({ determined: false, reason: "base_was_all_out" });
  });

  it("falls back to one party only when every councillor in the window is that party", () => {
    const h = [c("w.2022", "2022-05-05", ["Labour", "Labour", "Labour"]), c("w.2023", "2023-05-04", ["Labour"])];
    expect(thirdsDefended(h, row)).toMatchObject({ determined: true, parties: ["Labour"], basis: "every_sitting_councillor_one_party" });
  });
});

describe("tiers: hand verified, then hand recorded, then roundup, then derived", () => {
  const contest = { council_name: "X", ward_name: "W", polling_day: "2026-10-01", seats_contested: 1, seats_total: 3 };
  const derived = { determined: true, parties: ["Labour"], basis: "every_sitting_councillor_one_party", evidence: ["a"] };

  it("a hand-verified holder wins and a change of party is explained, not flagged as an error", () => {
    const r = byElectionRecord(contest, { hand: { party: "Liberal Democrats", elected_as: "Labour", sources: [{ label: "s", url: "u" }] }, derived });
    expect(r).toMatchObject({ confidence: "determined", holders: ["Liberal Democrats"], review_status: "hand_verified_two_sources", held_data_check: "differs" });
    expect(r.disagreement).toMatch(/elected for/);
  });

  it("a roundup that contradicts held data is unresolved, not applied", () => {
    const r = byElectionRecord(contest, { roundup: { previous: "Independent", sources: [{ label: "r", url: "u" }] }, derived });
    expect(r).toMatchObject({ confidence: "unresolved", holders: null, reason: "sources_disagree" });
  });

  it("a roundup that agrees is determined", () => {
    const r = byElectionRecord(contest, { roundup: { previous: "Labour", sources: [{ label: "r", url: "u" }] }, derived });
    expect(r).toMatchObject({ confidence: "determined", holders: ["Labour"], held_data_check: "agrees" });
  });
});

describe("the tracked file", () => {
  it("passes its own rules", () => {
    expect(validateSeats(doc)).toEqual([]);
  });

  it("covers every contest file, keyed by ballot paper id", () => {
    for (const d of contests) expect(doc.by_elections[d.contest.ballot_paper_id], d.contest.ballot_paper_id).toBeTruthy();
  });

  it("carries every hand-verified holder unchanged", () => {
    for (const [id, h] of Object.entries(handHolders)) {
      if (!doc.by_elections[id]) continue;
      expect(doc.by_elections[id]).toMatchObject({ review_status: "hand_verified_two_sources", confidence: "determined" });
      expect(new Set(doc.by_elections[id].holders)).toEqual(new Set([h.party]));
    }
  });

  it("carries every hand-recorded entry as recorded", () => {
    for (const [id, h] of Object.entries(handRecorded.by_elections)) {
      if (handHolders[id]) continue;
      expect(doc.by_elections[id]).toMatchObject({ review_status: "hand_recorded", confidence: h.confidence, holders: h.holders });
    }
  });

  it("gives every unresolved record a reason, and every determined one a source", () => {
    for (const r of [...Object.values(doc.by_elections), ...Object.values(doc.scheduled)]) {
      if (r.confidence === "unresolved") expect(r.reason && r.detail).toBeTruthy();
      else expect(r.source.length).toBeGreaterThan(0);
    }
  });

  it("uses no dashes as punctuation in anything people read", () => {
    const text = readFileSync(path.join(ROOT, SEATS_FILE), "utf8") + readFileSync(path.join(ROOT, "data/seats/README.md"), "utf8");
    // A Markdown list bullet at the start of a line is not punctuation.
    expect(text.replace(/^\s*- /gm, "")).not.toMatch(/[–—]| - /);
  });
});

describe("the scoreboard's holder benchmark reads this file", () => {
  const seats = doc.by_elections;

  it("calls only determined single-party holders", () => {
    expect(benchmarkHolder({ confidence: "unresolved", holders: null })).toBeNull();
    expect(benchmarkHolder({ confidence: "determined", holders: ["Labour", "Reform UK"] })).toBeNull();
    expect(benchmarkHolder({ confidence: "determined", holders: ["Labour", "Labour"] })).toBe("Labour");
  });

  it("matches the file record for record", () => {
    for (const d of contests) {
      const r = contestRecord(d, seats);
      const want = benchmarkHolder(seats[d.contest.ballot_paper_id]);
      expect(r.benchmarks.holder?.called_leader ?? null).toBe(want ? (["Reform UK", "Labour", "Conservative", "Liberal Democrats", "Green Party"].includes(want) ? want : "Others") : null);
    }
  });

  it("covers more of the live record than the contest pages did (39 of 52 before)", () => {
    const board = buildScoreboard(ledger, contests, seats);
    const live = board.live.find((b) => b.forecaster === "uk-elections");
    const holder = live.benchmarks.find((b) => b.id === "holder");
    expect(holder.score.contests).toBeGreaterThanOrEqual(39);
    expect(holder.score.contests + holder.left_out).toBe(live.score.contests);
  });
});
