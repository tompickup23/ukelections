import { describe, it, expect } from "vitest";
import { corpusPriorFinder } from "../scripts/build-local-byelections.mjs";

// The swing corpus pairs each council by-election with a prior ward result.
// Until 2 Nov 2026 it looked the prior up again by ward name alone, so a
// contest whose page had taken its baseline from Democracy Club directly fell
// out of the corpus as soon as its result reached the sidecar.

const row = { ballot_paper_id: "local.x.ward.by.2026-10-01", council_slug: "x", ward_slug: "ward", election_date: "2026-10-01" };
const archivePrior = { election_date: "2022-05-05", candidates: [{ party_name: "Labour", votes: 1 }] };
const pagePrior = { election_date: "2026-05-07", candidates: [{ party_name: "Reform UK", votes: 1 }], usable_as_baseline: true };

function priorsReturning(result) {
  const calls = [];
  return { calls, find: (q) => { calls.push(q); return result; } };
}

describe("corpusPriorFinder", () => {
  it("uses the prior the contest's own page showed", () => {
    const priors = priorsReturning(archivePrior);
    const find = corpusPriorFinder(priors, new Map([[row.ballot_paper_id, { gss: "E05000001", prior: pagePrior, usable: true }]]));
    expect(find(row)).toBe(pagePrior);
    expect(priors.calls).toHaveLength(0);
  });

  it("never uses a prior the page rejected for a boundary change", () => {
    const priors = priorsReturning(archivePrior);
    const find = corpusPriorFinder(priors, new Map([[row.ballot_paper_id, { gss: "E05000001", prior: pagePrior, usable: false }]]));
    expect(find(row)).toBeNull();
  });

  it("falls back to the archives with the ward's GSS code when the page had no prior", () => {
    const priors = priorsReturning(archivePrior);
    const find = corpusPriorFinder(priors, new Map([[row.ballot_paper_id, { gss: "E05000001", prior: null, usable: true }]]));
    expect(find(row)).toBe(archivePrior);
    expect(priors.calls[0]).toMatchObject({ council_slug: "x", ward_slug: "ward", gss: "E05000001", before: "2026-10-01" });
  });

  it("keeps a fresh contest's attached prior and looks up unpaged contests by name", () => {
    const priors = priorsReturning(archivePrior);
    const find = corpusPriorFinder(priors);
    expect(find({ ...row, _prior: pagePrior })).toBe(pagePrior);
    expect(find(row)).toBe(archivePrior);
    expect(priors.calls[0].gss).toBeNull();
  });
});
