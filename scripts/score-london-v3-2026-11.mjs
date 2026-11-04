#!/usr/bin/env node
/**
 * score-london-v3-2026-11.mjs: the last London arm, scored once on the full
 * run's stage. Protocol: docs/local-engine-london-v3-2026-11.md.
 *
 * As S2 (C1, the slate step, A0P outside London), except London's Final-C is
 * run on its own and aims at the pre-lock London Westminster polls with a
 * ratio of 1.
 *
 * Usage:
 *   node scripts/score-london-v3-2026-11.mjs --run1=<path> [--write-predictions=<path>]
 *   writes data/transparency/may-2026-london-v3-2026-11.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { MAJOR_PARTIES, ge2024ForArea, localElectionTargets } from "../src/lib/localElectionTarget.js";
import { LONDON } from "./fit-candidate-engine-2026-10-24.mjs";
import { ACTUALS_PATH, POSTAUDIT_PATH, readJson, localRows } from "./score-may-2026-like-for-like.mjs";
import { baseTargets, pre9bStage, step9b, finalC, asPredictions, CALIBRATION_PARTIES } from "./replay-may-2026-candidate.mjs";
import { londonLsoaBaseline } from "./fit-c2-london-2026-11.mjs";
import { councilType, score } from "./replay-may-2026-c2-london.mjs";
import { pollsterBalancedMean } from "./extract-wikipedia-polls.mjs";
import { reformSlateFractions, slateStep, rostersAt, ROSTER_COMMIT } from "./score-london-v2-2026-11.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const LONDON_POLLS = "data/polling/wikipedia/london-westminster-2025-10-25-to-2026-04-25.json";

// Rows from one pollster with the same sample and overlapping fieldwork are one
// survey reported twice: average them into a single poll before pollster averaging.
export function mergeDuplicateRows(polls) {
  const start = (p) => {
    const d = p.fieldwork_start_day ? Number(p.fieldwork_start_day) : Number(p.fieldwork_end.slice(8));
    const end = new Date(`${p.fieldwork_end}T00:00:00Z`);
    const s = new Date(end);
    if (d > end.getUTCDate()) s.setUTCMonth(s.getUTCMonth() - 1);
    s.setUTCDate(d);
    return s.toISOString().slice(0, 10);
  };
  const groups = [];
  for (const p of polls) {
    const g = groups.find((x) => x[0].pollster === p.pollster && x[0].sample === p.sample && x.some((q) => start(q) <= p.fieldwork_end && start(p) <= q.fieldwork_end));
    if (g) g.push(p); else groups.push([p]);
  }
  return groups.map((g) => {
    if (g.length === 1) return g[0];
    const shares = {};
    for (const party of new Set(g.flatMap((p) => Object.keys(p.shares)))) {
      const vals = g.map((p) => p.shares[party]).filter((v) => v != null);
      shares[party] = vals.reduce((a, b) => a + b, 0) / vals.length;
    }
    return { ...g[0], fieldwork_end: g.map((p) => p.fieldwork_end).sort().at(-1), merged_rows: g.length, shares };
  });
}

function subset(stage, keep) {
  return Object.fromEntries(Object.entries(stage).filter(([id]) => keep(id)));
}

function wardsOf(stage) {
  return Object.entries(stage).map(([id, s]) => ({ council_slug: id.split(".")[1], votes: s.votes, shares: s.shares }));
}

function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true]; }));
  if (!args.run1) throw new Error("--run1 is required");
  const buf = readFileSync(path.resolve(args.run1));
  const run1 = JSON.parse(buf.toString("utf8"));
  const history = readJson("data/history/dc-historic-results.json");
  const postaudit = readJson(POSTAUDIT_PATH);
  const actuals = readJson(ACTUALS_PATH).by_ballot;
  const c1Doc = readJson("data/calibration/candidate-2026-10-24/reform-regional-multiplier.json");
  const ratioOct = readJson("data/calibration/candidate-2026-10-24/local-national-ratio.json");
  const ratioNov = readJson("data/calibration/candidate-2026-11/local-national-ratio.json");
  const londonDoc = readJson(LONDON_POLLS);
  const C1 = Object.fromEntries(Object.entries(c1Doc.tiers).map(([t, v]) => [t, v.multiplier]));

  const londonPolls = mergeDuplicateRows(londonDoc.polls);
  const londonMean = pollsterBalancedMean(londonPolls, MAJOR_PARTIES);
  const londonPoll = londonMean.shares;

  const pre = pre9bStage(run1.predictions);
  const lifted = step9b(pre, baseTargets(), C1);
  const { stage } = slateStep(pre, lifted, reformSlateFractions(rostersAt(ROSTER_COMMIT)));
  const ids = localRows(postaudit, "prereg").map((r) => r.ballot_paper_id);
  const types = Object.fromEntries(ids.map((id) => [id, councilType(id, pre)]));

  const nameCache = new Map();
  const nameMatched = (slug) => { if (!nameCache.has(slug)) nameCache.set(slug, ge2024ForArea(history, slug)?.shares || null); return nameCache.get(slug); };
  const lsoa = londonLsoaBaseline(history);
  const isLondon = (id) => LONDON.has(id.split(".")[1]);
  const rest = subset(stage, (id) => !isLondon(id));
  const lon = subset(stage, isLondon);
  const tRest = localElectionTargets(wardsOf(rest), {
    poll: ratioOct.polls_to_cutoff.shares,
    ge24National: ratioOct.snapshot.ge2024_national,
    ratio: ratioNov.ratio,
    areaShares: (slug) => (LONDON.has(slug) ? lsoa[slug]?.shares || null : nameMatched(slug)),
  });
  const ones = Object.fromEntries(MAJOR_PARTIES.map((p) => [p, 1]));
  const tLon = localElectionTargets(wardsOf(lon), { poll: londonPoll, ge24National: londonPoll, ratio: ones, areaShares: () => londonPoll });
  const rRest = finalC(rest, tRest);
  const rLon = finalC(lon, tLon);
  const shares = { ...rRest.shares, ...rLon.shares };

  const s = score(shares, ids, actuals, types);
  const passes = s.called > 1623 && s.by_council_type.london.called >= 447;
  const r4 = (o) => Object.fromEntries(Object.entries(o).filter(([p]) => CALIBRATION_PARTIES.includes(p)).map(([p, v]) => [p, Number(v.toFixed(4))]));
  const out = {
    generated_by: "scripts/score-london-v3-2026-11.mjs",
    protocol: "docs/local-engine-london-v3-2026-11.md",
    yardstick: "scripts/score-may-2026-like-for-like.mjs; pass: more than 1,623 of 2,897 and at least 447 London wards",
    run1_sha256: createHash("sha256").update(buf).digest("hex"),
    london_poll: { shares: r4(londonPoll), polls_after_merging: londonMean.polls, rows: londonDoc.polls.length, pollsters: londonMean.pollsters, source: londonDoc.source, window: londonDoc.window },
    final_c: { london: { targets: r4(tLon), multipliers: r4(rLon.multipliers) }, rest: { targets: r4(tRest), multipliers: r4(rRest.multipliers) } },
    runs: { T: { label: "C1, slate step, A0P outside London, London Final-C on the pre-lock London polls", passes_gate: passes, ...s } },
  };
  writeFileSync(path.join(ROOT, "data/transparency/may-2026-london-v3-2026-11.json"), JSON.stringify(out, null, 2) + "\n");
  if (args["write-predictions"]) writeFileSync(path.resolve(args["write-predictions"]), JSON.stringify({ snapshot: { generated_by: "scripts/score-london-v3-2026-11.mjs", arm: "T" }, predictions: asPredictions(shares) }) + "\n");
  const t = s.by_council_type;
  console.log(`London poll ${JSON.stringify(r4(londonPoll))} from ${londonMean.polls} polls (${londonDoc.polls.length} rows)`);
  console.log(`London Final-C multipliers ${JSON.stringify(r4(rLon.multipliers))}`);
  console.log(`T ${s.called} of ${s.wards} = ${s.accuracy_pct}%  London ${t.london.called}  met ${t.metropolitan.called}  no-anchor ${t.no_anchor.called}  anchored ${t.anchored.called}  Reform first ${s.named_first["Reform UK"]}  recall Lab ${s.recall_pct.Labour} LD ${s.recall_pct["Liberal Democrats"]} Grn ${s.recall_pct["Green Party"]}  passes ${passes}`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main();
