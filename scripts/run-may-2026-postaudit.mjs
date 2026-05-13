#!/usr/bin/env node
/**
 * run-may-2026-postaudit.mjs — score the May 7 2026 forecast against actual
 * results from data/results/may-2026/local-and-mayor.json.
 *
 * Usage:
 *   node scripts/run-may-2026-postaudit.mjs                       # main audit
 *   node scripts/run-may-2026-postaudit.mjs --shadow              # also score shadow (no-Step-9b) forecast
 *   node scripts/run-may-2026-postaudit.mjs --manifest=preregistration-2026-04-26.json
 *
 * Outputs:
 *   data/transparency/may-2026-postaudit-{run_date}.json  (full per-ballot deltas + summaries)
 *   data/transparency/may-2026-postaudit-{run_date}.md     (executive summary, copy-paste-ready)
 *
 * Four metric families:
 *   1. Winner accuracy — boolean per ballot, stratified by confidence,
 *      region, predicted-winner party, Step 9b cohort.
 *   2. Vote-share accuracy — per-party MAE / RMSE / signed bias on the
 *      five major parties, computed only on parties that stood.
 *   3. Confidence calibration — does MAE rise monotonically across the
 *      high / medium / low buckets? If not, the labels are decorative.
 *   4. Step 9b isolation — same metrics computed on the
 *      shadow-no-step9b forecast, restricted to the cohort that received
 *      a non-trivial uplift, bucketed by regional multiplier tier.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)=(.*)$/);
  return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true];
}));

const MAJOR = ["Labour", "Conservative", "Liberal Democrats", "Reform UK", "Green Party"];

const LONDON_BOROUGHS = new Set(["barking-and-dagenham", "barnet", "bexley", "brent", "bromley", "camden", "city-of-london", "croydon", "ealing", "enfield", "greenwich", "hackney", "hammersmith-and-fulham", "haringey", "harrow", "havering", "hillingdon", "hounslow", "islington", "kensington-and-chelsea", "kingston-upon-thames", "lambeth", "lewisham", "merton", "newham", "redbridge", "richmond-upon-thames", "southwark", "sutton", "tower-hamlets", "waltham-forest", "wandsworth", "westminster"]);
const METROPOLITAN_BOROUGHS = new Set(["barnsley", "birmingham", "bolton", "bradford", "bury", "calderdale", "coventry", "doncaster", "dudley", "gateshead", "kirklees", "knowsley", "leeds", "liverpool", "manchester", "newcastle-upon-tyne", "north-tyneside", "oldham", "rochdale", "rotherham", "salford", "sandwell", "sefton", "sheffield", "solihull", "south-tyneside", "st-helens", "stockport", "sunderland", "tameside", "trafford", "wakefield", "walsall", "wigan", "wirral", "wolverhampton"]);
const NORTHERN_UNITARY_FULL_LIFT = new Set([
  "blackburn-with-darwen", "blackpool", "kingston-upon-hull", "north-east-lincolnshire",
  "north-lincolnshire", "redcar-and-cleveland", "middlesbrough", "stockton-on-tees",
  "darlington", "hartlepool", "york", "east-riding-of-yorkshire", "stoke-on-trent",
  "derby", "nottingham", "leicester", "telford-and-wrekin", "halton", "warrington",
]);

function regionTagOf(slug) {
  if (LONDON_BOROUGHS.has(slug)) return "london";
  if (METROPOLITAN_BOROUGHS.has(slug)) return "metropolitan";
  return "other";
}
function regionMultiplierOf(slug) {
  if (NORTHERN_UNITARY_FULL_LIFT.has(slug)) return 1.00;
  if (LONDON_BOROUGHS.has(slug)) return 0.50;
  if (METROPOLITAN_BOROUGHS.has(slug)) return 0.75;
  return 0.85;
}

function readJson(p) { return JSON.parse(readFileSync(join(REPO, p), "utf8")); }
function sha256(buf) { return createHash("sha256").update(buf).digest("hex"); }

function pickLatestManifest() {
  const dir = join(REPO, "data/transparency");
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => f.startsWith("preregistration-") && f.endsWith(".json"))
    .sort()
    .reverse();
  return files[0] || null;
}

function predictionShares(pred) {
  if (!pred?.prediction) return null;
  const out = {};
  for (const [party, payload] of Object.entries(pred.prediction)) {
    out[party] = payload.pct || 0;
  }
  return out;
}

function topParty(shares) {
  if (!shares) return null;
  const entries = Object.entries(shares).filter(([, v]) => v > 0);
  if (!entries.length) return null;
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

function scoreOne(predicted, actual, parties) {
  // Per-party absolute / squared / signed errors restricted to the union of
  // parties that the prediction or actual mentions. We restrict to the
  // intersection with `parties` (typically MAJOR) for the headline MAE.
  const all = new Set([...Object.keys(predicted || {}), ...Object.keys(actual || {})]);
  const perParty = {};
  for (const p of all) {
    const pred = predicted?.[p] || 0;
    const act = actual?.[p] || 0;
    perParty[p] = { pred, actual: act, delta: pred - act, abs: Math.abs(pred - act) };
  }
  const majorErrs = [];
  for (const p of parties) if (perParty[p]) majorErrs.push(perParty[p].abs);
  const mae = majorErrs.length ? majorErrs.reduce((s, x) => s + x, 0) / majorErrs.length : 0;
  return { perParty, mae };
}

function audit({ predictions, actuals, label, manifestEntry, manifestSha }) {
  const rows = [];
  let evaluated = 0;
  let winnerCorrect = 0;
  let brierSum = 0;

  // Per-party accumulators (vote-share)
  const partyAbs = {};   // sum |pred - actual|
  const partySq = {};    // sum (pred - actual)^2
  const partySigned = {}; // sum (pred - actual)
  const partyN = {};

  // Confidence-band accumulators
  const byConfidence = {
    high: { n: 0, winner: 0, mae_sum: 0 },
    medium: { n: 0, winner: 0, mae_sum: 0 },
    low: { n: 0, winner: 0, mae_sum: 0 },
  };

  // Region accumulators
  const byRegion = {};

  // Step 9b cohort = wards where the LIVE forecast applied an uplift.
  // We can't easily detect that from predictions alone, so the caller
  // computes the diff between live and shadow forecasts and passes the
  // cohort set in via the per-ballot rows.

  for (const [ballotId, predEntry] of Object.entries(predictions)) {
    const predicted = predictionShares(predEntry);
    const actual = actuals[ballotId]?.vote_shares;
    if (!predicted || !actual) continue;

    evaluated += 1;
    const predWinner = topParty(predicted);
    const actWinner = topParty(actual);
    const winnerMatch = predWinner && actWinner && predWinner === actWinner;
    if (winnerMatch) winnerCorrect += 1;

    const probActWinner = predicted[actWinner] || 0;
    brierSum += (1 - probActWinner) ** 2;

    const { perParty, mae } = scoreOne(predicted, actual, MAJOR);
    for (const [p, e] of Object.entries(perParty)) {
      partyAbs[p] = (partyAbs[p] || 0) + e.abs;
      partySq[p] = (partySq[p] || 0) + e.delta * e.delta;
      partySigned[p] = (partySigned[p] || 0) + e.delta;
      partyN[p] = (partyN[p] || 0) + 1;
    }

    const conf = predEntry.confidence || "medium";
    if (byConfidence[conf]) {
      byConfidence[conf].n += 1;
      if (winnerMatch) byConfidence[conf].winner += 1;
      byConfidence[conf].mae_sum += mae;
    }

    const slug = ballotId.split(".")[1] || null;
    const region = regionTagOf(slug || "");
    if (!byRegion[region]) byRegion[region] = { n: 0, winner: 0, mae_sum: 0 };
    byRegion[region].n += 1;
    if (winnerMatch) byRegion[region].winner += 1;
    byRegion[region].mae_sum += mae;

    rows.push({
      ballot_paper_id: ballotId,
      council_slug: slug,
      ward: predEntry.lad_name,
      confidence: conf,
      region,
      predicted_winner: predWinner,
      actual_winner: actWinner,
      winner_match: winnerMatch,
      major_party_mae: mae,
      reform_pred: predicted["Reform UK"] || 0,
      reform_actual: actual["Reform UK"] || 0,
      reform_delta: (predicted["Reform UK"] || 0) - (actual["Reform UK"] || 0),
      lab_pred: predicted["Labour"] || 0,
      lab_actual: actual["Labour"] || 0,
      lab_delta: (predicted["Labour"] || 0) - (actual["Labour"] || 0),
      con_pred: predicted["Conservative"] || 0,
      con_actual: actual["Conservative"] || 0,
      con_delta: (predicted["Conservative"] || 0) - (actual["Conservative"] || 0),
    });
  }

  // Build per-party summaries
  const perPartySummary = {};
  for (const p of Object.keys(partyN)) {
    perPartySummary[p] = {
      n: partyN[p],
      mae: partyAbs[p] / partyN[p],
      rmse: Math.sqrt(partySq[p] / partyN[p]),
      signed_bias: partySigned[p] / partyN[p],
    };
  }
  const majorAvgMae = MAJOR
    .filter((p) => perPartySummary[p])
    .reduce((s, p) => s + perPartySummary[p].mae, 0) /
    Math.max(1, MAJOR.filter((p) => perPartySummary[p]).length);

  // Confidence calibration — average mae per band
  for (const k of Object.keys(byConfidence)) {
    const b = byConfidence[k];
    b.winner_accuracy = b.n ? b.winner / b.n : 0;
    b.mae_avg = b.n ? b.mae_sum / b.n : 0;
    delete b.mae_sum;
  }

  // Region rollup
  for (const k of Object.keys(byRegion)) {
    const b = byRegion[k];
    b.winner_accuracy = b.n ? b.winner / b.n : 0;
    b.mae_avg = b.n ? b.mae_sum / b.n : 0;
    delete b.mae_sum;
  }

  rows.sort((a, b) => b.major_party_mae - a.major_party_mae);

  return {
    label,
    manifest_entry: manifestEntry,
    sha256_match: manifestSha === manifestEntry?.sha256,
    sha256_actual: manifestSha,
    summary: {
      ballots_evaluated: evaluated,
      winner_accuracy: evaluated ? winnerCorrect / evaluated : 0,
      major_party_mae_avg: majorAvgMae,
      brier_top_winner: evaluated ? brierSum / evaluated : 0,
    },
    per_party: perPartySummary,
    by_confidence: byConfidence,
    by_region: byRegion,
    worst_residuals: rows.slice(0, 30),
    rows,
  };
}

function reformCohortFromDiff(live, shadow) {
  // Wards where live Reform pct exceeds shadow Reform pct by >1pp = the
  // Step 9b uplift cohort.
  const cohort = new Set();
  const detail = {};
  for (const [ballotId, livePred] of Object.entries(live.predictions || {})) {
    const shadowPred = shadow.predictions?.[ballotId];
    if (!shadowPred?.prediction) continue;
    const liveR = livePred?.prediction?.["Reform UK"]?.pct || 0;
    const shadowR = shadowPred?.prediction?.["Reform UK"]?.pct || 0;
    const lift = liveR - shadowR;
    if (lift > 0.01) {
      cohort.add(ballotId);
      detail[ballotId] = { live_reform: liveR, shadow_reform: shadowR, lift };
    }
  }
  return { cohort, detail };
}

function bucketBallotByMultiplier(ballotId) {
  const slug = ballotId.split(".")[1] || "";
  return regionMultiplierOf(slug);
}

function step9bCohortAudit({ live, shadow, actuals, cohort, cohortDetail }) {
  // For each cohort ballot, compare:
  //   - Live (post-9b) Reform forecast vs actual
  //   - Shadow (pre-9b) Reform forecast vs actual
  //   - Net help/harm: |shadow err| - |live err| (positive = 9b helped)
  const buckets = {};
  for (const ballotId of cohort) {
    const livePred = live.predictions[ballotId];
    const shadowPred = shadow.predictions[ballotId];
    const actual = actuals[ballotId];
    if (!livePred || !shadowPred || !actual) continue;
    const r_act = actual.vote_shares?.["Reform UK"] || 0;
    const r_live = livePred?.prediction?.["Reform UK"]?.pct || 0;
    const r_shadow = shadowPred?.prediction?.["Reform UK"]?.pct || 0;
    const liveErr = r_live - r_act;
    const shadowErr = r_shadow - r_act;
    const liveAbs = Math.abs(liveErr);
    const shadowAbs = Math.abs(shadowErr);
    const help = shadowAbs - liveAbs; // >0 = 9b reduced error, <0 = 9b inflated it

    const mult = bucketBallotByMultiplier(ballotId);
    const key = mult.toFixed(2);
    if (!buckets[key]) buckets[key] = {
      multiplier: mult,
      n: 0,
      shadow_abs_sum: 0, live_abs_sum: 0,
      shadow_signed_sum: 0, live_signed_sum: 0,
      help_sum: 0,
      helped: 0, hurt: 0, neutral: 0,
    };
    const b = buckets[key];
    b.n += 1;
    b.shadow_abs_sum += shadowAbs;
    b.live_abs_sum += liveAbs;
    b.shadow_signed_sum += shadowErr;
    b.live_signed_sum += liveErr;
    b.help_sum += help;
    if (help > 0.01) b.helped += 1;
    else if (help < -0.01) b.hurt += 1;
    else b.neutral += 1;
  }

  for (const k of Object.keys(buckets)) {
    const b = buckets[k];
    b.live_mae = b.n ? b.live_abs_sum / b.n : 0;
    b.shadow_mae = b.n ? b.shadow_abs_sum / b.n : 0;
    b.live_signed_bias = b.n ? b.live_signed_sum / b.n : 0;
    b.shadow_signed_bias = b.n ? b.shadow_signed_sum / b.n : 0;
    b.avg_help = b.n ? b.help_sum / b.n : 0;
    delete b.shadow_abs_sum; delete b.live_abs_sum;
    delete b.shadow_signed_sum; delete b.live_signed_sum;
    delete b.help_sum;
  }

  // Aggregate over the whole cohort
  const all = Object.values(buckets);
  const totN = all.reduce((s, b) => s + b.n, 0);
  const aggregate = {
    cohort_size: cohort.size,
    cohort_evaluated: totN,
    live_reform_mae: all.reduce((s, b) => s + b.live_mae * b.n, 0) / Math.max(1, totN),
    shadow_reform_mae: all.reduce((s, b) => s + b.shadow_mae * b.n, 0) / Math.max(1, totN),
    avg_help_pp: all.reduce((s, b) => s + b.avg_help * b.n, 0) / Math.max(1, totN),
    helped: all.reduce((s, b) => s + b.helped, 0),
    hurt: all.reduce((s, b) => s + b.hurt, 0),
    neutral: all.reduce((s, b) => s + b.neutral, 0),
  };

  return { aggregate, by_multiplier: buckets };
}

function writeMarkdownSummary(out, mdPath) {
  const liveS = out.live.summary;
  const shadowS = out.shadow?.summary;
  const lines = [];
  lines.push(`# May 7 2026 Post-Audit\n`);
  lines.push(`Generated: ${out.snapshot.generated_at}`);
  lines.push(`Election date: ${out.snapshot.election_date}`);
  lines.push(`Manifest: ${out.snapshot.manifest}\n`);

  lines.push(`## Coverage\n`);
  lines.push(`- Target ballots: ${out.snapshot.target_ballots}`);
  lines.push(`- Declared: ${out.snapshot.declared_ballots} (${out.snapshot.coverage_pct}%)`);
  lines.push(`- Evaluated against forecast: ${liveS.ballots_evaluated}\n`);

  if (out.prereg) {
    lines.push(`## Pre-registered forecast (April 26 — sha-witnessed)\n`);
    lines.push(`SHA256: ${out.prereg.sha256_actual} ${out.prereg.sha256_match ? "✓ matches manifest" : "✗ MISMATCH"}\n`);
    lines.push(`This is the model output as locked 11 days before polling day. The May 7 forecast served on the live site differs (Step 9b realignment uplift was added between pre-reg and election day). Both numbers are reported in this audit.\n`);
    lines.push(`| Metric | Value |`);
    lines.push(`|---|---|`);
    lines.push(`| Winner accuracy | ${(out.prereg.summary.winner_accuracy * 100).toFixed(1)}% |`);
    lines.push(`| Major-party MAE (avg of 5) | ${(out.prereg.summary.major_party_mae_avg * 100).toFixed(2)}pp |`);
    lines.push(`| Brier (top winner) | ${out.prereg.summary.brier_top_winner.toFixed(4)} |\n`);
  }

  lines.push(`## Live forecast (what users saw on May 7, includes Step 9b)\n`);
  lines.push(`SHA256 match against pre-registration manifest: ${out.live.sha256_match ? "✓" : "✗ (modified post pre-registration — see prereg section above)"}\n`);
  lines.push(`| Metric | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Winner accuracy | ${(liveS.winner_accuracy * 100).toFixed(1)}% |`);
  lines.push(`| Major-party MAE (avg of 5) | ${(liveS.major_party_mae_avg * 100).toFixed(2)}pp |`);
  lines.push(`| Brier (top winner) | ${liveS.brier_top_winner.toFixed(4)} |\n`);

  lines.push(`### Per-party (vote share)\n`);
  lines.push(`| Party | n | MAE | RMSE | Signed bias |`);
  lines.push(`|---|---|---|---|---|`);
  for (const p of MAJOR) {
    const r = out.live.per_party[p];
    if (!r) continue;
    lines.push(`| ${p} | ${r.n} | ${(r.mae * 100).toFixed(2)}pp | ${(r.rmse * 100).toFixed(2)}pp | ${(r.signed_bias * 100).toFixed(2)}pp |`);
  }
  lines.push(``);

  lines.push(`### Confidence calibration\n`);
  lines.push(`(MAE should rise from high → low; if it doesn't, the labels are decorative.)\n`);
  lines.push(`| Band | n | Winner accuracy | MAE |`);
  lines.push(`|---|---|---|---|`);
  for (const b of ["high", "medium", "low"]) {
    const r = out.live.by_confidence[b];
    if (!r || !r.n) continue;
    lines.push(`| ${b} | ${r.n} | ${(r.winner_accuracy * 100).toFixed(1)}% | ${(r.mae_avg * 100).toFixed(2)}pp |`);
  }
  lines.push(``);

  lines.push(`### By region\n`);
  lines.push(`| Region | n | Winner accuracy | MAE |`);
  lines.push(`|---|---|---|---|`);
  for (const k of Object.keys(out.live.by_region)) {
    const r = out.live.by_region[k];
    lines.push(`| ${k} | ${r.n} | ${(r.winner_accuracy * 100).toFixed(1)}% | ${(r.mae_avg * 100).toFixed(2)}pp |`);
  }
  lines.push(``);

  if (shadowS && out.step9b) {
    lines.push(`## Step 9b (Reform realignment uplift) — isolated audit\n`);
    lines.push(`Shadow forecast = pipeline rerun with UKE_DISABLE_REALIGNMENT_UPLIFT=1.\n`);
    lines.push(`| Metric | Value |`);
    lines.push(`|---|---|`);
    lines.push(`| Cohort size (lift > 1pp) | ${out.step9b.aggregate.cohort_size} |`);
    lines.push(`| Cohort evaluated | ${out.step9b.aggregate.cohort_evaluated} |`);
    lines.push(`| Reform MAE — live (with 9b) | ${(out.step9b.aggregate.live_reform_mae * 100).toFixed(2)}pp |`);
    lines.push(`| Reform MAE — shadow (no 9b) | ${(out.step9b.aggregate.shadow_reform_mae * 100).toFixed(2)}pp |`);
    lines.push(`| Avg help (positive = 9b helped) | ${(out.step9b.aggregate.avg_help_pp * 100).toFixed(2)}pp |`);
    lines.push(`| Helped / Hurt / Neutral | ${out.step9b.aggregate.helped} / ${out.step9b.aggregate.hurt} / ${out.step9b.aggregate.neutral} |\n`);

    lines.push(`### By regional multiplier\n`);
    lines.push(`| Multiplier | n | Live Reform MAE | Shadow Reform MAE | Avg help |`);
    lines.push(`|---|---|---|---|---|`);
    for (const k of Object.keys(out.step9b.by_multiplier).sort()) {
      const b = out.step9b.by_multiplier[k];
      lines.push(`| ${b.multiplier.toFixed(2)} | ${b.n} | ${(b.live_mae * 100).toFixed(2)}pp | ${(b.shadow_mae * 100).toFixed(2)}pp | ${(b.avg_help * 100).toFixed(2)}pp |`);
    }
    lines.push(``);

    lines.push(`### Shadow forecast — overall\n`);
    lines.push(`(For comparison; the shadow run scored against the same actuals on the same evaluable cohort.)\n`);
    lines.push(`| Metric | Live | Shadow | Δ |`);
    lines.push(`|---|---|---|---|`);
    lines.push(`| Winner accuracy | ${(liveS.winner_accuracy * 100).toFixed(1)}% | ${(shadowS.winner_accuracy * 100).toFixed(1)}% | ${((liveS.winner_accuracy - shadowS.winner_accuracy) * 100).toFixed(2)}pp |`);
    lines.push(`| Major-party MAE | ${(liveS.major_party_mae_avg * 100).toFixed(2)}pp | ${(shadowS.major_party_mae_avg * 100).toFixed(2)}pp | ${((liveS.major_party_mae_avg - shadowS.major_party_mae_avg) * 100).toFixed(2)}pp |`);
    lines.push(``);
  }

  lines.push(`## Worst residuals (live forecast)\n`);
  lines.push(`| Ballot | Predicted | Actual | Major MAE | Reform Δ | Lab Δ | Con Δ |`);
  lines.push(`|---|---|---|---|---|---|---|`);
  for (const r of out.live.worst_residuals.slice(0, 20)) {
    lines.push(`| ${r.ballot_paper_id} | ${r.predicted_winner} | ${r.actual_winner} | ${(r.major_party_mae * 100).toFixed(2)}pp | ${(r.reform_delta * 100).toFixed(1)}pp | ${(r.lab_delta * 100).toFixed(1)}pp | ${(r.con_delta * 100).toFixed(1)}pp |`);
  }

  writeFileSync(mdPath, lines.join("\n") + "\n");
}

function main() {
  const manifestFile = args.manifest || pickLatestManifest();
  if (!manifestFile) {
    console.error("No pre-registration manifest found in data/transparency/");
    process.exit(1);
  }
  const manifest = readJson(`data/transparency/${manifestFile}`);
  console.log(`Manifest: ${manifestFile} (pre-registered ${manifest.pre_registered_at})`);

  const liveEntry = manifest.files.find((f) => f.path === "data/predictions/may-2026/local-and-mayor.json");
  if (!liveEntry) {
    console.error("Manifest does not include data/predictions/may-2026/local-and-mayor.json");
    process.exit(1);
  }
  const liveSha = sha256(readFileSync(join(REPO, liveEntry.path)));
  if (liveSha !== liveEntry.sha256) {
    console.warn(`⚠ TAMPERING DETECTED on ${liveEntry.path}`);
    console.warn(`  Pre-registered: ${liveEntry.sha256}`);
    console.warn(`  Current      : ${liveSha}`);
  } else {
    console.log(`✓ ${liveEntry.path} sha256 matches pre-registration`);
  }

  const live = readJson(liveEntry.path);
  // Prefer the merged file (DC + Wikipedia supplement) when present;
  // fall back to the DC-only file.
  const mergedPath = "data/results/may-2026/local-and-mayor.merged.json";
  const dcOnlyPath = "data/results/may-2026/local-and-mayor.json";
  const actualsPath = existsSync(join(REPO, mergedPath)) ? mergedPath : dcOnlyPath;
  console.log(`Actuals source: ${actualsPath}`);
  const actualsBundle = readJson(actualsPath);
  const actuals = actualsBundle.by_ballot;
  console.log(`Forecast: ${Object.keys(live.predictions).length} predictions`);
  console.log(`Actuals: ${Object.keys(actuals).length} declared ballots`);

  const liveAudit = audit({
    predictions: live.predictions,
    actuals,
    label: "live",
    manifestEntry: liveEntry,
    manifestSha: liveSha,
  });
  console.log(`\nLive forecast (May 7 13:14, includes Step 9b — what users saw):`);
  console.log(`  Evaluated: ${liveAudit.summary.ballots_evaluated}`);
  console.log(`  Winner accuracy: ${(liveAudit.summary.winner_accuracy * 100).toFixed(1)}%`);
  console.log(`  Major-party MAE: ${(liveAudit.summary.major_party_mae_avg * 100).toFixed(2)}pp`);
  console.log(`  Brier (top): ${liveAudit.summary.brier_top_winner.toFixed(4)}`);

  // Pre-registered forecast (April 26, sha-matched against manifest) — the
  // honest pre-commitment, restored from git.
  let preregAudit = null;
  const preregPath = "data/predictions/may-2026/local-and-mayor.prereg-2026-04-26.json";
  if (existsSync(join(REPO, preregPath))) {
    const preregSha = sha256(readFileSync(join(REPO, preregPath)));
    if (preregSha !== liveEntry.sha256) {
      console.warn(`⚠ Pre-reg restoration mismatch: ${preregSha} vs ${liveEntry.sha256}`);
    } else {
      console.log(`✓ Pre-reg forecast restoration sha256 matches manifest (${preregSha.slice(0, 12)}...)`);
    }
    const prereg = readJson(preregPath);
    preregAudit = audit({
      predictions: prereg.predictions,
      actuals,
      label: "prereg-2026-04-26",
      manifestEntry: liveEntry,
      manifestSha: preregSha,
    });
    console.log(`\nPre-registered forecast (April 26 — locked, sha-witnessed):`);
    console.log(`  Evaluated: ${preregAudit.summary.ballots_evaluated}`);
    console.log(`  Winner accuracy: ${(preregAudit.summary.winner_accuracy * 100).toFixed(1)}%`);
    console.log(`  Major-party MAE: ${(preregAudit.summary.major_party_mae_avg * 100).toFixed(2)}pp`);
  }

  let shadowAudit = null;
  let step9b = null;
  const shadowPath = "data/predictions/may-2026/local-and-mayor.shadow-no-step9b.json";
  if (existsSync(join(REPO, shadowPath))) {
    const shadow = readJson(shadowPath);
    shadowAudit = audit({
      predictions: shadow.predictions,
      actuals,
      label: "shadow-no-step9b",
      manifestEntry: null,
      manifestSha: sha256(readFileSync(join(REPO, shadowPath))),
    });
    console.log(`\nShadow forecast (Step 9b disabled):`);
    console.log(`  Evaluated: ${shadowAudit.summary.ballots_evaluated}`);
    console.log(`  Winner accuracy: ${(shadowAudit.summary.winner_accuracy * 100).toFixed(1)}%`);
    console.log(`  Major-party MAE: ${(shadowAudit.summary.major_party_mae_avg * 100).toFixed(2)}pp`);

    const { cohort, detail } = reformCohortFromDiff(live, shadow);
    console.log(`\nStep 9b cohort: ${cohort.size} ballots received >1pp lift`);
    step9b = step9bCohortAudit({ live, shadow, actuals, cohort, cohortDetail: detail });
    console.log(`  Cohort evaluated against actuals: ${step9b.aggregate.cohort_evaluated}`);
    console.log(`  Reform MAE live:    ${(step9b.aggregate.live_reform_mae * 100).toFixed(2)}pp`);
    console.log(`  Reform MAE shadow:  ${(step9b.aggregate.shadow_reform_mae * 100).toFixed(2)}pp`);
    console.log(`  Avg help (pos = 9b helped): ${(step9b.aggregate.avg_help_pp * 100).toFixed(2)}pp`);
    console.log(`  Helped/Hurt/Neutral: ${step9b.aggregate.helped}/${step9b.aggregate.hurt}/${step9b.aggregate.neutral}`);
  } else {
    console.log(`\nShadow forecast not found at ${shadowPath} — skipping Step 9b isolation audit.`);
  }

  const generatedAt = new Date().toISOString();
  const runDate = generatedAt.slice(0, 10);
  const out = {
    snapshot: {
      generated_at: generatedAt,
      election_date: actualsBundle.snapshot.election_date,
      manifest: manifestFile,
      pre_registered_at: manifest.pre_registered_at,
      target_ballots: actualsBundle.coverage.target_ballots,
      declared_ballots: actualsBundle.coverage.declared_ballots,
      coverage_pct: actualsBundle.coverage.coverage_pct,
      actuals_sha256: actualsBundle.snapshot.sha256,
    },
    prereg: preregAudit,
    live: liveAudit,
    shadow: shadowAudit,
    step9b,
  };

  // Strip per-row arrays from the markdown summary path; keep rows in the
  // JSON for downstream consumers.
  const outPath = `data/transparency/may-2026-postaudit-${runDate}.json`;
  mkdirSync(dirname(join(REPO, outPath)), { recursive: true });
  writeFileSync(join(REPO, outPath), JSON.stringify(out, null, 2));
  console.log(`\nWrote ${outPath}`);

  const mdPath = `data/transparency/may-2026-postaudit-${runDate}.md`;
  writeMarkdownSummary(out, join(REPO, mdPath));
  console.log(`Wrote ${mdPath}`);
}

main();
