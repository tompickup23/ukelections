import { describe, expect, it } from "vitest";
import { contestFromCandidates, currentRun, historySentence, orderContests } from "../src/lib/wardHistory";

const one = (date: string, a: [string, number], b: [string, number], byElection = false) =>
  contestFromCandidates({
    date,
    byElection,
    candidates: [
      { party_name: a[0], votes: a[1], elected: true },
      { party_name: b[0], votes: b[1], elected: false },
    ],
  });
const label = (p: string) => p;

describe("ward history", () => {
  it("gives share and majority for a single-seat contest", () => {
    const c = one("2023-05-04", ["Labour Party", 800], ["Conservative and Unionist Party", 200])!;
    expect(c.topParty).toBe("Labour");
    expect(c.topShare).toBeCloseTo(0.8);
    expect(c.majorityVotes).toBe(600);
  });

  it("claims no share where several seats were filled", () => {
    const c = contestFromCandidates({
      date: "2022-05-05",
      byElection: false,
      candidates: [
        { party_name: "Labour Party", votes: 900, elected: true },
        { party_name: "Labour Party", votes: 850, elected: true },
        { party_name: "Green Party", votes: 400, elected: false },
      ],
    })!;
    expect(c.seats).toBe(2);
    expect(c.topShare).toBeNull();
    expect(c.majorityVotes).toBeNull();
  });

  it("never counts across a boundary change", () => {
    const contests = orderContests(
      [
        one("2018-05-03", ["Conservative", 500], ["Labour Party", 400]),
        one("2022-05-05", ["Labour Party", 500], ["Conservative", 400]),
        one("2026-05-07", ["Labour Party", 500], ["Reform UK", 450]),
      ],
      "2022-05-05",
    );
    expect(contests[1].breakBefore).toBe(true);
    expect(currentRun(contests)).toHaveLength(2);
    const sentence = historySentence(contests, label);
    expect(sentence).toContain("all 2");
    expect(sentence).toContain("current boundaries");
    expect(sentence).not.toContain("Conservative");
  });

  it("says what is held and names no individual", () => {
    const contests = orderContests([
      one("2019-05-02", ["Labour Party", 500], ["Conservative", 400]),
      one("2023-05-04", ["Labour Party", 500], ["Conservative", 400]),
      one("2026-05-07", ["Reform UK", 500], ["Labour Party", 450]),
    ]);
    expect(historySentence(contests, label)).toBe(
      "Labour topped the poll at 2 of the 3 results held since 2019. The lead last changed in 2026, from Labour to Reform UK.",
    );
  });

  it("keeps one contest per polling day", () => {
    const a = one("2026-05-07", ["Reform UK", 500], ["Labour Party", 450]);
    expect(orderContests([a, a])).toHaveLength(1);
  });
});
