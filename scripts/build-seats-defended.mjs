#!/usr/bin/env node
/**
 * Build data/seats/seats-defended.json: the party defending each council seat
 * before a by-election, and before each scheduled 7 May 2026 contest in the
 * councils that elect by thirds or halves.
 *
 *   node scripts/build-seats-defended.mjs              rebuild and write
 *   node scripts/build-seats-defended.mjs --check      rebuild, compare, write nothing
 *
 * Inputs, best first where they overlap:
 *   data/contests/local-byelection-holders.json   hand verified, two sources each
 *   data/results/local-byelections.json           previous party as published by roundups
 *   election results with elected flags:
 *     data/history/byelection-appends.json        tracked by-election sidecar
 *     data/results/may-2026/local-and-mayor.merged.json
 *     dc-historic-results.json                    gitignored bundle (--history=)
 *     data/contests/local-byelections             single-seat by-election winners since June 2026
 *
 * Hand-recorded holders live in data/seats/hand-recorded.json, an input this
 * script reads and never writes, so a rebuild cannot lose them. Rules:
 * data/seats/README.md.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import {
  SEATS_FILE,
  byElectionRecord,
  controlKey,
  normaliseContest,
  roundupFor,
  roundupIndex,
  sittingParties,
  thirdsDefended,
  validateSeats,
} from "./lib/seats-defended.mjs";

const ROOT = process.cwd();
const p = (...xs) => path.join(ROOT, ...xs);
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")).map(([k, v]) => [k, v ?? true]));

const ELECTION = "2026-05-07";
const ALL_OUT_FRACTION = 0.6;

function firstExisting(list) {
  return list.find((f) => f && existsSync(f)) || null;
}

const HISTORY = firstExisting([args.history, p("data/history/dc-historic-results.json"), path.join(homedir(), "ukelections/data/history/dc-historic-results.json")]);

const readJson = (f) => JSON.parse(readFileSync(f, "utf8"));

function loadContestFiles() {
  const dir = p("data/contests/local-byelections");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
    .map((f) => readJson(path.join(dir, f)))
    .filter((d) => d?.contest?.ballot_paper_id)
    .sort((a, b) => a.contest.ballot_paper_id.localeCompare(b.contest.ballot_paper_id));
}

/** Every contest with elected flags, one per ballot, best source first. */
function buildHistory(contestFiles) {
  const chosen = new Map();
  const add = (raw, sourceName) => {
    if (!raw?.ballot_paper_id || !raw.ballot_paper_id.startsWith("local.")) return;
    if (chosen.has(raw.ballot_paper_id)) return;
    const c = normaliseContest(raw, sourceName);
    if (!c.council || !c.ward || !c.date) return;
    chosen.set(raw.ballot_paper_id, c);
  };
  const appends = readJson(p("data/history/byelection-appends.json")).results || [];
  const rank = { hand_verified_declaration: 0, hand_verified_two_sources: 1, corrected_against_declaration: 2 };
  [...appends].sort((a, b) => (rank[a.review_status] ?? 9) - (rank[b.review_status] ?? 9)).forEach((r) => add(r, "data/history/byelection-appends.json"));
  const merged = readJson(p("data/results/may-2026/local-and-mayor.merged.json"));
  for (const r of Object.values(merged.by_ballot)) if (r.tier === "local") add(r, "data/results/may-2026/local-and-mayor.merged.json");
  const hist = readJson(HISTORY);
  for (const r of Object.values(hist.by_ballot)) if (r.tier === "local") add(r, "dc-historic-results.json");
  // Single-seat by-elections declared since June 2026, from the contest files.
  for (const d of contestFiles) {
    const c = d.contest;
    if (!d.result?.declared || !d.result.winner_party || c.seats_contested !== 1) continue;
    add({
      ballot_paper_id: c.ballot_paper_id,
      election_date: c.polling_day,
      council_slug: c.council_slug,
      ward_slug: c.ward_slug,
      is_by_election: true,
      source: d.result.source,
      candidates: [{ name: d.result.winner_candidate, party_name: d.result.winner_party_name || d.result.winner_party, elected: true }],
    }, "data/contests/local-byelections");
  }
  const byWard = new Map();
  for (const c of chosen.values()) {
    const k = `${c.council}|${c.ward}`;
    if (!byWard.has(k)) byWard.set(k, []);
    byWard.get(k).push(c);
  }
  return { byWard, snapshot: hist.snapshot, total: chosen.size };
}

function sourcesFor(evidence, byId) {
  return evidence.map((id) => {
    const c = byId.get(id);
    return { label: `Result ${id} (${c?.source_name || "held data"})`, url: c?.source_url || `https://candidates.democracyclub.org.uk/elections/${id}/` };
  });
}

