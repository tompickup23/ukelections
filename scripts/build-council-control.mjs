#!/usr/bin/env node
/**
 * build-council-control.mjs — derive post-May-7-2026 council control state
 * for every contesting English local authority.
 *
 * Inputs:
 *   - data/identity/wards-may-2026.json (which seats were up)
 *   - data/results/may-2026/local-and-mayor.json (actual elected candidates)
 *   - data/features/council-composition-history.json (OCD per-council yearly composition)
 *
 * Output:
 *   data/results/may-2026/council-control.json
 *
 * Methodology:
 *   - Pre-May-7 composition = OCD 2025 snapshot (latest year before the election).
 *   - May 7 wins = elected-candidate party tally per council.
 *   - For "all-up" councils (seats_up == total_seats): post = may7_wins exactly.
 *   - For "thirds/halves" councils: post = pre - up_held + may7_wins, where
 *     up_held is approximated by pre[party] * (seats_up / total). This is a
 *     defensible first-order estimate; per-ward incumbent verification would
 *     refine it but is out of scope here.
 *   - Control: a party with strict majority (≥ floor(total/2)+1) controls
 *     the council; otherwise the council is NOC, with the largest party as
 *     the plurality leader.
 *
 * The output drives:
 *   - data/transparency/may-2026-reform-controlled-councils.md (deliverable)
 *   - any future "council control" frontend page.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");

const PARTIES = ["con", "lab", "ld", "green", "ref", "ukip", "snp", "pc", "nat", "other"];

const PARTY_TO_OCD = {
  "Labour": "lab",
  "Conservative": "con",
  "Liberal Democrats": "ld",
  "Green Party": "green",
  "Reform UK": "ref",
  "UKIP": "ukip",
  "SNP": "snp",
  "Plaid Cymru": "pc",
  "Independent": "other",
  "Local": "other",
};

const PARTY_LABEL = {
  con: "Conservative",
  lab: "Labour",
  ld: "Liberal Democrats",
  green: "Green Party",
  ref: "Reform UK",
  ukip: "UKIP",
  snp: "SNP",
  pc: "Plaid Cymru",
  nat: "Other Nationalist",
  other: "Independent / Other",
};

// Slug aliases where wards-may-2026 council_slug differs from OCD slug.
const SLUG_ALIASES = {
  "city-of-lincoln": "lincoln",
};

function readJson(p) { return JSON.parse(readFileSync(join(REPO, p), "utf8")); }

function preMay7Composition(ocdEntry) {
  if (!ocdEntry?.history) return null;
  // Pick the latest year ≤ 2025 (pre-May-7-2026 snapshot).
  const years = Object.keys(ocdEntry.history).map((y) => parseInt(y, 10)).filter((y) => y <= 2025).sort((a, b) => b - a);
  if (!years.length) return null;
  const year = years[0];
  const row = ocdEntry.history[String(year)];
  return {
    year,
    total: row.total,
    by_party: Object.fromEntries(PARTIES.map((p) => [p, row[p] || 0])),
    raw_majority_label: row.majority || "",
  };
}

function aggregateMay7Wins(councilSlug, actualsBundle) {
  const wins = Object.fromEntries(PARTIES.map((p) => [p, 0]));
  let evaluatedBallots = 0;
  let pendingBallots = 0;
  for (const result of actualsBundle.results) {
    if (result.tier !== "local") continue;
    if (result.council_slug !== councilSlug) continue;
    if (!result.winners?.length) {
      pendingBallots += 1;
      continue;
    }
    evaluatedBallots += 1;
    for (const w of result.winners) {
      const ocdParty = PARTY_TO_OCD[w.party_canonical] || "other";
      wins[ocdParty] += 1;
    }
  }
  return { wins, evaluated_ballots: evaluatedBallots, pending_ballots: pendingBallots };
}

function postMay7Composition(pre, wins, seatsUp, isAllUp) {
  const post = Object.fromEntries(PARTIES.map((p) => [p, 0]));
  if (isAllUp) {
    for (const p of PARTIES) post[p] = wins[p] || 0;
    return post;
  }
  // Approximation: defended seats by party = pre[party] * (seats_up / total).
  // The remainder carries over.
  const total = pre.total;
  const upRatio = total > 0 ? seatsUp / total : 0;
  for (const p of PARTIES) {
    const preSeats = pre.by_party[p] || 0;
    const defended = Math.round(preSeats * upRatio);
    const carryOver = preSeats - defended;
    post[p] = carryOver + (wins[p] || 0);
  }
  return post;
}

function classifyControl(post, total) {
  const threshold = Math.floor(total / 2) + 1;
  const sorted = Object.entries(post).sort((a, b) => b[1] - a[1]);
  const top = sorted[0];
  if (!top || top[1] === 0) return { status: "no_seats_won", controlling_party: null, threshold };
  if (top[1] >= threshold) {
    return {
      status: "majority",
      controlling_party: top[0],
      threshold,
      lead_over_majority: top[1] - threshold,
    };
  }
  // No overall control — return plurality
  const second = sorted[1];
  return {
    status: "no_overall_control",
    controlling_party: null,
    plurality_party: top[0],
    plurality_seats: top[1],
    threshold,
    seats_short_of_majority: threshold - top[1],
    second_party: second?.[0] || null,
    second_party_seats: second?.[1] || 0,
  };
}

function changeFlag(prePartyTop, postControl) {
  if (postControl.status === "majority") {
    if (prePartyTop && PARTY_TO_OCD_REVERSE(postControl.controlling_party) === prePartyTop) {
      return "majority_held";
    }
    return "majority_gained";
  }
  return "no_overall_control";
}

function PARTY_TO_OCD_REVERSE(slug) { return slug; } // identity for now

function main() {
  const identity = readJson("data/identity/wards-may-2026.json");
  // Prefer the merged file (DC + Wikipedia supplement) when present;
  // fall back to the DC-only file.
  const mergedRel = "data/results/may-2026/local-and-mayor.merged.json";
  const dcOnlyRel = "data/results/may-2026/local-and-mayor.json";
  const actualsRel = existsSync(join(REPO, mergedRel)) ? mergedRel : dcOnlyRel;
  console.log(`Actuals source: ${actualsRel}`);
  const actuals = readJson(actualsRel);
  const ocd = readJson("data/features/council-composition-history.json").per_council;

  // Build seats-up per local council.
  const seatsUpByCouncil = {};
  const councilNames = {};
  for (const w of identity.wards) {
    if (w.cancelled) continue;
    if (w.tier !== "local") continue;
    const slug = w.council_slug;
    if (!slug) continue;
    seatsUpByCouncil[slug] = (seatsUpByCouncil[slug] || 0) + (w.winner_count || 1);
    councilNames[slug] = w.council_name;
  }

  const councils = [];
  let unmatched = [];

  for (const [slug, seatsUp] of Object.entries(seatsUpByCouncil)) {
    const ocdSlug = SLUG_ALIASES[slug] || slug;
    const ocdEntry = ocd[ocdSlug];
    if (!ocdEntry) {
      unmatched.push(slug);
      continue;
    }
    const pre = preMay7Composition(ocdEntry);
    if (!pre) {
      unmatched.push(slug);
      continue;
    }
    const total = pre.total || 0;
    const isAllUp = seatsUp >= total - 1; // tolerate off-by-1 (rare boundary edits)

    const { wins, evaluated_ballots, pending_ballots } = aggregateMay7Wins(slug, actuals);
    const seatsWonTotal = Object.values(wins).reduce((s, v) => s + v, 0);
    const declaredCoveragePct = seatsUp > 0 ? seatsWonTotal / seatsUp : 0;
    const provisional = declaredCoveragePct < 0.95;
    const post = postMay7Composition(pre, wins, seatsUp, isAllUp);
    const control = classifyControl(post, total);

    // Pre-control classification for change-flag
    let preControl = "ncc";
    const sortedPre = Object.entries(pre.by_party).sort((a, b) => b[1] - a[1]);
    if (sortedPre[0] && sortedPre[0][1] >= Math.floor(total / 2) + 1) preControl = sortedPre[0][0];

    let changeStatus;
    if (control.status === "majority") {
      changeStatus = control.controlling_party === preControl ? "majority_held" : "majority_gained";
    } else if (preControl !== "ncc") {
      changeStatus = "majority_lost";
    } else {
      changeStatus = "noc_continued";
    }

    councils.push({
      council_slug: slug,
      council_name: councilNames[slug],
      ocd_slug: ocdSlug,
      cycle: {
        seats_up: seatsUp,
        total_seats: total,
        is_all_up: isAllUp,
        cycle_pattern: isAllUp ? "all_up" : (seatsUp / total > 0.4 ? "halves_or_partial" : "thirds_or_partial"),
      },
      pre_may7: {
        snapshot_year: pre.year,
        by_party: pre.by_party,
        raw_majority_label: pre.raw_majority_label,
        plurality_party: sortedPre[0]?.[0] || null,
      },
      may7_wins: {
        by_party: wins,
        seats_won_total: seatsWonTotal,
        evaluated_ballots,
        pending_ballots,
        declared_coverage_pct: declaredCoveragePct,
        provisional,
      },
      post_may7: { by_party: post },
      control: { ...control, change_status: changeStatus, pre_control: preControl },
      reform: {
        pre_seats: pre.by_party.ref || 0,
        won_seats: wins.ref || 0,
        post_seats: post.ref || 0,
        post_share: total ? (post.ref || 0) / total : 0,
        has_majority: control.status === "majority" && control.controlling_party === "ref",
        is_largest: (control.plurality_party || control.controlling_party) === "ref",
        seats_short_of_majority: control.status === "majority" && control.controlling_party === "ref"
          ? 0
          : Math.max(0, Math.floor(total / 2) + 1 - (post.ref || 0)),
      },
    });
  }

  // Build summary roll-ups.
  const reformMajorities = councils.filter((c) => c.reform.has_majority);
  const reformLargestNoc = councils.filter((c) => !c.reform.has_majority && c.reform.is_largest);
  const reformBreakthrough = councils.filter(
    (c) => !c.reform.has_majority && !c.reform.is_largest && c.reform.won_seats > 0
  );

  const summary = {
    contesting_councils: councils.length,
    unmatched_council_slugs: unmatched,
    reform_outcomes: {
      majorities: reformMajorities.length,
      largest_party_noc: reformLargestNoc.length,
      breakthrough_minor: reformBreakthrough.length,
      no_seats: councils.filter((c) => c.reform.won_seats === 0 && c.reform.pre_seats === 0).length,
    },
    control_outcomes: {
      majority: councils.filter((c) => c.control.status === "majority").length,
      no_overall_control: councils.filter((c) => c.control.status === "no_overall_control").length,
    },
    by_controlling_party: {},
    change_summary: {
      majority_gained: councils.filter((c) => c.control.change_status === "majority_gained").length,
      majority_held: councils.filter((c) => c.control.change_status === "majority_held").length,
      majority_lost: councils.filter((c) => c.control.change_status === "majority_lost").length,
      noc_continued: councils.filter((c) => c.control.change_status === "noc_continued").length,
    },
    aggregate_seats: { pre: {}, won: {}, post: {} },
  };
  for (const c of councils) {
    if (c.control.status === "majority") {
      const p = c.control.controlling_party;
      summary.by_controlling_party[p] = (summary.by_controlling_party[p] || 0) + 1;
    }
    for (const p of PARTIES) {
      summary.aggregate_seats.pre[p] = (summary.aggregate_seats.pre[p] || 0) + (c.pre_may7.by_party[p] || 0);
      summary.aggregate_seats.won[p] = (summary.aggregate_seats.won[p] || 0) + (c.may7_wins.by_party[p] || 0);
      summary.aggregate_seats.post[p] = (summary.aggregate_seats.post[p] || 0) + (c.post_may7.by_party[p] || 0);
    }
  }

  const out = {
    snapshot: {
      generated_at: new Date().toISOString(),
      election_date: actuals.snapshot.election_date,
      actuals_sha256: actuals.snapshot.sha256,
      method: "pre = OCD 2025 snapshot; up_held approximated as pre[party] * seats_up/total for non-all-up councils; post = pre - up_held + may7_wins; majority threshold = floor(total/2)+1.",
    },
    summary,
    councils: councils.sort((a, b) => a.council_name.localeCompare(b.council_name)),
  };

  const outPath = "data/results/may-2026/council-control.json";
  mkdirSync(dirname(join(REPO, outPath)), { recursive: true });
  writeFileSync(join(REPO, outPath), JSON.stringify(out, null, 2));

  console.log(`Wrote ${outPath}`);
  console.log(`Contesting councils: ${councils.length}`);
  console.log(`Unmatched (skipped): ${unmatched.length}${unmatched.length ? ` — ${unmatched.join(", ")}` : ""}`);
  console.log(``);
  console.log(`Control outcomes:`);
  console.log(`  Majority: ${summary.control_outcomes.majority}`);
  console.log(`  No overall control: ${summary.control_outcomes.no_overall_control}`);
  console.log(``);
  console.log(`Majority by party:`);
  for (const [p, n] of Object.entries(summary.by_controlling_party).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${PARTY_LABEL[p] || p}: ${n}`);
  }
  console.log(``);
  console.log(`Change summary:`);
  console.log(`  Majorities gained: ${summary.change_summary.majority_gained}`);
  console.log(`  Majorities held:   ${summary.change_summary.majority_held}`);
  console.log(`  Majorities lost:   ${summary.change_summary.majority_lost}`);
  console.log(`  NOC continued:     ${summary.change_summary.noc_continued}`);
  console.log(``);
  console.log(`Reform UK:`);
  console.log(`  Majorities won:     ${summary.reform_outcomes.majorities}`);
  console.log(`  Largest party NOC:  ${summary.reform_outcomes.largest_party_noc}`);
  console.log(`  Breakthrough minor: ${summary.reform_outcomes.breakthrough_minor}`);
  console.log(`  No seats:           ${summary.reform_outcomes.no_seats}`);
  console.log(``);
  console.log(`Aggregate seats (sum across contesting councils):`);
  console.log(`  Pre  Reform: ${summary.aggregate_seats.pre.ref}`);
  console.log(`  Won  Reform: ${summary.aggregate_seats.won.ref}`);
  console.log(`  Post Reform: ${summary.aggregate_seats.post.ref}`);
}

main();
