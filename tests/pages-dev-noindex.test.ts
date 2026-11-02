import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Cloudflare Pages _headers: a rule block starts with an unindented path or
// absolute URL; indented lines under it are headers.
function rules(text: string): Array<{ match: string; headers: string[] }> {
  const out: Array<{ match: string; headers: string[] }> = [];
  for (const line of text.split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    if (/^\s/.test(line)) out[out.length - 1]?.headers.push(line.trim());
    else out.push({ match: line.trim(), headers: [] });
  }
  return out;
}

describe("pages.dev duplicate host", () => {
  const parsed = rules(readFileSync(path.join(process.cwd(), "public/_headers"), "utf8"));

  it("sends noindex on the production pages.dev host", () => {
    const rule = parsed.find((r) => r.match === "https://ukelections.pages.dev/*");
    expect(rule?.headers).toContain("X-Robots-Tag: noindex");
  });

  it("never sends noindex on the real domain or on every host", () => {
    for (const rule of parsed) {
      if (!rule.headers.some((h) => /x-robots-tag/i.test(h))) continue;
      expect(rule.match).toMatch(/^https:\/\/[^/]*\.pages\.dev\//);
    }
  });
});
