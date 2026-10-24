#!/usr/bin/env node
/**
 * score-may-2026-like-for-like.mjs: score a May 2026 local forecast on
 * Pollcheck's conventions, so UK Elections and Pollcheck are compared on the
 * same footing. This is the yardstick for every change to the local engine.
 *
 * Conventions (UKE_Competitor_Gap_Analysis_2026-10-24.md, "Like-for-like check"):
 *   - local wards only (ballot ids starting "local."), mayoralties removed;
 *   - Labour, Conservative, Liberal Democrats, Reform UK and Green Party kept,
 *     every other party and independent pooled as "Others";
 *   - the ward leader is the top party by vote share, with full-slate shares
 *     in multi-member wards (every candidate's votes summed);
 *   - optionally the leader is the party winning most seats, with wards whose
 *     seats split evenly between two parties left out.
 *
 * Inputs:
 *   data/transparency/may-2026-postaudit-2026-05-10.json  (ballot set, per-ward
 *     predicted winners for the locked and polling-day versions, commit refs)
 *   data/results/may-2026/local-and-mayor.merged.json     (actuals; never the
 *     Democracy Club-only local-and-mayor.json, which is missing 204 ballots)
 *
 * Usage:
 *   node scripts/score-may-2026-like-for-like.mjs
 *       scores the locked (26 Apr) and polling-day versions; writes
 *       data/transparency/may-2026-like-for-like.json
 *   node scripts/score-may-2026-like-for-like.mjs --forecast=<path> --label=<name> [--out=<path>]
 *       scores a candidate forecast file on the same ballot set
 *   --normalise-coop   count "Labour Co-operative" as Labour (off by default,
 *                      because the 1,463 and 1,623 baselines were scored without it)
 *   --no-shares        skip per-party signed bias (needs the full forecast files
 *                      from git history, which a shallow checkout lacks)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");

export const POSTAUDIT_PATH = "data/transparency/may-2026-postaudit-2026-05-10.json";
export const ACTUALS_PATH = "data/results/may-2026/local-and-mayor.merged.json";
export const MAJOR = ["Reform UK", "Labour", "Conservative", "Liberal Democrats", "Green Party"];
export const POOLED = [...MAJOR, "Others"];
const MAJOR_SET = new Set(MAJOR);

// The two published versions. The locked file's commit and hash are recorded in
// the post-audit itself; the polling-day file is the last commit to the forecast
// before the audit ran (5e85c84, 7 May 2026 13:40 BST), whose Reform, Labour and
// Conservative shares match all 2,903 "live" rows of the post-audit.
export const VERSIONS = {
  prereg: {
    label: "Locked forecast, 26 April 2026",
    commit: "ab3d999cf537442f0514cb4c8ddd6823eeea2a75",
    sha256: "e33e0ad72bc52ca438fbe81670632fff03c8f3bc9d181f5763f4e31fd80f5368",
  },
  live: {
    label: "Polling-day version, 7 May 2026",
    commit: "5e85c84",
    sha256: "566868149ccbdf67015bcf8d70656f2f34a300b16bf3b964cd9835f8e00139e5",
  },
};
const FORECAST_PATH = "data/predictions/may-2026/local-and-mayor.json";

export function normaliseParty(party, { normaliseCoop = false } = {}) {
  if (normaliseCoop && party === "Labour Co-operative") return "Labour";
  return party;
}

export function poolParty(party, opts) {
  const p = normaliseParty(party, opts);
  return MAJOR_SET.has(p) ? p : "Others";
}

export function pooledShares(shares, opts) {
  const out = {};
  for (const [party, v] of Object.entries(shares || {})) {
    const k = poolParty(party, opts);
    out[k] = (out[k] || 0) + (v || 0);
  }
  return out;
}

export function topParty(shares) {
  const entries = Object.entries(shares || {}).filter(([, v]) => v > 0);
  if (!entries.length) return null;
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

// Party winning most seats in the ward, pooled. null when no elected candidates
// are recorded; "TIE" when two parties share the top seat count.
export function seatLeader(ballot, opts) {
  const seats = {};
  for (const c of ballot?.candidates || []) {
    if (!c.elected) continue;
    const k = poolParty(c.party_canonical, opts);
    seats[k] = (seats[k] || 0) + 1;
  }
  const e = Object.entries(seats).sort((a, b) => b[1] - a[1]);
  if (!e.length) return null;
  if (e.length > 1 && e[0][1] === e[1][1]) return "TIE";
  return e[0][0];
}

export function forecastShares(entry) {
  const out = {};
  for (const [party, payload] of Object.entries(entry?.prediction || {})) out[party] = payload?.pct || 0;
  return out;
}

function emptyMatrix() {
  const m = {};
  for (const p of POOLED) { m[p] = {}; for (const q of POOLED) m[p][q] = 0; }
  return m;
}

/**
 * Score one forecast. `wards` is an array of
 *   { ballot_paper_id, predicted_leader, predicted_shares? }
 * where predicted_leader is already pooled. Returns winner accuracy on the vote
 * basis and the seat basis, recall and precision by party, the miss matrix
 * (rows predicted, columns actual) and, where shares are given, signed bias.
 */
