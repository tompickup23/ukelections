// The ward page quality reset (register T13, November 2026): ward pages
// noindex,follow and out of the sitemap unless they hold a contest of their
// own; the sitemap split into an index by page type; the ward results table
// and new title on the council pages; constituency lastmod tied to the
// headline. Each block names the rule it pins.
import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { byElectionsSince, loadWardByElections, wardIndexDecision, type WardByElection } from "../src/lib/wardIndexing";
import { councilTitle, councilDescription, wardTableRow } from "../src/lib/councilPage";
import { summariseWardResult, seatsWonLabel, resultSourceLabel, type RawWardResult } from "../src/lib/may7WardResult";
import { SITEMAP_GROUPS, sitemapGroupFor } from "../src/lib/sitemapPaths";
import { PARLIAMENT_REGIONS } from "../src/lib/parliamentRegions";
import { pageFingerprint, planDiscovery, sitemapFiles, stampDiscoveryDates } from "../scripts/lib/discovery-manifest.mjs";
import { childSitemapUrls } from "../scripts/indexnow-submit.mjs";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const origin = "https://ukelections.co.uk";

const by = (over: Partial<WardByElection>): WardByElection => ({
  slug: "x-ward-2026-10-22",
  pollingDay: "2026-10-22",
  status: "concluded",
  declared: false,
  winnerParty: null,
  winnerCandidate: null,
  winnerVotes: null,
  totalVotes: null,
  majorityVotes: null,
  candidateCount: null,
  fieldPublished: false,
  resultSource: null,
  nominationsUrl: null,
  resultUpdatedAt: null,
  ...over,
});

describe("ward re-admission rule", () => {
  it("keeps a ward with nothing of its own out of the index", () => {
    expect(wardIndexDecision({ byElections: [] }).index).toBe(false);
  });
  it("admits a ward with a declared by-election result", () => {
    expect(wardIndexDecision({ byElections: [by({ declared: true, winnerParty: "Labour" })] }).index).toBe(true);
  });
  it("admits an upcoming by-election only once its candidates are published", () => {
    expect(wardIndexDecision({ today: "2026-10-22", byElections: [by({ status: "upcoming", fieldPublished: true, candidateCount: 4 })] }).index).toBe(true);
    expect(wardIndexDecision({ byElections: [by({ status: "upcoming", fieldPublished: false })] }).index).toBe(false);
  });
  it("does not admit a by-election whose polls closed before we hold the result", () => {
    expect(wardIndexDecision({ byElections: [by({ status: "polls_closed", fieldPublished: true })] }).index).toBe(false);
    expect(wardIndexDecision({ today: "2026-10-23", byElections: [by({ status: "upcoming", fieldPublished: true })] }).index).toBe(false);
  });
  it("admits a 2027 contest with candidates (none held yet)", () => {
    expect(wardIndexDecision({ byElections: [], contests2027WithCandidates: 3 }).index).toBe(true);
  });
});

describe("by-elections matched to a ward", () => {
  const dir = mkdtempSync(join(tmpdir(), "uke-wardby-"));
  const contest = (slug: string, day: string, extra: any = {}) =>
    writeFileSync(join(dir, `${slug}.json`), JSON.stringify({
      slug,
      status: "concluded",
      contest: { polling_day: day, council_slug: "leeds", ward_slug: "calverley-farsley", ward_gss: "E05001416" },
      result: { declared: true, winner_party: "Conservative", winner_votes: 2330, majority_votes: 196, source: "https://www.leeds.gov.uk/elections" },
      sources: [{ label: "Returning officer declaration (verified)", url: "https://www.leeds.gov.uk/elections" }],
      ...extra,
    }));
  contest("leeds-calverley-farsley-2026-10-22", "2026-10-22");
  contest("leeds-calverley-farsley-2025-03-06", "2025-03-06");
  writeFileSync(join(dir, "_meta.json"), "{}");
  const all = loadWardByElections(dir);
  rmSync(dir, { recursive: true, force: true });

  it("keeps only contests after 7 May 2026, once each, by slug or GSS", () => {
    const rows = byElectionsSince({ council_slug: "leeds", ward_slug: "calverley-farsley", gss_code: "E05001416" }, all);
    expect(rows.map((r) => r.slug)).toEqual(["leeds-calverley-farsley-2026-10-22"]);
    expect(rows[0].resultSource?.label).toBe("Returning officer declaration (verified)");
    expect(byElectionsSince({ council_slug: "x", ward_slug: "y", gss_code: "E05001416" }, all)).toHaveLength(1);
  });
});

