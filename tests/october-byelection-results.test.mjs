import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { assemble } from "../scripts/build-local-byelections.mjs";

const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const holbornFile = "data/predictions/by-elections/holborn-and-st-pancras-2026-10-08.json";

describe("8 October declarations, checked at the administering councils", () => {
  it("uses Camden's complete count and preserves the absence of a forecast", () => {
    const d = read(holbornFile);
    expect(d.result.candidates).toHaveLength(15);
    expect(d.result.total_valid_votes).toBe(27211);
    expect(d.result.candidates.reduce((n, c) => n + c.votes, 0)).toBe(27211);
    expect(d.result.turnout_votes).toBe(27319);
    expect(d.result.rejected_ballots).toBe(108);
    expect(d.result.majority_votes).toBe(12292 - 8928);
    expect(d.result.votes["Climate Party"]).toBe(51);
    expect(d.result.votes.UKIP).toBe(51);
    expect(d.result.verification).toContain("Parliament prints 54");
    expect(d.forecast.winner).toBeNull();
    expect(d.forecast.classification).toBe("signal-only");
  });

  it("cannot overwrite the concluded result by rerunning the pre-poll builder", () => {
    const before = readFileSync(holbornFile, "utf8");
    execFileSync(process.execPath, ["scripts/build-holborn-byelection.mjs"]);
    expect(readFileSync(holbornFile, "utf8")).toBe(before);
  });

  it("reconciles the three FPTP counts and grades only the saved pre-poll forecast", () => {
    for (const [slug, votes, margin, party] of [
      ["amber-valley-kilburn-denby-holbrook-horsley", 2287, 57, "Green Party"],
      ["lambeth-myatts-fields", 2197, 211, "Labour"],
      ["newcastle-under-lyme-town", 932, 182, "Labour"],
    ]) {
      const d = read(`data/contests/local-byelections/${slug}-2026-10-08.json`);
      expect(d.status).toBe("concluded");
      expect(d.result.total_votes).toBe(votes);
      expect(d.field.candidates.reduce((n, c) => n + c.votes, 0)).toBe(votes);
      expect(d.result.majority_votes).toBe(margin);
      expect(d.result.winner_party).toBe(party);
      expect(d.result.review_status).toBe("hand_verified_declaration");
      expect(d.result.grading.graded_against).toBe("forecast_as_published");
      expect(d.result.grading.published_captured_at < "2026-10-08").toBe(true);
    }
    const amber = read("data/history/byelection-appends.json").results.find((r) => r.ballot_paper_id === "local.amber-valley.kilburn-denby-holbrook-horsley.by.2026-10-08");
    expect(amber.candidates.reduce((n, c) => n + c.votes, 0) + amber.spoilt_ballots).toBe(amber.turnout_votes);
    expect((amber.turnout_votes / amber.electorate * 100).toFixed(2)).toBe("34.29");
  });

  it("lists all four contests in the roundup", () => {
    const round = read("data/results/local-byelections.json").dates.find((d) => d.date === "2026-10-08");
    expect(round.contests.map((c) => c.council).sort()).toEqual(["Aberdeen City", "Amber Valley", "Lambeth", "Newcastle-under-Lyme"]);
  });
});

describe("STV declarations", () => {
  it("does not declare the first-preference leader the winner or grade an STV result", () => {
    const d = assemble({
      ballot: { election_id: "local.example.ward.by.2026-10-08", organisation: { common_name: "Example" } },
      ids: { date: "2026-10-08", slug: "example-ward-2026-10-08", council_slug: "example", ward_slug: "ward" },
      division: { name: "Ward" }, gss: null, setStart: null, votingSystem: "STV", dc: {},
      candidates: [
        { name: "First preference leader", party_name: "Labour Party", votes: 400, elected: false },
        { name: "Winner after transfers", party_name: "Green Party", votes: 350, elected: true },
      ],
      field: new Set(["Labour", "Green Party"]), prior: null, boundaryChanged: false, fieldUnavailable: false,
    }, [], { wards: {}, medians: {} }, {});
    expect(d.result).toBeNull();
    expect(d.declaration.winner_candidate).toBe("Winner after transfers");
    expect(d.declaration.winner_party).toBe("Green Party");
    expect(d.forecast).toBeNull();
  });
});
