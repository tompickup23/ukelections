import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildRow,
  declarationLinks,
  duringCountNight,
  fromFixtures,
  mergeRows,
  parseDeclaration,
  reconcile,
  robotsAllows,
} from "../scripts/results-morning.mjs";

// Saved council declarations for the 22 and 29 October 2026 polls, read on
// 3 November 2026. The .txt files are pdftotext -layout output of the council
// PDFs, except Wychavon's, whose bot check stops a script: that one is the
// layout text of its declaration as read in a browser (PDF SHA-256 9a07a0ac...).
// The .dc.json files are Democracy Club's ballots API on the same day.
const FIXTURES = "tests/fixtures/results-morning";
const read = (file) => JSON.parse(readFileSync(file, "utf8"));
const contest = (slug) => read(`data/contests/local-byelections/${slug}.json`);
const sidecar = read("data/history/byelection-appends.json").results;

function run(slug) {
  const doc = contest(slug);
  const saved = fromFixtures(FIXTURES, doc);
  const parsed = parseDeclaration(saved.text, doc);
  const result = reconcile(parsed, doc, saved.dc);
  const row = result.ok ? buildRow(doc, parsed, result, { source: "fixture", accessedAt: "2026-11-03" }) : null;
  return { doc, parsed, result, row, verified: sidecar.find((r) => r.ballot_paper_id === doc.contest.ballot_paper_id) };
}

const votes = (row) => Object.fromEntries(row.candidates.map((c) => [c.name, c.votes]));

describe("results morning, offline on the October declarations", () => {
  it("reproduces the hand-verified Hartlebury row: Reform UK 238, turnout 25.29%", () => {
    const { row, verified, result } = run("wychavon-hartlebury-2026-10-22");
    expect(row).not.toBeNull();
    expect(votes(row)).toEqual(votes(verified));
    expect(votes(row)["Jake Richardson"]).toBe(238);
    expect(row.turnout_votes).toBe(633);
    expect(row.turnout_pct).toBe(0.2529);
    expect(row.spoilt_ballots).toBe(2);
    expect(row.electorate).toBe(2503);
    expect(row.candidates.find((c) => c.elected).name).toBe("Tony Miller");
    // Democracy Club's 248 is reported, never applied.
    expect(result.dcDiffs).toEqual(["Jake Richardson 238 (Democracy Club 248)"]);
    expect(row.verification_note).toContain("Democracy Club differs");
  });

  it("reproduces Calverley and Farsley: 5,804 papers, 32.20%", () => {
    const { row, verified } = run("leeds-calverley-farsley-2026-10-22");
    expect(votes(row)).toEqual(votes(verified));
    expect(row.turnout_votes).toBe(5804);
    expect(row.turnout_pct).toBe(0.322);
    expect(row.spoilt_ballots).toBe(6);
    // Leeds prints no electorate, so it stays blank rather than estimated.
    expect(row.electorate).toBeNull();
  });

  it("reproduces the Halton, Dover Beck and Southwell counts", () => {
    for (const slug of ["halton-beechwood-heath-2026-10-29", "newark-and-sherwood-dover-beck-2026-10-29", "nottinghamshire-southwell-2026-10-29"]) {
      const { row, verified } = run(slug);
      expect(votes(row)).toEqual(votes(verified));
      expect(row.turnout_votes).toBe(verified.turnout_votes);
      expect(row.spoilt_ballots).toBe(verified.spoilt_ballots);
      expect(row.electorate).toBe(verified.electorate);
    }
    // Halton prints "34%"; the script records the exact 2,055 of 6,064.
    expect(run("halton-beechwood-heath-2026-10-29").row.turnout_pct).toBe(0.3389);
  });

  it("keeps Bassetlaw and Dudley pending, as a person reading them did", () => {
    // Bassetlaw: 1,304 papers issued against 1,308 counted, and the rejected
    // table prints no total, so nothing can be reconciled.
    expect(run("bassetlaw-worksop-east-2026-10-29").result.ok).toBe(false);
    // Dudley's page sets "Elected" on the wrong row and has no declaration sentence.
    const dudley = run("dudley-st-jamess-2026-10-29").result;
    expect(dudley.ok).toBe(false);
    expect(dudley.reasons.join(" ")).toMatch(/not the top count/);
  });

  it("refuses a misread count that the arithmetic catches", () => {
    const doc = contest("wychavon-hartlebury-2026-10-22");
    const text = fromFixtures(FIXTURES, doc).text.replace("Reform UK 238", "Reform UK 248");
    const result = reconcile(parseDeclaration(text, doc), doc, null);
    expect(result.ok).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/ballot papers does not reconcile/);
  });

  it("refuses a declaration with no cross-check at all", () => {
    const doc = contest("leeds-calverley-farsley-2026-10-22");
    const result = reconcile(parseDeclaration(fromFixtures(FIXTURES, doc).text, doc), doc, null);
    expect(result.ok).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/no cross-check is possible/);
  });

  it("refuses an unlisted candidate's figure in the table", () => {
    const doc = contest("newark-and-sherwood-dover-beck-2026-10-29");
    const text = fromFixtures(FIXTURES, doc).text.replace("SPOORS,", "SMITH, Independent 5\nSPOORS,");
    expect(reconcile(parseDeclaration(text, doc), doc, null).reasons.join(" ")).toMatch(/6 figures for 5 candidates/);
  });
});

