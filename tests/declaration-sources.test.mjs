import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// The preparation gap behind 20 November 2026: scripts/results-morning.mjs read
// nothing for the nine 19 November by-elections because
// data/results/declaration-sources.json had no entry for any of their councils,
// so every result was entered by hand a day late. This fails in the week before
// polling day instead, naming the contests, so the sources get seeded on the
// Wednesday (docs/results-morning.md, "Before polling day").
//
// Deliberately NOT in the `test:polling-publish` gate. A missing declaration
// source is a preparation job for a person; it must never be able to stop the
// nightly publisher and strand national polling. It runs in `npm test` only.

const DIR = path.join(process.cwd(), "data/contests/local-byelections");
const SOURCES = path.join(process.cwd(), "data/results/declaration-sources.json");
const present = existsSync(DIR);
const contests = present
  ? readdirSync(DIR)
      .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
      .map((f) => ({ file: f, doc: JSON.parse(readFileSync(path.join(DIR, f), "utf8")) }))
  : [];
const sources = JSON.parse(readFileSync(SOURCES, "utf8"));

// The same "today" the freshness tests in local-byelection-contests.test.mjs use.
const today = new Date().toISOString().slice(0, 10);
const daysUntil = (iso) => Math.round((Date.parse(iso.slice(0, 10)) - Date.parse(today)) / 86400000);

/** True when the script has somewhere to look, or a recorded reason not to look. */
function prepared(doc, sourceFile) {
  const council = sourceFile.councils?.[doc.contest.council_slug];
  return Boolean(sourceFile.contests?.[doc.contest.ballot_paper_id]?.url || council?.index_url || council?.hand_read_only);
}

describe.skipIf(!present)("declaration sources before polling day", () => {
  it("has a declaration source or a hand-read-only reason for every contest polling within seven days", () => {
    const missing = contests
      .filter(({ doc }) => doc.status === "upcoming" && doc.contest?.polling_day)
      .filter(({ doc }) => {
        const days = daysUntil(doc.contest.polling_day);
        return days >= 0 && days <= 7;
      })
      .filter(({ doc }) => !prepared(doc, sources))
      .map(({ doc }) => `${doc.contest.council_name}, ${doc.contest.ward_name} (${doc.contest.polling_day}, council slug ${doc.contest.council_slug})`);
    expect(
      missing,
      "add each council's results page, or a hand_read_only reason, to data/results/declaration-sources.json",
    ).toEqual([]);
  });
});

describe("declaration-sources.json", () => {
  it("never gives a hand-read-only council a page for the script to fetch", () => {
    const both = Object.entries(sources.councils)
      .filter(([, c]) => c.hand_read_only && (c.index_url || c.also_check?.length))
      .map(([slug]) => slug);
    expect(both, "a hand-read-only council is never fetched; put the page under hand_url").toEqual([]);
  });

  it("states a reason in words for every hand-read-only council", () => {
    for (const [slug, c] of Object.entries(sources.councils)) {
      if (!("hand_read_only" in c)) continue;
      expect(typeof c.hand_read_only, slug).toBe("string");
      expect(c.hand_read_only.length, slug).toBeGreaterThan(20);
    }
  });

  it("recognises a seeded council and refuses an unseeded one", () => {
    const doc = (slug, id = `local.${slug}.x.by.2026-11-26`) => ({ contest: { council_slug: slug, ballot_paper_id: id } });
    const file = {
      councils: { a: { index_url: "https://a.example/" }, b: { hand_read_only: "robots.txt could not be read." }, c: { notes: "only a note" } },
      contests: { "local.d.x.by.2026-11-26": { url: "https://d.example/declaration.pdf" } },
    };
    expect(prepared(doc("a"), file)).toBe(true);
    expect(prepared(doc("b"), file)).toBe(true);
    expect(prepared(doc("c"), file)).toBe(false);
    expect(prepared(doc("d"), file)).toBe(true);
    expect(prepared(doc("e"), file)).toBe(false);
  });
});