describe("council page title and snippet", () => {
  it("promises the next election only where the date is verified", () => {
    expect(councilTitle("Burnley", true)).toBe("Burnley election results 2026 and next election");
    expect(councilTitle("Colchester", false)).toBe("Colchester election results 2026");
  });
  it("stays under 160 characters and drops the next-election clause first", () => {
    const d = councilDescription({ councilName: "Burnley", controlHeadline: "No overall control. Labour largest party", seatsUp: 15, nextLabel: "Thursday 6 May 2027" });
    expect(d.length).toBeLessThan(160);
    expect(d).toContain("Next: Thursday 6 May 2027.");
    expect(councilDescription({ councilName: "Burnley", controlHeadline: "x", seatsUp: 15, nextLabel: null })).not.toContain("Next");
    const long = councilDescription({ councilName: "Royal Borough of Windsor and Maidenhead", controlHeadline: "No overall control. Liberal Democrats largest party", seatsUp: 41, nextLabel: "Thursday 6 May 2027, all seats" });
    expect(long.length).toBeLessThan(160);
    expect(long).not.toContain("Next:");
  });
  it("is the only council title the component writes", () => {
    const src = read("src/components/CouncilDetail.astro");
    expect(src).toContain("const title = councilTitle(councilName, nextKnown);");
    expect(src).not.toContain("council seats and results, 2026");
    expect(src).not.toMatch(/May 7 2026 (result|council election)/);
  });
});

describe("council ward table rows", () => {
  const raw = (over: Partial<RawWardResult>): RawWardResult => ({
    ballot_paper_id: "local.test.ward.2026-05-07",
    election_date: "2026-05-07",
    tier: "local",
    council_slug: "test",
    ward_slug: "ward",
    is_by_election: false,
    winner_count: 1,
    electorate: null,
    turnout_votes: null,
    turnout_pct: 0.31,
    spoilt_ballots: null,
    total_valid_votes: null,
    candidates: [
      { person_id: 1, name: "A", party_name: "Labour", party_canonical: "Labour", votes: 600, elected: true },
      { person_id: 2, name: "B", party_name: "Reform UK", party_canonical: "Reform UK", votes: 400, elected: false },
    ],
    vote_shares: null,
    winner_party_canonical: "Labour",
    winners: null,
    source: "https://example.gov.uk/results",
    source_provider: "dc-api",
    ingested_at: "2026-05-10T12:00:00Z",
    ...over,
  });
  const won = (r: any) => seatsWonLabel(r, (p) => p);

  it("shows the winner's votes and share in a one-seat ward", () => {
    const row = wardTableRow(summariseWardResult(raw({}), 2), won);
    expect(row).toEqual({ wonBy: "Labour", votes: 600, share: 0.6, turnoutPct: 0.31 });
  });
  it("shows the last candidate elected in a multi-seat ward", () => {
    const r = raw({
      winner_count: 2,
      candidates: [
        { person_id: 1, name: "A", party_name: "Labour", party_canonical: "Labour", votes: 600, elected: true },
        { person_id: 2, name: "B", party_name: "Reform UK", party_canonical: "Reform UK", votes: 500, elected: true },
        { person_id: 3, name: "C", party_name: "Green Party", party_canonical: "Green Party", votes: 400, elected: false },
      ],
    });
    expect(wardTableRow(summariseWardResult(r, 3), won).votes).toBe(500);
  });
  it("withholds the share when the field is incomplete", () => {
    expect(wardTableRow(summariseWardResult(raw({}), 4), won).share).toBeNull();
  });
  it("names the source and the edition the ward page names", () => {
    const s = resultSourceLabel(summariseWardResult(raw({}), 2)!);
    expect(s).toMatchObject({ short: "Democracy Club", href: "https://example.gov.uk/results", captured: "10 May 2026" });
    expect(resultSourceLabel(summariseWardResult(raw({ source_provider: "wikipedia" }), 2)!).short).toBe("Wikipedia (provisional)");
  });
  it("is what the council page renders, from the ward page's own helper", () => {
    const src = read("src/components/CouncilDetail.astro");
    expect(src).toContain("const result = wardResultFor(w);");
    expect(read("src/pages/seats/[council]/[ward]/index.astro")).toContain("const resultRow = wardResultRowFor(ward);");
  });
});

