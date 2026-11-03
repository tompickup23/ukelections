#!/usr/bin/env node
/**
 * score-london-free-2026-11.mjs: the May 2026 figures that bear on 2027, a
 * year with no London borough elections. Scores the 2,261 non-London wards for
 * the published forecast, the 7 May engine with Final-C over the non-London
 * wards only, and the candidate as in S3 (Final-C over the non-London wards).
 * Protocol: docs/preregistration-2027.md, section 1.
 *
 * Usage: node scripts/score-london-free-2026-11.mjs --run1=<path>
 *   writes data/transparency/may-2026-london-free-2026-11.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { MULTIPLIERS_7_MAY, LONDON } from "./fit-candidate-engine-2026-10-24.mjs";
import { ACTUALS_PATH, POSTAUDIT_PATH, POOLED, readJson, localRows } from "./score-may-2026-like-for-like.mjs";
import { pre9bStage, baseTargets, step9b, finalC, sharesOf } from "./replay-may-2026-candidate.mjs";
import { councilType, score } from "./replay-may-2026-c2-london.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUTSIDE = ["metropolitan", "no_anchor", "anchored"];

// Sum the non-London council types of a scored run.
export function outsideLondon(run) {
  const t = run.by_council_type;
  const sum = (f) => OUTSIDE.reduce((a, k) => a + f(t[k]), 0);
  return {
    wards: sum((x) => x.wards),
    called: sum((x) => x.called),
    by_council_type: Object.fromEntries(OUTSIDE.map((k) => [k, t[k].called])),
    named_first: Object.fromEntries(POOLED.map((p) => [p, sum((x) => x.named_first[p])])),
    won: Object.fromEntries(POOLED.map((p) => [p, sum((x) => x.won[p])])),
  };
}

function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true]; }));
  if (!args.run1) throw new Error("--run1 is required");
  const buf = readFileSync(path.resolve(args.run1));
  const run1 = JSON.parse(buf.toString("utf8"));
  const polls = readJson("data/calibration/candidate-2026-10-24/local-national-ratio.json").polls_to_cutoff.shares;
  const isLondon = (id) => LONDON.has(id.split(".")[1]);

  const pre = pre9bStage(run1.predictions);
  const lifted = step9b(pre, baseTargets(), MULTIPLIERS_7_MAY);
  const rest = finalC(Object.fromEntries(Object.entries(lifted).filter(([id]) => !isLondon(id))), polls);
  // London keeps run 1's own shares so the scorer has every type; only the non-London figures are read.
  const shares = { ...rest.shares };
  for (const [id, e] of Object.entries(run1.predictions)) if (isLondon(id) && e.prediction) shares[id] = sharesOf(e);
  const ids = localRows(readJson(POSTAUDIT_PATH), "prereg").map((r) => r.ballot_paper_id);
  const types = Object.fromEntries(ids.map((id) => [id, councilType(id, pre)]));
  const may7 = score(shares, ids, readJson(ACTUALS_PATH).by_ballot, types);

  const full = readJson("data/transparency/may-2026-full-run-2026-04-25.json");
  const v2 = readJson("data/transparency/may-2026-london-v2-2026-11.json");
  const out = {
    generated_by: "scripts/score-london-free-2026-11.mjs",
    protocol: "docs/preregistration-2027.md",
    run1_sha256: createHash("sha256").update(buf).digest("hex"),
    note: "Non-London wards of May 2026 only (no London borough votes in 2027). Held out, on the yardstick's conventions.",
    runs: {
      published: { label: "Polling-day forecast as published (Final-C over all wards)", ...outsideLondon(full.runs.F0) },
      may7_london_free: { label: "7 May engine, polls to 24 April, Final-C over the non-London wards", ...outsideLondon(may7) },
      candidate_london_free: { label: "Candidate: C1, slate step, C2 Final-C over the non-London wards (S3)", ...outsideLondon(v2.runs.S3) },
    },
  };
  writeFileSync(path.join(ROOT, "data/transparency/may-2026-london-free-2026-11.json"), JSON.stringify(out, null, 2) + "\n");
  for (const [k, r] of Object.entries(out.runs)) console.log(`${k} ${r.called} of ${r.wards} ${JSON.stringify(r.by_council_type)} Reform first ${r.named_first["Reform UK"]}`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main();
