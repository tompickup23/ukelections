import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  GE_MODEL_OPTIONS,
  INCUMBENCY_CONSTANTS,
  buildGeAssumptions,
} from "../scripts/run-ge-predictions.mjs";
import { applyTacticalVoting } from "../src/lib/tacticalVoting.js";
import { applyIncumbencyAdjustment } from "../src/lib/incumbencyTracker.js";
import { predictConstituencyGE } from "../src/lib/electionModel.js";

const readJson = (rel) => JSON.parse(readFileSync(path.join(process.cwd(), rel), "utf8"));
const published = readJson("data/predictions/ge-next/assumptions.json");

// The audit of 9 Nov 2026 found assumptions.json stating a BES weight of 0.15
// and a tactical transfer of 0.30 while the run passed 0.05 and the 0.15
// default. The published file must be the options the model receives.
describe("ge-next assumptions.json matches the run", () => {
  it("publishes exactly the parameters built from GE_MODEL_OPTIONS", () => {
    expect(published.parameters).toEqual(buildGeAssumptions(GE_MODEL_OPTIONS, "2026-01-01T00:00:00Z").parameters);
  });

  it("states the BES weight the model applies", () => {
    const constituency = { name: "Test", ge2024: { results: [{ party: "Labour", pct: 0.5 }, { party: "Conservative", pct: 0.5 }] } };
    const polling = { aggregate: { Labour: 0.5, Conservative: 0.5 }, ge2024_baseline: { Labour: 0.5, Conservative: 0.5 } };
    const out = predictConstituencyGE(constituency, polling, {}, {
      ...GE_MODEL_OPTIONS,
      besPrior: { region: "test", shares: { Labour: 1, Conservative: 0 } },
    });
    const step = out.methodology.find((m) => m.name === "BES MRP Prior");
    expect(step.data.weight).toBe(published.parameters.bes_prior_weight);
  });

  it("states the tactical transfer the model applies", () => {
    const shares = { "Reform UK": 0.34, Labour: 0.3, "Liberal Democrats": 0.2, Conservative: 0.16 };
    const tac = applyTacticalVoting(shares, GE_MODEL_OPTIONS.tacticalOpts);
    expect(tac.applied.amount).toBeCloseTo(0.2 * published.parameters.tactical_voting_transfer_rate, 10);
    // And the explicit options equal the library defaults, so passing them
    // changed nothing about the forecast.
    expect(applyTacticalVoting(shares).applied.amount).toBeCloseTo(tac.applied.amount, 10);
  });

  it("states the incumbency constants incumbencyTracker.js applies", () => {
    const shares = { Labour: 0.4, Conservative: 0.4 };
    const delta = (mp) => applyIncumbencyAdjustment(shares, mp).applied.delta * 100;
    const p = published.parameters;
    expect(delta({ party: "Labour", tenure_years: 25, status: "standing_again" })).toBeCloseTo(p.incumbency_personal_vote_pp[">=20yr"], 10);
    expect(delta({ party: "Labour", tenure_years: 12, status: "standing_again" })).toBeCloseTo(p.incumbency_personal_vote_pp[">=10yr"], 10);
    expect(delta({ party: "Labour", tenure_years: 6, status: "standing_again" })).toBeCloseTo(p.incumbency_personal_vote_pp[">=5yr"], 10);
    expect(delta({ party: "Labour", tenure_years: 2, status: "standing_again" })).toBeCloseTo(p.incumbency_personal_vote_pp["<5yr"], 10);
    expect(-delta({ party: "Labour", tenure_years: 25, status: "retiring" })).toBeCloseTo(p.retirement_drag_pp[">=20yr"], 10);
    expect(-delta({ party: "Labour", tenure_years: 12, status: "retiring" })).toBeCloseTo(p.retirement_drag_pp[">=10yr"], 10);
    expect(-delta({ party: "Labour", tenure_years: 3, status: "retiring" })).toBeCloseTo(p.retirement_drag_pp["<10yr"], 10);
    expect(-delta({ party: "Labour", tenure_years: 3, status: "defected" })).toBeCloseTo(p.defection_open_seat_drag_pp, 10);
    expect(p).toMatchObject(INCUMBENCY_CONSTANTS);
  });
});

describe("ge-next summary names its polling", () => {
  const summary = readJson("data/predictions/ge-next/summary.json");
  it("gives a fieldwork window, not a constant name", () => {
    expect(summary.snapshot.polling_source).not.toMatch(/^UK_WESTMINSTER/);
    expect(summary.snapshot.polling_source).toMatch(/fieldwork \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}/);
    expect(summary.snapshot.polling_fieldwork_latest).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
