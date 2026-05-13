#!/usr/bin/env node
/**
 * list-reform-councils.mjs — produce the Reform-specific deliverable from
 * data/results/may-2026/council-control.json.
 *
 * Outputs three artefacts:
 *   - data/transparency/may-2026-reform-controlled-councils.md (human-readable)
 *   - data/transparency/may-2026-reform-controlled-councils.csv (sortable)
 *   - data/transparency/may-2026-reform-controlled-councils.json (machine-readable)
 *
 * Three lists per output:
 *   1. Outright Reform majorities (Reform alone has ≥ floor(total/2)+1)
 *   2. Reform largest-party NOC (biggest group, coalition needed)
 *   3. Reform breakthrough minor (won seats, not largest)
 *
 * Headline numbers:
 *   - Aggregate Reform seats won across the 156 contesting councils
 *   - Comparison vs pre-May-7 holdings
 *   - Comparison vs forecast (where available)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");

function readJson(p) { return JSON.parse(readFileSync(join(REPO, p), "utf8")); }

const PARTY_LABEL = {
  con: "Con", lab: "Lab", ld: "LD", green: "Green", ref: "Reform",
  ukip: "UKIP", snp: "SNP", pc: "Plaid", nat: "Nat", other: "Ind/Other",
};

function partyTallyString(byParty, total) {
  const parts = Object.entries(byParty)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([p, v]) => `${PARTY_LABEL[p] || p} ${v}`);
  return parts.join(", ") + ` (of ${total})`;
}

function csvEscape(s) {
  const v = String(s ?? "");
  if (v.includes(",") || v.includes("\"") || v.includes("\n")) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function main() {
  const data = readJson("data/results/may-2026/council-control.json");
  const councils = data.councils;
  const summary = data.summary;

  const majorities = councils.filter((c) => c.reform.has_majority)
    .sort((a, b) => b.reform.post_seats - a.reform.post_seats);
  const largestNoc = councils.filter((c) => !c.reform.has_majority && c.reform.is_largest)
    .sort((a, b) => b.reform.post_seats - a.reform.post_seats);
  const breakthrough = councils.filter(
    (c) => !c.reform.has_majority && !c.reform.is_largest && c.reform.won_seats > 0
  ).sort((a, b) => b.reform.won_seats - a.reform.won_seats);

  const provisionalCouncils = councils.filter((c) => c.may7_wins.provisional)
    .sort((a, b) => a.may7_wins.declared_coverage_pct - b.may7_wins.declared_coverage_pct);
  const provisionalSet = new Set(provisionalCouncils.map((c) => c.council_slug));
  const flagP = (c) => provisionalSet.has(c.council_slug) ? " ⚠" : "";

  // Try to pull predicted seat winners from the live forecast for a forecast-vs-actual line.
  let forecastReformPostByCouncil = {};
  const summaryPath = "data/predictions/may-2026/summary.json";
  if (existsSync(join(REPO, summaryPath))) {
    const sumF = readJson(summaryPath);
    for (const c of sumF.councils || []) {
      const pred = c.predicted_seat_winners?.["Reform UK"] || 0;
      if (c.council_slug) forecastReformPostByCouncil[c.council_slug] = pred;
    }
  }

  // ======== Build markdown ========
  const md = [];
  md.push(`# May 7 2026 — Reform UK council control\n`);
  md.push(`Generated: ${data.snapshot.generated_at}`);
  md.push(`Source: ${data.snapshot.election_date} actuals (sha256 ${data.snapshot.actuals_sha256.slice(0, 12)}…)`);
  md.push(`Method: ${data.snapshot.method}\n`);

  if (provisionalCouncils.length) {
    md.push(`> ⚠ **${provisionalCouncils.length} councils are PROVISIONAL** (under 95% of seats declared at audit time). They are marked with ⚠ in the tables below. Re-run the pipeline once DC has full coverage.\n`);
  }

  md.push(`## Headline\n`);
  md.push(`| Metric | Value |`);
  md.push(`|---|---|`);
  md.push(`| Contesting councils analysed | ${summary.contesting_councils} |`);
  md.push(`| Reform majorities | **${majorities.length}** |`);
  md.push(`| Reform largest-party NOC | ${largestNoc.length} |`);
  md.push(`| Reform breakthrough (won seats, not largest) | ${breakthrough.length} |`);
  md.push(`| Councils with no Reform seats post-May-7 | ${summary.reform_outcomes.no_seats} |`);
  md.push(`| Reform seats pre-May-7 (across contesting councils) | ${summary.aggregate_seats.pre.ref} |`);
  md.push(`| Reform seats won May 7 | **${summary.aggregate_seats.won.ref}** |`);
  md.push(`| Reform seats post-May-7 (across contesting councils) | **${summary.aggregate_seats.post.ref}** |\n`);

  md.push(`## Control by party (majorities only)\n`);
  md.push(`| Party | Majorities |`);
  md.push(`|---|---|`);
  const sortedParties = Object.entries(summary.by_controlling_party).sort((a, b) => b[1] - a[1]);
  for (const [p, n] of sortedParties) {
    const label = PARTY_LABEL[p] || p;
    md.push(`| ${label === "Reform" ? "**Reform**" : label} | ${n} |`);
  }
  md.push(`| (No overall control) | ${summary.control_outcomes.no_overall_control} |\n`);

  md.push(`## Change vs pre-May-7\n`);
  md.push(`| Outcome | Count |`);
  md.push(`|---|---|`);
  md.push(`| Majorities gained | ${summary.change_summary.majority_gained} |`);
  md.push(`| Majorities held | ${summary.change_summary.majority_held} |`);
  md.push(`| Majorities lost | ${summary.change_summary.majority_lost} |`);
  md.push(`| NOC → NOC | ${summary.change_summary.noc_continued} |\n`);

  md.push(`## 1. Reform majorities (${majorities.length})\n`);
  if (majorities.length === 0) {
    md.push(`_None._\n`);
  } else {
    md.push(`Councils where Reform UK alone holds ≥ floor(total/2)+1 of all seats post-May-7. These are the "Reform now runs X" councils.\n`);
    md.push(`| Council | Reform seats | Total | Reform pre | Reform won | Lead over majority | Pre-control | Other parties |`);
    md.push(`|---|---|---|---|---|---|---|---|`);
    for (const c of majorities) {
      const lead = c.control.lead_over_majority ?? 0;
      const others = Object.entries(c.post_may7.by_party)
        .filter(([p, v]) => p !== "ref" && v > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([p, v]) => `${PARTY_LABEL[p] || p} ${v}`)
        .join(", ");
      md.push(`| ${c.council_name}${flagP(c)} | **${c.reform.post_seats}** | ${c.cycle.total_seats} | ${c.reform.pre_seats} | ${c.reform.won_seats} | +${lead} | ${PARTY_LABEL[c.control.pre_control] || c.control.pre_control} | ${others} |`);
    }
    md.push(``);
  }

  md.push(`## 2. Reform largest-party NOC (${largestNoc.length})\n`);
  if (largestNoc.length === 0) {
    md.push(`_None._\n`);
  } else {
    md.push(`Councils where Reform UK is the biggest single group but doesn't hold a majority. Coalition or minority administration territory.\n`);
    md.push(`| Council | Reform seats | Total | Short of majority | Second party | 2nd seats | Composition |`);
    md.push(`|---|---|---|---|---|---|---|`);
    for (const c of largestNoc) {
      const tally = partyTallyString(c.post_may7.by_party, c.cycle.total_seats);
      md.push(`| ${c.council_name}${flagP(c)} | **${c.reform.post_seats}** | ${c.cycle.total_seats} | ${c.reform.seats_short_of_majority} | ${PARTY_LABEL[c.control.second_party] || c.control.second_party || "-"} | ${c.control.second_party_seats || 0} | ${tally} |`);
    }
    md.push(``);
  }

  md.push(`## 3. Reform breakthrough — won seats, not largest (${breakthrough.length})\n`);
  if (breakthrough.length === 0) {
    md.push(`_None._\n`);
  } else {
    md.push(`Councils where Reform won at least one seat but isn't the largest group. The "one to watch in 2027/2028" cohort.\n`);
    md.push(`| Council | Reform won | Reform post | Total | Controlling party (post) | Composition |`);
    md.push(`|---|---|---|---|---|---|`);
    for (const c of breakthrough.slice(0, 50)) {
      const ctrlLabel = c.control.status === "majority"
        ? `${PARTY_LABEL[c.control.controlling_party] || c.control.controlling_party} maj`
        : `${PARTY_LABEL[c.control.plurality_party] || c.control.plurality_party || "-"} plur (NOC)`;
      const tally = partyTallyString(c.post_may7.by_party, c.cycle.total_seats);
      md.push(`| ${c.council_name}${flagP(c)} | ${c.reform.won_seats} | ${c.reform.post_seats} | ${c.cycle.total_seats} | ${ctrlLabel} | ${tally} |`);
    }
    if (breakthrough.length > 50) md.push(`| _… ${breakthrough.length - 50} more (see CSV)_ | | | | | |`);
    md.push(``);
  }

  if (provisionalCouncils.length) {
    md.push(`## Provisional councils (under 95% declared)\n`);
    md.push(`| Council | Declared | Seats up | Coverage | Reform won | Reform post (provisional) |`);
    md.push(`|---|---|---|---|---|---|`);
    for (const c of provisionalCouncils) {
      const cov = (c.may7_wins.declared_coverage_pct * 100).toFixed(1);
      md.push(`| ${c.council_name} | ${c.may7_wins.seats_won_total} | ${c.cycle.seats_up} | ${cov}% | ${c.reform.won_seats} | ${c.reform.post_seats} |`);
    }
    md.push(``);
  }

  md.push(`## Method notes & caveats\n`);
  md.push(`1. **Pre-May-7 composition** is the OpenCouncilData 2025 snapshot for each council. Defections and by-elections between January 2025 and May 7 2026 are not folded in.`);
  md.push(`2. **Carry-over seats** (for thirds / halves councils where only some seats were up) are approximated by pre[party] × seats_up/total. Exact derivation requires per-ward incumbent verification.`);
  md.push(`3. **Pending ballots**: ${data.councils.reduce((s, c) => s + (c.may7_wins.pending_ballots || 0), 0)} ballots had no DC-elected flag at ingest time — they're treated as pending and excluded from the wins count. As more declarations process, re-run the pipeline to refresh.`);
  md.push(`4. **Group affiliation vs elected party**: a candidate elected as Reform may not whip with the Reform group in practice; vice-versa for independents who join. This view counts elected-party labels only.`);
  md.push(`5. **Control thresholds**: a council with an even total (e.g. 60 seats) needs 31 for majority; an odd total (e.g. 61) needs 31. We use floor(total/2)+1 throughout.`);
  md.push(`6. **${summary.unmatched_council_slugs.length} councils could not be matched** to OCD: ${summary.unmatched_council_slugs.join(", ") || "—"}.\n`);

  const mdPath = "data/transparency/may-2026-reform-controlled-councils.md";
  mkdirSync(dirname(join(REPO, mdPath)), { recursive: true });
  writeFileSync(join(REPO, mdPath), md.join("\n") + "\n");

  // ======== Build CSV ========
  const csvRows = [];
  csvRows.push([
    "council_slug", "council_name", "category", "total_seats", "reform_pre", "reform_won",
    "reform_post", "reform_post_share", "majority_threshold", "seats_short_of_majority",
    "control_status", "controlling_party", "plurality_party", "second_party", "second_party_seats",
    "pre_control", "change_status", "evaluated_ballots", "pending_ballots", "all_party_post"
  ].join(","));
  function category(c) {
    if (c.reform.has_majority) return "majority";
    if (c.reform.is_largest) return "largest_noc";
    if (c.reform.won_seats > 0) return "breakthrough";
    return "no_seats";
  }
  for (const c of councils) {
    csvRows.push([
      c.council_slug,
      csvEscape(c.council_name),
      category(c),
      c.cycle.total_seats,
      c.reform.pre_seats,
      c.reform.won_seats,
      c.reform.post_seats,
      c.reform.post_share.toFixed(4),
      c.control.threshold,
      c.reform.seats_short_of_majority,
      c.control.status,
      c.control.controlling_party || "",
      c.control.plurality_party || "",
      c.control.second_party || "",
      c.control.second_party_seats || 0,
      c.control.pre_control,
      c.control.change_status,
      c.may7_wins.evaluated_ballots,
      c.may7_wins.pending_ballots,
      csvEscape(partyTallyString(c.post_may7.by_party, c.cycle.total_seats)),
    ].join(","));
  }
  const csvPath = "data/transparency/may-2026-reform-controlled-councils.csv";
  writeFileSync(join(REPO, csvPath), csvRows.join("\n") + "\n");

  // ======== Build JSON deliverable ========
  const jsonOut = {
    snapshot: data.snapshot,
    headline: {
      contesting_councils: summary.contesting_councils,
      reform_majorities: majorities.length,
      reform_largest_noc: largestNoc.length,
      reform_breakthrough: breakthrough.length,
      reform_no_seats: summary.reform_outcomes.no_seats,
      reform_seats_pre: summary.aggregate_seats.pre.ref,
      reform_seats_won: summary.aggregate_seats.won.ref,
      reform_seats_post: summary.aggregate_seats.post.ref,
    },
    control_by_party: summary.by_controlling_party,
    change_summary: summary.change_summary,
    majorities,
    largest_noc: largestNoc,
    breakthrough,
  };
  const jsonPath = "data/transparency/may-2026-reform-controlled-councils.json";
  writeFileSync(join(REPO, jsonPath), JSON.stringify(jsonOut, null, 2));

  console.log(`Wrote:`);
  console.log(`  ${mdPath}`);
  console.log(`  ${csvPath}`);
  console.log(`  ${jsonPath}`);
  console.log(``);
  console.log(`Reform majorities (${majorities.length}):`);
  for (const c of majorities) {
    const flag = provisionalSet.has(c.council_slug) ? " ⚠ PROVISIONAL" : "";
    console.log(`  ${c.council_name.padEnd(40)} ${c.reform.post_seats}/${c.cycle.total_seats} (+${c.control.lead_over_majority} over threshold; was ${PARTY_LABEL[c.control.pre_control] || c.control.pre_control})${flag}`);
  }
  console.log(``);
  console.log(`Reform largest-party NOC (${largestNoc.length}):`);
  for (const c of largestNoc) {
    const flag = provisionalSet.has(c.council_slug) ? " ⚠ PROVISIONAL" : "";
    console.log(`  ${c.council_name.padEnd(40)} ${c.reform.post_seats}/${c.cycle.total_seats}, short ${c.reform.seats_short_of_majority} for majority${flag}`);
  }
  if (provisionalCouncils.length) {
    console.log(``);
    console.log(`Provisional councils (under 95% declared, ${provisionalCouncils.length}):`);
    for (const c of provisionalCouncils) {
      const cov = (c.may7_wins.declared_coverage_pct * 100).toFixed(1);
      console.log(`  ${c.council_name.padEnd(40)} ${c.may7_wins.seats_won_total}/${c.cycle.seats_up} declared (${cov}%)`);
    }
  }
}

main();
