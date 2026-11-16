import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}
const source = files("src").filter(path => /\.(astro|css|[cm]?[jt]sx?)$/.test(path));
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "");

// Measured 280 on origin/main on 9 November 2026; one fallback was removed here.
// Lower this budget whenever literal spacing is removed.
const LITERAL_SPACING_BUDGET = 279;
// This page is reserved for results week. Do not permit these tokens elsewhere.
const heldTokens: Record<string, string[]> = {
  "src/pages/by-elections/local/index.astro": ["--status-good", "--status-bad"],
};

describe("CSS token contracts", () => {
  it("declares every custom property globally or on an inline style in the same file", () => {
    const global = new Set([...stripComments(readFileSync("src/styles/global.css", "utf8"))
      .matchAll(/(--[\w-]+)\s*:/g)].map(match => match[1]));
    const missing: string[] = [];
    for (const path of source) {
      const text = stripComments(readFileSync(path, "utf8"));
      const inline = new Set([...text.matchAll(/\bstyle\s*=\s*(?:"[^"]*"|'[^']*'|\{`[^`]*`\})/g)]
        .flatMap(style => [...style[0].matchAll(/(--[\w-]+)\s*:/g)].map(match => match[1])));
      for (const [, token] of text.matchAll(/var\(\s*(--[\w-]+)/g)) {
        if (!global.has(token) && !inline.has(token) && !heldTokens[path]?.includes(token)) {
          missing.push(`${path}: ${token}`);
        }
      }
    }
    expect([...new Set(missing)]).toEqual([]);
  });

  it("keeps literal spacing within the recorded budget", () => {
    let count = 0;
    for (const path of source.filter(path => /^src\/(components|pages)\//.test(path) && path.endsWith(".astro"))) {
      for (const [, block] of readFileSync(path, "utf8").matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)) {
        for (const [, value] of stripComments(block).matchAll(/(?<![\w-])(?:padding|margin|gap|inset|row-gap|column-gap)(?:-[\w-]+)?\s*:\s*([^;}]+)/g)) {
          count += [...value.matchAll(/(?<![\w])[+-]?(?:\d*\.)?\d+(?:rem|px)\b/g)].length;
        }
      }
    }
    expect(count).toBeLessThanOrEqual(LITERAL_SPACING_BUDGET);
  });
});
