import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildExtract, extractPolls, plainFieldwork } from "../scripts/extract-wikipedia-polls.mjs";

// The 2024 page fixture is a verbatim excerpt of revision 1363820081 of
// "Opinion polling for the 2024 United Kingdom general election" (Wikipedia,
// CC BY-SA 4.0): the 2022 heading, that table's header, and its rows whose
// fieldwork ended 19 April to 6 May 2022.
const GE2024_EXCERPT = "tests/fixtures/wikipedia-polls/ge2024-rev1363820081-2022-04-excerpt.wiki";
const GE2024_FILE = "data/polling/wikipedia/westminster-2022-04-21-to-2022-05-04.json";

describe("2024 page output is unchanged", () => {
  it("regenerates the committed 2022 extract byte for byte from its recorded revision", () => {
    const committed = readFileSync(GE2024_FILE, "utf8");
    const { source, window } = JSON.parse(committed);
    const out = buildExtract(readFileSync(GE2024_EXCERPT, "utf8"), {
      page: source.page,
      revid: source.revision_id,
      from: window.fieldwork_end_from,
      to: window.fieldwork_end_to,
    });
    expect(JSON.stringify(out, null, 2) + "\n").toBe(committed);
  });

  it("gives {{opdrts}} pages no counts block and no plain-text fields", () => {
    const out = buildExtract(readFileSync(GE2024_EXCERPT, "utf8"), { page: "x", revid: 1, from: "2022-01-01", to: "2022-12-31" });
    expect(out.counts).toBeUndefined();
    expect(out.polls.every((p) => !("fieldwork_start" in p))).toBe(true);
  });
});

describe("plain-text fieldwork dates", () => {
  it("reads a single day under a year heading", () => {
    expect(plainFieldwork("6 Nov", 2019)).toEqual({ start: "2019-11-06", end: "2019-11-06" });
  });
  it("reads a single day with its own year", () => {
    expect(plainFieldwork("12 Dec 2019", null)).toEqual({ start: "2019-12-12", end: "2019-12-12" });
  });
  it("reads a range within a month", () => {
    expect(plainFieldwork("10\u201311 Dec", 2019)).toEqual({ start: "2019-12-10", end: "2019-12-11" });
    expect(plainFieldwork("10-11 Dec", 2019)).toEqual({ start: "2019-12-10", end: "2019-12-11" });
  });
  it("reads a range across months", () => {
    expect(plainFieldwork("27 Nov \u2013 10 Dec", 2019)).toEqual({ start: "2019-11-27", end: "2019-12-10" });
    expect(plainFieldwork("26 Feb \u2013 1 Mar", 2019)).toEqual({ start: "2019-02-26", end: "2019-03-01" });
  });
  it("reads a range across a year end, with or without written years", () => {
    expect(plainFieldwork("21 Dec 2018 \u2013 4 Jan 2019", 2019)).toEqual({ start: "2018-12-21", end: "2019-01-04" });
    expect(plainFieldwork("28 Dec \u2013 2 Jan", 2019)).toEqual({ start: "2018-12-28", end: "2019-01-02" });
  });
  it("reads full month names and strips cell attributes", () => {
    expect(plainFieldwork("30 September \u2013 2 October", 2018)).toEqual({ start: "2018-09-30", end: "2018-10-02" });
  });
  it("returns null rather than guessing", () => {
    expect(plainFieldwork("Pre-23 Apr", 2017)).toBeNull();
    expect(plainFieldwork("31 Feb", 2019)).toBeNull();
    expect(plainFieldwork("10\u201311 Dec", null)).toBeNull();
    expect(plainFieldwork("Dec 2019", 2019)).toBeNull();
  });
});

