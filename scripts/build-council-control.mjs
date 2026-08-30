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

function postMay7Composition(pre, wins, seatsUp, isAllUp, total) {
  const post = Object.fromEntries(PARTIES.map((p) => [p, 0]));
  if (isAllUp) {
    for (const p of PARTIES) post[p] = wins[p] || 0;
    return post;
  }
  // Which of a party's seats were up is not recorded, so it is apportioned:
  // defended = pre[party] * (seats_up / total).
  //
  // Rounding each party independently does NOT sum back to seats_up —
  // sum(round(x)) is not round(sum(x)) — and the drift landed in the
  // carry-over, so the post composition disagreed with the chamber size on
  // 32 councils. Largest remainder fixes the total by construction: floor
  // everyone, then hand the leftover seats to the largest fractional parts.
  const upRatio = total > 0 ? seatsUp / total : 0;
  const quota = PARTIES.map((p) => {
    const preSeats = pre.by_party[p] || 0;
    const exact = Math.min(preSeats, preSeats * upRatio);
    return { p, preSeats, floor: Math.floor(exact), frac: exact - Math.floor(exact) };
  });
  let assigned = quota.reduce((s, q) => s + q.floor, 0);
  const targetDefended = Math.min(seatsUp, quota.reduce((s, q) => s + q.preSeats, 0));
  for (const q of [...quota].sort((a, b) => b.frac - a.frac)) {
    if (assigned >= targetDefended) break;
    if (q.floor >= q.preSeats) continue; // never defend more seats than held
    q.floor += 1;
    assigned += 1;
  }
  for (const q of quota) post[q.p] = (q.preSeats - q.floor) + (wins[q.p] || 0);
  return post;
}

