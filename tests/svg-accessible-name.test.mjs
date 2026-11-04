/**
 * Built-page sweep: every <svg> on /councils/ and the forecasts hub must
 * either be decorative (aria-hidden="true") or carry an accessible name
 * (aria-label, aria-labelledby, or a <title> as its first element child).
 *
 * Requires a prior `npm run build` so dist/ is present.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const PAGES = [
  "dist/councils/index.html",
  "dist/forecasts/index.html",
];

function firstElementChildTag(innerHtml) {
  const match = innerHtml.match(/^\s*(?:<!--[\s\S]*?-->\s*)*<([a-zA-Z][\w:-]*)\b/);
  return match ? match[1].toLowerCase() : null;
}

function collectUnnamedSvgs(html) {
  const unnamed = [];
  const re = /<svg\b([^>]*)>([\s\S]*?)<\/svg>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    const attrs = match[1] || "";
    const inner = match[2] || "";
    const hidden = /aria-hidden\s*=\s*(["'])true\1/i.test(attrs);
    const labelled =
      /aria-label\s*=/i.test(attrs) ||
      /aria-labelledby\s*=/i.test(attrs) ||
      firstElementChildTag(inner) === "title";
    if (!hidden && !labelled) {
      unnamed.push(attrs.trim().slice(0, 160) || "(no attributes)");
    }
  }
  return unnamed;
}

describe("inline SVG accessible names on built pages", () => {
  for (const relative of PAGES) {
    const path = resolve(process.cwd(), relative);
    it.skipIf(!existsSync(path))(
      `${relative} has no unnamed SVG`,
      () => {
        const html = readFileSync(path, "utf8");
        const unnamed = collectUnnamedSvgs(html);
        expect(unnamed, unnamed.join("\n")).toEqual([]);
      },
    );
  }

  it("documents the pages under test", () => {
    expect(PAGES).toContain("dist/councils/index.html");
    expect(PAGES).toContain("dist/forecasts/index.html");
  });
});
