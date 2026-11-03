#!/usr/bin/env node
/**
 * fit-c2-london-2026-11.mjs: fit a London local-to-Westminster ratio for C2
 * from pre-lock evidence, and refit C2's national ratio on named May 2025
 * polls. Protocol: docs/local-engine-holdout-2026-11.md, section 1, committed
 * before this script was run.
 *
 *   E1  London borough elections, 5 May 2022, full-slate votes by party
 *   E2  London's notional GE2019 result on 2024 boundaries
 *   E3  Westminster polls with fieldwork ending 21 April to 4 May 2022
 *   E4  London council by-elections, 2 May 2025 to 25 April 2026, against
 *       each borough's GE2024 share carried by the polls of the 14 days before
 *
 * Reads the poll extracts written by scripts/extract-wikipedia-polls.mjs under
 * data/polling/wikipedia/. Writes data/calibration/candidate-2026-11/.
 *
 * Usage: node scripts/fit-c2-london-2026-11.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { MAJOR_PARTIES, canonicalMajor, ge2024ForArea, ge2024ForLadByLsoa, fitLocalToWestminsterRatio } from "../src/lib/localElectionTarget.js";
import { LONDON, assertBeforeCutoff } from "./fit-candidate-engine-2026-10-24.mjs";
import { pollsterBalancedMean } from "./extract-wikipedia-polls.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const CUTOFF = "2026-04-25";
const BY_FROM = "2025-05-01";
const OUT_DIR = "data/calibration/candidate-2026-11";
const POLLS_2022 = "data/polling/wikipedia/westminster-2022-04-21-to-2022-05-04.json";
const POLLS_2025_26 = "data/polling/wikipedia/westminster-2025-04-15-to-2026-04-25.json";
const RATIO_PARTIES_2022 = ["Labour", "Conservative", "Liberal Democrats", "Green Party"];
// GE2024 UK result as the engine held it at 5e85c84, as in the 24 October fit.
const GE24_NATIONAL = { "Labour": 0.337, "Conservative": 0.236, "Reform UK": 0.143, "Liberal Democrats": 0.122, "Green Party": 0.069 };
const NOTIONAL_ABBR = { Lab: "Labour", Con: "Conservative", LD: "Liberal Democrats", Green: "Green Party", BRX: "Reform UK" };

const readJson = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), "utf8"));
const atCommit = (commit, rel) => execFileSync("git", ["show", `${commit}:${rel}`], { cwd: ROOT }).toString("utf8");

function ge2019National() {
  const src = atCommit("5e85c84", "src/lib/nationalPolling.js");
  const block = src.slice(src.indexOf("UK_WESTMINSTER_2019_GE_RESULT"));
  const get = (p) => Number(block.match(new RegExp(`"${p}":\\s*([0-9.]+)`))[1]);
  return Object.fromEntries(MAJOR_PARTIES.map((p) => [p, get(p)]));
}

function shiftDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// E1: London borough votes by party, 5 May 2022.
function london2022(history) {
  const votes = {};
  let total = 0;
  const boroughs = new Set();
  let contests = 0;
  for (const r of history.results) {
    if (r.election_date !== "2022-05-05" || r.is_by_election || r.tier !== "local" || !LONDON.has(r.council_slug)) continue;
    boroughs.add(r.council_slug);
    contests += 1;
    for (const c of r.candidates || []) {
      const k = canonicalMajor(c.party_name);
      votes[k] = (votes[k] || 0) + (c.votes || 0);
      total += c.votes || 0;
    }
  }
  return { shares: Object.fromEntries(Object.entries(votes).map(([p, v]) => [p, v / total])), boroughs: boroughs.size, contests, votes: total };
}

// E2: notional GE2019 on 2024 boundaries for constituencies mostly in E09 authorities.
function londonNotional2019() {
  const notional = readJson("data/history/ge-notional-2019.json");
  const lookup = readJson("data/features/lsoa21-to-pcon24.json").lookup;
  const count = {};
  for (const v of Object.values(lookup)) {
    const c = (count[v.pcon24cd] ||= { london: 0, all: 0 });
    c.all += 1;
    if (v.lad21cd.startsWith("E09")) c.london += 1;
  }
  const seats = Object.entries(count).filter(([, c]) => c.london / c.all > 0.5).map(([g]) => g).sort();
  const votes = {};
  let total = 0;
  for (const g of seats) {
    for (const c of notional.by_gss[g].candidates) {
      const k = NOTIONAL_ABBR[c.party_abbr] || "Other";
      votes[k] = (votes[k] || 0) + c.votes;
      total += c.votes;
    }
  }
  return { shares: Object.fromEntries(Object.entries(votes).map(([p, v]) => [p, v / total])), seats: seats.length, source: notional.snapshot.source_url, method: notional.snapshot.method };
}

// The LSOA baseline for every London borough (amendment of 3 November 2026).
export function londonLsoaBaseline(history) {
  const lsoaLookup = readJson("data/features/lsoa21-to-pcon24.json").lookup;
  const pconCodes = readJson("data/identity/parliament-lookup-codes.json").entries;
  const ladBySlug = readJson("data/identity/council-slug-to-lad24.json").map;
  const out = {};
  for (const slug of LONDON) {
    const lad = ladBySlug[slug]?.lad24cd;
    const g = lad ? ge2024ForLadByLsoa(history, lad, { lsoaLookup, pconCodes }) : null;
    if (g) out[slug] = { shares: g.shares, via: g.via };
  }
  return out;
}

// E4: London council by-elections with the poll of the 14 days before each.
function londonByelections(history, polls, areaShares) {
  const rows = history.results.filter((r) => r.is_by_election && r.tier === "local" && LONDON.has(r.council_slug) && r.election_date > BY_FROM && r.election_date <= CUTOFF);
  assertBeforeCutoff(rows, "London by-elections");
  const num = {};
  const den = {};
  const detail = [];
  for (const r of rows) {
    const total = (r.candidates || []).reduce((a, c) => a + (c.votes || 0), 0);
    if (!total) continue;
    const g = areaShares(r.council_slug);
    const window = polls.filter((p) => p.fieldwork_end >= shiftDays(r.election_date, -14) && p.fieldwork_end <= shiftDays(r.election_date, -1));
    const poll = pollsterBalancedMean(window, MAJOR_PARTIES);
    const votes = {};
    for (const c of r.candidates) votes[canonicalMajor(c.party_name)] = (votes[canonicalMajor(c.party_name)] || 0) + (c.votes || 0);
    detail.push({ ballot_paper_id: r.ballot_paper_id, votes: total, polls_in_window: poll.polls, ge2024_via: g?.via || null, shares: Object.fromEntries(MAJOR_PARTIES.map((p) => [p, Number(((votes[p] || 0) / total).toFixed(4))])) });
    if (!g || !poll.polls) continue;
    for (const p of MAJOR_PARTIES) {
      num[p] = (num[p] || 0) + (votes[p] || 0);
      den[p] = (den[p] || 0) + total * (g.shares[p] || 0) * poll.shares[p] / GE24_NATIONAL[p];
    }
  }
  return { ratio: Object.fromEntries(MAJOR_PARTIES.map((p) => [p, num[p] / den[p]])), byelections: detail };
}

function main() {
  const history = readJson("data/history/dc-historic-results.json");
  const nationalRatio = readJson("data/calibration/candidate-2026-10-24/local-national-ratio.json");
  const p22 = readJson(POLLS_2022);
  const p2526 = readJson(POLLS_2025_26);
  assertBeforeCutoff(p2526.polls.map((p) => ({ date: p.fieldwork_end })), "polls");
  const ge19 = ge2019National();

  const e1 = london2022(history);
  const e2 = londonNotional2019();
  const poll22 = p22.mean.shares;
  const r2022 = { "Reform UK": nationalRatio.ratio["Reform UK"] };
  const implied = {};
  for (const p of RATIO_PARTIES_2022) {
    implied[p] = e2.shares[p] * poll22[p] / ge19[p];
    r2022[p] = e1.shares[p] / implied[p];
  }
  const e4 = londonByelections(history, p2526.polls, (slug) => ge2024ForArea(history, slug));
  const lsoa = londonLsoaBaseline(history);
  const e4Lsoa = londonByelections(history, p2526.polls, (slug) => lsoa[slug] || null);

  // The May 2025 poll behind C2's national ratio, replaced by named polls.
  const may25Polls = p2526.polls.filter((p) => p.fieldwork_end >= "2025-04-17" && p.fieldwork_end <= "2025-04-30");
  const may25 = pollsterBalancedMean(may25Polls, MAJOR_PARTIES);
  const refit = fitLocalToWestminsterRatio(history, { poll: may25.shares, ge24National: GE24_NATIONAL });

  const r4 = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v == null ? null : Number(v.toFixed(4))]));
  mkdirSync(path.join(ROOT, OUT_DIR), { recursive: true });
  writeFileSync(path.join(ROOT, OUT_DIR, "london-ratio.json"), JSON.stringify({
    snapshot: {
      fitted_by: "scripts/fit-c2-london-2026-11.mjs",
      protocol: "docs/local-engine-holdout-2026-11.md",
      hold_out: `Evidence dated on or before ${CUTOFF} only; no May 2026 result is read.`,
    },
    ratio_2022: r4(r2022),
    ratio_2022_note: "Reform UK keeps the national ratio: Reform polled about 2% in 2022 and stood in few London wards, so no London Reform ratio can be estimated from 2022.",
    evidence_2022: {
      london_borough_2022: { shares: r4(e1.shares), boroughs: e1.boroughs, contests: e1.contests, votes: e1.votes, source: "data/history/dc-historic-results.json, election_date 2022-05-05, full-slate votes summed by party" },
      london_notional_ge2019: { shares: r4(e2.shares), constituencies: e2.seats, source: e2.source, method: e2.method, london_rule: "most of the constituency's LSOAs in an E09 authority (data/features/lsoa21-to-pcon24.json)" },
      polls_2022: { shares: r4(poll22), pollsters: p22.mean.pollsters, polls: p22.mean.polls, source: p22.source, window: p22.window },
      ge2019_national: { shares: ge19, source: "UK_WESTMINSTER_2019_GE_RESULT, src/lib/nationalPolling.js at 5e85c84 (House of Commons Library CBP-8749, UK-wide)" },
      westminster_implied_london_2022: r4(implied),
    },
    ratio_byelections: r4(e4.ratio),
    ratio_byelections_note: "Name-matched GE2024 baseline (set N): only the by-elections in boroughs with a constituency match count.",
    ratio_byelections_lsoa: r4(e4Lsoa.ratio),
    evidence_byelections: { byelections: e4.byelections, byelections_lsoa: e4Lsoa.byelections, polls_source: p2526.source, ge2024_national: GE24_NATIONAL },
    london_lsoa_baseline: Object.fromEntries(Object.entries(lsoa).sort().map(([k, v]) => [k, { via: v.via, shares: r4(v.shares) }])),
    london_lsoa_baseline_source: "data/features/lsoa21-to-pcon24.json (ONS LSOA21 to PCON24) and GE2024 constituency results in data/history/dc-historic-results.json; LSOA counts stand in for population",
  }, null, 2) + "\n");

  writeFileSync(path.join(ROOT, OUT_DIR, "local-national-ratio.json"), JSON.stringify({
    ...nationalRatio,
    snapshot: {
      ...nationalRatio.snapshot,
      fitted_by: "scripts/fit-c2-london-2026-11.mjs",
      westminster_poll_may_2025: { shares: r4(may25.shares), pollsters: may25.pollsters, polls: may25.polls, window: "fieldwork ending 17 to 30 April 2025", source: p2526.source },
      replaces: "UK_WESTMINSTER_2025_MAY_AVERAGE, the hand-set average used by the 24 October fit",
      protocol: "docs/local-engine-holdout-2026-11.md",
    },
    ratio: r4(refit.ratio),
    ratio_24_october: nationalRatio.ratio,
    councils: refit.councils,
  }, null, 2) + "\n");

  console.log("London 2022 shares:", JSON.stringify(r4(e1.shares)), `${e1.boroughs} boroughs, ${e1.contests} wards`);
  console.log("London notional GE2019:", JSON.stringify(r4(e2.shares)), `${e2.seats} seats`);
  console.log("Polls 2022:", JSON.stringify(r4(poll22)), `${p22.mean.polls} polls`);
  console.log("r_London (2022):", JSON.stringify(r4(r2022)));
  console.log("r_London (by-elections):", JSON.stringify(r4(e4.ratio)), `${e4.byelections.length} by-elections`);
  console.log("r_London (by-elections, LSOA baseline):", JSON.stringify(r4(e4Lsoa.ratio)), `${e4Lsoa.byelections.filter((b) => b.ge2024_via).length} with a baseline`);
  console.log("May 2025 named polls:", JSON.stringify(r4(may25.shares)), `${may25.polls} polls, ${may25.pollsters.length} pollsters`);
  console.log("National ratio refit:", JSON.stringify(r4(refit.ratio)), "was", JSON.stringify(nationalRatio.ratio));
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main();