function classifyControl(post, total, undeclared = 0) {
  const label = (slug) => PARTY_LABEL[slug] || slug;
  const threshold = Math.floor(total / 2) + 1;
  const sorted = Object.entries(post).sort((a, b) => b[1] - a[1]);
  const top = sorted[0];
  if (!top || top[1] === 0) return { status: "no_seats_won", controlling_party: null, threshold };

  // Decidability gate. The question is not "have enough seats declared" as a
  // percentage, it is "could the seats still outstanding change the answer".
  // A leader already at the threshold has a majority whatever happens next;
  // a leader who could still reach it with the undeclared seats has an
  // undetermined council, and saying otherwise publishes a verdict the count
  // does not support. Newham was calling a largest party off 5 of 66 seats.
  if (undeclared > 0 && top[1] < threshold && top[1] + undeclared >= threshold) {
    const second = sorted[1];
    return {
      status: "undetermined",
      controlling_party: null,
      plurality_party: null,
      threshold,
      undeclared_seats: undeclared,
      leading_party_so_far: top[0],
      leading_seats_so_far: top[1],
      second_party: second?.[0] || null,
      second_party_seats: second?.[1] || 0,
      reason:
        `${undeclared} seat${undeclared === 1 ? "" : "s"} still to declare, and ` +
        `${label(top[0])} on ${top[1]} could still reach the ${threshold} needed`,
    };
  }
  if (top[1] >= threshold) {
    return {
      status: "majority",
      controlling_party: top[0],
      threshold,
      lead_over_majority: top[1] - threshold,
    };
  }
  // No overall control. "Largest party" is a second claim and needs its own
  // test: it only holds if the undeclared seats cannot lift the runner-up
  // past the leader.
  const second = sorted[1];
  const pluralityCertain = top[1] >= (second?.[1] || 0) + undeclared;
  return {
    status: "no_overall_control",
    controlling_party: null,
    plurality_party: pluralityCertain ? top[0] : null,
    plurality_seats: pluralityCertain ? top[1] : null,
    plurality_certain: pluralityCertain,
    leading_party_so_far: top[0],
    leading_seats_so_far: top[1],
    threshold,
    seats_short_of_majority: threshold - top[1],
    second_party: second?.[0] || null,
    second_party_seats: second?.[1] || 0,
    undeclared_seats: undeclared,
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
  //
  // A cancelled poll (a candidate dies between nomination and polling day)
  // still contests a real seat, it just leaves it empty until the deferred
  // by-election. Those seats are counted separately as vacancies rather than
  // dropped, so the chamber still adds up and the site can say a seat is
  // empty instead of quietly rendering a smaller council.
  const seatsUpByCouncil = {};
  const vacantByCouncil = {};
  const councilNames = {};
  for (const w of identity.wards) {
    if (w.tier !== "local") continue;
    const slug = w.council_slug;
    if (!slug) continue;
    councilNames[slug] = w.council_name;
    if (w.cancelled) {
      vacantByCouncil[slug] = (vacantByCouncil[slug] || 0) + (w.winner_count || 1);
      continue;
    }
    seatsUpByCouncil[slug] = (seatsUpByCouncil[slug] || 0) + (w.winner_count || 1);
  }

  const seatRegistry = existsSync(join(REPO, "data/identity/council-seat-counts.json"))
    ? readJson("data/identity/council-seat-counts.json").councils
    : {};
  if (!Object.keys(seatRegistry).length) {
    console.warn(
      "No seat registry found. Falling back to the OCD snapshot for chamber size.\n" +
      "Run: node scripts/build-seat-registry.mjs",
    );
  }

  const councils = [];
  let unmatched = [];
  const resized = [];

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
    // Chamber size comes from the seat registry, which reconciles the OCD
    // snapshot against AI DOGE's live roster and against the seats actually
    // on the ballot. Taking it from the OCD snapshot alone put Calderdale,
    // Milton Keynes, Essex and Suffolk on a chamber a boundary review had
    // already replaced, and every majority threshold inherited the error.
    const reg = seatRegistry[slug];
    const total = reg?.statutory_seats ?? pre.total ?? 0;
    if (reg && reg.statutory_seats !== pre.total) {
      resized.push(`${slug}: ${pre.total} -> ${reg.statutory_seats} (${reg.resolved_by})`);
    }
    const isAllUp = seatsUp >= total - 1; // tolerate off-by-1 (rare boundary edits)

    const { wins, evaluated_ballots, pending_ballots } = aggregateMay7Wins(slug, actuals);
    const seatsWonTotal = Object.values(wins).reduce((s, v) => s + v, 0);
    const declaredCoveragePct = seatsUp > 0 ? seatsWonTotal / seatsUp : 0;
    const provisional = declaredCoveragePct < 0.95;
    // Seats contested but not yet declared. This is what makes a verdict
    // safe or unsafe, so it is measured in seats rather than ballots: a
    // three-member ward that returns two councillors leaves one seat open.
    const undeclaredSeats = Math.max(0, seatsUp - seatsWonTotal);
    const vacantSeats = vacantByCouncil[slug] || 0;
    const post = postMay7Composition(pre, wins, seatsUp, isAllUp, total);
    const control = classifyControl(post, total, undeclaredSeats);

    // Pre-control classification for change-flag
    let preControl = "ncc";
    const sortedPre = Object.entries(pre.by_party).sort((a, b) => b[1] - a[1]);
    if (sortedPre[0] && sortedPre[0][1] >= Math.floor(total / 2) + 1) preControl = sortedPre[0][0];

    let changeStatus;
    // Whether control CHANGED is a verdict too, and it needs the same test as
    // the verdict itself. Newham read "Majority lost, previously Labour" off
    // five declared seats: true or not, the count cannot yet say.
    if (control.status === "undetermined") {
      changeStatus = "undetermined";
    } else if (control.status === "majority") {
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
        undeclared_seats: undeclaredSeats,
        vacant_seats: vacantSeats,
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

  if (resized.length) {
    console.log(``);
    console.log(`Chamber size taken from the seat registry, not the OCD snapshot (${resized.length}):`);
    for (const line of resized) console.log(`  ${line}`);
  }

  const undetermined = councils.filter((c) => c.control.status === "undetermined");
  if (undetermined.length) {
    console.log(``);
    console.log(`Control WITHHELD, result not yet decidable (${undetermined.length}):`);
    for (const c of undetermined) {
      console.log(`  ${c.council_slug.padEnd(26)} ${c.control.reason}`);
    }
  }

  // Reconciliation gate. Every council's post composition must fill exactly
  // the chamber it is drawn against, because that composition is what the
  // majority threshold is compared with and what the site renders seat by
  // seat. This is the check that was missing: the drift it catches was
  // shipping silently as percentage bars, which stretch to fit any total.
  //
  // A gate has to be able to fail. This one is exercised by
  // test/seat-reconciliation.test.mjs against a fixture built to break it.
  const unreconciled = [];
  for (const c of councils) {
    const sum = Object.values(c.post_may7.by_party).reduce((s, v) => s + v, 0);
    const expected = c.cycle.total_seats;
    // A council still counting is allowed to be short by exactly the seats
    // that have not declared, and by no more than that.
    const allowedShort = (c.may7_wins.undeclared_seats || 0) + (c.may7_wins.vacant_seats || 0);
    if (sum > expected || sum < expected - allowedShort) {
      unreconciled.push(
        `${c.council_slug}: post sums to ${sum}, chamber is ${expected}` +
        (allowedShort
          ? `, ${c.may7_wins.undeclared_seats || 0} undeclared and ${c.may7_wins.vacant_seats || 0} vacant`
          : ""),
      );
    }
  }
  console.log(``);
  if (unreconciled.length) {
    console.error(`SEAT RECONCILIATION FAILED for ${unreconciled.length} council(s):`);
    for (const line of unreconciled) console.error(`  ${line}`);
    process.exitCode = 1;
  } else {
    console.log(`Seat reconciliation: all ${councils.length} councils fill their chamber exactly.`);
  }
}

main();
