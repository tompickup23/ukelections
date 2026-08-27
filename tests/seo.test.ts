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
  newsPublicationDate,
  publisherNode
} from "../src/lib/seo";
import { collectNewsEntries, newsTitle } from "../src/pages/sitemap-news.xml";
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

describe("news publication dates", () => {
  // Polls close at 22:00 UK local time. The whole point of deriving the offset
  // is that a summer result is not filed an hour late in Top Stories.
  it("resolves 22:00 BST to 21:00Z", () => {
    expect(newsPublicationDate("2026-08-27")).toBe("2026-08-27T21:00:00Z");
  });

  it("resolves 22:00 GMT to 22:00Z", () => {
    expect(newsPublicationDate("2026-12-10")).toBe("2026-12-10T22:00:00Z");
  });

  it("emits a full W3C datetime, not a bare date", () => {
    expect(newsPublicationDate("2026-05-07")).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it("refuses a value that is not an ISO date", () => {
    expect(() => newsPublicationDate("last Thursday")).toThrow();
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

describe("news sitemap titles", () => {
  it("carries no raw ISO date, which is what a News reader would have seen", () => {
    expect(newsTitle("Bank Hall", "Burnley", true)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("falls back to the short form rather than exceeding 110 characters", () => {
    const long = newsTitle("A".repeat(80), "B".repeat(80), true);
    expect(long.length).toBeLessThanOrEqual(110);
    expect(long.startsWith("A".repeat(80))).toBe(true);
  });
});

describe("news sitemap window", () => {
  let dir: string;
  // 22:00 BST on 27 Aug 2026 is 21:00Z. "Now" is the following morning.
  const now = Date.parse("2026-08-28T08:00:00Z");

  const write = (slug: string, pollingDay: string, status: string, declared = false) =>
    writeFileSync(
      path.join(dir, `${slug}.json`),
      JSON.stringify({
        slug,
        status,
        contest: { polling_day: pollingDay, ward_name: "Test Ward", council_name: "Test Council" },
        ...(declared ? { result: { winner_party: "Reform UK" } } : {})
      })
    );

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "uke-news-"));
    write("declared-yesterday", "2026-08-27", "concluded", true);
    write("awaiting-yesterday", "2026-08-27", "polls_closed");
    write("polling-next-week", "2026-09-03", "upcoming");
    write("polling-tomorrow", "2026-08-29", "upcoming");
    write("declared-last-month", "2026-07-16", "concluded", true);
    // Polling day has passed but the contest refresh has not run since, so
    // `status` still reads "upcoming". Eligibility is decided by the polling
    // day, not by that field, so this one still belongs in the window.
    write("stale-status", "2026-08-27", "upcoming", true);
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("carries only contests polled within the last 48 hours", () => {
    const slugs = collectNewsEntries(now, dir).map((e) => e.loc.split("/").filter(Boolean).pop());
    expect(slugs.sort()).toEqual(["awaiting-yesterday", "declared-yesterday", "stale-status"]);
  });

  it("never advertises a contest that has not happened yet", () => {
    // The old window ran 48 hours EITHER side of polling day, so a contest
    // polling tomorrow was published to Google News as already-published news.
    const slugs = collectNewsEntries(now, dir).map((e) => e.loc);
    expect(slugs.some((l) => l.includes("polling-tomorrow"))).toBe(false);
  });

  it("drops out once the contest is more than 48 hours old", () => {
    // 1 Sept: the 29 Aug contest is now 59 hours old and the 3 Sept one has
    // still not happened, so nothing is inside the window.
    const later = Date.parse("2026-09-01T08:00:00Z");
    expect(collectNewsEntries(later, dir)).toEqual([]);
  });

  it("admits a contest as soon as its polls close, and not before", () => {
    const beforeClose = Date.parse("2026-08-29T20:00:00Z"); // 21:00 BST, polls still open
    const afterClose = Date.parse("2026-08-29T21:30:00Z"); // 22:30 BST, closed
    const slugs = (at: number) => collectNewsEntries(at, dir).map((e) => e.loc);

    expect(slugs(beforeClose).some((l) => l.includes("polling-tomorrow"))).toBe(false);
    expect(slugs(afterClose).some((l) => l.includes("polling-tomorrow"))).toBe(true);
  });

  it("emits a full datetime as the publication date", () => {
    for (const entry of collectNewsEntries(now, dir)) {
      expect(entry.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    }
  });

  it("returns nothing rather than throwing when the contest directory is absent", () => {
    expect(collectNewsEntries(now, path.join(dir, "does-not-exist"))).toEqual([]);
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

  it("stamps only the paths with a real content date", () => {
    expect(getLastmodByPath(dir)).toEqual({
      "/by-elections/local/burnley-bank-hall-2026-08-27/": "2026-08-27"
    });
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
