import { describe, expect, it } from "vitest";
import {
  PARTIES,
  canonParty,
  normalise,
  sharesFromCandidates,
  fieldFromCandidates,
  baselineEra,
  logit,
  buildSwingCorpus,
  estimateSwing,
  projectContest,
  runDraws,
  backtest,
  calibration,
  PUBLISHED_BANDS,
  assessBaseline,
  SIGMA_INFLATION,
  TOO_CLOSE_TO_CALL,
} from "../scripts/lib/local-byelection-model.mjs";

// A synthetic corpus where the right answer is known by construction. The
// point is that these assertions CAN fail: if the estimator ignored the corpus
// and returned 1.0 for every ratio, or if leave-one-out leaked the contest's
// own answer, the numbers below would move.
function contest(id, date, from, to) {
  const cands = (shares, scale = 1000) =>
    Object.entries(shares).map(([party_name, s]) => ({ party_name, votes: Math.round(s * scale) }));
  return {
    ballot_paper_id: id,
    election_date: date,
    council_slug: id.split(".")[1],
    ward_slug: id.split(".")[2],
    is_by_election: true,
    candidates: cands(to),
    _prior: { election_date: "2025-05-01", candidates: cands(from) },
  };
}
const findPrior = (row) => row._prior;

describe("party canonicalisation", () => {
  it("folds the co-operative label into Labour and keeps Reform and Restore Britain apart", () => {
    expect(canonParty("Labour and Co-operative Party")).toBe("Labour");
    expect(canonParty("Labour Party")).toBe("Labour");
    expect(canonParty("Conservative and Unionist Party")).toBe("Conservative");
    expect(canonParty("Reform UK")).toBe("Reform UK");
    expect(canonParty("Restore Britain")).toBe("Restore Britain");
    expect(canonParty("Restore Britain")).not.toBe(canonParty("Reform UK"));
    expect(canonParty("Scottish National Party (SNP)")).toBe("SNP");
    expect(canonParty("Plaid Cymru")).toBe("Plaid Cymru");
    expect(canonParty("Some Local Residents Group")).toBe("Other");
    expect(canonParty(null)).toBe("Other");
  });
});

describe("shares from a candidate list", () => {
  it("takes each party's strongest candidate in a multi-member ward, not the sum", () => {
    // Three-member ward, full Labour slate. Summing would give Labour 75%.
    const s = sharesFromCandidates([
      { party_name: "Labour Party", votes: 1000 },
      { party_name: "Labour Party", votes: 950 },
      { party_name: "Labour Party", votes: 900 },
      { party_name: "Conservative and Unionist Party", votes: 1000 },
    ]);
    expect(s.Labour).toBeCloseTo(0.5, 6);
    expect(s.Conservative).toBeCloseTo(0.5, 6);
  });

  it("sums independents, because two independents are a real split of the same lane", () => {
    const s = sharesFromCandidates([
      { party_name: "Independent", votes: 300 },
      { party_name: "Independent", votes: 200 },
      { party_name: "Labour Party", votes: 500 },
    ]);
    expect(s.Independent).toBeCloseTo(0.5, 6);
  });

  it("normalises to one and ignores candidates with no vote count", () => {
    const s = sharesFromCandidates([
      { party_name: "Labour Party", votes: 10 },
      { party_name: "Reform UK", votes: null },
    ]);
    expect(PARTIES.reduce((a, p) => a + s[p], 0)).toBeCloseTo(1, 9);
  });

  it("reads the field from nomination papers even before any votes exist", () => {
    const f = fieldFromCandidates([
      { party_name: "Reform UK", votes: null },
      { party_name: "Green Party", votes: null },
    ]);
    expect([...f].sort()).toEqual(["Green Party", "Reform UK"]);
  });
});

