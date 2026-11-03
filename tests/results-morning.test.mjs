import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildRow,
  collectResults,
  politeFetch,
  writeSidecar,
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


describe("results morning, failed and late fetches", () => {
  afterEach(() => vi.restoreAllMocks());
  const state = () => ({ previous: {}, hosts: {} });
  const options = { persist: () => {} };

  it("continues after a failed fetch and leaves that contest untouched", async () => {
    const failed = contest("wychavon-hartlebury-2026-10-22");
    const good = contest("leeds-calverley-farsley-2026-10-22");
    const saved = structuredClone({ results: sidecar });
    const before = structuredClone(saved.results.find((r) => r.ballot_paper_id === failed.contest.ballot_paper_id));
    const report = await collectResults([failed, good], async (c) => {
      if (c === failed) throw new Error("connection reset");
      return { ...fromFixtures(FIXTURES, c), source: "fixture" };
    }, "2026-11-03", () => {});
    expect(report.rows).toHaveLength(1);
    expect(report.pending).toEqual([{ label: "Wychavon, Hartlebury", why: "fetch or extraction failed: connection reset", failed: true }]);
    mergeRows(saved, report.rows);
    expect(saved.results.find((r) => r.ballot_paper_id === before.ballot_paper_id)).toEqual(before);
  });

  it("tries a missing declaration again on a later run", async () => {
    const c = contest("wychavon-hartlebury-2026-10-22");
    const early = await collectResults([c], async () => ({ blocked: "HTTP 404" }), "2026-11-03", () => {});
    expect(early.rows).toEqual([]);
    expect(early.pending[0].failed).toBe(false);
    const later = await collectResults([c], async () => ({ ...fromFixtures(FIXTURES, c), source: "fixture" }), "2026-11-03", () => {});
    expect(later.rows).toHaveLength(1);
  });

  it("bounds requests and persists the fetch time before a connection fails", async () => {
    const saved = state();
    const persist = vi.fn();
    const timeout = vi.spyOn(AbortSignal, "timeout");
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("User-agent: *\nAllow: /"))
      .mockImplementationOnce(async (_url, init) => {
        expect(persist).toHaveBeenCalledWith(saved);
        expect(saved.hosts["example.gov.uk"]).toBeTruthy();
        expect(init.signal).toBeInstanceOf(AbortSignal);
        throw new Error("request timed out");
      });
    await expect(politeFetch("https://example.gov.uk/result", saved, { persist })).rejects.toThrow("request timed out");
    expect(timeout).toHaveBeenCalledWith(20_000);
  });

  it("does not follow an unchecked redirect", async () => {
    const fetch = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(""))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://other.gov.uk/private" } }));
    expect((await politeFetch("https://example.gov.uk/result", state(), options)).blocked).toContain("redirect");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.every(([, init]) => init.redirect === "manual")).toBe(true);
  });

  it("does not retry a council after a 403 or a large bot challenge", async () => {
    for (const response of [new Response("Forbidden", { status: 403 }), new Response(`<title>Just a moment</title>${" ".repeat(5000)}`, { headers: { "content-type": "text/html" } })]) {
      const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("")).mockResolvedValueOnce(response);
      const saved = state();
      expect((await politeFetch("https://example.gov.uk/result", saved, options)).failed).toBe(true);
      expect((await politeFetch("https://example.gov.uk/other", saved, options)).failed).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(2);
      fetch.mockRestore();
    }
  });

  it("checks the hourly gap before requesting robots", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const saved = state();
    saved.previous["example.gov.uk"] = new Date().toISOString();
    expect((await politeFetch("https://example.gov.uk/result", saved, options)).blocked).toContain("less than an hour");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not read a declaration if robots cannot be read", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network error"));
    expect((await politeFetch("https://example.gov.uk/result", state(), options)).failed).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});


