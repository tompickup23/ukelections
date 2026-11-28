import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  fullSlateShares, pooledShares, notionalShares, slugify, looseSlug, canonicalParty, parseOrderCommencement, bngToWgs84, parseCsv,
} from "../scripts/lib/wards-2027-lib.mjs";

const wards = JSON.parse(readFileSync("data/identity/wards-2027.json", "utf8"));
const base = JSON.parse(readFileSync("data/identity/wards-2027-baselines.json", "utf8"));
const METHODS = new Set(["same_ward", "renamed", "notional", "none"]);

function checkShares(shares, label) {
  const vals = Object.values(shares);
  expect(vals.length, label).toBeGreaterThan(0);
  for (const v of vals) {
    expect(v, label).toBeGreaterThanOrEqual(0);
    expect(v, label).toBeLessThanOrEqual(1);
  }
  const sum = vals.reduce((a, b) => a + b, 0);
  expect(Math.abs(sum - 1), `${label} sums to ${sum}`).toBeLessThan(0.001);
}

describe("wards-2027 data files", () => {
  it("parse and declare England-only scope", () => {
    expect(wards.status).toBe("first_cut");
    expect(wards.scope).toMatch(/England only/);
    expect(wards.wards.length).toBeGreaterThan(0);
    expect(base.wards.length).toBe(wards.wards.length);
  });

  it("list no ward twice, in either file", () => {
    for (const list of [wards.wards, base.wards]) {
      const ids = list.map((w) => w.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
    const codes = wards.wards.map((w) => w.gss_code).filter(Boolean);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("give every ward exactly one baseline record with a known method", () => {
    const byId = new Map(base.wards.map((b) => [b.id, b]));
    for (const w of wards.wards) {
      const b = byId.get(w.id);
      expect(b, w.id).toBeTruthy();
      expect(METHODS.has(b.method), `${w.id} ${b.method}`).toBe(true);
      expect(w.baseline_method).toBe(b.method);
      if (b.method === "none") {
        expect(b.baseline).toBeNull();
        expect(b.note, w.id).toBeTruthy();
      } else {
        expect(b.baseline?.shares, w.id).toBeTruthy();
        expect(b.baseline.date, w.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
      if (b.method === "same_ward") expect(b.baseline.rows, w.id).toBeGreaterThan(0);
      if (b.method === "notional") expect(b.notional?.weights?.length, w.id).toBeGreaterThan(0);
    }
  });

  it("keep every share set inside 0 to 1 and summing to 1", () => {
    for (const b of base.wards) {
      if (b.baseline) {
        checkShares(b.baseline.shares, `${b.id} baseline`);
        checkShares(b.baseline.pooled, `${b.id} pooled`);
      }
      if (b.fallback_2019) checkShares(b.fallback_2019.shares, `${b.id} 2019`);
      if (b.last_by_election) checkShares(b.last_by_election.shares, `${b.id} by-election`);
      if (b.notional) {
        const w = b.notional.weights.reduce((s, x) => s + x.weight, 0);
        expect(Math.abs(w - 1), `${b.id} weights`).toBeLessThan(0.001);
      }
    }
  });

  it("never use a by-election as a baseline", () => {
    for (const b of base.wards) if (b.baseline?.ballot_paper_id) expect(b.baseline.ballot_paper_id, b.id).not.toMatch(/\.by\./);
  });

  it("keep the unverified councils in their own flagged block", () => {
    const blocks = new Set(wards.councils.map((c) => c.block));
    expect([...blocks].sort()).toEqual(["unverified", "verified"]);
    for (const w of wards.wards) expect(["verified", "unverified"]).toContain(w.block);
    const council = new Map(wards.councils.map((c) => [c.slug, c]));
    for (const w of wards.wards) expect(council.get(w.council_slug)?.block, w.id).toBe(w.block);
  });

  it("agree with their own summary", () => {
    const s = wards.summary.verified;
    expect(s.wards_listed).toBe(wards.wards.filter((w) => w.block === "verified").length);
    const m = { same_ward: 0, renamed: 0, notional: 0, none: 0 };
    for (const b of base.wards.filter((x) => x.block === "verified")) m[b.method]++;
    expect(s.wards_by_baseline_method).toEqual(m);
  });

  it("only give a ward seats where a basis is recorded, and match the council total when all wards have seats", () => {
    for (const w of wards.wards) if (w.seats_up != null) expect(w.seats_up_basis, w.id).toBeTruthy();
    for (const c of wards.councils) {
      if (c.ward_seats_check === "matches_council_total") expect(c.ward_seats_sum).toBe(c.council_seats_up);
    }
  });
});

describe("wards-2027 helpers", () => {
  it("computes full-slate shares over every vote cast", () => {
    const s = fullSlateShares([{ party: "Labour", votes: 300 }, { party: "Labour", votes: 200 }, { party: "Reform UK", votes: 500 }]);
    expect(s.shares).toEqual({ Labour: 0.5, "Reform UK": 0.5 });
    expect(pooledShares({ Labour: 0.5, Independent: 0.5 }).Others).toBe(0.5);
  });

  it("carries old results to a new ward by shared LSOAs", () => {
    const lsoaToOld = new Map([["a", "X"], ["b", "X"], ["c", "Y"], ["d", "Z"]]);
    const old = new Map([["X", { Labour: 1 }], ["Y", { Conservative: 1 }]]);
    const n = notionalShares(["a", "b", "c", "d", "e"], lsoaToOld, old);
    expect(n.shares.Labour).toBeCloseTo(2 / 3, 5);
    expect(n.lsoas_used).toBe(3);
    expect(n.lsoas_unmapped).toBe(1);
    expect(n.lsoas_old_ward_without_result).toBe(1);
  });

  it("matches Democracy Club ward slugs that drop 'and'", () => {
    expect(looseSlug(slugify("Basing & Upton Grey"))).toBe(looseSlug("basing-upton-grey"));
    expect(slugify("St. Michael's")).toBe("st-michaels");
  });

  it("maps party labels the way the May 2026 merged results do", () => {
    expect(canonicalParty("Labour and Co-operative Party")).toBe("Labour");
    expect(canonicalParty("Conservative and Unionist Party")).toBe("Conservative");
    expect(canonicalParty("C")).toBe("Conservative");
    expect(canonicalParty("RUK")).toBe("Reform UK");
    expect(canonicalParty("Some Residents")).toBe("Some Residents");
  });

  it("separates ward changes from parish-only changes in an order's commencement", () => {
    const t = "b for all other purposes, on the ordinary day of election of councillors in England in 2024. 4 Article 5 comes into force— a for the purpose of proceedings preliminary or relating to the election of parish councillors, on 15th October 2026; b for all other purposes, on the ordinary day of election of parish councillors in England in 2027.";
    const c = parseOrderCommencement(t);
    expect(c.ward_change_years).toEqual([2024]);
    expect(c.parish_change_years).toEqual([2027]);
  });

  it("converts British National Grid to WGS84 within metres of the OS worked example", () => {
    // OS worked example point (Caister Water Tower area), OSGB36 52.657570 N 1.717922 E;
    // the WGS84 position sits about 100 m away after the datum shift.
    const [lon, lat] = bngToWgs84(651409.903, 313177.27);
    expect(lat).toBeCloseTo(52.658, 2);
    expect(lon).toBeCloseTo(1.716, 2);
  });

  it("parses quoted CSV with repeated headers", () => {
    const rows = parseCsv('a,b,a\n"x,1","y ""q""",z\n');
    expect(rows[0]).toEqual({ a: "x,1", b: 'y "q"', a_2: "z" });
  });
});

describe("wards-2027 boundary orders", () => {
  it("lists the councils redrawn for May 2027 with the ward count their order's note gives", () => {
    const redrawn = wards.councils.filter((c) => c.boundaries === "new");
    expect(redrawn.map((c) => c.slug).sort()).toEqual([
      "canterbury", "cheshire-east", "cumberland", "east-riding-of-yorkshire", "middlesbrough",
      "north-yorkshire", "somerset", "stockton-on-tees", "westmorland-and-furness", "wirral",
    ]);
    for (const c of redrawn) {
      expect(c.wards_listed, c.slug).toBe(c.new_wards_in_order_note);
      expect(c.boundary_order?.[0]?.url, c.slug).toMatch(/^https:\/\/www\.legislation\.gov\.uk\/uksi\//);
      for (const w of wards.wards.filter((x) => x.council_slug === c.slug)) {
        expect(w.gss_code).toBeNull();
        expect(w.seats_up_basis).toBe("order_schedule_all_out");
      }
    }
  });

  it("never gives a redrawn ward a baseline it cannot have", () => {
    const newIds = new Set(wards.wards.filter((w) => w.boundaries === "new").map((w) => w.id));
    for (const b of base.wards) if (newIds.has(b.id)) expect(b.method).toBe("none");
  });
});
