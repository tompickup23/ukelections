import { describe, expect, it } from "vitest";
import {
  wilsonInterval,
  reliability,
  toLanes,
  probabilityViolations,
  calibration,
  PUBLISHED_BANDS,
  RELIABILITY_BANDS,
  SHARE_BANDS,
} from "../scripts/lib/local-byelection-model.mjs";

// Every guard here is paired with a fixture built to make it FIRE. A check that
// passes on real data proves nothing on its own: the published three-band
// calibration table passed every day while being structurally incapable of
// reporting on three quarters of the probabilities on the same page. So each
// describe block below contains at least one "and it fires when" case, and if
// the guard were deleted or weakened that case is the one that breaks.

describe("wilsonInterval", () => {
  it("never returns a negative lower bound at the extreme tail", () => {
    // The normal approximation gives phat - 1.96*sqrt(...) < 0 here, which is
    // where a reliability table on small-party lanes actually lives.
    const [lo, hi] = wilsonInterval(1, 218);
    expect(lo).toBeGreaterThan(0);
    expect(lo).toBeLessThan(0.01);
    expect(hi).toBeGreaterThan(0.02);
    expect(hi).toBeLessThan(0.03);
  });

  it("brackets the point estimate and narrows as n grows", () => {
    const [lo10, hi10] = wilsonInterval(5, 10);
    const [lo1000, hi1000] = wilsonInterval(500, 1000);
    expect(lo10).toBeLessThan(0.5);
    expect(hi10).toBeGreaterThan(0.5);
    expect(hi1000 - lo1000).toBeLessThan(hi10 - lo10);
  });

  it("returns nulls rather than dividing by zero on an empty band", () => {
    expect(wilsonInterval(0, 0)).toEqual([null, null]);
  });
});

describe("reliability", () => {
  /** n rows all claiming `claimed`, of which `wins` actually won. */
  const band = (claimed, n, wins) =>
    Array.from({ length: n }, (unused, i) => ({ claimed, won: i < wins ? 1 : 0 }));

  it("marks a band honest when the claim sits inside the interval", () => {
    // Claim 50% on 200 lanes, 100 of them win. Nothing to complain about.
    const table = reliability(band(0.5, 200, 100), { bands: [[0.5, 0.6]] });
    expect(table).toHaveLength(1);
    expect(table[0].n).toBe(200);
    expect(table[0].observed).toBeCloseTo(0.5, 6);
    expect(table[0].honest).toBe(true);
  });

  it("and it fires when the claim escapes the interval", () => {
    // The fixture that must fail: claim 50% on 200 lanes and win 10 of them.
    // If `honest` cannot go false here, it can never go false at all.
    const table = reliability(band(0.5, 200, 10), { bands: [[0.5, 0.6]] });
    expect(table[0].observed).toBeCloseTo(0.05, 6);
    expect(table[0].honest).toBe(false);
    expect(table[0].mean_claimed).toBeGreaterThan(table[0].ci_high);
  });

  it("and it fires in the other direction, on an understated claim", () => {
    const table = reliability(band(0.05, 200, 100), { bands: [[0.05, 0.1]] });
    expect(table[0].honest).toBe(false);
    expect(table[0].mean_claimed).toBeLessThan(table[0].ci_low);
  });

  it("separates the binning field from the field under test", () => {
    // The units bug this option exists to prevent. Rows are grouped by a
    // projected SHARE in percentage points; the claim under test is a
    // probability. Binning and claiming on one field compares 7.5pp against a
    // win rate and reports a mean claim of 750%.
    const rows = Array.from({ length: 100 }, (unused, i) => ({
      central_pp: 7.5,
      claimed: 0.02,
      won: i < 1 ? 1 : 0,
    }));
    const wrong = reliability(rows, { bands: [[5, 10]], binKey: "central_pp", clampTo: 100 });
    expect(wrong[0].mean_claimed).toBeCloseTo(7.5, 6); // a share, not a probability

    const right = reliability(rows, {
      bands: [[5, 10]], binKey: "central_pp", claimKey: "claimed", clampTo: 100,
    });
    expect(right[0].mean_claimed).toBeCloseTo(0.02, 6);
    expect(right[0].observed).toBeCloseTo(0.01, 6);
    expect(right[0].n).toBe(100);
  });

  it("clamps the top label to the scale it was given", () => {
    const rows = band(0.95, 10, 9);
    const prob = reliability(rows, { bands: [[0.9, 1.0001]] });
    expect(prob[0].to).toBe(1);
    const shares = reliability(
      [{ central_pp: 60, claimed: 0.8, won: 1 }],
      { bands: [[50, 100.01]], binKey: "central_pp", claimKey: "claimed", clampTo: 100 },
    );
    expect(shares[0].to).toBe(100);
  });

  it("suppresses the honest verdict where claim and outcome are different kinds of number", () => {
    const table = reliability([{ central_pp: 7.5, won: 0 }], {
      bands: [[5, 10]], binKey: "central_pp", clampTo: 100, comparable: false,
    });
    expect(table[0].honest).toBeNull();
  });

  it("skips empty bands rather than emitting a row with n=0", () => {
    expect(reliability(band(0.5, 10, 5), { bands: [[0.9, 1]] })).toEqual([]);
  });
});