describe("baseline era", () => {
  it("splits on the two moments that reordered local voting", () => {
    expect(baselineEra("2022-05-05")).toBe("pre_realignment");
    expect(baselineEra("2024-07-04")).toBe("ge2024_era");
    expect(baselineEra("2025-05-01")).toBe("post_may_2025");
    expect(baselineEra(null)).toBe(null);
  });
});

describe("swing corpus", () => {
  it("pairs each by-election with its prior and drops Scottish STV", () => {
    const rows = [
      contest("local.a.w1.by.2026-01-01", "2026-01-01", { "Labour Party": 0.6, "Reform UK": 0.4 }, { "Labour Party": 0.4, "Reform UK": 0.6 }),
      { ...contest("local.b.w2.by.2026-01-01", "2026-01-01", { "Labour Party": 1 }, { "Labour Party": 1 }), voting_system: "STV" },
    ];
    const corpus = buildSwingCorpus(rows, findPrior);
    expect(corpus).toHaveLength(1);
    expect(corpus[0].era).toBe("post_may_2025");
    expect(corpus[0].reform_entered).toBe(false);
  });

  it("flags a first-time Reform entry", () => {
    const corpus = buildSwingCorpus(
      [contest("local.a.w1.by.2026-01-01", "2026-01-01", { "Labour Party": 1 }, { "Labour Party": 0.6, "Reform UK": 0.4 })],
      findPrior,
    );
    expect(corpus[0].reform_entered).toBe(true);
  });
});

describe("swing estimation", () => {
  // Twelve contests in which Reform doubles its share and Labour halves it.
  const corpus = buildSwingCorpus(
    Array.from({ length: 12 }, (_, i) =>
      contest(`local.c${i}.w.by.2026-0${1 + (i % 3)}-01`, `2026-0${1 + (i % 3)}-01`,
        { "Labour Party": 0.6, "Reform UK": 0.2, "Conservative and Unionist Party": 0.2 },
        { "Labour Party": 0.3, "Reform UK": 0.4, "Conservative and Unionist Party": 0.3 }),
    ),
    findPrior,
  );

  it("recovers the swing that is actually in the corpus", () => {
    const s = estimateSwing(corpus, { asOf: "2026-06-01" });
    // Reform 20% to 40% and Labour 60% to 30%, as log-odds shifts.
    expect(s.shifts["Reform UK"]).toBeCloseTo(logit(0.4) - logit(0.2), 6);
    expect(s.shifts.Labour).toBeCloseTo(logit(0.3) - logit(0.6), 6);
    expect(s.n).toBe(12);
  });

  it("cannot push a party off the end of the scale, which a share ratio can", () => {
    // Manchester Burnage: the Greens went into the by-election on 45.8% and the
    // median Green share ratio of 1.76 would have projected them to 65.6%.
    const s = estimateSwing(corpus, { asOf: "2026-06-01" });
    const big = projectContest(normalise({ "Reform UK": 0.458, Labour: 0.542 }), new Set(["Reform UK", "Labour"]), s);
    // The same shift that doubles a party on 20% must move one on 45.8% far less.
    const small = projectContest(normalise({ "Reform UK": 0.2, Labour: 0.8 }), new Set(["Reform UK", "Labour"]), s);
    const bigGain = big.central["Reform UK"] / 0.458;
    const smallGain = small.central["Reform UK"] / 0.2;
    expect(smallGain).toBeGreaterThan(bigGain);
    for (const p of PARTIES) {
      expect(big.central[p]).toBeLessThanOrEqual(1);
      expect(big.central[p]).toBeGreaterThanOrEqual(0);
    }
  });

  it("never uses a contest that had not yet polled", () => {
    const s = estimateSwing(corpus, { asOf: "2026-01-01" });
    expect(s.n).toBe(0);
    expect(s.shifts["Reform UK"]).toBeUndefined();
  });

  it("falls back from a thin stratum to the pooled sample and says which it used", () => {
    const thin = estimateSwing(corpus, { asOf: "2026-06-01", era: "pre_realignment" });
    expect(thin.stratum).toBe("pooled");
    expect(thin.stratum_used).toBe(false);
    const fat = estimateSwing(corpus, { asOf: "2026-06-01", era: "post_may_2025" });
    expect(fat.stratum).toBe("post_may_2025");
    expect(fat.stratum_used).toBe(true);
  });

  it("prices a first-time entrant from what entrants actually score", () => {
    const entryCorpus = buildSwingCorpus(
      Array.from({ length: 10 }, (_, i) =>
        contest(`local.e${i}.w.by.2026-02-01`, "2026-02-01",
          { "Labour Party": 0.7, "Conservative and Unionist Party": 0.3 },
          { "Labour Party": 0.4, "Conservative and Unionist Party": 0.3, "Reform UK": 0.3 }),
      ),
      findPrior,
    );
    const s = estimateSwing(entryCorpus, { asOf: "2026-06-01" });
    expect(s.entry["Reform UK"]).toBeCloseTo(0.3, 2);
    expect(s.shifts["Reform UK"]).toBeUndefined();
  });
});

