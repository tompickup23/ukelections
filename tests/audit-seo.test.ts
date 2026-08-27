import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { auditDir, evaluate, BUDGETS } from "../scripts/audit-seo.mjs";

/**
 * Every hard check in the gate gets a fixture that must make it fire.
 *
 * The gate reported PASS on the real site the day it landed, and a passing gate
 * proves nothing on its own: the question is what input makes it fail. If a
 * check cannot be made to fail here, it is not protecting anything.
 */

let dist: string;

const GOOD = (title: string, body: string, extraHead = "") => `<!doctype html>
<html lang="en-GB">
<head>
<title>${title}</title>
<meta name="description" content="A description of a length that sits inside the budget without being flagged as short.">
<link rel="canonical" href="https://ukelections.co.uk/${title === "Home" ? "" : "page/"}">
<meta property="og:image" content="https://ukelections.co.uk/og-default.png">
${extraHead}
</head>
<body><h1>${title}</h1>${body}</body>
</html>`;

function write(rel: string, html: string) {
  const file = path.join(dist, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, html);
}

/** A site that passes cleanly, for each test to break in exactly one way. */
function writeCleanSite() {
  write("index.html", GOOD("Home", '<a href="/page/">Page</a>'));
  write("page/index.html", GOOD("Page", '<a href="/">Home</a>'));
}

beforeEach(() => {
  dist = mkdtempSync(path.join(tmpdir(), "uke-audit-"));
  writeCleanSite();
});
afterEach(() => rmSync(dist, { recursive: true, force: true }));

const fire = (key: string) => {
  const failures = evaluate(auditDir(dist));
  const hit = failures.find((f) => f.key === key);
  expect(hit, `expected ${key} to fire. fired: ${failures.map((f) => f.key).join(", ") || "nothing"}`).toBeDefined();
  return hit!;
};

describe("the gate passes a clean site", () => {
  it("reports no failures when nothing is wrong", () => {
    expect(evaluate(auditDir(dist))).toEqual([]);
  });
});

describe("every hard check can fail", () => {
  it("noTitle", () => {
    write("page/index.html", GOOD("Page", "").replace(/<title>.*<\/title>/, ""));
    fire("noTitle");
  });

  it("noDesc", () => {
    write("page/index.html", GOOD("Page", "").replace(/<meta name="description"[^>]*>/, ""));
    fire("noDesc");
  });

  it("noH1, the defect that was live on the homepage", () => {
    write("page/index.html", GOOD("Page", "").replace(/<h1>.*?<\/h1>/, "<h2>Page</h2>"));
    fire("noH1");
  });

  it("multiH1", () => {
    write("page/index.html", GOOD("Page", "<h1>Second</h1>"));
    fire("multiH1");
  });

  it("noCanonical", () => {
    write("page/index.html", GOOD("Page", "").replace(/<link rel="canonical"[^>]*>/, ""));
    fire("noCanonical");
  });

  it("canonicalNotAbsolute", () => {
    write("page/index.html", GOOD("Page", "").replace(/href="https:\/\/ukelections\.co\.uk\/page\/"/, 'href="/page/"'));
    fire("canonicalNotAbsolute");
  });

  it("noLang", () => {
    write("page/index.html", GOOD("Page", "").replace('<html lang="en-GB">', "<html>"));
    fire("noLang");
  });

  it("noOgImage", () => {
    write("page/index.html", GOOD("Page", "").replace(/<meta property="og:image"[^>]*>/, ""));
    fire("noOgImage");
  });

  it("imgNoAlt", () => {
    write("page/index.html", GOOD("Page", '<img src="/x.png">'));
    fire("imgNoAlt");
  });

  it("badJsonLd", () => {
    write("page/index.html", GOOD("Page", "", '<script type="application/ld+json">{not json</script>'));
    fire("badJsonLd");
  });

  it("junkHref, the attribution-as-link-target defect", () => {
    write("page/index.html", GOOD("Page", '<a href="LEAP data at https://example.com/x">declaration</a>'));
    const hit = fire("junkHref");
    expect(hit.examples.join(" ")).toContain("LEAP data at");
  });

  it("junkHref also catches a bare attribution", () => {
    write("page/index.html", GOOD("Page", '<a href="BBC">declaration</a>'));
    fire("junkHref");
  });

  it("duplicateTitles", () => {
    write("other/index.html", GOOD("Page", '<a href="/">Home</a>'));
    write("index.html", GOOD("Home", '<a href="/page/">Page</a><a href="/other/">Other</a>'));
    fire("duplicateTitles");
  });

  it("orphanPages, the defect that hid 590 constituency pages", () => {
    // Reachable only by URL, with nothing linking to it.
    write("lonely/index.html", GOOD("Lonely", '<a href="/">Home</a>'));
    const hit = fire("orphanPages");
    expect(hit.examples).toContain("/lonely/");
  });

  it("does not count a noindex page as an orphan", () => {
    write(
      "404.html",
      GOOD("Not found", "").replace("<head>", '<head><meta name="robots" content="noindex,follow">')
    );
    expect(evaluate(auditDir(dist)).find((f) => f.key === "orphanPages")).toBeUndefined();
  });
});

describe("budgets", () => {
  it("fails when a count rises above the recorded budget", () => {
    write("page/index.html", GOOD("A title deliberately far longer than sixty characters so that it breaches the budget", ""));
    const failures = evaluate(auditDir(dist), { ...BUDGETS, titleOver60: 0 });
    expect(failures.find((f) => f.key === "titleOver60")?.kind).toBe("budget");
  });

  it("passes when a count is at or below budget", () => {
    expect(
      evaluate(auditDir(dist), { ...BUDGETS, titleOver60: 5 }).find((f) => f.key === "titleOver60")
    ).toBeUndefined();
  });
});
