import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { localElectionTargets, MAJOR_PARTIES } from "../src/lib/localElectionTarget.js";
import { assertBeforeCutoff, CUTOFF, upliftTier } from "../scripts/fit-candidate-engine-2026-10-24.mjs";

const poll = { "Reform UK": 0.25, "Labour": 0.2, "Conservative": 0.2, "Liberal Democrats": 0.12, "Green Party": 0.15, "SNP": 0.03 };
const ge24 = { "Reform UK": 0.14, "Labour": 0.34, "Conservative": 0.24, "Liberal Democrats": 0.12, "Green Party": 0.07 };
const ones = Object.fromEntries(MAJOR_PARTIES.map((p) => [p, 1]));

describe("local-election Final-C target (candidate C2)", () => {
  it("returns the Westminster poll when every area matches GE2024 nationally and every ratio is 1", () => {
    const wards = [{ council_slug: "a", votes: 100, shares: { "Reform UK": 0.5, "Labour": 0.5 } }];
    const t = localElectionTargets(wards, { poll, ge24National: ge24, ratio: ones, areaShares: () => ge24 });
    const majorSum = MAJOR_PARTIES.reduce((s, p) => s + poll[p], 0);
    for (const p of MAJOR_PARTIES) expect(t[p]).toBeCloseTo(poll[p] / majorSum, 10);
    expect(t.SNP).toBe(0.03);
  });

  it("leaves room for the forecast's own non-major share", () => {
    const wards = [{ council_slug: "a", votes: 100, shares: { "Reform UK": 0.4, "Labour": 0.4, "Independent": 0.2 } }];
    const t = localElectionTargets(wards, { poll, ge24National: ge24, ratio: ones, areaShares: () => null });
    expect(MAJOR_PARTIES.reduce((s, p) => s + t[p], 0)).toBeCloseTo(0.8, 10);
  });

  it("weights each council's GE2024 area by its wards' votes", () => {
    const strongLab = { ...ge24, "Labour": 0.68 };
    const wards = [
      { council_slug: "lab", votes: 300, shares: { "Labour": 1 } },
      { council_slug: "avg", votes: 100, shares: { "Labour": 1 } },
    ];
    const t = localElectionTargets(wards, { poll, ge24National: ge24, ratio: ones, areaShares: (s) => (s === "lab" ? strongLab : ge24) });
    const flat = localElectionTargets(wards, { poll, ge24National: ge24, ratio: ones, areaShares: () => ge24 });
    expect(t.Labour).toBeGreaterThan(flat.Labour);
  });
});

describe("candidate fitter guards", () => {
  it("refuses any row polled after the 25 April 2026 cut-off", () => {
    expect(CUTOFF).toBe("2026-04-25");
    expect(() => assertBeforeCutoff([{ election_date: "2026-04-25" }], "x")).not.toThrow();
    expect(() => assertBeforeCutoff([{ election_date: "2026-05-07" }], "x")).toThrow(/hold-out/);
  });

  it("assigns tiers as the 7 May Step 9b did", () => {
    expect(upliftTier("hartlepool")).toBe("northern_unitary");
    expect(upliftTier("camden")).toBe("london");
    expect(upliftTier("leeds")).toBe("metropolitan");
    expect(upliftTier("burnley")).toBe("county_district");
    expect(upliftTier("west-surrey")).toBe("other");
  });
});

describe("recorded candidate score", () => {
  const file = new URL("../data/transparency/may-2026-candidate-2026-10-24.json", import.meta.url);
  it.skipIf(!existsSync(file))("keeps the replayed 7 May engine within a few wards of the published 1,623", () => {
    const doc = JSON.parse(readFileSync(file, "utf8"));
    expect(Math.abs(doc.arms.replay.vote_leader.correct - 1623)).toBeLessThanOrEqual(3);
    expect(doc.arms.replay.vote_leader.wards).toBe(2897);
    expect(doc.arms.candidate.vote_leader.wards).toBe(2897);
  });
});