describe("robots meta by page type", () => {
  it("the ward page asks for noindex unless the rule admits it", () => {
    expect(read("src/pages/seats/[council]/[ward]/index.astro")).toContain("noIndex={!indexDecision.index}");
  });
  it("council, constituency and by-election pages never ask for noindex", () => {
    for (const p of [
      "src/components/CouncilDetail.astro",
      "src/pages/seats/parliament/[constituency]/index.astro",
      "src/pages/by-elections/local/[slug].astro",
    ]) expect(read(p), p).not.toMatch(/noIndex/);
  });
});

describe("sitemap groups", () => {
  it("sorts each path type into its own child sitemap", () => {
    expect(sitemapGroupFor("/")).toBe("core");
    expect(sitemapGroupFor("/by-elections/")).toBe("core");
    expect(sitemapGroupFor("/by-elections/local/")).toBe("core");
    expect(sitemapGroupFor("/seats/parliament/")).toBe("core");
    expect(sitemapGroupFor("/seats/burnley/")).toBe("councils");
    expect(sitemapGroupFor("/seats/leeds/calverley-farsley/")).toBe("councils");
    expect(sitemapGroupFor("/seats/parliament/burnley/")).toBe("constituencies");
    expect(sitemapGroupFor("/by-elections/local/leeds-calverley-farsley-2026-10-22/")).toBe("by-elections");
    expect(sitemapGroupFor("/by-elections/makerfield/")).toBe("by-elections");
    expect(sitemapGroupFor("/by-elections/archive/2025/")).toBe("by-elections");
  });
  it("robots.txt declares the index and nothing else", async () => {
    const { GET } = await import("../src/pages/robots.txt");
    const text = await (await GET({} as any)).text();
    expect(text.match(/^Sitemap:/gm)).toHaveLength(1);
    expect(text).toContain("Sitemap: https://ukelections.co.uk/sitemap.xml");
  });
  it("the index lists one child per group", async () => {
    const { GET } = await import("../src/pages/sitemap.xml");
    const xml = await (await GET({} as any)).text();
    expect(xml).toContain("<sitemapindex");
    expect(childSitemapUrls(xml)).toEqual(SITEMAP_GROUPS.map((g) => `${origin}/sitemap-${g}.xml`));
  });
});

