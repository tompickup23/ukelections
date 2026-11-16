import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { classifyCycle } from "../scripts/build-councils-2027-cycle-evidence.mjs";

const polls = (spec) => Object.entries(spec).map(([y, elected]) => ({ date: `${y}-05-05`, elected }));
const evidence = JSON.parse(readFileSync("data/identity/councils-2027-cycle-evidence.json", "utf8"));
const baselines = JSON.parse(readFileSync("data/identity/councils-2027-baselines.json", "utf8"));
const c27 = JSON.parse(readFileSync("data/identity/councils-2027.json", "utf8"));

describe("2027 cycle from Democracy Club polls", () => {
  it("reads a thirds council with equal annual polls as electing in parts, due 2027", () => {
    const c = classifyCycle(polls({ 2018: 14, 2019: 14, 2021: 15, 2022: 14, 2023: 14, 2024: 14, 2026: 15 }));
    expect(c).toMatchObject({ pattern: "partial", due_2027: true });
  });
  it("reads a 2023 all-out council as due 2027, even when a review shrank the chamber", () => {
    expect(classifyCycle(polls({ 2019: 51, 2023: 37 }))).toMatchObject({ pattern: "whole_council", last_whole_council_poll: 2023, due_2027: true });
  });
  it("puts a council that moved to all-out in 2024 on 2028", () => {
    const c = classifyCycle(polls({ 2018: 13, 2019: 11, 2021: 12, 2022: 13, 2023: 11, 2024: 35 }));
    expect(c).toMatchObject({ pattern: "whole_council", last_whole_council_poll: 2024, due_2027: false });
  });
  it("finds no 2027 seats for an even-year halves council", () => {
    expect(classifyCycle(polls({ 2018: 14, 2021: 18, 2022: 14, 2024: 16, 2026: 14 }))).toMatchObject({ pattern: "partial", due_2027: false });
  });
  it("puts a 2026 all-out council on 2030", () => {
    expect(classifyCycle(polls({ 2018: 52, 2022: 48, 2026: 52 }))).toMatchObject({ due_2027: false });
  });
});

describe("evidence file", () => {
  it("covers every not-verified council exactly once and never marks one verified", () => {
    expect(evidence.councils.map((r) => r.slug).sort()).toEqual(c27.not_verified.map((r) => r.slug).sort());
    for (const r of evidence.councils) expect(["due_by_cycle", "not_due_by_cycle", "sources_disagree"]).toContain(r.status_2027);
  });
  it("only calls a council due when Democracy Club and Open Council Data agree", () => {
    for (const r of evidence.councils.filter((x) => x.status_2027 === "due_by_cycle")) {
      expect(r.dc_cycle.due_2027, r.slug).toBe(true);
      expect(r.listed_by_ocd_for_2027, r.slug).toBe(true);
    }
  });
  it("has a baselines row for every English and Welsh 2027 council", () => {
    const want = [...c27.councils.filter((c) => c.nation !== "S"), ...c27.not_verified].map((c) => c.slug).sort();
    expect(baselines.councils.map((c) => c.slug).sort()).toEqual(want);
  });
});