describe("results morning, durable records", () => {
  it("preserves missing figures and their provenance when replacing a weaker row", () => {
    const previous = { ballot_paper_id: "a", review_status: "auto_ingested_dc", turnout_votes: 120, electorate: 200, source: "original source", custom_note: "retain me" };
    const saved = { results: [previous] };
    mergeRows(saved, [{ ballot_paper_id: "a", review_status: "hand_verified_declaration", turnout_votes: null, electorate: null, spoilt_ballots: 0, verification_note: "New declaration" }]);
    expect(saved.results[0]).toMatchObject({ turnout_votes: 120, electorate: 200, spoilt_ballots: 0, custom_note: "retain me" });
    expect(saved.results[0].verification_note).toContain("original source");
    expect(saved.results[0].verification_note).toContain("not verified by this declaration read");
  });

  it("preserves every field of both hand verified tiers", () => {
    for (const review_status of ["hand_verified_declaration", "hand_verified_two_sources"]) {
      const saved = { results: [{ ballot_paper_id: "a", review_status, verification_note: "checked", turnout_votes: 123, candidates: [{ name: "A", votes: 121 }] }] };
      const before = JSON.stringify(saved);
      expect(mergeRows(saved, [{ ballot_paper_id: "a", turnout_votes: 999 }]).written).toEqual([]);
      expect(JSON.stringify(saved)).toBe(before);
    }
  });

  it("replaces the sidecar as a complete file and preserves it if serialisation fails", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "results-morning-test-"));
    try {
      const file = path.join(dir, "sidecar.json");
      writeFileSync(file, "original");
      const invalid = {}; invalid.self = invalid;
      expect(() => writeSidecar(file, invalid)).toThrow();
      expect(readFileSync(file, "utf8")).toBe("original");
      writeSidecar(file, { results: [] });
      expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ results: [] });
      expect(readdirSync(dir)).toEqual(["sidecar.json"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses to write saved fixtures into the real sidecar", () => {
    const file = "data/history/byelection-appends.json";
    const before = readFileSync(file);
    const result = spawnSync(process.execPath, ["scripts/results-morning.mjs", "--date=2026-10-22", `--fixtures=${FIXTURES}`, "--write"], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Saved fixtures are for dry runs only");
    expect(readFileSync(file)).toEqual(before);
  });
});


// Exercise the real command in an isolated repository with mocked HTTP only.
function sandboxRun(run) {
  const dir = mkdtempSync(path.join(tmpdir(), "results-morning-cli-"));
  try {
    for (const child of ["scripts", "data/contests/local-byelections", "data/results", "data/history"]) mkdirSync(path.join(dir, child), { recursive: true });
    writeFileSync(path.join(dir, "scripts/results-morning.mjs"), readFileSync("scripts/results-morning.mjs"));
    const c = contest("wychavon-hartlebury-2026-10-22");
    writeFileSync(path.join(dir, `data/contests/local-byelections/${c.slug}.json`), JSON.stringify(c));
    writeFileSync(path.join(dir, "data/results/declaration-sources.json"), JSON.stringify({ contests: { [c.contest.ballot_paper_id]: { url: "https://example.gov.uk/result" } } }));
    const sidecarFile = path.join(dir, "data/history/byelection-appends.json");
    writeFileSync(sidecarFile, JSON.stringify({ results: [{ ballot_paper_id: c.contest.ballot_paper_id, review_status: "auto_ingested_dc", turnout_votes: 633 }] }));
    const preload = path.join(dir, "http.mjs");
    const command = () => spawnSync(process.execPath, ["--import", preload, "scripts/results-morning.mjs", "--date=2026-10-22", "--write", "--report=report.json"], { cwd: dir, encoding: "utf8" });
    run({ dir, c, sidecarFile, preload, command });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("results morning, command failure recovery", () => {
  it("leaves the sidecar byte identical and reports a network failure", () => sandboxRun(({ dir, sidecarFile, preload, command }) => {
    const before = readFileSync(sidecarFile);
    writeFileSync(preload, 'globalThis.fetch = async () => { throw new Error("offline"); };');
    const result = command();
    expect(result.status).toBe(1);
    expect(readFileSync(sidecarFile)).toEqual(before);
    expect(JSON.parse(readFileSync(path.join(dir, "report.json"))).pending[0].failed).toBe(true);
  }));

  it("retries finalisation after saving the sidecar without replacing a verified row", () => sandboxRun(({ dir, c, sidecarFile, preload, command }) => {
    const text = fromFixtures(FIXTURES, c).text;
    writeFileSync(preload, `globalThis.fetch = async (url) => new Response(url.endsWith("robots.txt") ? "" : url.includes("example.gov.uk") ? ${JSON.stringify(text)} : "", { status: url.includes("democracyclub") ? 404 : 200, headers: { "content-type": "text/plain" } });`);
    const finaliser = path.join(dir, "scripts/finalise-october-byelection-results.mjs");
    writeFileSync(finaliser, 'process.exit(1);');
    expect(command().status).toBe(1);
    const saved = readFileSync(sidecarFile);
    expect(JSON.parse(saved).results[0].review_status).toBe("hand_verified_declaration");
    // Simulate the later retry, outside the hourly council guard.
    writeFileSync(path.join(dir, ".cache/results-morning/last-fetch.json"), "{}");
    writeFileSync(finaliser, 'import { writeFileSync } from "node:fs"; writeFileSync("finalised", "yes");');
    expect(command().status).toBe(0);
    expect(readFileSync(sidecarFile)).toEqual(saved);
    expect(readFileSync(path.join(dir, "finalised"), "utf8")).toBe("yes");
  }));
});
