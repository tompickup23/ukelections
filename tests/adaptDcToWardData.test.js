import { describe, it, expect } from "vitest";
import { buildWardData, buildAllWardData, partiesOnBallotCanonical, restrictToBallot } from "../src/lib/adaptDcToWardData.js";

const identityWard = {
  ballot_paper_id: "local.adur.buckingham.2026-05-07",
  gss_code: "E05007562",
  ward_name: "Buckingham",
  ward_slug: "buckingham",
  council_slug: "adur",
  council_name: "Adur",
  tier: "local",
  election_group_id: "local.adur.2026-05-07",
  winner_count: 1,
  cancelled: false,
  parties_standing: ["Conservative and Unionist Party", "Reform UK", "Labour Party"],
  sopn_url: "https://example.com/sopn.pdf",
};

const historyBundle = {
  by_ballot: {
    "local.adur.buckingham.2022-05-05": {
      ballot_paper_id: "local.adur.buckingham.2022-05-05",
      election_date: "2022-05-05",
      year: 2022,
      tier: "local",
      council_slug: "adur",
      ward_slug: "buckingham",
      is_by_election: false,
      turnout_votes: 1500,
      turnout_pct: 0.42,
      electorate: 3571,
      source: "https://example.com/2022.pdf",
      candidates: [
        { name: "A. Smith", party_name: "Conservative and Unionist Party", votes: 800, elected: true },
        { name: "B. Jones", party_name: "Labour Party", votes: 500, elected: false },
        { name: "C. Patel", party_name: "Liberal Democrats", votes: 200, elected: false },
      ],
    },
    "local.adur.buckingham.by.2024-03-14": {
      ballot_paper_id: "local.adur.buckingham.by.2024-03-14",
      election_date: "2024-03-14",
      year: 2024,
      tier: "local",
      council_slug: "adur",
      ward_slug: "buckingham",
      is_by_election: true,
      turnout_votes: 900,
      turnout_pct: 0.25,
      electorate: 3580,
      source: "https://example.com/2024by.pdf",
      candidates: [
        { name: "D. Reform", party_name: "Reform UK", votes: 400, elected: true },
        { name: "A. Smith", party_name: "Conservative and Unionist Party", votes: 350, elected: false },
        { name: "B. Jones", party_name: "Labour Party", votes: 150, elected: false },
      ],
    },
  },
  by_ward_slug: {
    "local::adur::buckingham": [
      "local.adur.buckingham.2022-05-05",
      "local.adur.buckingham.by.2024-03-14",
    ],
  },
};

describe("buildWardData", () => {
  it("merges DC identity + history into AI DOGE wardData shape", () => {
    const wd = buildWardData(identityWard, historyBundle);
    expect(wd.gss_code).toBe("E05007562");
    expect(wd.council_slug).toBe("adur");
    expect(wd.seats).toBe(1);
    expect(wd.history).toHaveLength(2);
    expect(wd.history[0].date).toBe("2022-05-05");
    expect(wd.history[0].type).toBe("borough");
    expect(wd.history[1].type).toBe("by-election");
  });

  it("ranks candidates and computes pct", () => {
    const wd = buildWardData(identityWard, historyBundle);
    const top = wd.history[0].candidates[0];
    expect(top.party).toBe("Conservative");
    expect(top.party_dc).toBe("Conservative and Unionist Party");
    expect(top.elected).toBe(true);
    expect(top.pct).toBeCloseTo(800 / 1500, 4);
  });

  it("computes majority correctly", () => {
    const wd = buildWardData(identityWard, historyBundle);
    expect(wd.history[0].majority).toBe(300);
  });

  it("returns empty history for unmatched ward", () => {
    const orphan = { ...identityWard, ward_slug: "nonexistent" };
    const wd = buildWardData(orphan, historyBundle);
    expect(wd.history).toHaveLength(0);
    expect(wd._meta.history_count).toBe(0);
  });

  it("emits 2026 candidates from parties_standing", () => {
    const wd = buildWardData(identityWard, historyBundle);
    expect(wd.candidates_2026).toHaveLength(3);
    expect(wd.candidates_2026.map((c) => c.party)).toContain("Reform UK");
  });

  it("buildAllWardData returns a Map keyed by ballot_paper_id", () => {
    const identity = { wards: [identityWard] };
    const map = buildAllWardData(identity, historyBundle);
    expect(map.size).toBe(1);
    expect(map.get("local.adur.buckingham.2026-05-07")?.gss_code).toBe("E05007562");
  });
});

describe("partiesOnBallotCanonical", () => {
  it("canonicalises DC party names to AI DOGE labels", () => {
    const w = { parties_standing: ["Conservative and Unionist Party", "Labour Party", "Reform UK", "Liberal Democrats"] };
    const out = partiesOnBallotCanonical(w);
    expect(out).toContain("Conservative");
    expect(out).toContain("Labour");
    expect(out).toContain("Reform UK");
    expect(out).toContain("Liberal Democrats");
    expect(out).not.toContain("Conservative and Unionist Party");
  });

  it("dedupes when DC variants collapse to the same canonical", () => {
    const w = { parties_standing: ["Labour Party", "Labour and Co-operative Party"] };
    const out = partiesOnBallotCanonical(w);
    expect(out).toEqual(["Labour"]);
  });

  it("returns empty array when parties_standing absent", () => {
    expect(partiesOnBallotCanonical({})).toEqual([]);
  });
});

describe("restrictToBallot", () => {
  const prediction = {
    "Liberal Democrats": { pct: 0.381, votes: 533 },
    "Labour": { pct: 0.253, votes: 354 },
    "Reform UK": { pct: 0.149, votes: 208 },
    "Conservative": { pct: 0.142, votes: 199 },
    "Green Party": { pct: 0.075, votes: 105 },
  };

  it("keeps standing parties and redistributes non-standing share pro-rata", () => {
    const onBallot = new Set(["Conservative", "Labour", "Liberal Democrats", "Reform UK"]);
    const { prediction: out, dropped } = restrictToBallot(prediction, onBallot);
    expect(dropped.map((d) => d.party)).toEqual(["Green Party"]);
    expect(Object.keys(out).sort()).toEqual([...onBallot].sort());
    const total = Object.values(out).reduce((s, p) => s + p.pct, 0);
    expect(total).toBeCloseTo(1.0, 5);
  });

  it("dropped Greens 7.5pp redistributed proportionally to the four kept parties", () => {
    const onBallot = new Set(["Conservative", "Labour", "Liberal Democrats", "Reform UK"]);
    const { prediction: out } = restrictToBallot(prediction, onBallot);
    // Pre-redistribution kept sum = 1 - 0.075 = 0.925; LD 0.381/0.925 = 0.412
    expect(out["Liberal Democrats"].pct).toBeCloseTo(0.412, 2);
    // Non-standing parties not present
    expect(out["Green Party"]).toBeUndefined();
  });

  it("adds parties on the ballot that have no historical baseline at a small floor", () => {
    const onBallot = new Set(["Labour", "Reform UK", "Brand New Local Party"]);
    const { prediction: out } = restrictToBallot(
      { "Labour": { pct: 0.6, votes: 600 }, "Reform UK": { pct: 0.4, votes: 400 } },
      onBallot,
    );
    expect(out["Brand New Local Party"]).toBeDefined();
    expect(out["Brand New Local Party"].pct).toBeGreaterThan(0);
  });

  it("returns null prediction unchanged", () => {
    expect(restrictToBallot(null, new Set(["Labour"])).prediction).toBe(null);
  });
});
