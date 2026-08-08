// Guards on the mayoral projections bundle (registry + built forecast).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const registry = JSON.parse(readFileSync(path.join(ROOT, "data/contests/mayoral.json"), "utf8"));
const forecast = JSON.parse(readFileSync(path.join(ROOT, "data/predictions/mayoral/forecast.json"), "utf8"));

describe("mayoral contest registry", () => {
  it("every 2027 contest has a date, status, voting system and at least one source", () => {
    for (const c of registry.contests_2027) {
      expect(c.election_date).toBe("2027-05-06");
      expect(["confirmed", "scheduled_with_caveat"]).toContain(c.status);
      expect(c.voting_system).toBe("supplementary_vote");
      expect(c.sources.length).toBeGreaterThan(0);
      expect(c.constituent_councils.length).toBeGreaterThan(0);
      for (const cc of c.constituent_councils) expect(cc.lad25cd).toMatch(/^E0[678]\d{6}$/);
    }
  });

  it("prior results are internally consistent with their vote totals", () => {
    for (const c of registry.contests_2027) {
      if (!c.prior_result) continue;
      const sum = c.prior_result.candidates.reduce((a, x) => a + x.votes, 0);
      expect(sum).toBe(c.prior_result.total_valid);
      expect(c.prior_result.source_url).toMatch(/^https:\/\//);
    }
  });

  it("SV calibration tables are arithmetically consistent", () => {
    const gm = registry.sv_calibration.gm_2026_byelection;
    const fpSum = gm.first_round.reduce((a, x) => a + x.votes, 0);
    expect(fpSum).toBe(gm.total_first_preferences);
    // transfers to finalists + exhausted = eliminated candidates' first prefs
    const finalists = ["Bev Craig", "Sian Niamh Astley"];
    const eliminated = gm.first_round.filter((x) => !finalists.includes(x.name)).reduce((a, x) => a + x.votes, 0);
    const craigGain = gm.final_round["Bev Craig"] - gm.first_round[0].votes;
    const astleyGain = gm.final_round["Sian Niamh Astley"] - gm.first_round[1].votes;
    expect(craigGain + astleyGain + gm.exhausted_ballots).toBe(eliminated);

    const ldn = registry.sv_calibration.london_2021;
    expect(ldn.final_round["Sadiq Khan"]).toBe(ldn.first_round_top_two[0].votes + ldn.transfers_received["Sadiq Khan"]);
    expect(ldn.final_round["Shaun Bailey"]).toBe(ldn.first_round_top_two[1].votes + ldn.transfers_received["Shaun Bailey"]);
  });
});

describe("mayoral forecast output", () => {
  it("covers every non-concluded registry contest", () => {
    const expected = registry.contests_2027.filter((c) => c.status !== "concluded").map((c) => c.slug);
    expect(forecast.contests.map((c) => c.slug).sort()).toEqual(expected.sort());
  });

  it("shares and win probabilities are sane per method", () => {
    for (const c of forecast.contests) {
      expect(c.methods.length).toBeGreaterThan(0);
      for (const m of c.methods) {
        const central = Object.values(m.parties).reduce((a, x) => a + x.central, 0);
        expect(central).toBeGreaterThan(0.98);
        expect(central).toBeLessThan(1.02);
        const pw = Object.values(m.parties).reduce((a, x) => a + x.p_win, 0);
        expect(pw).toBeGreaterThan(0.98);
        expect(pw).toBeLessThan(1.02);
        for (const v of Object.values(m.parties)) {
          expect(v.p10).toBeLessThanOrEqual(v.p90);
          expect(v.p_win).toBeLessThanOrEqual(v.p_reach_runoff + 1e-9);
        }
        expect(m.modal_runoff).toBeTruthy();
      }
    }
  });

  it("never blends: method-split contests carry no consensus leader", () => {
    for (const c of forecast.contests) {
      if (!c.methods_agree_on_leader) expect(c.consensus_leader).toBeNull();
      else expect(c.consensus_leader).toBeTruthy();
    }
  });

  it("validation backtest is present and honest", () => {
    expect(forecast.validation).toBeTruthy();
    expect(forecast.validation.mae_pp).toBeGreaterThan(0);
    expect(typeof forecast.validation.winner_called).toBe("boolean");
  });

  it("no em-dashes anywhere in the published bundle", () => {
    const raw = JSON.stringify(forecast) + JSON.stringify(registry);
    expect(raw.includes("—")).toBe(false);
  });
});
