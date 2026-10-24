import { describe, expect, it } from "vitest";
import {
  ACTUALS_PATH,
  POSTAUDIT_PATH,
  poolParty,
  pooledShares,
  readJson,
  scorePublishedVersion,
  topParty,
} from "../scripts/score-may-2026-like-for-like.mjs";

// Shares come from git history, which CI's shallow checkout lacks, so the
// reproduction runs on the post-audit rows alone.
const postaudit = readJson(POSTAUDIT_PATH);
const actuals = readJson(ACTUALS_PATH).by_ballot;

describe("May 2026 like-for-like score", () => {
  it("reproduces 1,463 of 2,897 (50.5%) for the forecast locked on 26 April", () => {
    const r = scorePublishedVersion(postaudit, actuals, "prereg", { shares: false });
    expect(r.vote_leader.wards).toBe(2897);
    expect(r.vote_leader.correct).toBe(1463);
    expect((100 * r.vote_leader.accuracy).toFixed(1)).toBe("50.5");
    expect(r.missing_actuals).toEqual([]);
  });

  it("reproduces 1,623 of 2,897 (56.0%) for the polling-day version", () => {
    const r = scorePublishedVersion(postaudit, actuals, "live", { shares: false });
    expect(r.vote_leader.wards).toBe(2897);
    expect(r.vote_leader.correct).toBe(1623);
    expect((100 * r.vote_leader.accuracy).toFixed(1)).toBe("56.0");
    expect(r.by_party["Reform UK"].predicted_wins).toBe(1251);
    expect(r.by_party["Reform UK"].actual_wins).toBe(980);
    expect(r.miss_matrix["Reform UK"]["Liberal Democrats"]).toBe(225);
  });

  it("reproduces the seat-leader basis (1,415 and 1,583 of 2,784)", () => {
    expect(scorePublishedVersion(postaudit, actuals, "prereg", { shares: false }).seat_leader.correct).toBe(1415);
    const live = scorePublishedVersion(postaudit, actuals, "live", { shares: false }).seat_leader;
    expect(live.wards).toBe(2784);
    expect(live.correct).toBe(1583);
  });

  it("pools Waltham Forest's Labour Co-operative as Labour only when asked", () => {
    const ward = actuals["local.waltham-forest.upper-walthamstow.2026-05-07"].vote_shares;
    expect(poolParty("Labour Co-operative")).toBe("Others");
    expect(poolParty("Labour Co-operative", { normaliseCoop: true })).toBe("Labour");
    expect(topParty(pooledShares(ward))).toBe("Others");
    expect(topParty(pooledShares(ward, { normaliseCoop: true }))).toBe("Labour");
    const live = scorePublishedVersion(postaudit, actuals, "live", { shares: false, normaliseCoop: true });
    const locked = scorePublishedVersion(postaudit, actuals, "prereg", { shares: false, normaliseCoop: true });
    expect(live.vote_leader.correct).toBe(1625);
    expect(locked.vote_leader.correct).toBe(1465);
  });
});
