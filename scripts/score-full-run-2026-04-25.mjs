#!/usr/bin/env node
/**
 * score-full-run-2026-04-25.mjs: score the full run of the 7 May engine on
 * 25 April 2026 inputs, with and without the candidate steps. Protocol:
 * docs/local-engine-full-run-2026-11.md, section 1.
 *
 * The engine itself is run elsewhere, in a detached checkout of 5e85c84 with
 * the history rebuilt as at 25 April (scripts/rebuild-history-as-at.mjs) and
 * data/polling/override.json set to the polls to 24 April. This script reads
 * the two engine outputs and scores:
 *   F0  run 0: the engine with its own poll override (reproduction check)
 *   F1  run 1: the engine on the polls to 24 April, as it comes out
 *   F2  run 1 with Step 9b and Final-C replaced by C1 and A0P (the gate figure)
 *   F3  run 1 with C1 and A1P, London out of Final-C (diagnostic)
 *
 * Usage:
 *   node scripts/score-full-run-2026-04-25.mjs --run0=<path> --run1=<path>
 *     [--write-predictions=<path>]   writes F2's forecast, for the calibration refits
 *   writes data/transparency/may-2026-full-run-2026-04-25.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { ge2024ForArea } from "../src/lib/localElectionTarget.js";
import { LONDON } from "./fit-candidate-engine-2026-10-24.mjs";
import { ACTUALS_PATH, POSTAUDIT_PATH, readJson, localRows } from "./score-may-2026-like-for-like.mjs";
import { atCommit, baseTargets, pre9bStage, step9b, sharesOf, asPredictions } from "./replay-may-2026-candidate.mjs";
import { londonLsoaBaseline } from "./fit-c2-london-2026-11.mjs";
import { councilType, runArm, score } from "./replay-may-2026-c2-london.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function load(p) {
  const buf = readFileSync(path.resolve(p));
  return { doc: JSON.parse(buf.toString("utf8")), sha256: createHash("sha256").update(buf).digest("hex") };
}

function asShares(predictions) {
  return Object.fromEntries(Object.entries(predictions).filter(([, e]) => e.prediction).map(([id, e]) => [id, sharesOf(e)]));
}

function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true]; }));
  if (!args.run0 || !args.run1) throw new Error("--run0 and --run1 are required");
  const run0 = load(args.run0);
  const run1 = load(args.run1);
  const published = atCommit("data/predictions/may-2026/local-and-mayor.json");
  const history = readJson("data/history/dc-historic-results.json");
  const postaudit = readJson(POSTAUDIT_PATH);
  const actuals = readJson(ACTUALS_PATH).by_ballot;
  const c1Doc = readJson("data/calibration/candidate-2026-10-24/reform-regional-multiplier.json");
  const ratioOct = readJson("data/calibration/candidate-2026-10-24/local-national-ratio.json");
  const ratioNov = readJson("data/calibration/candidate-2026-11/local-national-ratio.json");
  const C1 = Object.fromEntries(Object.entries(c1Doc.tiers).map(([t, v]) => [t, v.multiplier]));

  // Reproduction check: run 0 against the polling-day file.
  const top = (sh) => Object.entries(sh).sort((a, b) => b[1] - a[1])[0]?.[0];
  let flips = 0;
  let maxDiff = 0;
  for (const [id, e] of Object.entries(published.predictions)) {
    if (!e.prediction) continue;
    const a = sharesOf(run0.doc.predictions[id] || {});
    const b = sharesOf(e);
    if (top(a) !== top(b)) flips += 1;
    for (const p of Object.keys(b)) maxDiff = Math.max(maxDiff, Math.abs((a[p] || 0) - b[p]));
  }

  const pre = pre9bStage(run1.doc.predictions);
  const stage = step9b(pre, baseTargets(), C1);
  const ids = localRows(postaudit, "prereg").map((r) => r.ballot_paper_id);
  const types = Object.fromEntries(ids.map((id) => [id, councilType(id, pre)]));
  const nameCache = new Map();
  const nameMatched = (slug) => { if (!nameCache.has(slug)) nameCache.set(slug, ge2024ForArea(history, slug)?.shares || null); return nameCache.get(slug); };
  const lsoa = londonLsoaBaseline(history);
  const inputsP = {
    poll: ratioOct.polls_to_cutoff.shares,
    ge24National: ratioOct.snapshot.ge2024_national,
    nationalRatio: ratioNov.ratio,
    areaShares: (slug) => (LONDON.has(slug) ? lsoa[slug]?.shares || null : nameMatched(slug)),
  };
  const f2 = runArm(stage, inputsP, { mode: "single" });
  const f3 = runArm(stage, inputsP, { mode: "exclude" });

  const runs = {
    F0: { label: "Run 0: 7 May engine, its own poll override, history as at 25 April", ...score(asShares(run0.doc.predictions), ids, actuals, types) },
    F1: { label: "Run 1: 7 May engine, polls to 24 April, history as at 25 April", ...score(asShares(run1.doc.predictions), ids, actuals, types) },
    F2: { label: "Run 1 with C1 and A0P (the gate figure)", ...score(f2.shares, ids, actuals, types) },
    F3: { label: "Run 1 with C1 and A1P, London out of Final-C (diagnostic)", ...score(f3.shares, ids, actuals, types) },
  };
  const out = {
    generated_by: "scripts/score-full-run-2026-04-25.mjs",
    protocol: "docs/local-engine-full-run-2026-11.md",
    yardstick: "scripts/score-may-2026-like-for-like.mjs; bar 1,623 of 2,897 (56.0%); published London 447",
    engine: "scripts/run-bulk-predictions.mjs at 5e85c84, unchanged",
    inputs: {
      history: "data/history/dc-historic-results.json rebuilt with scripts/rebuild-history-as-at.mjs --as-at=2026-04-25 (Democracy Club fetch of 2026-04-25T16:09:17Z, 21,269 rows)",
      polls_run1: { shares: ratioOct.polls_to_cutoff.shares, date: ratioOct.polls_to_cutoff.date, polls: ratioOct.polls_to_cutoff.polls, source: ratioOct.polls_to_cutoff.source },
      polls_run0: { shares: run0.doc.snapshot?.input_polling, source: "data/polling/override.json at 5e85c84 (retrieved 2026-04-26, fieldwork window given as 13 to 27 April 2026)" },
    },
    engine_outputs_sha256: { run0: run0.sha256, run1: run1.sha256 },
    reproduction_check: { wards_with_a_different_top_party: flips, max_abs_share_difference: Number(maxDiff.toFixed(6)), against: "data/predictions/may-2026/local-and-mayor.json at 5e85c84" },
    runs,
  };
  writeFileSync(path.join(ROOT, "data/transparency/may-2026-full-run-2026-04-25.json"), JSON.stringify(out, null, 2) + "\n");
  if (args["write-predictions"]) writeFileSync(path.resolve(args["write-predictions"]), JSON.stringify({ snapshot: { generated_by: "scripts/score-full-run-2026-04-25.mjs", arm: "F2" }, predictions: asPredictions(f2.shares) }) + "\n");
  console.log(`reproduction: ${flips} wards with a different top party, max share difference ${maxDiff.toFixed(6)}`);
  for (const [k, r] of Object.entries(runs)) {
    const t = r.by_council_type;
    console.log(`${k} ${r.called} of ${r.wards} = ${r.accuracy_pct}%  London ${t.london.called}  met ${t.metropolitan.called}  no-anchor ${t.no_anchor.called}  anchored ${t.anchored.called}  Reform first ${r.named_first["Reform UK"]}  recall Lab ${r.recall_pct.Labour} LD ${r.recall_pct["Liberal Democrats"]} Grn ${r.recall_pct["Green Party"]}`);
  }
}

main();