describe("discovery over a sitemap index", () => {
  const page = (route: string, text: string, headline?: string) =>
    `<html><head><title>T</title><link rel="canonical" href="${origin}${route}"><meta name="description" content="D"></head><body><main><p${headline ? ` data-discovery-headline="${headline}"` : ""}>${text}</p></main></body></html>`;

  it("reads, plans and stamps every child file, and dates each index entry by its newest route", () => {
    const root = mkdtempSync(join(tmpdir(), "uke-index-"));
    try {
      writeFileSync(join(root, "sitemap.xml"), `<sitemapindex>\n  <sitemap>\n    <loc>${origin}/sitemap-core.xml</loc>\n  </sitemap>\n  <sitemap>\n    <loc>${origin}/sitemap-councils.xml</loc>\n  </sitemap>\n</sitemapindex>\n`);
      writeFileSync(join(root, "sitemap-core.xml"), `<urlset>\n  <url>\n    <loc>${origin}/a/</loc>\n  </url>\n</urlset>\n`);
      writeFileSync(join(root, "sitemap-councils.xml"), `<urlset>\n  <url>\n    <loc>${origin}/seats/b/</loc>\n  </url>\n</urlset>\n`);
      for (const r of ["/a/", "/seats/b/"]) { mkdirSync(join(root, r), { recursive: true }); writeFileSync(join(root, r, "index.html"), page(r, "10 votes")); }
      expect(sitemapFiles(root).map((f) => f.slice(root.length))).toEqual(["/sitemap-core.xml", "/sitemap-councils.xml"]);
      const first = planDiscovery(root, null, "2026-11-16T04:40:00Z");
      expect(Object.keys(first.pages)).toEqual([`${origin}/a/`, `${origin}/seats/b/`]);
      writeFileSync(join(root, "seats/b/index.html"), page("/seats/b/", "11 votes"));
      const second = planDiscovery(root, first as any, "2026-11-17T04:40:00Z");
      expect(second.changed).toEqual([`${origin}/seats/b/`]);
      stampDiscoveryDates(root, second);
      expect(readFileSync(join(root, "sitemap-councils.xml"), "utf8")).toContain("<lastmod>2026-11-17T04:40:00Z</lastmod>");
      expect(readFileSync(join(root, "sitemap-core.xml"), "utf8")).not.toContain("<lastmod>");
      const index = readFileSync(join(root, "sitemap.xml"), "utf8");
      expect(index).toMatch(/sitemap-councils\.xml<\/loc>\n    <lastmod>2026-11-17T04:40:00Z<\/lastmod>/);
      expect(index).not.toMatch(/sitemap-core\.xml<\/loc>\n    <lastmod>/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("re-dates a page with a headline only when the headline changes", () => {
    const url = `${origin}/seats/parliament/x/`;
    const base = pageFingerprint(page("/seats/parliament/x/", "Labour 41.2%", "Labour|Reform UK|41|6"), url);
    expect(pageFingerprint(page("/seats/parliament/x/", "Labour 41.4%", "Labour|Reform UK|41|6"), url)).toBe(base);
    expect(pageFingerprint(page("/seats/parliament/x/", "Labour 42.6%", "Labour|Reform UK|43|7"), url)).not.toBe(base);
    expect(pageFingerprint(page("/seats/parliament/x/", "Reform UK 41.2%", "Reform UK|Labour|41|6"), url)).not.toBe(base);
  });

  it("the constituency page marks its headline", () => {
    expect(read("src/pages/seats/parliament/[constituency]/index.astro")).toContain("data-discovery-headline={`${record.winner}|${record.runner_up}|");
  });
});

// Over the built site, where one exists (npm run build first). The counts are
// the per-type pins the prompt asks for: about 1,034 URLs after the reset,
// from 4,011, plus any ward the rule re-admits.
const DIST = join(process.cwd(), "dist");
const built = existsSync(join(DIST, "sitemap-councils.xml"));
describe.skipIf(!built)("built site", () => {
  const locs = (f: string) => [...readFileSync(join(DIST, f), "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const robots = (route: string) => readFileSync(join(DIST, route, "index.html"), "utf8").match(/<meta name="robots" content="([^"]*)"/)?.[1];

  it("serves noindex,follow on an ordinary ward page and index on the others", () => {
    expect(robots("seats/burnley/bank-hall")).toMatch(/^noindex,follow/);
    expect(robots("seats/burnley")).toMatch(/^index,follow/);
    expect(robots("seats/parliament/burnley")).toMatch(/^index,follow/);
    const local = readdirSync(join(DIST, "by-elections/local")).find((d) => existsSync(join(DIST, "by-elections/local", d, "index.html")));
    expect(robots(`by-elections/local/${local}`)).toMatch(/^index,follow/);
  });

  it("pins the per-type counts", () => {
    const counts = Object.fromEntries(SITEMAP_GROUPS.map((g) => [g, locs(`sitemap-${g}.xml`).length]));
    const contests = readdirSync(join(process.cwd(), "data/contests/local-byelections")).filter((f) => f.endsWith(".json") && !f.startsWith("_")).length;
    expect(counts.constituencies).toBe(650 + PARLIAMENT_REGIONS.length);
    expect(counts["by-elections"]).toBeGreaterThanOrEqual(contests);
    const wards = locs("sitemap-councils.xml").filter((u) => /\/seats\/[^/]+\/[^/]+\/$/.test(new URL(u).pathname));
    expect(counts.councils - wards.length).toBeGreaterThan(150);
    expect(wards.length).toBeLessThan(100);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(950);
    expect(total).toBeLessThan(1_200);
  });

  it("lists no URL whose page asks for noindex", () => {
    for (const g of SITEMAP_GROUPS) for (const u of locs(`sitemap-${g}.xml`)) {
      expect(robots(new URL(u).pathname.slice(1)) || "", u).not.toMatch(/noindex/);
    }
  });
});
