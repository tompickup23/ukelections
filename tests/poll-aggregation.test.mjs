import { describe, expect, it } from "vitest";
import { aggregatePolls, pollWeight } from "../scripts/lib/poll-aggregation.mjs";

const poll = {
  poll_id: "poll-1",
  fieldwork_end: "2026-04-10",
  sample_size: 1600,
  party_shares: { A: 0.6, B: 0.4 }
};

describe("poll aggregation", () => {
  it("weights newer polls more than older polls with the same sample", () => {
    const newer = pollWeight(poll, "2026-04-12T00:00:00Z", 21);
    const older = pollWeight({ ...poll, fieldwork_end: "2026-03-01" }, "2026-04-12T00:00:00Z", 21);
    expect(newer).toBeGreaterThan(older);
  });

  it("builds normalised aggregate shares", () => {
    const result = aggregatePolls([
      poll,
      { ...poll, poll_id: "poll-2", party_shares: { A: 0.4, B: 0.6 } }
    ], { generatedAt: "2026-04-12T00:00:00Z" });
    const total = Object.values(result.aggregate_party_shares).reduce((sum, value) => sum + value, 0);
    expect(result.poll_count).toBe(2);
    expect(total).toBeCloseTo(1);
  });
});
