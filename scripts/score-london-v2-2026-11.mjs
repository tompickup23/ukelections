#!/usr/bin/env node
/**
 * score-london-v2-2026-11.mjs: the slate step and its two arms, scored once
 * on the full run's stage. Protocol: docs/local-engine-london-v2-2026-11.md.
 *
 * Starts from run 1 of the full run (the 7 May engine on 25 April inputs),
 * recovers the pre-Step 9b stage, applies C1, then the slate step (Reform's
 * share times its slate fraction in wards Step 9b lifted, from the rosters
 * locked on 25 April 2026), then Final-C as A0P (S2) or A1P (S3).
 *
 * Usage:
 *   node scripts/score-london-v2-2026-11.mjs --run1=<path> [--write-predictions=<path> --arm=S2]
 *   writes data/transparency/may-2026-london-v2-2026-11.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { canonicalMajor, ge2024ForArea } from "../src/lib/localElectionTarget.js";
import { LONDON } from "./fit-candidate-engine-2026-10-24.mjs";
import { ACTUALS_PATH, POSTAUDIT_PATH, readJson, localRows } from "./score-may-2026-like-for-like.mjs";
import { baseTargets, pre9bStage, step9b, asPredictions } from "./replay-may-2026-candidate.mjs";
import { londonLsoaBaseline } from "./fit-c2-london-2026-11.mjs";
import { councilType, runArm, score } from "./replay-may-2026-c2-london.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
export const ROSTER_COMMIT = "2bfb62b";
const ROSTER_DIR = "data/candidates/may-2026";

// Reform's slate fraction per ballot: candidates standing over seats, capped at 1.
export function reformSlateFractions(ballots) {
  const out = {};
  for (const b of ballots) {
    const seats = b.winner_count;
    if (!seats || !b.ballot_paper_id?.startsWith("local.")) continue;
    const reform = (b.candidates || []).filter((c) => canonicalMajor(c.party_name) === "Reform UK").length;
    out[b.ballot_paper_id] = Math.min(reform / seats, 1);
  }
  return out;
}

// The slate step: only in wards Step 9b lifted, Reform scaled, the rest pro rata.
export function slateStep(pre, lifted, fractions) {
  const out = {};
  let changed = 0;
  for (const [id, s] of Object.entries(lifted)) {
    const before = pre[id]?.shares["Reform UK"] || 0;
    const r = s.shares["Reform UK"] || 0;
    const f = fractions[id];
    if (!(r > before + 1e-9) || f == null || f >= 1) { out[id] = s; continue; }
    const nr = r * f;
    const shares = Object.fromEntries(Object.entries(s.shares).map(([p, v]) => [p, p === "Reform UK" ? nr : r < 1 ? (v * (1 - nr)) / (1 - r) : v]));
    out[id] = { ...s, shares };
    changed += 1;
  }
  return { stage: out, changed };
}

function rostersAt(commit) {
  const files = execFileSync("git", ["ls-tree", "--name-only", `${commit}:${ROSTER_DIR}`], { cwd: ROOT }).toString("utf8").split("\n").filter((f) => f.endsWith(".json"));
  const ballots = [];
  for (const f of files) {
    const doc = JSON.parse(execFileSync("git", ["show", `${commit}:${ROSTER_DIR}/${f}`], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }).toString("utf8"));
    ballots.push(...(doc.ballots || []));
  }
  return ballots;
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
  const C1 = Object.fromEntries(Object.entries(c1Doc.tiers).map(([t, v]) => [t, v.multiplier]));

  const pre = pre9bStage(run1.predictions);
  const lifted = step9b(pre, baseTargets(), C1);
  const fractions = reformSlateFractions(rostersAt(ROSTER_COMMIT));
  const { stage, changed } = slateStep(pre, lifted, fractions);
  const ids = localRows(postaudit, "prereg").map((r) => r.ballot_paper_id);
  const types = Object.fromEntries(ids.map((id) => [id, councilType(id, pre)]));
  const changedByType = {};
  for (const id of ids) if (stage[id] !== lifted[id]) changedByType[types[id]] = (changedByType[types[id]] || 0) + 1;

  const nameCache = new Map();
  const nameMatched = (slug) => { if (!nameCache.has(slug)) nameCache.set(slug, ge2024ForArea(history, slug)?.shares || null); return nameCache.get(slug); };
  const lsoa = londonLsoaBaseline(history);
  const inputsP = {
    poll: ratioOct.polls_to_cutoff.shares,
    ge24National: ratioOct.snapshot.ge2024_national,
    nationalRatio: ratioNov.ratio,
    areaShares: (slug) => (LONDON.has(slug) ? lsoa[slug]?.shares || null : nameMatched(slug)),
  };
  const arms = {
    S2: { label: "C1, slate step, A0P", r: runArm(stage, inputsP, { mode: "single" }) },
    S3: { label: "C1, slate step, A1P (London out of Final-C)", r: runArm(stage, inputsP, { mode: "exclude" }) },
  };
  const out = {
    generated_by: "scripts/score-london-v2-2026-11.mjs",
    protocol: "docs/local-engine-london-v2-2026-11.md",
    yardstick: "scripts/score-may-2026-like-for-like.mjs; pass: more than 1,623 of 2,897 and at least 447 London wards",
    run1_sha256: createHash("sha256").update(buf).digest("hex"),
    rosters: `${ROSTER_DIR} at ${ROSTER_COMMIT} (locked 25 April 2026 from Democracy Club)`,
    slate_step: { wards_changed: changed, yardstick_wards_changed_by_type: changedByType },
    runs: {},
  };
  for (const [k, a] of Object.entries(arms)) {
    const s = score(a.r.shares, ids, actuals, types);
    const passes = s.called > 1623 && s.by_council_type.london.called >= 447;
    out.runs[k] = { label: a.label, passes_gate: passes, ...s };
    const t = s.by_council_type;
    console.log(`${k} ${s.called} of ${s.wards} = ${s.accuracy_pct}%  London ${t.london.called}  met ${t.metropolitan.called}  no-anchor ${t.no_anchor.called}  anchored ${t.anchored.called}  Reform first ${s.named_first["Reform UK"]}  recall Lab ${s.recall_pct.Labour} LD ${s.recall_pct["Liberal Democrats"]} Grn ${s.recall_pct["Green Party"]}  passes ${passes}`);
    if (args["write-predictions"] && args.arm === k) writeFileSync(path.resolve(args["write-predictions"]), JSON.stringify({ snapshot: { generated_by: "scripts/score-london-v2-2026-11.mjs", arm: k }, predictions: asPredictions(a.r.shares) }) + "\n");
  }
  writeFileSync(path.join(ROOT, "data/transparency/may-2026-london-v2-2026-11.json"), JSON.stringify(out, null, 2) + "\n");
  console.log(`slate step changed ${changed} wards; yardstick wards by type ${JSON.stringify(changedByType)}`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main();
