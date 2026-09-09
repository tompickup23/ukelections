import { describe, expect, it } from "vitest";
import { averagePollRecords, normaliseRoadTo326Poll, recentRoadTo326Polls } from "../scripts/lib/polling-reconciliation.mjs";

const row = {
  id: "example-1",
  publication_date: "2026-09-05",
  fieldwork_start: "2026-09-02",
  fieldwork_end: "2026-09-04",
  pollster: "Example Polling",
  client: "Example",
  sample_size: 2000,
  area: "GB",
  mode: "Online",
  mrp: false,
  source_name: "Example release",
  source_url: "https://example.test/poll",
  shares: { lab: 28, con: 18, ref: 24, ld: 11, green: 11, snp: 3, pc: 1, restore: 3, other: 1 },
};

describe("Road to 326 polling reconciliation", () => {
  it("keeps only comparable GB national VI polls and folds Restore Britain into Other", () => {
    const poll = normaliseRoadTo326Poll(row);
    expect(poll.fieldwork_end).toBe("2026-09-04");
    expect(poll.shares.Other).toBeCloseTo(0.04);
    expect(poll.restore_britain_reported).toBeCloseTo(0.03);
    expect(Object.values(poll.shares).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1);
  });

  it("excludes MRPs, non-GB rows and records outside the fieldwork window", () => {
    const recent = recentRoadTo326Polls({ polls: [
      row,
      { ...row, id: "mrp", mrp: true },
      { ...row, id: "uk", area: "UK" },
      { ...row, id: "old", fieldwork_end: "2026-08-01" },
    ] }, { now: "2026-09-09T12:00:00Z", windowDays: 14 });
    expect(recent.map((poll) => poll.poll_id)).toEqual(["road-to-326:example-1"]);
  });

  it("uses the same transparent equal-poll mean as the existing live anchor", () => {
    const left = normaliseRoadTo326Poll(row);
    const right = normaliseRoadTo326Poll({ ...row, id: "example-2", shares: { ...row.shares, lab: 24, con: 22, ref: 24 } });
    const average = averagePollRecords([left, right]);
    expect(average.polls_used).toBe(2);
    expect(average.shares.Labour).toBeGreaterThan(average.shares.Conservative);
    expect(average.fieldwork_window.latest).toBe("2026-09-04");
  });
});
