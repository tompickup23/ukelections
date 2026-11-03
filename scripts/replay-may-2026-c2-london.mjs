#!/usr/bin/env node
/**
 * replay-may-2026-c2-london.mjs: score the London arms of
 * docs/local-engine-holdout-2026-11.md on May 2026, held out, through the same
 * stage replay as scripts/replay-may-2026-candidate.mjs.
 *
 * Every arm starts from the polling-day forecast's recovered pre-Step 9b stage
 * and applies C1's Step 9b. Final-C then differs:
 *   A0  one run over all wards, national ratio (the 24 October candidate)
 *   A1  C2 over the non-London wards only; London gets no Final-C
 *   A2  split: London on the 2022 London ratio, the rest on the national ratio
 *   A3  split: London on the by-election ratio (diagnostic)
 *   A4  split: both groups on the national ratio (diagnostic)
 * Set N uses the 24 October inputs; set P the corrected ones (LSOA baseline in
 * London, named May 2025 polls). Each arm is scored once on the yardstick.
 *
 * Usage: node scripts/replay-may-2026-c2-london.mjs [--write-predictions=<path> --arm=A0P]
 *   writes data/transparency/may-2026-c2-london-2026-11.json; with
 *   --write-predictions, also the named arm's forecast, for the calibration refits
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { ge2024ForArea, localElectionTargets } from "../src/lib/localElectionTarget.js";
import { upliftTier, LONDON, METROPOLITAN } from "./fit-candidate-engine-2026-10-24.mjs";
import { ACTUALS_PATH, POSTAUDIT_PATH, POOLED, readJson, localRows, scoreWards, pooledShares, topParty, forecastShares } from "./score-may-2026-like-for-like.mjs";
import { atCommit, baseTargets, pre9bStage, step9b, finalC, asPredictions, CALIBRATION_PARTIES } from "./replay-may-2026-candidate.mjs";
import { londonLsoaBaseline } from "./fit-c2-london-2026-11.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OCT = "data/calibration/candidate-2026-10-24";
const NOV = "data/calibration/candidate-2026-11";
const TYPES = ["london", "metropolitan", "no_anchor", "anchored"];
const TYPE_LABEL = { london: "London borough", metropolitan: "Metropolitan borough", no_anchor: "Unitary or county, no 2025 anchor", anchored: "Shire district with 2025 county anchor" };

const isLondon = (id) => LONDON.has(id.split(".")[1]);

function councilType(id, stage) {
  const slug = id.split(".")[1];
  if (LONDON.has(slug)) return "london";
  if (METROPOLITAN.has(slug)) return "metropolitan";
  return stage[id]?.anchored ? "anchored" : "no_anchor";
}

function subset(stage, keep) {
  return Object.fromEntries(Object.entries(stage).filter(([id]) => keep(id)));
}

function targetsFor(stage, { poll, ge24National, ratio, areaShares }) {
  const wards = Object.entries(stage).map(([id, s]) => ({ council_slug: id.split(".")[1], votes: s.votes, shares: s.shares }));
  return localElectionTargets(wards, { poll, ge24National, ratio, areaShares });
}

function normalised(stage) {
  return Object.fromEntries(Object.entries(stage).map(([id, s]) => {
    const t = Object.values(s.shares).reduce((a, b) => a + b, 0);
    return [id, Object.fromEntries(Object.entries(s.shares).map(([p, v]) => [p, v / t]))];
  }));
}

// One arm: Final-C over all wards, or split into London and the rest.
function runArm(stage, inputs, { mode, londonRatio }) {
  const common = { poll: inputs.poll, ge24National: inputs.ge24National, areaShares: inputs.areaShares };
  if (mode === "single") {
    const t = targetsFor(stage, { ...common, ratio: inputs.nationalRatio });
    const r = finalC(stage, t);
    return { shares: r.shares, detail: { all: { targets: t, multipliers: r.multipliers } } };
  }
  const rest = subset(stage, (id) => !isLondon(id));
  const lon = subset(stage, isLondon);
  const tRest = targetsFor(rest, { ...common, ratio: inputs.nationalRatio });
  const rRest = finalC(rest, tRest);
  if (mode === "exclude") return { shares: { ...rRest.shares, ...normalised(lon) }, detail: { rest: { targets: tRest, multipliers: rRest.multipliers }, london: "no Final-C" } };
  const tLon = targetsFor(lon, { ...common, ratio: londonRatio });
  const rLon = finalC(lon, tLon);
  return { shares: { ...rRest.shares, ...rLon.shares }, detail: { rest: { targets: tRest, multipliers: rRest.multipliers }, london: { ratio: londonRatio, targets: tLon, multipliers: rLon.multipliers } } };
}

function score(shares, ids, actuals, types) {
  const wards = [];
  let missing = 0;
  for (const id of ids) {
    if (!shares[id]) { missing += 1; continue; }
    const s = forecastShares(asPredictions({ [id]: shares[id] })[id]);
    wards.push({ ballot_paper_id: id, type: types[id], predicted_leader: topParty(pooledShares(s)), predicted_shares: s });
  }
  const pp = (x) => (x == null ? null : Number((100 * x).toFixed(1)));
  const brief = (r, extraMissing = 0) => ({
    wards: r.vote_leader.wards + extraMissing,
    called: r.vote_leader.correct,
    accuracy_pct: pp(r.vote_leader.correct / (r.vote_leader.wards + extraMissing)),
    named_first: Object.fromEntries(POOLED.map((p) => [p, r.by_party[p].predicted_wins])),
    won: Object.fromEntries(POOLED.map((p) => [p, r.by_party[p].actual_wins])),
    recall_pct: Object.fromEntries(POOLED.map((p) => [p, pp(r.by_party[p].recall)])),
    signed_bias_pp: Object.fromEntries(POOLED.map((p) => [p, r.signed_bias[p].signed_bias_pp == null ? null : Number(r.signed_bias[p].signed_bias_pp.toFixed(2))])),
    mae_pp: Object.fromEntries(POOLED.map((p) => [p, r.signed_bias[p].mae_pp == null ? null : Number(r.signed_bias[p].mae_pp.toFixed(2))])),
    largest_misses: r.largest_misses.slice(0, 5),
  });
  const all = brief(scoreWards(wards, actuals), missing);
  const byType = Object.fromEntries(TYPES.map((t) => [t, brief(scoreWards(wards.filter((w) => w.type === t), actuals))]));
  return { ...all, by_council_type: byType };
}

function round4(o) {
  return Object.fromEntries(Object.entries(o).filter(([p]) => CALIBRATION_PARTIES.includes(p)).map(([p, v]) => [p, Number(v.toFixed(4))]));
}

function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true]; }));
  const published = atCommit("data/predictions/may-2026/local-and-mayor.json");
  const history = readJson("data/history/dc-historic-results.json");
  const postaudit = readJson(POSTAUDIT_PATH);
  const actuals = readJson(ACTUALS_PATH).by_ballot;
  const c1Doc = readJson(`${OCT}/reform-regional-multiplier.json`);
  const ratioOct = readJson(`${OCT}/local-national-ratio.json`);
  const ratioNov = readJson(`${NOV}/local-national-ratio.json`);
  const london = readJson(`${NOV}/london-ratio.json`);
  const C1 = Object.fromEntries(Object.entries(c1Doc.tiers).map(([t, v]) => [t, v.multiplier]));

  const pre = pre9bStage(published.predictions);
  const stage = step9b(pre, baseTargets(), C1);
  const ids = localRows(postaudit, "prereg").map((r) => r.ballot_paper_id);
  const types = Object.fromEntries(ids.map((id) => [id, councilType(id, pre)]));

  const nameCache = new Map();
  const nameMatched = (slug) => { if (!nameCache.has(slug)) nameCache.set(slug, ge2024ForArea(history, slug)?.shares || null); return nameCache.get(slug); };
  const lsoa = londonLsoaBaseline(history);
  const withLsoa = (slug) => (LONDON.has(slug) ? lsoa[slug]?.shares || null : nameMatched(slug));

  const sets = {
    N: { label: "24 October inputs: name-matched GE2024, hand-set May 2025 poll", poll: ratioOct.polls_to_cutoff.shares, ge24National: ratioOct.snapshot.ge2024_national, nationalRatio: ratioOct.ratio, areaShares: nameMatched,
      ratio2022: london.ratio_2022, ratioBy: london.ratio_byelections },
    P: { label: "Corrected inputs: LSOA baseline in London, named May 2025 polls", poll: ratioOct.polls_to_cutoff.shares, ge24National: ratioOct.snapshot.ge2024_national, nationalRatio: ratioNov.ratio, areaShares: withLsoa,
      ratio2022: { ...london.ratio_2022, "Reform UK": ratioNov.ratio["Reform UK"] }, ratioBy: london.ratio_byelections_lsoa },
  };
  const ARMS = {
    A0: { label: "Candidate as it stands: one Final-C run, national ratio", mode: "single" },
    A1: { label: "London excluded from C2: no Final-C in London", mode: "exclude" },
    A2: { label: "Split, London on the 2022 London ratio", mode: "split", ratio: "ratio2022" },
    A3: { label: "Split, London on the by-election ratio (diagnostic)", mode: "split", ratio: "ratioBy" },
    A4: { label: "Split, both groups on the national ratio (diagnostic)", mode: "split", ratio: "nationalRatio" },
  };

  const out = {
    generated_by: "scripts/replay-may-2026-c2-london.mjs",
    protocol: "docs/local-engine-holdout-2026-11.md",
    yardstick: "scripts/score-may-2026-like-for-like.mjs; bar 1,623 of 2,897 (56.0%); published London figure 447 of 636",
    council_type_wards: Object.fromEntries(TYPES.map((t) => [TYPE_LABEL[t], ids.filter((id) => types[id] === t).length])),
    sets: {},
  };
  for (const [k, inputs] of Object.entries(sets)) {
    out.sets[k] = { label: inputs.label, arms: {} };
    for (const [a, arm] of Object.entries(ARMS)) {
      const r = runArm(stage, inputs, { mode: arm.mode, londonRatio: arm.ratio ? inputs[arm.ratio] : null });
      const s = score(r.shares, ids, actuals, types);
      if (args["write-predictions"] && args.arm === `${a}${k}`) writeFileSync(path.resolve(args["write-predictions"]), JSON.stringify({ snapshot: { generated_by: "scripts/replay-may-2026-c2-london.mjs", arm: `${a}${k}` }, predictions: asPredictions(r.shares) }) + "\n");
      const detail = JSON.parse(JSON.stringify(r.detail, (key, v) => (v && typeof v === "object" && !Array.isArray(v) && ("Labour" in v) ? round4(v) : v)));
      out.sets[k].arms[a] = { label: arm.label, ...s, final_c: detail };
      const L = s.by_council_type.london;
      console.log(`${a}${k} ${String(s.called).padStart(5)} of ${s.wards} = ${s.accuracy_pct}%  London ${L.called}  met ${s.by_council_type.metropolitan.called}  no-anchor ${s.by_council_type.no_anchor.called}  anchored ${s.by_council_type.anchored.called}  Reform first ${s.named_first["Reform UK"]}  recall Lab ${s.recall_pct.Labour} LD ${s.recall_pct["Liberal Democrats"]} Grn ${s.recall_pct["Green Party"]}`);
    }
  }
  writeFileSync(path.join(ROOT, "data/transparency/may-2026-c2-london-2026-11.json"), JSON.stringify(out, null, 2) + "\n");
  console.log("wards by type:", JSON.stringify(out.council_type_wards));
}

main();
