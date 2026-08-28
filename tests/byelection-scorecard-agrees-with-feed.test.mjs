import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { canonParty } from "../scripts/lib/local-byelection-model.mjs";

// The site publishes two by-election records side by side: the hand-curated ward
// scorecard at data/results/local-byelections.json, which is what a reader sees,
// and the tracked sidecar at data/history/byelection-appends.json, which is what
// the models read. They are maintained separately and nothing forced them to
// agree, so a scorecard could name a winner or a share the model's own data
// contradicts and no test would notice.
//
// This gate only checks contests present in BOTH, which is the point: it cannot
// complain about a scorecard entry the sweep has not reached yet, and it cannot
// pass by finding nothing, because the count of overlapping contests is asserted
// to be non-trivial first.

const ROOT = process.cwd();
const scorecard = JSON.parse(readFileSync(path.join(ROOT, "data/results/local-byelections.json"), "utf8"));
const sidecar = JSON.parse(readFileSync(path.join(ROOT, "data/history/byelection-appends.json"), "utf8"));

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

const feed = new Map();
for (const row of sidecar.results || []) {
  const total = row.candidates.reduce((a, c) => a + (c.votes || 0), 0);
  if (!total) continue;
  const shares = {};
  for (const c of row.candidates) {
    const q = canonParty(c.party_name);
    shares[q] = (shares[q] || 0) + (100 * (c.votes || 0)) / total;
  }
  const top = [...row.candidates].sort((a, b) => (b.votes || 0) - (a.votes || 0))[0];
  feed.set(`${row.election_date}::${norm(row.council_slug)}::${norm(row.ward_slug)}`, {
    winner: canonParty(top.party_name),
    winner_party_raw: top.party_name,
    // The WINNING CANDIDATE's own share, not the canonical party's. canonParty
    // folds every minor and local party into Independent, so Horwich North's
    // "Horwich & Blackrod First Independents" on 1,186 was being summed with a
    // genuine independent on 13 and compared against a scorecard entry that
    // rightly quoted only the first. That is a bug in the comparison, not in
    // either dataset.
    winner_share: (100 * (top.votes || 0)) / total,
    shares,
    total,
  });
}

// Scorecard entries carry a display ward and council name, not a slug, so match
// on the normalised names and accept a prefix, which covers "Trinity" against
// "trinity" and "St. Helens" against "st-helens".
function lookup(date, council, ward) {
  const c = norm(council);
  const w = norm(ward).replace(/\d+seats?$/, "");
  for (const [k, v] of feed) {
    const [d, kc, kw] = k.split("::");
    if (d !== date) continue;
    if (kc !== c && !kc.startsWith(c) && !c.startsWith(kc)) continue;
    if (kw !== w && !kw.startsWith(w) && !w.startsWith(kw)) continue;
    return v;
  }
  return null;
}

const pairs = [];
for (const day of scorecard.dates) {
  for (const contest of day.contests) {
    const match = lookup(day.date, contest.council, contest.ward);
    if (match) pairs.push({ day: day.date, contest, match });
  }
}

describe("the ward scorecard agrees with the feed the models read", () => {
  it("overlaps on enough contests for the checks below to mean something", () => {
    // Without this the whole suite could pass by matching nothing at all.
    expect(pairs.length).toBeGreaterThanOrEqual(8);
  });

  it("names the same winner in every overlapping contest", () => {
    // canonParty folds every minor and local party into Independent or Other, and
    // it does not fold them consistently: "Horwich and Blackrod First" lands in
    // Other while "Horwich & Blackrod First Independents", the same party as
    // Democracy Club spells it, lands in Independent. Comparing inside those two
    // buckets tests the canon, not the data, so this check only covers contests
    // where both sides name a party the canon actually knows. The number skipped
    // is asserted rather than left silent: a check that quietly stopped covering
    // anything would otherwise still pass.
    const bucket = (q) => q === "Independent" || q === "Other";
    const comparable = pairs
      .filter((p) => !String(p.contest.winner).includes("/")) // multi-seat rows list two winners
      .filter((p) => !bucket(canonParty(p.contest.winner)) && !bucket(p.match.winner));
    const skipped = pairs.length - comparable.length;
    expect(skipped).toBeLessThanOrEqual(6);
    expect(comparable.length).toBeGreaterThanOrEqual(8);

    const clashes = comparable
      .filter((p) => canonParty(p.contest.winner) !== p.match.winner)
      .map((p) => `${p.day} ${p.contest.council}/${p.contest.ward}: scorecard ${p.contest.winner}, feed ${p.match.winner}`);
    expect(clashes).toEqual([]);
  });

  it("publishes a winning share that matches the feed to a tenth of a point", () => {
    const clashes = pairs
      .filter((p) => typeof p.contest.share_pct === "number")
      .filter((p) => !String(p.contest.winner).includes("/"))
      .map((p) => ({ p, feedShare: p.match.winner_share }))
      .filter(({ p, feedShare }) => Math.abs(p.contest.share_pct - feedShare) > 0.1)
      .map(({ p, feedShare }) =>
        `${p.day} ${p.contest.council}/${p.contest.ward}: scorecard ${p.contest.share_pct}%, feed ${feedShare.toFixed(1)}%`);
    expect(clashes).toEqual([]);
  });
});
