import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const PAGES = path.join(ROOT, "src/pages");

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else if (/\.(astro|ts|tsx|js|mjs)$/.test(entry)) files.push(full);
  }
  return files;
}

const linked = new Set();
for (const file of walk(PAGES)) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(
    /["'`(]\/data\/([A-Za-z0-9._\-/]+\.(?:json|csv|md|txt))/g,
  )) {
    linked.add(match[1]);
  }
}

const { PUBLISHED_DATA } = await import("../src/lib/publishedData.ts");
const published = new Set(PUBLISHED_DATA.map((file) => file.path));

describe("published data files", () => {
  it("finds the /data/ links it is meant to check", () => {
    expect(linked.size).toBeGreaterThanOrEqual(5);
  });

  it("serves every /data/ URL linked by a page", () => {
    const dangling = [...linked].filter((relativePath) => !published.has(relativePath)).sort();
    expect(dangling).toEqual([]);
  });

  it("names only files that exist on disk", () => {
    const missing = PUBLISHED_DATA.map((file) => file.path).filter(
      (relativePath) => !existsSync(path.join(ROOT, "data", relativePath)),
    );
    expect(missing).toEqual([]);
  });

  it("never publishes anything outside data/", () => {
    for (const file of PUBLISHED_DATA) {
      expect(file.path).not.toMatch(/^\//);
      expect(file.path.split("/")).not.toContain("..");
      expect(file.label.length).toBeGreaterThan(10);
    }
  });
});
