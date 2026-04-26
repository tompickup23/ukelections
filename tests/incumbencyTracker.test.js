import { describe, it, expect } from "vitest";
import { applyIncumbencyAdjustment, buildMpRosterFromGe2024 } from "../src/lib/incumbencyTracker.js";

describe("applyIncumbencyAdjustment", () => {
  it("adds personal vote to a long-tenure incumbent standing again", () => {
    const shares = { Labour: 0.40, Conservative: 0.30, "Liberal Democrats": 0.20, "Reform UK": 0.10 };
    const mp = { party: "Labour", tenure_years: 25, status: "standing_again" };
    const r = applyIncumbencyAdjustment(shares, mp);
    expect(r.applied).not.toBeNull();
    expect(r.applied.party).toBe("Labour");
    expect(r.applied.delta).toBeCloseTo(0.04, 4);
    expect(r.shares.Labour).toBeCloseTo(0.44, 4);
  });

  it("applies retirement drag when MP is standing down", () => {
    const shares = { Labour: 0.40, Conservative: 0.30 };
    const mp = { party: "Labour", tenure_years: 15, status: "retiring" };
    const r = applyIncumbencyAdjustment(shares, mp);
    expect(r.applied?.delta).toBeCloseTo(-0.025, 4);
    expect(r.shares.Labour).toBeCloseTo(0.375, 4);
  });

  it("treats defected/suspended MPs as fresh open seat", () => {
    const shares = { Labour: 0.40, Conservative: 0.30 };
    const mp = { party: "Labour", tenure_years: 8, status: "defected" };
    const r = applyIncumbencyAdjustment(shares, mp);
    expect(r.applied?.delta).toBeCloseTo(-0.015, 4);
  });

  it("returns no-op when MP info is missing", () => {
    const shares = { Labour: 0.50, Conservative: 0.50 };
    const r = applyIncumbencyAdjustment(shares, null);
    expect(r.applied).toBeNull();
    expect(r.shares.Labour).toBe(0.50);
  });

  it("scales personal vote with tenure", () => {
    const shares = { Labour: 0.40 };
    const mpShort = { party: "Labour", tenure_years: 3, status: "standing_again" };
    const mpMid = { party: "Labour", tenure_years: 12, status: "standing_again" };
    const mpLong = { party: "Labour", tenure_years: 25, status: "standing_again" };
    expect(applyIncumbencyAdjustment(shares, mpShort).applied.delta).toBeCloseTo(0.01, 4);
    expect(applyIncumbencyAdjustment(shares, mpMid).applied.delta).toBeCloseTo(0.03, 4);
    expect(applyIncumbencyAdjustment(shares, mpLong).applied.delta).toBeCloseTo(0.04, 4);
  });
});

describe("buildMpRosterFromGe2024", () => {
  it("derives roster from GE2024 winner data", () => {
    const pcons = [
      { slug: "burnley", ge2024: { winner_party: "Labour", winner_name: "Oliver Ryan" } },
      { slug: "ribble-valley", ge2024: { winner_party: "Labour", winner_name: "Maya Ellis" } },
    ];
    const roster = buildMpRosterFromGe2024(pcons, []);
    expect(roster.burnley?.party).toBe("Labour");
    expect(roster.burnley?.name).toBe("Oliver Ryan");
    expect(roster.burnley?.source).toBe("ge_2024");
    expect(roster.burnley?.status).toBe("standing_again");
  });

  it("overrides with by-election winner where one exists post-2024-07-04", () => {
    const pcons = [{ slug: "runcorn-and-helsby", ge2024: { winner_party: "Labour", winner_name: "Mike Amesbury" } }];
    const byElections = [{
      ward_slug: "runcorn-and-helsby",
      election_date: "2025-05-01",
      is_by_election: true,
      candidates: [
        { name: "Sarah Pochin", party_name: "Reform UK", votes: 12645 },
        { name: "Karen Shore", party_name: "Labour", votes: 12639 },
      ],
    }];
    const roster = buildMpRosterFromGe2024(pcons, byElections);
    expect(roster["runcorn-and-helsby"].party).toBe("Reform UK");
    expect(roster["runcorn-and-helsby"].name).toBe("Sarah Pochin");
    expect(roster["runcorn-and-helsby"].source).toBe("by_election");
  });

  it("applies a status override from the standingDownMap", () => {
    const pcons = [{ slug: "x", ge2024: { winner_party: "Labour" } }];
    const r = buildMpRosterFromGe2024(pcons, [], { x: { status: "retiring" } });
    expect(r.x.status).toBe("retiring");
  });
});
