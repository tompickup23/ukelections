import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { previousLeader } from "../scripts/build-may-2026-skill.mjs";

const doc = JSON.parse(readFileSync(new URL("../data/transparency/may-2026-skill.json", import.meta.url), "utf8"));
const lfl = JSON.parse(readFileSync(new URL("../data/transparency/may-2026-like-for-like.json", import.meta.url), "utf8"));

describe("May 2026 against the same party rule", () => {
  it("pins the counts so data drift fails loudly", () => {
    expect(doc.wards_scored).toBe(2897);
    expect(doc.wards_with_previous_result).toBe(2532);
    expect(doc.kept_same_leader).toBe(1309);
    expect(doc.changed_leader).toBe(1223);
    expect(doc.same_party_rule_called).toBe(1309);
    expect(doc.locked_forecast_called).toBe(1295);
    expect(doc.polling_day_forecast_called).toBe(1462);
  });

  it("agrees with the like for like yardstick on all wards", () => {
    expect(doc.wards_scored).toBe(lfl.prereg.vote_leader.wards);
    expect(doc.all_wards.locked_forecast_called).toBe(lfl.prereg.vote_leader.correct);
    expect(doc.all_wards.polling_day_forecast_called).toBe(lfl.live.vote_leader.correct);
  });

  it("is internally consistent", () => {
    expect(doc.kept_same_leader + doc.changed_leader).toBe(doc.wards_with_previous_result);
    expect(doc.wards_with_previous_result + doc.wards_without_previous_result).toBe(doc.wards_scored);
    expect(doc.same_party_rule_called).toBe(doc.kept_same_leader);
    for (const k of ["ward_leader", "previous_result", "same_party_rule", "locked_forecast", "polling_day_forecast", "why_subset"]) {
      expect(doc.definitions[k]).toBeTruthy();
      expect(doc.definitions[k]).not.toMatch(/[–—]| - /);
    }
  });

  it("pools the baseline leader like the yardstick", () => {
    const entry = { methodology: [{ step: 1, data: { "Britain First": 0.3, "Independent": 0.25, Labour: 0.4 } }] };
    expect(previousLeader(entry)).toBe("Others");
    expect(previousLeader({ methodology: [] })).toBeNull();
  });
});
