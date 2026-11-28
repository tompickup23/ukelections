import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { BANNED_DASHES, CATEGORIES, buildEntries, londonDate } from "../scripts/build-changelog.mjs";

const root = process.cwd();
const changelog = JSON.parse(readFileSync(path.join(root, "data/transparency/changelog.json"), "utf8"));
const copy = JSON.parse(readFileSync(path.join(root, "data/transparency/changelog-copy.json"), "utf8")).entries;
const entries = changelog.entries;

describe("public changelog data", () => {
  it("has entries, all dated from the backfill start", () => {
    expect(entries.length).toBeGreaterThan(50);
    for (const e of entries) {
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.date >= changelog.since).toBe(true);
      expect(Number.isNaN(Date.parse(e.merged_at))).toBe(false);
    }
  });

  it("is sorted newest first", () => {
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i - 1].merged_at >= entries[i].merged_at).toBe(true);
    }
    expect(changelog.updated_at).toBe(entries[0].merged_at);
  });

  it("never dates an entry later than its merge", () => {
    for (const e of entries) {
      // The date is the UK calendar day of the merge itself, so it can be
      // neither before nor after the moment the change reached main.
      expect(e.date).toBe(londonDate(e.merged_at));
      expect(e.date <= londonDate(changelog.updated_at)).toBe(true);
    }
  });

  it("uses only the published categories and links each entry to its pull request", () => {
    const seen = new Set();
    for (const e of entries) {
      expect(CATEGORIES).toContain(e.category);
      expect(e.url).toBe(`https://github.com/tompickup23/ukelections/pull/${e.pr}`);
      expect(seen.has(e.pr)).toBe(false);
      seen.add(e.pr);
    }
  });

  it("has no banned dashes anywhere in the published text", () => {
    for (const e of entries) expect(BANNED_DASHES.test(e.summary), `#${e.pr}`).toBe(false);
    for (const [n, c] of Object.entries(copy)) {
      if (c.summary) expect(BANNED_DASHES.test(c.summary), `copy #${n}`).toBe(false);
    }
  });

  it("matches the reader copy it was written from", () => {
    for (const e of entries) {
      expect(copy[String(e.pr)]?.summary).toBe(e.summary);
      expect(copy[String(e.pr)]?.category).toBe(e.category);
    }
  });
});

describe("buildEntries", () => {
  const prs = [
    { number: 3, title: "feat: x", mergedAt: "2026-09-01T23:30:00Z" },
    { number: 2, title: "chore(deps): y", mergedAt: "2026-09-01T10:00:00Z" },
  ];

  it("dates by the UK calendar day and leaves out omitted chores", () => {
    const { entries: out, missing, problems } = buildEntries(prs, {
      3: { category: "pages", summary: "A page." },
      2: { omit: true, reason: "dependency update" },
    });
    expect(missing).toEqual([]);
    expect(problems).toEqual([]);
    expect(out).toHaveLength(1);
    // 23:30 UTC on 1 September is 00:30 on 2 September in British Summer Time.
    expect(out[0].date).toBe("2026-09-02");
  });

  it("refuses a merged pull request with no reader copy", () => {
    const { missing } = buildEntries(prs, { 3: { category: "pages", summary: "A page." } });
    expect(missing).toEqual(["#2 chore(deps): y"]);
  });

  it("refuses a dash, an unknown category or an omission without a reason", () => {
    const { problems } = buildEntries(prs, {
      3: { category: "news", summary: "A page — with a dash." },
      2: { omit: true },
    });
    expect(problems).toHaveLength(3);
  });
});
