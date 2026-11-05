import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { localContestGroups, loadLocalHub } from "../src/lib/byElections";
import { loadDownloads, downloadDistributions, recordedDataDate } from "../src/lib/downloads";
import { PUBLISHED_DATA } from "../src/lib/publishedData";
import { NAV_GROUPS, getIndexableSitePaths } from "../src/lib/site";
import { buildDataset } from "../src/lib/seo";
import { CALENDAR, longDate } from "../src/lib/nextElections";

const record = (slug: string, day: string, declared = false) => ({
  slug, contest: { polling_day: day }, result: declared ? { declared: true } : null,
});

describe("shared council by-election hub data", () => {
  it("keeps pending results, declared STV and the next polling day consistent", () => {
    const contests = [record("future", "2026-11-12"), record("old", "2026-10-15", true),
      record("awaited", "2026-10-29"), { ...record("stv", "2026-10-22"), declaration: { declared: true } }];
    const groups = localContestGroups(contests, "2026-11-04");
    expect(groups.latest.map(c => c.slug)).toEqual(["awaited", "stv"]);
    expect(groups.earlier.map(c => c.slug)).toEqual(["old"]);
    expect(groups.nextDay).toBe("2026-11-12");
    expect(localContestGroups([], "2026-11-04").nextDay).toBeNull();
  });
  it("moves a polled contest into the results window without modifying its record", () => {
    const input = [record("poll", "2026-11-05")];
    expect(localContestGroups(input, "2026-11-04").latest).toEqual([]);
    expect(localContestGroups(input, "2026-11-06").latest).toEqual(input);
    expect(input[0].result).toBeNull();
  });
  it("reads the refresh date from the same metadata as the local hub", () => {
    const hub = loadLocalHub();
    const meta = JSON.parse(readFileSync("data/contests/local-byelections/_meta.json", "utf8"));
    expect(hub.updatedAt).toBe(meta.generated_at.slice(0, 10));
    for (const page of ["src/pages/by-elections/index.astro", "src/pages/by-elections/local/index.astro"])
      expect(readFileSync(page, "utf8")).toContain("loadLocalHub()");
  });
});

describe("downloads and discovery", () => {
  it("catalogues every published file exactly once and uses its actual format", () => {
    const downloads = loadDownloads();
    expect(downloads.map(f => f.path)).toEqual(PUBLISHED_DATA.map(f => f.path));
    expect(new Set(downloads.map(f => f.href)).size).toBe(downloads.length);
    for (const file of downloads) {
      expect(existsSync(`data/${file.path}`)).toBe(true);
      expect(file.source.publisher).toBe("UK Elections");
      expect(file.source.document).toBe(file.label);
      expect(file.source.edition).not.toBe("");
      expect(file.source.section).not.toBe("");
      expect(file.source.upstream).not.toBe("");
      expect(file.format).toBe(file.path.endsWith(".json") ? "application/json" : file.path.endsWith(".csv") ? "text/csv" : "text/markdown");
    }
  });
  it("keeps missing dates unknown and derives alternate exports from their JSON", () => {
    expect(recordedDataDate({})).toBeNull();
    expect(recordedDataDate({ generated_at: "not a date" })).toBeNull();
    expect(recordedDataDate({ snapshot: { generated_at: "2026-10-21T03:30:07Z" } })).toBe("2026-10-21T03:30:07Z");
    const files = loadDownloads();
    const json = files.find(f => f.path.endsWith("controlled-councils.json"))!;
    for (const suffix of ["csv", "md"]) expect(files.find(f => f.path.endsWith(`controlled-councils.${suffix}`))!.date).toBe(json.date);
    expect(files.find(f => f.path.endsWith("source-registry.json"))!.source.edition).toBe("Schema 1");
    expect(json.source.upstream).toContain("approximated");
  });
  it("includes every catalogue download in the Dataset distributions", () => {
    const distributions = downloadDistributions();
    const node = buildDataset({ name: "Election data", description: "Published data", url: "https://ukelections.co.uk/downloads/", distributions });
    expect(node.distribution).toEqual(distributions);
    expect(distributions.map(d => d.contentUrl)).toEqual(PUBLISHED_DATA.map(f => `https://ukelections.co.uk/data/${f.path}`));
  });
  it("keeps one council hub in navigation and the sitemap with exact redirects", () => {
    expect(getIndexableSitePaths()).toContain("/councils/");
    expect(getIndexableSitePaths()).toContain("/downloads/");
    expect(getIndexableSitePaths()).not.toContain("/seats/");
    expect(NAV_GROUPS.flatMap(g => g.items).filter(i => i.href === "/councils/")).toHaveLength(1);
    expect(NAV_GROUPS.flatMap(g => g.items).some(i => i.href === "/seats/")).toBe(false);
    const redirects = readFileSync("public/_redirects", "utf8");
    expect(redirects).toMatch(/^\/seats \/councils\/ 301$/m);
    expect(redirects).toMatch(/^\/seats\/ \/councils\/ 301$/m);
    expect(redirects).not.toMatch(/^\/seats\/\*/m);
  });
  it("formats the existing legal deadline with the correct weekday", () => {
    const general = CALENDAR.find(row => row.id === "general-election")!;
    expect(longDate(general.date_iso!)).toBe("Wednesday 15 August 2029");
    expect(general.sources.some(s => s.url.endsWith("/2022/11/section/4"))).toBe(true);
  });
});
