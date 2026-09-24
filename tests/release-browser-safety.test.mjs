import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("production browser safeguards", () => {
  it("keeps the shared contact address out of Cloudflare email rewriting", () => {
    const layout = read("src/layouts/BaseLayout.astro");
    const start = layout.indexOf("<!--email_off-->");
    const email = layout.indexOf("mailto:info@ukelections.co.uk");
    const end = layout.indexOf("<!--/email_off-->");

    expect(start).toBeGreaterThan(-1);
    expect(email).toBeGreaterThan(start);
    expect(end).toBeGreaterThan(email);
  });

  it("puts the polling tables in labelled horizontal scroll regions", () => {
    const polling = read("src/pages/polling/index.astro");
    expect(polling.match(/class="table-scroll"/g)).toHaveLength(4);
    expect(polling.match(/role="region"/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("puts the council ward table in a labelled horizontal scroll region", () => {
    const council = read("src/pages/seats/[council]/index.astro");
    expect(council).toMatch(/class="table-scroll"[^>]+aria-label=.*ward forecasts and results/);
    expect(council).toMatch(/<div class="table-scroll"[\s\S]*<table class="ward-grid"/);
  });
});