function main() {
  if (!HISTORY) {
    console.error("dc-historic-results.json not found. Pass --history=<path>. Refusing to rebuild: the derived records would all turn unresolved.");
    process.exit(1);
  }
  const contestFiles = loadContestFiles();
  const { byWard, snapshot, total } = buildHistory(contestFiles);
  const byId = new Map([...byWard.values()].flat().map((c) => [c.id, c]));
  const hand = readJson(p("data/contests/local-byelection-holders.json")).holders || {};
  const roundups = roundupIndex(readJson(p("data/results/local-byelections.json")));
  const handRecorded = readJson(p("data/seats/hand-recorded.json"));
  const contestIds = new Set(contestFiles.map((d) => d.contest.ballot_paper_id));
  const strays = Object.keys(handRecorded.by_elections || {}).filter((id) => !contestIds.has(id));
  if (strays.length) console.warn(`! hand-recorded entries with no contest file: ${strays.join(", ")}`);

  /* ---------------- by-elections ---------------- */
  const byElections = {};
  for (const d of contestFiles) {
    const c = d.contest;
    const id = c.ballot_paper_id;
    const history = (byWard.get(`${c.council_slug}|${c.ward_slug}`) || []).filter((h) => h.id !== id);
    const derived = sittingParties(history, { date: c.polling_day, seats: c.seats_total, boundary_start: c.boundary_set_start });
    const rec = byElectionRecord(c, { hand: hand[id], roundup: roundupFor(roundups, c), derived, handRecorded: handRecorded.by_elections?.[id] });
    if (rec.review_status === "derived") rec.source = sourcesFor(derived.evidence || [], byId);
    if (c.voting_system === "STV" && rec.confidence === "unresolved" && rec.reason !== "sources_disagree") {
      rec.detail = `${rec.detail}. Scottish wards elect by STV, and held data has no elected flags for them`;
    }
    byElections[id] = rec;
  }

  /* ---------------- 7 May 2026 thirds and halves ---------------- */
  const merged = readJson(p("data/results/may-2026/local-and-mayor.merged.json"));
  const control = readJson(p("data/results/may-2026/council-control.json"));
  const cc = Object.fromEntries(control.councils.map((x) => [x.council_slug, x]));
  const missing = new Set((merged.missing_ballots || []).filter((b) => b.tier === "local").map((b) => b.council_slug));
  const byCouncil = new Map();
  for (const r of Object.values(merged.by_ballot)) {
    if (r.tier !== "local" || r.is_by_election || /\.by\./.test(r.ballot_paper_id)) continue;
    if (!byCouncil.has(r.council_slug)) byCouncil.set(r.council_slug, []);
    byCouncil.get(r.council_slug).push(r);
  }
  const scheduled = {};
  const councils = {};
  for (const [slug, rows] of [...byCouncil.entries()].sort()) {
    const T = cc[slug]?.cycle?.total_seats;
    const U = rows.reduce((n, r) => n + r.winner_count, 0);
    // All-out councils with gaps in the results (Birmingham, Newham, Tower
    // Hamlets) look like thirds on seat counts alone; council-control.json's
    // cycle says otherwise, so they are left out.
    if (!T || U >= ALL_OUT_FRACTION * T || cc[slug].cycle?.is_all_up) continue;
    const wards = [];
    for (const r of rows.sort((a, b) => a.ballot_paper_id.localeCompare(b.ballot_paper_id))) {
      const prior = handRecorded.scheduled?.[r.ballot_paper_id];
      if (prior) {
        const rec = { kind: "scheduled", council: cc[slug].council_name, ward_slug: r.ward_slug, polling_day: ELECTION, seats_up: r.winner_count, ...prior, review_status: "hand_recorded" };
        scheduled[r.ballot_paper_id] = rec;
        wards.push(rec);
        continue;
      }
      const history = (byWard.get(`${slug}|${r.ward_slug}`) || []).filter((h) => h.id !== r.ballot_paper_id && h.date < ELECTION);
      const res = thirdsDefended(history, r, ELECTION);
      const rec = {
        kind: "scheduled",
        council: cc[slug].council_name,
        ward_slug: r.ward_slug,
        polling_day: ELECTION,
        seats_up: r.winner_count,
        confidence: res.determined ? "determined" : "unresolved",
        defended: res.determined ? res.parties : null,
        review_status: "derived",
        source: sourcesFor(res.evidence, byId),
      };
      if (res.determined) {
        rec.basis = res.basis;
        rec.note = [res.note, "Party as last elected. A change of party since then is not checked unless a source is named."].filter(Boolean).join(" ");
      } else {
        rec.reason = res.reason;
        rec.detail = res.detail;
      }
      scheduled[r.ballot_paper_id] = rec;
      wards.push(rec);
    }
    const determined = wards.filter((w) => w.confidence === "determined");
    const summary = {
      council: cc[slug].council_name,
      total_seats: T,
      seats_up: U,
      wards: wards.length,
      wards_determined: determined.length,
      results_incomplete: missing.has(slug) || Boolean(cc[slug].may7_wins?.undeclared_seats),
      all_determined: determined.length === wards.length,
    };
    if (summary.all_determined) {
      const D = {};
      for (const w of wards) for (const party of w.defended) D[controlKey(party)] = (D[controlKey(party)] || 0) + 1;
      const pre = cc[slug].pre_may7?.by_party || {};
      const wins = cc[slug].may7_wins?.by_party || {};
      const keys = ["con", "lab", "ld", "green", "ref", "other"];
      const fold = (o) => {
        const out = Object.fromEntries(keys.map((k) => [k, 0]));
        for (const [k, v] of Object.entries(o)) out[keys.includes(k) ? k : "other"] += v || 0;
        return out;
      };
      const preF = fold(pre);
      const winF = fold(wins);
      const post = Object.fromEntries(keys.map((k) => [k, preF[k] - (D[k] || 0) + winF[k]]));
      const negative = keys.filter((k) => preF[k] - (D[k] || 0) < 0);
      const threshold = Math.floor(T / 2) + 1;
      const majority = keys.find((k) => k !== "other" && post[k] >= threshold) || null;
      const ccPost = fold(cc[slug].post_may7?.by_party || {});
      summary.defended = Object.fromEntries(keys.map((k) => [k, D[k] || 0]));
      summary.composition_before = { source: "council-control.json pre_may7 (OpenCouncilData 2025 snapshot)", by_party: preF };
      summary.derived_after = { by_party: post, control: majority ? `${majority} majority` : "no overall control", threshold };
      summary.council_control_json = { by_party: ccPost, control: cc[slug].control?.status === "majority" ? `${cc[slug].control.controlling_party} majority` : "no overall control" };
      if (negative.length) summary.does_not_reconcile = `the 2025 composition has fewer ${negative.join(", ")} seats than the seats determined as defended; a change of party or a by-election since the 2025 snapshot`;
      const diff = keys.filter((k) => post[k] !== ccPost[k]);
      summary.disagrees_with_council_control_json = diff.length > 0 || summary.derived_after.control !== summary.council_control_json.control;
    }
    councils[slug] = summary;
  }

  /* ---------------- counts and write ---------------- */
  const count = (recs) => {
    const vals = Object.values(recs);
    const reasons = {};
    const tiers = {};
    for (const r of vals) {
      if (r.confidence === "unresolved") reasons[r.reason] = (reasons[r.reason] || 0) + 1;
      if (r.confidence === "determined") tiers[r.review_status] = (tiers[r.review_status] || 0) + 1;
    }
    return { records: vals.length, determined: vals.filter((r) => r.confidence === "determined").length, determined_by_tier: tiers, unresolved_by_reason: reasons };
  };
  const out = {
    _readme: "Which party was defending each council seat before a contest. Rules, sources and licences: data/seats/README.md. Built by scripts/build-seats-defended.mjs; entries marked hand_recorded come from data/seats/hand-recorded.json and hand_verified_two_sources from data/contests/local-byelection-holders.json.",
    inputs: {
      hand_holders: "data/contests/local-byelection-holders.json",
      hand_recorded: "data/seats/hand-recorded.json",
      roundups: "data/results/local-byelections.json",
      appends: "data/history/byelection-appends.json",
      may_2026_results: "data/results/may-2026/local-and-mayor.merged.json",
      council_control: "data/results/may-2026/council-control.json",
      dc_history_bundle: { snapshot_id: snapshot?.snapshot_id, retrieved_at: snapshot?.retrieved_at, licence: snapshot?.licence },
      contests_with_elected_flags: total,
    },
    counts: {
      by_elections: count(byElections),
      scheduled_2026_wards: count(scheduled),
      scheduled_2026_councils: {
        councils: Object.keys(councils).length,
        all_wards_determined: Object.values(councils).filter((c) => c.all_determined).length,
        disagree_with_council_control_json: Object.entries(councils).filter(([, c]) => c.disagrees_with_council_control_json).map(([k]) => k),
      },
    },
    by_elections: byElections,
    scheduled,
    councils_2026: councils,
  };
  const errors = validateSeats(out);
  if (errors.length) {
    console.error(errors.slice(0, 30).join("\n"));
    process.exit(1);
  }
  const text = `${JSON.stringify(out, null, 2)}\n`;
  console.log(JSON.stringify(out.counts, null, 2));
  if (args.check) {
    const same = existsSync(p(SEATS_FILE)) && readFileSync(p(SEATS_FILE), "utf8") === text;
    console.log(same ? "seats-defended.json is up to date" : "seats-defended.json would change");
    process.exit(same ? 0 : 1);
  }
  mkdirSync(p("data/seats"), { recursive: true });
  writeFileSync(p(SEATS_FILE), text);
  console.log(`wrote ${SEATS_FILE}`);
}

main();
