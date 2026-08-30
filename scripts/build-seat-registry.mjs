#!/usr/bin/env node
/**
 * build-seat-registry.mjs — resolve the statutory seat count for every
 * council page, from three independent sources, and record which one won.
 *
 * WHY THIS EXISTS
 * Council control is "does any party hold more than half the chamber", so
 * every control verdict on the site is a function of one number: how many
 * seats the chamber has. That number was being taken from a single source
 * (the OCD composition history), which is a snapshot of the last year the
 * council was surveyed. Where a boundary review resized a council, the
 * snapshot is stale and the threshold is computed against a chamber that no
 * longer exists.
 *
 * THE TWO QUANTITIES, WHICH ARE NOT THE SAME
 *   statutory seats  how many seats the chamber HAS. Changes only when the
 *                    LGBCE makes an order, so it is stable between reviews.
 *                    This is the only number a majority threshold may use.
 *   live occupancy   how many seats are currently FILLED, and by whom.
 *                    Moves with every resignation, death, defection and
 *                    by-election. Useful as a second opinion on the count,
 *                    never as a source for an election-night composition.
 *
 * SOURCES
 *   ocd     data/features/council-composition-history.json — latest year
 *           at or before 2025. Authoritative until a boundary review.
 *   ballot  sum of winner_count over the council's May 2026 ward ballots.
 *           When a council elected ALL of its seats and every seat was
 *           declared, this is the chamber as the electorate just filled it,
 *           which beats any prior snapshot.
 *   roster  data/sources/aidoge-councillor-rosters.json — AI DOGE's
 *           moderngov scrape. Live occupancy, so it is expected to sit
 *           within one of the statutory figure.
 *
 * RESOLUTION, in order. The rule that fired is recorded on every row.
 *   1 all_out_declared    all-out election, every seat declared → ballot wins.
 *   2 inaugural_all_out   no prior history at all (a council created by LGR),
 *                         fully declared → the ballot IS the new chamber.
 *   3 ballot_roster_agree ballot and roster agree against ocd → the pair wins.
 *                         This is the boundary-review case that rule 1 misses
 *                         because a seat or two has yet to declare.
 *   4 corroborated        ocd and roster agree → that value.
 *   5 roster_off_by_one   they differ by exactly 1 → ocd wins; the roster is
 *                         reading a vacancy or a co-option.
 *   6 single_source       no roster for this council → ocd, unconfirmed.
 *   7 unresolved          nothing breaks the tie → ocd, flagged for review.
 *                         These are the only rows that should need a human.
 *
 * Output: data/identity/council-seat-counts.json
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");
const OUT = join(REPO, "data/identity/council-seat-counts.json");

const readJson = (p) => JSON.parse(readFileSync(join(REPO, p), "utf8"));

// wards-may-2026 council_slug → OCD slug, where they differ.
const OCD_SLUG_ALIASES = { "city-of-lincoln": "lincoln" };

// A UKE council slug can appear in AI DOGE under a few directory spellings.
function rosterCandidates(slug) {
  const u = slug.replace(/-/g, "_");
  return [u, `${u}_cc`, u.replace(/^city_of_/, ""), u.replace(/^london_borough_of_/, "")];
}

function main() {
  const identity = readJson("data/identity/wards-may-2026.json");
  const wards = Array.isArray(identity) ? identity : identity.wards;
  const ocdAll = readJson("data/features/council-composition-history.json").per_council;

  const rosterPath = "data/sources/aidoge-councillor-rosters.json";
  const rosters = existsSync(join(REPO, rosterPath))
    ? readJson(rosterPath)
    : { snapshot: null, councils: {} };
  if (!rosters.snapshot) {
    console.warn("No AI DOGE roster snapshot present. Every row will be single_source.");
  }

  const resultsRel = existsSync(join(REPO, "data/results/may-2026/local-and-mayor.merged.json"))
    ? "data/results/may-2026/local-and-mayor.merged.json"
    : "data/results/may-2026/local-and-mayor.json";
  const declaredBy = new Map();
  for (const r of readJson(resultsRel).results) {
    declaredBy.set(r.ballot_paper_id, r.winners?.length || 0);
  }

  // Per council: seats on the ballot, and how many of them were declared.
  const ballot = new Map();
  for (const w of wards) {
    if (w.tier !== "local") continue;
    const b = ballot.get(w.council_slug) || { seats: 0, declared: 0, ballots: 0 };
    b.seats += w.winner_count || 1;
    b.declared += declaredBy.get(w.ballot_paper_id) || 0;
    b.ballots += 1;
    ballot.set(w.council_slug, b);
  }

  const councils = {};
  const tally = {};
  for (const [slug, b] of [...ballot.entries()].sort()) {
    const ocdEntry = ocdAll[OCD_SLUG_ALIASES[slug] || slug];
    let ocd = null;
    if (ocdEntry?.history) {
      const years = Object.keys(ocdEntry.history)
        .map(Number)
        .filter((y) => y <= 2025)
        .sort((a, b2) => b2 - a);
      if (years.length) ocd = ocdEntry.history[String(years[0])].total ?? null;
    }

    const rosterKey = rosterCandidates(slug).find((k) => rosters.councils[k]);
    const rosterRow = rosterKey ? rosters.councils[rosterKey] : null;
    // The roster offers two defensible counts: every entry, and only those
    // holding a ward. Which is right depends on whether the ward-less rows
    // are directly elected mayors or a scrape gap, which the row itself does
    // not say. So both are treated as candidates and a source counts as
    // agreeing if it matches either.
    const rosterOptions = rosterRow
      ? [...new Set([rosterRow.roster_seats_all, rosterRow.roster_seats_with_ward])]
      : [];
    const rosterAgrees = (n) => n != null && rosterOptions.includes(n);
    const roster = rosterOptions.length ? rosterOptions[0] : null;

    // "All out" is decided by the ballot against the best prior count, not by
    // a flag, because the flag is itself derived from the number in question.
    const prior = ocd ?? roster;
    const allOut = prior != null && b.seats >= prior;
    const fullyDeclared = b.declared === b.seats && b.seats > 0;

    let statutory = null;
    let rule = null;
    if (allOut && fullyDeclared) {
      statutory = b.seats;
      rule = "all_out_declared";
    } else if (ocd == null && roster == null && fullyDeclared) {
      // A council with no prior history at all: an inaugural all-out
      // election on a body that did not exist before, such as the new
      // Surrey unitaries. What the electorate just filled IS the chamber.
      statutory = b.seats;
      rule = "inaugural_all_out";
    } else if (rosterOptions.length && b.seats > 0 && rosterAgrees(b.seats) && b.seats !== ocd) {
      // Two independent sources agree against the third. A ballot covering
      // the whole chamber and a live roster cannot both be wrong by the same
      // amount, so the stale OCD snapshot loses. This is the boundary-review
      // case where the declaration is a seat or two short of complete, which
      // is why all_out_declared did not fire.
      statutory = b.seats;
      rule = "ballot_roster_agree";
    } else if (ocd != null && rosterAgrees(ocd)) {
      statutory = ocd;
      rule = "corroborated";
    } else if (ocd != null && rosterOptions.length &&
               rosterOptions.some((r) => Math.abs(ocd - r) === 1)) {
      statutory = ocd;
      rule = "roster_off_by_one";
    } else if (ocd != null && !rosterOptions.length) {
      statutory = ocd;
      rule = "single_source";
    } else if (ocd != null) {
      statutory = ocd;
      rule = "unresolved";
    } else if (roster != null) {
      statutory = roster;
      rule = "roster_only";
    } else {
      rule = "no_source";
    }
    tally[rule] = (tally[rule] || 0) + 1;

    councils[slug] = {
      statutory_seats: statutory,
      resolved_by: rule,
      needs_review: rule === "unresolved" || rule === "no_source",
      sources: {
        ocd_history: ocd,
        aidoge_roster: roster,
        aidoge_roster_options: rosterOptions,
        may2026_ballot_seats: b.seats,
        may2026_seats_declared: b.declared,
      },
      // Declaration coverage gates the control verdict downstream. A council
      // whose result is only fractionally in cannot be said to be run by
      // anyone yet.
      declaration_coverage: b.seats > 0 ? b.declared / b.seats : 0,
      all_seats_declared: fullyDeclared,
    };
  }

  const payload = {
    snapshot: {
      built_at: new Date().toISOString(),
      councils: Object.keys(councils).length,
      roster_snapshot: rosters.snapshot?.retrieved_at || null,
      resolution_tally: tally,
      note:
        "statutory_seats is the chamber size and is the ONLY figure a majority " +
        "threshold may be computed from. aidoge_roster is live occupancy and is " +
        "expected to sit within one of it.",
    },
    councils,
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n");

  console.log(`Wrote ${OUT}`);
  console.log(`  ${payload.snapshot.councils} councils`);
  for (const [k, v] of Object.entries(tally).sort((a, b2) => b2[1] - a[1])) {
    console.log(`    ${k.padEnd(20)} ${v}`);
  }
  const review = Object.entries(councils).filter(([, c]) => c.needs_review);
  if (review.length) {
    console.log(`\n  NEEDS REVIEW (${review.length}):`);
    for (const [slug, c] of review) {
      console.log(
        `    ${slug.padEnd(26)} ocd=${c.sources.ocd_history} roster=${c.sources.aidoge_roster} ballot=${c.sources.may2026_ballot_seats}`,
      );
    }
  }
  const partial = Object.entries(councils).filter(
    ([, c]) => c.declaration_coverage > 0 && c.declaration_coverage < 1,
  );
  if (partial.length) {
    console.log(`\n  INCOMPLETE DECLARATIONS (${partial.length}):`);
    for (const [slug, c] of partial.sort((a, b2) => a[1].declaration_coverage - b2[1].declaration_coverage)) {
      console.log(
        `    ${slug.padEnd(26)} ${c.sources.may2026_seats_declared}/${c.sources.may2026_ballot_seats} seats declared (${(c.declaration_coverage * 100).toFixed(0)}%)`,
      );
    }
  }
}

main();