// Shaped like the 2019 page: pollster and client in one cell, an Area column,
// UKIP, Brx and Chg columns, merged party cells, a two-row poll and event rows.
const PAGE_2019 = `== National poll results ==
===2019===
{| class="wikitable sortable"
! rowspan="2" | Date(s)<br>conducted
! rowspan="2" | Pollster/client(s)
! rowspan="2" | Area
! rowspan="2" data-sort-type="number" | Sample<br>size
! class="unsortable" |[[Conservative Party (UK)|Con]]
! class="unsortable" |[[Labour Party (UK)|Lab]]
! class="unsortable" |[[Liberal Democrats (UK)|LD]]
! class="unsortable" |[[Scottish National Party|SNP]]
! class="unsortable" |[[UK Independence Party|UKIP]]
! class="unsortable" |[[Green parties in the United Kingdom|Grn]]
! class="unsortable" |[[Plaid Cymru|PC]]
! class="unsortable" |[[Brexit Party|Brx]]
! class="unsortable" |[[Change UK|Chg]]
! rowspan="2" | Others
! rowspan="2" | Lead
|-
! style="background:red;" |
! style="background:blue;" |
|-
| rowspan="2" data-sort-value="2019-12-12" | 12 Dec 2019
| rowspan="2" | [[2019 United Kingdom general election|2019 general election]]
| UK
| rowspan="2"| \u2013
| '''43.6%'''
| 32.1%
| 11.6%
| 3.9%
| 0.1%
| 2.7%
| 0.5%
| 2.0%
| 0.03%
| 3.1%
| 11.5
|-
| GB
| '''44.7%'''
| 33.0%
| 11.8%
| 4.0%
| 0.1%
| 2.8%
| 0.5%
| 2.1%
| 0.03%
| 1.0%
| 11.7
|-
| data-sort-value="2019-04-03" | 2\u20133 Apr
|[https://example.org/a.pdf YouGov/''The Times'']{{Dead link|date=April 2024}}
| GB
| 1,771
| style="background:#CCEBFF;" |'''32%'''
| 31%
| 12%
| colspan="4" | 6%
| 5%
| \u2013
| 3%
| 1
|-
| style="border-right-style:hidden;" data-sort-value="2019-04-04" | 4 Apr
| colspan="14" | An event
|-
| rowspan="2" data-sort-value="2019-04-05" | 2\u20135 Apr
| rowspan="2" |[https://example.org/b BMG/''The Independent'']
| rowspan="2" | GB
| rowspan="2" | 1,500
| 29%
| 31%
| 8%
| 3%
| 7%
| 4%
| 1%
| 6%
| 8%
| 1%
| 2
|-
| 35%
| 34%
| 11%
| 4%
| 6%
| 5%
| 1%
| \u2013
| \u2013
| 3%
| 1
|-
| data-sort-value="2019-01-01" | 28 Dec \u2013 2 Jan
| [ |[https://example.org/c SavantaComRes/''The Daily Telegraph'']
| GB
| 2,000
| 40%
| 35%
| 10%
| 4%
| 2%
| 3%
| <1%
| \u2013
| \u2013
| 4%
| 5
|-
| data-sort-value="2019-03-10" | 9\u201310 Mar
| Panel
| E+W
| 1,000
| 40%
| 35%
| 10%
| \u2013
| 2%
| 3%
| 1%
| \u2013
| \u2013
| 4%
| 5
|-
| 30 Feb
| Typo
| GB
| 1,000
| 40%
| 35%
| 10%
| 4%
| 2%
| 3%
| 1%
| \u2013
| \u2013
| 4%
| 5
|-
| 1\u20132 Mar
| Footnoted
| GB
| 1,000
| 40%
| 35%
| 10%
| 4%
| 2%
| 3%
| 1%
| *
| \u2013
| 4%
| 5
|}
== Sub-national poll results ==
=== Scotland ===
{| class="wikitable"
! Date(s) conducted
! Pollster/client(s)
! Sample size
! [[Scottish National Party|SNP]]
! [[Conservative Party (UK)|Con]]
|-
| 1\u20132 Mar
| Panelbase
| 1,000
| 40%
| 25%
|}
`;

// Shaped like the 2017 page: no Area column, "Polling organisation/client",
// a leading "|-" before the header, inline "||" cells and a continuation line.
const PAGE_2017 = `=== 2016 ===
{| class="wikitable"
|-
! rowspan="2" |Date(s)<br />conducted
! rowspan="2" |Polling organisation/client
! rowspan="2" |Sample<br />size
! [[Conservative Party (UK)|Con]]
! [[Labour Party (UK)|Lab]]
! [[UK Independence Party|UKIP]]
! [[Liberal Democrats (UK)|LD]]
! rowspan="2" | Others
! rowspan="2" |Lead
|-
! style="background:red;" |
|-
|19\u201324 Oct||[http://example.org/bmg BMG]||1,546|| style="background:#CCEBFF" |'''42%'''||28%||12%
||8%||5%|| 14
|-
|9\u201311 Jul
|{{Deprecated archive|url=https://example.org/x|title=Ipsos MORI/''Evening Standard''}}|| 1,021|| '''36%'''||35%||8%||11%||5%||1
|}
`;

