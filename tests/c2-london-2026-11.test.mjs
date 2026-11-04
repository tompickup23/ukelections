import { describe, expect, it } from "vitest";
import { extractPolls, fieldworkEnd, pollsterBalancedMean } from "../scripts/extract-wikipedia-polls.mjs";
import { ge2024ForLadByLsoa } from "../src/lib/localElectionTarget.js";

const HEADER = `! rowspan="2"|Dates<br />conducted
! rowspan="2"|Pollster
! rowspan="2"|Client
! rowspan="2"|Area
! rowspan="2" data-sort-type="number"|Sample<br />size
! class="unsortable"|[[Labour Party (UK)|Lab]]
! class="unsortable"|[[Conservative Party (UK)|Con]]
! class="unsortable"|[[Reform UK|Ref]]
! class="unsortable"|[[Liberal Democrats (UK)|LD]]
! class="unsortable"|[[Green parties in the United Kingdom|Grn]]
! class="unsortable"|[[Plaid Cymru|PC]]
! rowspan="2"|Others
! rowspan="2"|Lead`;

const row = (date, pollster, area, cells) => `|-\n|${date}\n|${pollster}\n|N/A\n|${area}\n|1,000\n${cells.map((c) => `|${c}`).join("\n")}\n|2%\n|5`;

const page = `=== 2026 ===
{| class="wikitable"
${HEADER}
${row("{{opdrts|19|20|April|2026}}", "YouGov<ref>{{cite web|url=x}}</ref>", "GB", ["16%", 'style="background:#e8e8e8"|17%', "'''27%'''", "14%", "17%", "1%"])}
${row("{{opdrts|11|12|Feb|2026}}", "Techne{{efn|name=a}}", "UK", ["17%", "19%", "30%", "14%", "15%", "{{sdash}}"])}
${row("{{opdrts|31|2|Feb|2025}}", "More in Common", "GB", ["20%", "20%", "28%", "13%", "12%", "1%"])}
${row("{{opdrts|1|2|Feb|2026}}", "Panel", "Scotland", ["20%", "20%", "28%", "13%", "12%", "1%"])}
|-
|{{opdrts||5|Mar|2026}}
| colspan="14" |An event row
|}
`;

describe("Wikipedia poll extract", () => {
  it("reads month names in full or short, and blank start days", () => {
    expect(fieldworkEnd("{{opdrts|19|20|April|2026}}")).toBe("2026-04-20");
    expect(fieldworkEnd("{{opdrts||28|Dec|2022}}")).toBe("2022-12-28");
    expect(fieldworkEnd("{{opdrts|28|1|May|2022}}")).toBe("2022-05-01");
  });

  it("keeps GB and UK rows, drops sub-national and event rows, and reads styled cells", () => {
    const polls = extractPolls(page, { from: "2026-01-01", to: "2026-12-31" });
    expect(polls.map((p) => p.pollster)).toEqual(["More in Common", "Techne", "YouGov"]);
    const yg = polls.find((p) => p.pollster === "YouGov");
    expect(yg.shares).toEqual({ Labour: 0.16, Conservative: 0.17, "Reform UK": 0.27, "Liberal Democrats": 0.14, "Green Party": 0.17, "Plaid Cymru": 0.01 });
  });

  it("treats a dash template as no figure rather than dropping the poll", () => {
    const techne = extractPolls(page, { from: "2026-02-12", to: "2026-02-12" })[0];
    expect(techne.shares["Plaid Cymru"]).toBeUndefined();
    expect(techne.shares.Labour).toBe(0.17);
  });

  it("gives a row the section year when its template year disagrees, and flags it", () => {
    const mic = extractPolls(page, { from: "2026-02-02", to: "2026-02-02" }).find((p) => p.pollster === "More in Common");
    expect(mic.fieldwork_end).toBe("2026-02-02");
    expect(mic.year_corrected_from_section).toBe(true);
  });

  it("averages within each pollster before across pollsters", () => {
    const polls = [
      { pollster: "A", shares: { Labour: 0.2 } },
      { pollster: "A", shares: { Labour: 0.4 } },
      { pollster: "B", shares: { Labour: 0.1 } },
    ];
    expect(pollsterBalancedMean(polls, ["Labour"]).shares.Labour).toBeCloseTo(0.2, 10);
  });
});

describe("LSOA-weighted GE2024 baseline", () => {
  const history = {
    by_ballot: {
      "parl.north.2024-07-04": { candidates: [{ party_name: "Labour Party", votes: 600 }, { party_name: "Conservative and Unionist Party", votes: 400 }] },
      "parl.south.2024-07-04": { candidates: [{ party_name: "Labour Party", votes: 200 }, { party_name: "Green Party", votes: 800 }] },
    },
  };
  const pconCodes = { north: { code: "E1" }, south: { code: "E2" } };
  const lsoaLookup = {
    a: { pcon24cd: "E1", lad21cd: "L" },
    b: { pcon24cd: "E1", lad21cd: "L" },
    c: { pcon24cd: "E1", lad21cd: "L" },
    d: { pcon24cd: "E2", lad21cd: "L" },
    e: { pcon24cd: "E2", lad21cd: "M" },
  };

  it("weights each constituency's shares by the authority's LSOAs in it", () => {
    const g = ge2024ForLadByLsoa(history, "L", { lsoaLookup, pconCodes });
    expect(g.shares.Labour).toBeCloseTo((3 * 0.6 + 1 * 0.2) / 4, 10);
    expect(g.shares["Green Party"]).toBeCloseTo(0.8 / 4, 10);
    expect(g.via).toBe("LSOA-weighted, 2 constituencies");
  });

  it("returns null for an authority with no LSOAs", () => {
    expect(ge2024ForLadByLsoa(history, "Z", { lsoaLookup, pconCodes })).toBeNull();
  });
});

describe("sub-national poll tables", () => {
  const london = `==== London ====
{| class="wikitable"
! rowspan="2" | Date(s)<br />conducted
! rowspan="2"| Pollster
! rowspan="2"| Client
! rowspan="2"| Sample <br />size
! class="unsortable"| [[Labour Party (UK)|Lab]]
! class="unsortable"| [[Conservative Party (UK)|Con]]
! class="unsortable"| [[Green Party of England and Wales|Grn]]
! rowspan="2"|Others
! rowspan="2"| Lead
|-
|{{opdrts|17|23|Dec|2025|year}}
|Savanta
|QMUL
|1,006
|30%
|17%
|17%
|2%
|9
|}
==== Greater Manchester ====
{| class="wikitable"
! rowspan="2"| Pollster
|}
`;

  it("reads a section with no Area column and a trailing year flag", () => {
    const polls = extractPolls(london, { from: "2025-01-01", to: "2026-12-31", section: "London" });
    expect(polls).toHaveLength(1);
    expect(polls[0]).toMatchObject({ fieldwork_end: "2025-12-23", area: "London", sample: 1006, pollster: "Savanta" });
    expect(polls[0].shares).toEqual({ Labour: 0.3, Conservative: 0.17, "Green Party": 0.17 });
  });
});
