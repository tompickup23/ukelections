import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const page = (relative: string) =>
  readFileSync(path.join(process.cwd(), "src/pages", relative), "utf8");

describe("search-demand destinations", () => {
  it("answers what a ward is in static HTML and keeps crawlable browse fallbacks", () => {
    const source = page("your-area.astro");
    const script = source.indexOf("<script type=\"application/json\"");
    expect(source.indexOf("Council ward")).toBeGreaterThan(-1);
    expect(source.indexOf("Council ward")).toBeLessThan(script);
    expect(source).toContain('href="/seats/parliament/"');
    expect(source).toContain('href="/councils/"');
  });

  it("makes council control definitions, map source and text equivalent crawlable", () => {
    const source = page("councils/index.astro");
    expect(source).toContain("CouncilControlMap");
    expect(source).toMatch(/more than half of all council seats/);
    expect(source).toMatch(/not Westminster parliamentary constituencies/);
    expect(source).toMatch(/text equivalent of the map/);
    const map = readFileSync(path.join(process.cwd(), "src/components/CouncilControlMap.astro"), "utf8");
    expect(map).toMatch(/County councils and new authorities/);
  });

  it("separates polls, vote share, seats and constituency forecasts", () => {
    const source = page("forecasts/general-election/index.astro");
    for (const label of ["Polling evidence", "National vote share", "Seat projection", "Constituency forecasts"]) {
      expect(source).toContain(label);
    }
    expect(source).not.toContain("Refreshed daily from the latest");
    expect(source).toContain("/data/predictions/ge-next/constituencies.json");
  });

  it("links Makerfield result claims to the returning officer and completes the related journey", () => {
    const result = page("by-elections/makerfield/index.astro");
    const seat = page("seats/parliament/[constituency]/index.astro");
    expect(result).toContain("electionresults.wigan.gov.uk/ParliamentaryElections/Home/Index/3");
    expect(result).toContain("Statement-of-persons-nominated-and-notice-of-Poll-Makerfield-2026.pdf");
    expect(result).toContain("https://ukdemographics.co.uk/constituencies/makerfield/");
    expect(seat).toContain('href: "/by-elections/makerfield/"');
  });
});