export function scoreWards(wards, actualsByBallot, opts = {}) {
  let n = 0, correct = 0, seatN = 0, seatCorrect = 0, noSeatData = 0, seatTies = 0;
  const matrix = emptyMatrix();
  const missing = [];
  const bias = {};
  for (const p of POOLED) bias[p] = { n: 0, signed_sum: 0, abs_sum: 0 };

  for (const w of wards) {
    const ballot = actualsByBallot[w.ballot_paper_id];
    if (!ballot?.vote_shares) { missing.push(w.ballot_paper_id); continue; }
    const actualPooled = pooledShares(ballot.vote_shares, opts);
    const actual = topParty(actualPooled);
    const pred = w.predicted_leader;
    n += 1;
    if (pred === actual) correct += 1;
    if (matrix[pred] && matrix[pred][actual] !== undefined) matrix[pred][actual] += 1;

    const sl = seatLeader(ballot, opts);
    if (sl === null) noSeatData += 1;
    else if (sl === "TIE") seatTies += 1;
    else { seatN += 1; if (pred === sl) seatCorrect += 1; }

    if (w.predicted_shares) {
      const predPooled = pooledShares(w.predicted_shares, opts);
      for (const p of POOLED) {
        const a = actualPooled[p] || 0;
        const f = predPooled[p] || 0;
        if (a === 0 && f === 0) continue; // party absent from both: not scored, as in the post-audit
        bias[p].n += 1;
        bias[p].signed_sum += f - a;
        bias[p].abs_sum += Math.abs(f - a);
      }
    }
  }

  const byParty = {};
  for (const p of POOLED) {
    const actualWins = POOLED.reduce((s, q) => s + matrix[q][p], 0);
    const predictedWins = POOLED.reduce((s, q) => s + matrix[p][q], 0);
    byParty[p] = {
      actual_wins: actualWins,
      predicted_wins: predictedWins,
      called: matrix[p][p],
      recall: actualWins ? matrix[p][p] / actualWins : null,
      precision: predictedWins ? matrix[p][p] / predictedWins : null,
    };
  }
  const misses = [];
  for (const p of POOLED) for (const q of POOLED) if (p !== q && matrix[p][q]) misses.push({ predicted: p, actual: q, wards: matrix[p][q] });
  misses.sort((a, b) => b.wards - a.wards);

  const hasShares = wards.some((w) => w.predicted_shares);
  const signedBias = hasShares ? Object.fromEntries(POOLED.map((p) => [p, {
    n: bias[p].n,
    signed_bias_pp: bias[p].n ? (100 * bias[p].signed_sum) / bias[p].n : null,
    mae_pp: bias[p].n ? (100 * bias[p].abs_sum) / bias[p].n : null,
  }])) : null;

  return {
    vote_leader: { wards: n, correct, accuracy: n ? correct / n : null },
    seat_leader: { wards: seatN, correct: seatCorrect, accuracy: seatN ? seatCorrect / seatN : null, excluded_tied: seatTies, excluded_no_candidate_data: noSeatData },
    by_party: byParty,
    miss_matrix: matrix,
    largest_misses: misses.slice(0, 10),
    signed_bias: signedBias,
    missing_actuals: missing,
  };
}

export function readJson(p) { return JSON.parse(readFileSync(join(REPO, p), "utf8")); }

export function localRows(postaudit, version) {
  return postaudit[version].rows.filter((r) => r.ballot_paper_id.startsWith("local."));
}