describe("projection", () => {
  const corpus = buildSwingCorpus(
    Array.from({ length: 12 }, (_, i) =>
      contest(`local.c${i}.w.by.2026-02-01`, "2026-02-01",
        { "Labour Party": 0.6, "Reform UK": 0.2, "Conservative and Unionist Party": 0.2 },
        { "Labour Party": 0.3, "Reform UK": 0.4, "Conservative and Unionist Party": 0.3 }),
    ),
    findPrior,
  );
  const swing = estimateSwing(corpus, { asOf: "2026-06-01" });

  it("reproduces the corpus swing on a ward that matches the corpus baseline", () => {
    const base = sharesFromCandidates([
      { party_name: "Labour Party", votes: 600 },
      { party_name: "Reform UK", votes: 200 },
      { party_name: "Conservative and Unionist Party", votes: 200 },
    ]);
    const { central } = projectContest(base, new Set(["Labour", "Reform UK", "Conservative"]), swing);
    expect(central["Reform UK"]).toBeCloseTo(0.4, 2);
    expect(central.Labour).toBeCloseTo(0.3, 2);
  });

  it("gives a party that is not standing exactly nothing", () => {
    const base = { ...normalise({ Labour: 0.6, "Reform UK": 0.2, Conservative: 0.2 }) };
    const { central } = projectContest(base, new Set(["Labour", "Conservative"]), swing);
    expect(central["Reform UK"]).toBe(0);
    expect(central.Labour + central.Conservative).toBeCloseTo(1, 9);
  });

  it("declines to price an entrant the corpus cannot price, rather than inventing one", () => {
    const base = normalise({ Labour: 0.6, Conservative: 0.4 });
    const { central, unpriced } = projectContest(base, new Set(["Labour", "Conservative", "Plaid Cymru"]), swing);
    expect(unpriced).toContain("Plaid Cymru");
    expect(central["Plaid Cymru"]).toBe(0);
  });
});

