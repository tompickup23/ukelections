import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { getAidogeLink } from "../src/lib/siteData";
import { NAV_GROUPS } from "../src/lib/site";

describe("AI DOGE sister-site link", () => {
  it("resolves a council with a known lad24cd and aidoge page", () => {
    // Burnley: council-slug-to-lad24.json -> E07000117, present in both
    // registries with a published spending total.
    const link = getAidogeLink("burnley");
    expect(link).not.toBeNull();
    expect(link!.url).toBe("https://aidoge.co.uk/councils/burnley/");
    expect(link!.name).toBe("Burnley Borough Council");
  });

  it("returns null for a council_slug the join has no lad24cd for", () => {
    // County-tier remnant, unmatched in council-slug-to-lad24.json.
    expect(getAidogeLink("essex")).toBeNull();
  });

  it("resolves Barnsley and Sheffield across the 2025 boundary-change code split", () => {
    // council-slug-to-lad24.json carries the post-1-Apr-2025 reissued
    // codes (E08000038/E08000039); the aidoge join table, like
    // ukdemographics's area-code-aliases.json, still keys these two
    // councils on the pre-2025 codes the Census 2021 base uses
    // (E08000016/E08000019). The alias map in getAidogeLink bridges it.
    expect(getAidogeLink("barnsley")?.url).toBe("https://aidoge.co.uk/councils/barnsley/");
    expect(getAidogeLink("sheffield")?.url).toBe("https://aidoge.co.uk/councils/sheffield/");
  });

  it("never joins on name, only on the ONS/GSS code", () => {
    const councilMap = JSON.parse(
      readFileSync("data/identity/aidoge-council-map.json", "utf8")
    ).councils;
    // Every key in the join table is an ONS code (E/W/S + 8 digits), not a
    // slug or a display name.
    for (const code of Object.keys(councilMap)) {
      expect(code).toMatch(/^[EWS]\d{8}$/);
    }
  });

  it("lists AI DOGE in the About mega-menu group with the house-style wording", () => {
    const about = NAV_GROUPS.find((g) => g.label === "About");
    expect(about).toBeDefined();
    const item = about!.items.find((i) => i.href === "https://aidoge.co.uk");
    expect(item).toBeDefined();
    expect(item!.desc).toBe("Council spending on AI DOGE");
    expect(item!.desc).not.toMatch(/—/);
  });
});