describe("results morning, the guards", () => {
  it("never overwrites a hand-verified row", () => {
    const doc = { results: [{ ballot_paper_id: "a", review_status: "hand_verified_two_sources" }, { ballot_paper_id: "b", review_status: "auto_ingested_dc" }] };
    const { written, kept } = mergeRows(doc, [{ ballot_paper_id: "a" }, { ballot_paper_id: "b", review_status: "hand_verified_declaration" }, { ballot_paper_id: "c" }]);
    expect(kept).toEqual(["a"]);
    expect(written).toEqual(["b", "c"]);
    expect(doc.results[0].review_status).toBe("hand_verified_two_sources");
    expect(doc.results[1].review_status).toBe("hand_verified_declaration");
  });

  it("treats a robots disallow as a stop", () => {
    const robots = "User-agent: *\nDisallow: /elections/\nAllow: /elections/results/\n\nUser-agent: ukelections-results-morning\nDisallow: /private/";
    expect(robotsAllows(robots, "https://x.gov.uk/private/a.pdf")).toBe(false);
    expect(robotsAllows(robots, "https://x.gov.uk/elections/a.pdf")).toBe(true);
    expect(robotsAllows("User-agent: *\nDisallow: /elections/\nAllow: /elections/results/", "https://x.gov.uk/elections/a.pdf")).toBe(false);
    expect(robotsAllows("User-agent: *\nDisallow: /elections/\nAllow: /elections/results/", "https://x.gov.uk/elections/results/a.pdf")).toBe(true);
    expect(robotsAllows("", "https://x.gov.uk/anything")).toBe(true);
  });

  it("does not run on count night", () => {
    expect(duringCountNight(new Date("2026-11-12T21:30:00Z"), "2026-11-12")).toBe(true);
    expect(duringCountNight(new Date("2026-11-13T05:59:00Z"), "2026-11-12")).toBe(true);
    expect(duringCountNight(new Date("2026-11-13T07:00:00Z"), "2026-11-12")).toBe(false);
    // British Summer Time: 20:30 UTC on 7 May is 21:30 in the UK.
    expect(duringCountNight(new Date("2026-05-07T20:30:00Z"), "2026-05-07")).toBe(true);
  });

  it("finds a declaration link by the ward, including Hyndburn's bare Download links", () => {
    const hyndburn =
      '<p>Hyndburn Borough Council Huncoat Election Results 2026</p><a href="/download/x/?filename=Results-Huncoat-2026.pdf">Download</a>' +
      '<p>Notice of Election Huncoat</p><a href="/download/notice-huncoat.pdf">Download</a>';
    expect(declarationLinks(hyndburn, "https://www.hyndburnbc.gov.uk/download/election-results/", "Huncoat")).toEqual([
      "https://www.hyndburnbc.gov.uk/download/x/?filename=Results-Huncoat-2026.pdf",
    ]);
    const midSuffolk =
      '<a href="/documents/d/mid-suffolk/declaration-of-result-bosmere">Suffolk County Council (Bosmere Division May 2026)</a>' +
      '<a href="/documents/d/mid-suffolk/bosmere-by-election-declaration">Bosmere Division By-Election (November 2026)</a>';
    expect(declarationLinks(midSuffolk, "https://www.midsuffolk.gov.uk/election-results", "Bosmere", { exclude: "may 2026" })).toEqual([
      "https://www.midsuffolk.gov.uk/documents/d/mid-suffolk/bosmere-by-election-declaration",
    ]);
  });

  it("knows where to look for every contest polling on 12 November 2026", () => {
    const sources = read("data/results/declaration-sources.json");
    for (const slug of ["hyndburn-huncoat", "north-east-lincolnshire-croft-baker", "oldham-failsworth-west", "staffordshire-moorlands-cheddleton", "suffolk-bosmere", "wigan-hindley-green"]) {
      const doc = contest(`${slug}-2026-11-12`);
      expect(doc.contest.voting_system).toBe("FPTP");
      expect(sources.councils[doc.contest.council_slug]?.index_url).toMatch(/^https:\/\//);
    }
  });
});