describe("the published table's blind spot", () => {
  it("cannot report on a lane below 30% however wrong that lane is", () => {
    // Twenty contests where the named favourite was given 20% and every one of
    // them lost. PUBLISHED_BANDS starts at 0.3, so the published table sees
    // nothing at all. This is the structural reason the tail needed its own
    // table: no input can make this row appear.
    const rows = Array.from({ length: 20 }, (unused, i) => ({
      leader_probability: 0.2,
      projected_winner: "Reform UK",
      actual_winner: "Labour",
      ballot_paper_id: `fixture.${i}`,
    }));
    expect(calibration(rows, PUBLISHED_BANDS)).toEqual([]);

    // The full-range bands do see it, and call it dishonest.
    const full = reliability(rows, {
      bands: RELIABILITY_BANDS,
      binKey: "leader_probability",
      hit: (r) => r.projected_winner === r.actual_winner,
    });
    expect(full).toHaveLength(1);
    expect(full[0].n).toBe(20);
    expect(full[0].observed).toBe(0);
    expect(full[0].honest).toBe(false);
  });

  it("covers the whole unit interval with no gap and no overlap", () => {
    // A band table with a hole in it silently drops lanes, which would show up
    // as a reliability table whose rows do not sum to the lane count.
    expect(RELIABILITY_BANDS[0][0]).toBe(0);
    expect(RELIABILITY_BANDS.at(-1)[1]).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < RELIABILITY_BANDS.length; i++) {
      expect(RELIABILITY_BANDS[i][0]).toBe(RELIABILITY_BANDS[i - 1][1]);
    }
    expect(SHARE_BANDS[0][0]).toBe(0);
    for (let i = 1; i < SHARE_BANDS.length; i++) {
      expect(SHARE_BANDS[i][0]).toBe(SHARE_BANDS[i - 1][1]);
    }
  });

  it("loses no rows: band counts sum to the input count", () => {
    const rows = [0.01, 0.07, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95, 1]
      .map((claimed, i) => ({ claimed, won: i % 2 }));
    const table = reliability(rows, { bands: RELIABILITY_BANDS });
    expect(table.reduce((a, r) => a + r.n, 0)).toBe(rows.length);
  });
});

describe("toLanes", () => {
  const row = (id, wp, winner) => ({
    ballot_paper_id: id,
    date: "2026-01-01",
    actual_winner: winner,
    win_probability: wp,
    central_shares: {},
    actual_shares: {},
  });

  it("returns one row per party-contest, not one per contest", () => {
    const rows = [
      row("a", { "Reform UK": 0.6, Labour: 0.3, "Green Party": 0.1 }, "Reform UK"),
      row("b", { Labour: 0.7, Conservative: 0.3 }, "Conservative"),
    ];
    const lanes = toLanes(rows);
    expect(lanes).toHaveLength(5); // 3 + 2, NOT 2
    expect(lanes.filter((l) => l.won).length).toBe(2); // one winner per contest
  });

  it("scores the lane, not the contest: the favourite losing is a zero", () => {
    const lanes = toLanes([row("b", { Labour: 0.7, Conservative: 0.3 }, "Conservative")]);
    expect(lanes.find((l) => l.party === "Labour").won).toBe(0);
    expect(lanes.find((l) => l.party === "Conservative").won).toBe(1);
  });

  it("ignores rows with no probability map rather than inventing lanes", () => {
    expect(toLanes([{ ballot_paper_id: "c", actual_winner: "Labour" }])).toEqual([]);
  });
});

describe("probabilityViolations", () => {
  const clean = {
    ballot_paper_id: "clean",
    actual_winner: "Labour",
    win_probability: { Labour: 0.6, "Reform UK": 0.4 },
  };

  it("passes a well formed contest", () => {
    expect(probabilityViolations([clean])).toEqual([]);
  });

  it("and it fires on a probability outside zero to one", () => {
    const bad = { ...clean, win_probability: { Labour: 1.4, "Reform UK": -0.4 } };
    const kinds = probabilityViolations([bad]).map((v) => v.kind);
    expect(kinds).toContain("probability_out_of_range");
    expect(kinds.filter((k) => k === "probability_out_of_range")).toHaveLength(2);
  });

  it("and it fires when the lane probabilities do not sum to one", () => {
    const bad = { ...clean, win_probability: { Labour: 0.6, "Reform UK": 0.6 } };
    const v = probabilityViolations([bad]);
    expect(v.map((x) => x.kind)).toContain("probabilities_do_not_sum_to_one");
    expect(v.find((x) => x.kind === "probabilities_do_not_sum_to_one").value).toBeCloseTo(1.2, 6);
  });

  it("and it fires when the party that actually won was given no lane at all", () => {
    // The real defect this caught. A party standing in a ward with no prior
    // result and no priceable entry share is deleted from the projection, so
    // the page publishes a complete-looking set of chances that omits it. Three
    // contests in the corpus were won by a party in exactly that position.
    const bad = {
      ballot_paper_id: "local.great-yarmouth.caister-south.by.2026-05-07",
      actual_winner: "Other",
      win_probability: { "Reform UK": 0.55, Conservative: 0.3, "Green Party": 0.1, Labour: 0.05 },
    };
    const v = probabilityViolations([bad]);
    expect(v).toHaveLength(1);
    expect(v[0].kind).toBe("winner_had_no_lane");
    expect(v[0].party).toBe("Other");
  });

  it("does not confuse a zero-probability lane with a missing one", () => {
    // A party given 0% IS on the table and is honest about its chance. Only an
    // absent key is the defect.
    const zeroed = {
      ballot_paper_id: "zeroed",
      actual_winner: "Green Party",
      win_probability: { Labour: 1, "Green Party": 0 },
    };
    expect(probabilityViolations([zeroed])).toEqual([]);
  });

  it("skips rows carrying no probability map", () => {
    expect(probabilityViolations([{ ballot_paper_id: "x", actual_winner: "Labour" }])).toEqual([]);
  });
});
