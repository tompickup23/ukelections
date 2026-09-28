import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  externalHref,
  buildBreadcrumbList,
  buildDataset,
  buildNewsArticle,
  publisherNode
} from "../src/lib/seo";
import { GET as newsSitemap } from "../src/pages/sitemap-news.xml";
import { getLastmodByPath } from "../src/lib/sitemapPaths";

describe("breadcrumbs", () => {
  it("prepends the site root and numbers positions from one", () => {
    const node = buildBreadcrumbList([
      { name: "Councils", href: "/councils/" },
      { name: "Burnley", href: "/seats/burnley/" }
    ]) as any;

    expect(node["@type"]).toBe("BreadcrumbList");
    expect(node.itemListElement.map((i: any) => i.position)).toEqual([1, 2, 3]);
    expect(node.itemListElement[0].name).toBe("UK Elections");
    expect(node.itemListElement[0].item).toBe("https://ukelections.co.uk/");
  });

  it("emits absolute URLs, because Google discards a relative breadcrumb item", () => {
    const node = buildBreadcrumbList([{ name: "Polling", href: "/polling/" }]) as any;
    for (const item of node.itemListElement) {
      expect(item.item).toMatch(/^https:\/\/ukelections\.co\.uk\//);
    }
  });
});

describe("NewsArticle", () => {
  const base = {
    headline: "Bank Hall, Burnley by-election result: Reform UK win",
    description: "Reform UK won the Bank Hall by-election.",
    url: "https://ukelections.co.uk/by-elections/local/burnley-bank-hall-2026-08-27/",
    datePublished: "2026-08-27T21:00:00Z"
  };

  it("carries the publisher logo Google requires for a news rich result", () => {
    const node = buildNewsArticle(base) as any;
    expect(node.publisher.logo["@type"]).toBe("ImageObject");
    expect(node.publisher.logo.url).toMatch(/^https:\/\//);
  });

  it("defaults dateModified to datePublished rather than leaving it absent", () => {
    expect((buildNewsArticle(base) as any).dateModified).toBe(base.datePublished);
  });

  it("refuses a headline over Google News' 110-character limit", () => {
    expect(() => buildNewsArticle({ ...base, headline: "x".repeat(111) })).toThrow(/110/);
  });

  it("omits image entirely when there is no card, rather than emitting an empty one", () => {
    expect(buildNewsArticle(base)).not.toHaveProperty("image");
  });
});

describe("Dataset", () => {
  const base = {
    name: "UK general election seat projection",
    description: "Projected winner for every constituency.",
    url: "https://ukelections.co.uk/forecasts/general-election/"
  };

  it("names a creator, a publisher and a licence", () => {
    const node = buildDataset(base) as any;
    expect(node["@type"]).toBe("Dataset");
    expect(node.creator.name).toBe("UK Elections");
    expect(node.publisher).toEqual(publisherNode());
    expect(node.license).toMatch(/^https:\/\//);
  });

  it("claims no distribution unless a real download URL is supplied", () => {
    expect(buildDataset(base)).not.toHaveProperty("distribution");
    const withFile = buildDataset({ ...base, distributionUrl: "https://ukelections.co.uk/ge.json" }) as any;
    expect(withFile.distribution[0].contentUrl).toBe("https://ukelections.co.uk/ge.json");
    expect(withFile.distribution[0].encodingFormat).toBe("application/json");
  });
});

describe("news sitemap editorial boundary", () => {
  it("does not advertise automated contest records as articles", async () => {
    const response = await newsSitemap({} as any);
    const xml = await response.text();
    expect(response.headers.get("Content-Type")).toContain("application/xml");
    expect(xml).toContain("<urlset");
    expect(xml).not.toContain("<url>");
    expect(xml).not.toContain("<news:news>");
  });
});

describe("homepage heading", () => {
  // The homepage shipped with zero h1 for weeks because its only h1 sat inside
  // the upcoming-contest hero, and no contest was upcoming. Assert the h1 is
  // reached before the conditional, so it cannot become data-dependent again.
  it("renders an h1 that does not depend on there being an upcoming contest", () => {
    const source = readFileSync(path.join(process.cwd(), "src/pages/index.astro"), "utf8");
    const firstH1 = source.indexOf("<h1>");
    const heroBranch = source.indexOf("{heroContest && (");

    expect(firstH1).toBeGreaterThan(-1);
    expect(heroBranch).toBeGreaterThan(-1);
    expect(firstH1).toBeLessThan(heroBranch);
  });

  it("names whichever contest is next instead of a hardcoded past by-election", () => {
    const source = readFileSync(path.join(process.cwd(), "src/pages/index.astro"), "utf8");
    expect(source).not.toMatch(/The Makerfield parliamentary by-election/);
  });
});

describe("sitemap lastmod", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "uke-lastmod-"));
    writeFileSync(
      path.join(dir, "burnley-bank-hall-2026-08-27.json"),
      JSON.stringify({ slug: "burnley-bank-hall-2026-08-27", contest: { polling_day: "2026-08-27" } })
    );
    writeFileSync(path.join(dir, "_index.json"), JSON.stringify({ slug: "ignored", contest: { polling_day: "2026-08-27" } }));
    writeFileSync(path.join(dir, "broken.json"), "{ not json");
    writeFileSync(path.join(dir, "no-polling-day.json"), JSON.stringify({ slug: "x", contest: {} }));
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("does not present polling day as a content modification", () => {
    expect(getLastmodByPath(dir)).toEqual({});
  });

  it("survives an unparseable or incomplete contest file", () => {
    expect(() => getLastmodByPath(dir)).not.toThrow();
  });

  it("returns nothing when the contest directory is absent", () => {
    expect(getLastmodByPath(path.join(dir, "nope"))).toEqual({});
  });
});