// The published versions: leaders from the post-audit rows (works in a shallow
// checkout), shares from git history when it is there and the hash checks out.
export function scorePublishedVersion(postaudit, actualsByBallot, version, opts = {}) {
  const rows = localRows(postaudit, version);
  let predictions = null;
  let sharesNote = "per-party bias skipped (--no-shares)";
  if (opts.shares !== false) {
    try {
      const buf = execFileSync("git", ["show", `${VERSIONS[version].commit}:${FORECAST_PATH}`], { cwd: REPO, maxBuffer: 256 * 1024 * 1024 });
      const sha = createHash("sha256").update(buf).digest("hex");
      if (sha !== VERSIONS[version].sha256) sharesNote = `per-party bias skipped: forecast hash ${sha} does not match ${VERSIONS[version].sha256}`;
      else { predictions = JSON.parse(buf.toString("utf8")).predictions; sharesNote = `shares from git show ${VERSIONS[version].commit}:${FORECAST_PATH}, sha256 checked`; }
    } catch {
      sharesNote = `per-party bias skipped: commit ${VERSIONS[version].commit} not in this checkout`;
    }
  }
  const wards = rows.map((r) => ({
    ballot_paper_id: r.ballot_paper_id,
    predicted_leader: poolParty(r.predicted_winner, opts),
    predicted_shares: predictions ? forecastShares(predictions[r.ballot_paper_id]) : undefined,
  }));
  return { label: VERSIONS[version].label, commit: VERSIONS[version].commit, forecast_sha256: VERSIONS[version].sha256, shares_note: sharesNote, ...scoreWards(wards, actualsByBallot, opts) };
}

// A candidate forecast: the leader is the top party after pooling its full shares.
// On the polling-day file this moves 4 wards against the row-based leader but
// leaves the total at 1,623, so the two definitions agree on the yardstick.
export function scoreCandidateForecast(predictions, postaudit, actualsByBallot, opts = {}) {
  const ids = localRows(postaudit, "prereg").map((r) => r.ballot_paper_id);
  const wards = [];
  const missingForecast = [];
  for (const id of ids) {
    const e = predictions[id];
    if (!e?.prediction) { missingForecast.push(id); continue; }
    const shares = forecastShares(e);
    wards.push({ ballot_paper_id: id, predicted_leader: topParty(pooledShares(shares, opts)), predicted_shares: shares });
  }
  const result = scoreWards(wards, actualsByBallot, opts);
  // A ward the candidate did not forecast counts as a miss, so a thinner
  // forecast cannot score higher by leaving hard wards out.
  result.vote_leader.wards += missingForecast.length;
  result.vote_leader.accuracy = result.vote_leader.correct / result.vote_leader.wards;
  return { missing_forecast: missingForecast, ...result };
}

function fmt(r) {
  const v = r.vote_leader, s = r.seat_leader;
  return `${v.correct.toLocaleString("en-GB")} of ${v.wards.toLocaleString("en-GB")} = ${(100 * v.accuracy).toFixed(1)}% (seat basis ${s.correct} of ${s.wards} = ${(100 * s.accuracy).toFixed(1)}%)`;
}

function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true];
  }));
  const opts = { normaliseCoop: Boolean(args["normalise-coop"]), shares: !args["no-shares"] };
  const postaudit = readJson(POSTAUDIT_PATH);
  const actuals = readJson(ACTUALS_PATH).by_ballot;
  const conventions = {
    ballot_set: "local wards in the post-audit (ballot ids starting local.), mayoralties removed",
    parties: `${MAJOR.join(", ")}; every other party and independent pooled as Others`,
    leader: "top party by vote share, full-slate shares in multi-member wards; seat basis excludes wards with a tied seat split or no elected-candidate data",
    labour_coop_normalised: opts.normaliseCoop,
    actuals: ACTUALS_PATH,
    postaudit: POSTAUDIT_PATH,
  };

  if (args.forecast) {
    const predictions = JSON.parse(readFileSync(resolve(args.forecast), "utf8")).predictions;
    const result = { label: args.label || args.forecast, forecast: args.forecast, conventions, ...scoreCandidateForecast(predictions, postaudit, actuals, opts) };
    if (args.out) writeFileSync(resolve(args.out), JSON.stringify(result, null, 2) + "\n");
    console.log(`${result.label}: ${fmt(result)}`);
    return;
  }

  const out = {
    generated_by: "scripts/score-may-2026-like-for-like.mjs",
    conventions,
    reference: "Pollcheck's own published ward leader accuracy for its 6 May 2026 projection is 67.7% on 2,951 wards; that is its claim, not re-scored here.",
    prereg: scorePublishedVersion(postaudit, actuals, "prereg", opts),
    live: scorePublishedVersion(postaudit, actuals, "live", opts),
  };
  const outPath = args.out || `data/transparency/may-2026-like-for-like${opts.normaliseCoop ? "-coop" : ""}.json`;
  writeFileSync(resolve(REPO, outPath), JSON.stringify(out, null, 2) + "\n");
  console.log(`Locked:      ${fmt(out.prereg)}`);
  console.log(`Polling day: ${fmt(out.live)}`);
  console.log(`Wrote ${outPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
