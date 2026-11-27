#!/usr/bin/env node
/**
 * Writes data/transparency/may-2026-skill.json: the May 2026 local forecast
 * against the simplest possible rule, "the same party as last time".
 *
 * Scored on the like for like yardstick (scripts/score-may-2026-like-for-like.mjs):
 * local wards in the post-audit, five parties kept and every other party and
 * independent pooled as Others, the ward leader being the top pooled party by
 * vote share. This script reuses that yardstick's functions rather than
 * restating them, so the two cannot drift apart.
 *
 * "Last time" is the Step 1 baseline the locked forecast recorded for each ward
 * (data/predictions/may-2026/local-and-mayor.prereg-2026-04-26.json, the
 * methodology entry with step 1). Wards with no Step 1 baseline have no previous
 * result to repeat, so the rule cannot be applied there, and every comparison
 * in this file is made on the wards that do have one.
 *
 *   node scripts/build-may-2026-skill.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ACTUALS_PATH,
  POSTAUDIT_PATH,
  VERSIONS,
  localRows,
  poolParty,
  pooledShares,
  topParty,
} from "./score-may-2026-like-for-like.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const PREREG_PATH = "data/predictions/may-2026/local-and-mayor.prereg-2026-04-26.json";
export const OUT_PATH = "data/transparency/may-2026-skill.json";

const readJson = (p) => JSON.parse(readFileSync(join(REPO, p), "utf8"));

/** The pooled leader of a ward's Step 1 baseline, or null when it has none. */
export function previousLeader(entry) {
  const step = (entry?.methodology || []).find((m) => m.step === 1);
  const data = step?.data;
  if (!data || !Object.keys(data).length) return null;
  return topParty(pooledShares(data));
}

export function computeSkill(postaudit, prereg, actualsByBallot) {
  const lockedRows = localRows(postaudit, "prereg");
  const liveById = new Map(localRows(postaudit, "live").map((r) => [r.ballot_paper_id, r]));

  let scored = 0, withPrevious = 0, kept = 0, rule = 0, locked = 0, live = 0, lockedAll = 0, liveAll = 0;
  let noActual = 0;
  for (const row of lockedRows) {
    const actual = actualsByBallot[row.ballot_paper_id];
    if (!actual?.vote_shares) { noActual += 1; continue; }
    const leader = topParty(pooledShares(actual.vote_shares));
    const lockedCall = poolParty(row.predicted_winner);
    const liveRow = liveById.get(row.ballot_paper_id);
    const liveCall = liveRow ? poolParty(liveRow.predicted_winner) : null;
    scored += 1;
    if (lockedCall === leader) lockedAll += 1;
    if (liveCall === leader) liveAll += 1;

    const prev = previousLeader(prereg.predictions[row.ballot_paper_id]);
    if (!prev) continue;
    withPrevious += 1;
    if (prev === leader) { kept += 1; rule += 1; }
    if (lockedCall === leader) locked += 1;
    if (liveCall === leader) live += 1;
  }

  return {
    wards_scored: scored,
    wards_without_actual: noActual,
    wards_with_previous_result: withPrevious,
    wards_without_previous_result: scored - withPrevious,
    kept_same_leader: kept,
    changed_leader: withPrevious - kept,
    same_party_rule_called: rule,
    locked_forecast_called: locked,
    polling_day_forecast_called: live,
    all_wards: { locked_forecast_called: lockedAll, polling_day_forecast_called: liveAll },
  };
}

function main() {
  const postaudit = readJson(POSTAUDIT_PATH);
  const prereg = readJson(PREREG_PATH);
  const actuals = readJson(ACTUALS_PATH).by_ballot;
  const counts = computeSkill(postaudit, prereg, actuals);
  const out = {
    generated_by: "scripts/build-may-2026-skill.mjs",
    generated_at: new Date().toISOString().slice(0, 10),
    election: "Local elections, 7 May 2026",
    sources: {
      ballot_set_and_forecast_calls: POSTAUDIT_PATH,
      previous_result: `${PREREG_PATH} (Step 1 baseline recorded per ward)`,
      actuals: ACTUALS_PATH,
      yardstick: "scripts/score-may-2026-like-for-like.mjs",
    },
    definitions: {
      ward_leader:
        "The top party by vote share in the ward on 7 May 2026, with Labour, Conservative, Liberal Democrats, Reform UK and Green Party kept and every other party and independent pooled as Others. In wards electing more than one councillor, every candidate's votes count.",
      previous_result:
        "The ward's most recent earlier borough result, as recorded in Step 1 of the locked forecast. Wards with no such result have none to repeat.",
      same_party_rule:
        "Name whichever pooled party topped that previous result as the 2026 leader. It is correct when that party led again. By construction it calls exactly the wards that kept the same leader.",
      locked_forecast: `${VERSIONS.prereg.label}: the forecast published and hash-locked before polling day (commit ${VERSIONS.prereg.commit.slice(0, 7)}).`,
      polling_day_forecast: `${VERSIONS.live.label}: the forecast as it stood on polling day (commit ${VERSIONS.live.commit}).`,
      called: "The named party was the ward leader.",
      why_subset:
        "The same party rule needs a previous result to repeat. Wards without one are left out of every count in the comparison, so all three are scored on the same wards.",
    },
    ...counts,
  };
  writeFileSync(join(REPO, OUT_PATH), JSON.stringify(out, null, 2) + "\n");
  console.log(JSON.stringify(counts, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