describe("externalHref", () => {
  it("passes an absolute http(s) URL through", () => {
    expect(externalHref("https://www.andrewteale.me.uk/leap/downloads")).toBe(
      "https://www.andrewteale.me.uk/leap/downloads"
    );
    expect(externalHref("http://example.gov.uk/result.pdf")).toBe("http://example.gov.uk/result.pdf");
  });

  it("rejects the attribution strings the corpus actually holds", () => {
    // Every one of these was being fed into an href, where a relative value
    // invents a URL under the current page. 1,663 rows in the ward history
    // table alone, and Google had crawled one of them.
    for (const attribution of [
      "BBC",
      "FT",
      "at the count",
      "Walsall MBC Website",
      "LEAP data at https://www.andrewteale.me.uk/leap/downloads",
      "Trafford Council Website: http://www.trafford.gov.uk/about-your-council/elections/docs/Dec"
    ]) {
      expect(externalHref(attribution)).toBeNull();
    }
  });

  it("rejects a relative path, a protocol-relative URL and a javascript: URL", () => {
    expect(externalHref("/seats/burnley/")).toBeNull();
    expect(externalHref("//example.com/x")).toBeNull();
    expect(externalHref("javascript:alert(1)")).toBeNull();
  });

  it("handles absent and non-string values", () => {
    expect(externalHref(null)).toBeNull();
    expect(externalHref(undefined)).toBeNull();
    expect(externalHref("")).toBeNull();
    expect(externalHref("   ")).toBeNull();
    expect(externalHref(42)).toBeNull();
  });

  it("trims surrounding whitespace rather than rejecting the URL", () => {
    expect(externalHref("  https://example.com/a  ")).toBe("https://example.com/a");
  });
});

describe("externalHref rejects a URL with trailing prose", () => {
  // 477 values across the corpora are a real URL followed by a note. They pass
  // a startsWith("http") check, which is what the ward template used, and then
  // resolve to a 404 at the target host once the space is percent-encoded.
  it("rejects a URL followed by a note", () => {
    expect(
      externalHref(
        "https://en.powys.gov.uk/article/16661/Parliamentary-Election-Results.pdf electorate via email"
      )
    ).toBeNull();
    expect(externalHref("LEAP data at https://www.andrewteale.me.uk/leap/downloads")).toBeNull();
  });
});