describe("uncertainty", () => {
  const swing = { shifts: {}, ratios: {}, sigmas: { Labour: 0.6, "Reform UK": 0.6 }, entry: {}, counts: {} };
  const central = normalise({ Labour: 0.505, "Reform UK": 0.495 });

  it("is deterministic for a given contest", () => {
    const a = runDraws(central, swing, "seed-one");
    const b = runDraws(central, swing, "seed-one");
    expect(a.win_probability).toEqual(b.win_probability);
    expect(runDraws(central, swing, "seed-two").win_probability).not.toEqual(a.win_probability);
  });

  it("returns probabilities that sum to one", () => {
    const d = runDraws(central, swing, "sum");
    expect(Object.values(d.win_probability).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });

  it("calls a near tie too close, and a rout not", () => {
    expect(runDraws(central, swing, "tie").too_close_to_call).toBe(true);
    const rout = normalise({ Labour: 0.75, "Reform UK": 0.25 });
    const d = runDraws(rout, swing, "rout");
    expect(d.too_close_to_call).toBe(false);
    expect(d.leader_probability).toBeGreaterThan(TOO_CLOSE_TO_CALL);
  });

  it("widens the band by the fitted calibration factor, which is the whole point of it", () => {
    const tight = runDraws(central, swing, "x", 4000, 1);
    const wide = runDraws(central, swing, "x", 4000, SIGMA_INFLATION);
    expect(SIGMA_INFLATION).toBeGreaterThan(1);
    const span = (d) => d.bands.Labour.p90 - d.bands.Labour.p10;
    expect(span(wide)).toBeGreaterThan(span(tight));
  });
});

describe("baseline gate", () => {
  const swing = { n: 50 };
  const goodPrior = { election_date: "2025-05-01", candidates: [{ votes: 10 }, { votes: 5 }] };
  const field = new Set(["Labour", "Reform UK"]);

  it("passes a recent like-for-like baseline", () => {
    expect(assessBaseline({ prior: goodPrior, field, swing, votingSystem: "FPTP", boundaryChanged: false, fieldLocked: true }).forecastable).toBe(true);
  });

  it("blocks Scottish STV, a changed boundary, a missing prior and a stale one", () => {
    const cases = [
      { prior: goodPrior, votingSystem: "STV", boundaryChanged: false, fieldLocked: true },
      { prior: goodPrior, votingSystem: "FPTP", boundaryChanged: true, fieldLocked: true },
      { prior: null, votingSystem: "FPTP", boundaryChanged: false, fieldLocked: true },
      { prior: { election_date: "2015-05-07", candidates: [{ votes: 10 }, { votes: 5 }] }, votingSystem: "FPTP", boundaryChanged: false, fieldLocked: true },
    ];
    for (const c of cases) {
      const a = assessBaseline({ ...c, field, swing });
      expect(a.forecastable).toBe(false);
      expect(a.blockers.length).toBeGreaterThan(0);
    }
  });

  it("refuses to project a ballot paper that is not final", () => {
    // Before nominations close, a party absent from the list has not filed yet,
    // and the projection gives anything outside the field zero. Publishing that
    // would be wrong structurally, not noisily, and it is what an automated
    // post would pick up.
    const open = assessBaseline({ prior: goodPrior, field, swing, votingSystem: "FPTP", boundaryChanged: false, fieldLocked: false });
    expect(open.forecastable).toBe(false);
    expect(open.blockers.join(" ")).toMatch(/nominations have not closed/i);
    // The same contest with a locked ballot is fine.
    expect(assessBaseline({ prior: goodPrior, field, swing, votingSystem: "FPTP", boundaryChanged: false, fieldLocked: true }).forecastable).toBe(true);
  });

  it("blocks when the corpus in the window is too thin to measure a swing", () => {
    expect(assessBaseline({ prior: goodPrior, field, swing: { n: 2 }, votingSystem: "FPTP", boundaryChanged: false, fieldLocked: true }).forecastable).toBe(false);
  });
});

describe("back-test", () => {
  const corpus = buildSwingCorpus(
    Array.from({ length: 30 }, (_, i) =>
      contest(`local.b${i}.w.by.2026-0${1 + (i % 6)}-01`, `2026-0${1 + (i % 6)}-01`,
        { "Labour Party": 0.6, "Reform UK": 0.4 },
        { "Labour Party": 0.4, "Reform UK": 0.6 }),
    ),
    findPrior,
  );

  it("scores a corpus it can learn perfectly at close to zero error", () => {
    const bt = backtest(corpus);
    expect(bt.n).toBeGreaterThan(0);
    expect(bt.mae_pp).toBeLessThan(1);
    expect(bt.winner_called).toBe(bt.n);
  });

  it("holds each contest out of its own estimate", () => {
    // One contest breaks the pattern completely. If leave-one-out were not
    // working it would learn from itself and score near zero; held out, it is
    // projected from the other 29 and is badly wrong.
    const odd = contest("local.odd.w.by.2026-06-15", "2026-06-15",
      { "Labour Party": 0.6, "Reform UK": 0.4 },
      { "Labour Party": 0.95, "Reform UK": 0.05 });
    const bt = backtest(buildSwingCorpus([...corpus.map((c) => ({
      ballot_paper_id: c.ballot_paper_id,
      election_date: c.date,
      council_slug: c.council_slug,
      ward_slug: c.ward_slug,
      is_by_election: true,
      candidates: Object.entries(c.to).filter(([, v]) => v > 0).map(([party_name, v]) => ({ party_name, votes: Math.round(v * 1000) })),
      _prior: { election_date: "2025-05-01", candidates: Object.entries(c.from).filter(([, v]) => v > 0).map(([party_name, v]) => ({ party_name, votes: Math.round(v * 1000) })) },
    })), odd], findPrior));
    const row = bt.rows.find((r) => r.ballot_paper_id === "local.odd.w.by.2026-06-15");
    expect(row).toBeDefined();
    expect(row.mae_pp).toBeGreaterThan(20);
    expect(row.projected_winner).not.toBe(row.actual_winner);
  });

  it("reports the recent regime separately from the whole archive", () => {
    const bt = backtest(corpus);
    expect(bt.recent_since).toBe("2025-05-01");
    expect(bt.recent.n).toBeGreaterThan(0);
    expect(bt.recent.winner_called_pct).toBeGreaterThanOrEqual(0);
    expect(bt.recent.winner_called_pct).toBeLessThanOrEqual(1);
  });
});

describe("calibration table", () => {
  it("publishes wide bands, because narrow ones are mostly sampling noise", () => {
    // Ten-point bands left single-digit samples and produced an inversion that
    // read as the model contradicting itself.
    expect(PUBLISHED_BANDS.length).toBeLessThanOrEqual(4);
    expect(PUBLISHED_BANDS[0][0]).toBeLessThan(PUBLISHED_BANDS[0][1]);
    expect(PUBLISHED_BANDS.at(-1)[1]).toBeGreaterThan(1);
  });

  it("reports stated against observed, and is empty rather than misleading when thin", () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      leader_probability: 0.85,
      projected_winner: "Labour",
      actual_winner: i < 17 ? "Labour" : "Reform UK",
    }));
    const table = calibration(rows);
    const band = table.find((b) => b.from === 0.7);
    expect(band.n).toBe(20);
    expect(band.observed).toBeCloseTo(0.85, 2);
    expect(band.standard_error).toBeGreaterThan(0);
    expect(calibration([])).toEqual([]);
  });

  it("names the strongest lane by win probability, not central share", () => {
    // A fat-variance lane on a lower central share that wins the most draws.
    // With the old central-share ordering this fixture returned Labour as
    // winner while the probability table led with Reform UK, which is exactly
    // the page-contradicts-its-own-table defect found on the Dover and
    // Llantwit Fardre contests on 23 Aug 2026. Verified divergent: Labour has
    // the highest central (0.29) and Reform UK the highest win probability.
    const central = { Labour: 0.29, Conservative: 0.28, "Green Party": 0.27, "Reform UK": 0.16 };
    const swing = { sigmas: { Labour: 0.04, Conservative: 0.04, "Green Party": 0.04, "Reform UK": 1.5 } };
    const d = runDraws(central, swing, "fixture-0.16-1.5");
    const probMax = Object.entries(d.win_probability).sort((a, b) => b[1] - a[1])[0];
    expect(probMax[0]).toBe("Reform UK");
    expect(probMax[0]).not.toBe("Labour"); // proves the fixture actually diverges
    expect(d.winner).toBe(probMax[0]);
    expect(d.leader_probability).toBe(probMax[1]);
    // margin_pp keeps describing the central projection's top-two gap.
    expect(d.margin_pp).toBeCloseTo((0.29 - 0.28) * 100, 5);
  });
});