describe("plain-text date pages", () => {
  const stats = {};
  const polls = extractPolls(PAGE_2019, { from: "2018-01-01", to: "2019-12-31", stats });

  it("keeps UKIP, Brexit Party and Change UK as their own keys", () => {
    const bmg = polls.filter((p) => p.pollster === "BMG");
    expect(bmg[0].shares).toEqual({
      Conservative: 0.29, Labour: 0.31, "Liberal Democrats": 0.08, SNP: 0.03, UKIP: 0.07,
      "Green Party": 0.04, "Plaid Cymru": 0.01, "Brexit Party": 0.06, "Change UK": 0.08,
    });
    expect(Object.keys(bmg[0].shares)).not.toContain("Reform UK");
  });

  it("splits pollster from client and drops maintenance templates", () => {
    const yg = polls.find((p) => p.pollster === "YouGov");
    expect(yg).toMatchObject({ client: "The Times", area: "GB", sample: 1771, fieldwork_start: "2019-04-02", fieldwork_end: "2019-04-03" });
  });

  it("keeps a figure printed across several parties as a combined figure, never split", () => {
    const yg = polls.find((p) => p.pollster === "YouGov");
    expect(yg.shares).toEqual({ Conservative: 0.32, Labour: 0.31, "Liberal Democrats": 0.12, "Brexit Party": 0.05 });
    expect(yg.combined_shares).toEqual({ "SNP + UKIP + Green Party + Plaid Cymru": 0.06 });
  });

  it("carries the date, pollster, area and sample of a two-row poll into its second row", () => {
    const bmg = polls.filter((p) => p.pollster === "BMG");
    expect(bmg).toHaveLength(2);
    expect(bmg[1]).toMatchObject({ fieldwork_end: "2019-04-05", area: "GB", sample: 1500, row_of_multi_row_poll: { row: 2, of: 2 } });
    expect(bmg[1].shares["Brexit Party"]).toBeUndefined();
    expect(bmg[1].shares.Conservative).toBe(0.35);
  });

  it("reads a stray attribute pipe, a year-end range, and records <1% without a number", () => {
    const sc = polls.find((p) => p.pollster === "SavantaComRes");
    expect(sc).toMatchObject({ client: "The Daily Telegraph", fieldwork_start: "2018-12-28", fieldwork_end: "2019-01-02", less_than_one_percent: ["Plaid Cymru"] });
    expect(sc.shares["Plaid Cymru"]).toBeUndefined();
    expect(sc.sort_value_end).toBe("2019-01-01");
  });

  it("drops and counts election results, events, sub-national areas, bad dates and bad cells", () => {
    expect(polls.map((p) => p.pollster).sort()).toEqual(["BMG", "BMG", "SavantaComRes", "YouGov"]);
    // Both rows of the election result (UK and GB) are counted as results.
    expect(stats.election_result_rows).toBe(2);
    expect(stats.event_rows).toBe(1);
    expect(stats.dropped.area_not_gb_or_uk).toEqual({ count: 1, areas: { "E+W": 1 } });
    expect(stats.date_unparsed).toEqual({ count: 1, examples: [{ section: 2019, cell: "30 Feb" }] });
    expect(stats.dropped.share_unparsed.count).toBe(1);
    expect(stats.dropped.share_unparsed.examples[0]).toMatchObject({ pollster: "Footnoted", party: "Brexit Party", text: "*" });
    expect(stats.kept).toBe(4);
    expect(stats.sort_value_disagrees_with_text.count).toBe(1);
  });

  it("reads only tables under a year heading", () => {
    expect(stats.tables_read).toBe(1);
    expect(stats.tables_skipped_outside_year_sections).toBe(1);
    expect(polls.some((p) => p.pollster === "Panelbase")).toBe(false);
  });

  it("reads a page with no Area column, inline cells and continuation lines", () => {
    const s17 = {};
    const p17 = extractPolls(PAGE_2017, { from: "2016-01-01", to: "2016-12-31", stats: s17 });
    expect(p17.map((p) => [p.pollster, p.client, p.area])).toEqual([["Ipsos MORI", "Evening Standard", null], ["BMG", null, null]]);
    expect(p17[1].shares).toEqual({ Conservative: 0.42, Labour: 0.28, UKIP: 0.12, "Liberal Democrats": 0.08 });
    expect(s17.kept).toBe(2);
  });

  it("writes a counts block and an alphabetical mean for plain-text pages", () => {
    const out = buildExtract(PAGE_2019, { page: "Opinion polling for the 2019 United Kingdom general election", revid: 1, from: "2019-01-01", to: "2019-12-31" });
    expect(Object.keys(out.mean.shares)).toEqual(["Brexit Party", "Change UK", "Conservative", "Green Party", "Labour", "Liberal Democrats", "UKIP"]);
    expect(out.counts.kept).toBe(4);
  });
});
