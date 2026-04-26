#!/usr/bin/env node
// Phase 2: bulk-run electionModel.predictWard() across all 2,977 local + 6 mayor wards.
// Persist data/predictions/may-2026/local-and-mayor.json + summary.json.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { buildWardData, partiesOnBallotCanonical, restrictToBallot } from "../src/lib/adaptDcToWardData.js";
import { predictWard, DEFAULT_ASSUMPTIONS, normalizePartyName } from "../src/lib/electionModel.js";
import { pollingPair, UK_WESTMINSTER_2025_MAY_AVERAGE } from "../src/lib/nationalPolling.js";
import { buildCounty2025Shares, applyCounty2025Anchor, DISTRICT_TO_PARENT_COUNTY_2025 } from "../src/lib/county2025.js";
import { applyIntervalsToBundle } from "../src/lib/intervals.js";
import { buildCouncilGe2024Index } from "../src/lib/councilGe2024.js";
import { lancashireLcc2025ForWard } from "../src/lib/lancashireLcc2025.js";
import { computeWardDemographicAdjustments, applyAdjustments, applyDemographicCeilings } from "../src/lib/wardDemographicAdjustments.js";
import { applyLocalStrength } from "../src/lib/localPartyStrength.js";
import { buildCounty2025WinnerIndex, applyCounty2025Continuity } from "../src/lib/county2025Winners.js";

function applyCandidateOverrides(prediction, overrides, ballotPaperId, candidates2026) {
  if (!prediction || !overrides?.length) return { prediction, applied: [] };
  const applied = [];
  const out = { ...prediction };
  for (const o of overrides) {
    if (o.ballot_paper_id !== ballotPaperId) continue;
    // Resolve the candidate's party from DC roster (canonicalised)
    let party = o.party;
    if (candidates2026?.length) {
      const match = candidates2026.find((c) => {
        const candFirst = (c.name || "").toLowerCase().split(" ")[0];
        const overrideFirst = (o.candidate_name || "").toLowerCase().split(" ")[0];
        const candLast = (c.name || "").toLowerCase().split(" ").slice(-1)[0];
        const overrideLast = (o.candidate_name || "").toLowerCase().split(" ").slice(-1)[0];
        return candFirst === overrideFirst && candLast === overrideLast;
      });
      if (!match) continue;
      // Canonicalise party
      const dcParty = match.party_name || match.party || party;
      party = dcParty === "Labour Party" ? "Labour"
            : dcParty === "Labour and Co-operative Party" ? "Labour"
            : dcParty === "Conservative and Unionist Party" ? "Conservative"
            : dcParty === "Liberal Democrats" ? "Liberal Democrats"
            : dcParty === "Reform UK" ? "Reform UK"
            : dcParty === "Green Party" ? "Green Party"
            : /independent/i.test(dcParty) ? "Independent"
            : dcParty;
    }
    if (!out[party]) continue;
    const before = out[party].pct || 0;
    out[party] = { ...out[party], pct: before + o.bonus_pp };
    applied.push({ candidate: o.candidate_name, party, bonus: o.bonus_pp, reason: o.reason });
  }
  if (applied.length) {
    const sum = Object.values(out).reduce((s, v) => s + (v.pct || 0), 0);
    if (sum > 0) for (const p of Object.keys(out)) out[p].pct = out[p].pct / sum;
  }
  return { prediction: out, applied };
}
import { existsSync as fsExistsSync, readdirSync } from "node:fs";

const LONDON_BOROUGHS = new Set(["barking-and-dagenham", "barnet", "bexley", "brent", "bromley", "camden", "city-of-london", "croydon", "ealing", "enfield", "greenwich", "hackney", "hammersmith-and-fulham", "haringey", "harrow", "havering", "hillingdon", "hounslow", "islington", "kensington-and-chelsea", "kingston-upon-thames", "lambeth", "lewisham", "merton", "newham", "redbridge", "richmond-upon-thames", "southwark", "sutton", "tower-hamlets", "waltham-forest", "wandsworth", "westminster"]);
const METROPOLITAN_BOROUGHS = new Set(["barnsley", "birmingham", "bolton", "bradford", "bury", "calderdale", "coventry", "doncaster", "dudley", "gateshead", "kirklees", "knowsley", "leeds", "liverpool", "manchester", "newcastle-upon-tyne", "north-tyneside", "oldham", "rochdale", "rotherham", "salford", "sandwell", "sefton", "sheffield", "solihull", "south-tyneside", "st-helens", "stockport", "sunderland", "tameside", "trafford", "wakefield", "walsall", "wigan", "wirral", "wolverhampton"]);

function regionOf(councilSlug) {
  if (LONDON_BOROUGHS.has(councilSlug)) return "london";
  if (METROPOLITAN_BOROUGHS.has(councilSlug)) return "metropolitan";
  if (DISTRICT_TO_PARENT_COUNTY_2025[councilSlug]) return "county_district";
  return "other";
}

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const CLAWD = "/Users/tompickup/clawd/burnley-council/data";
const MODEL_VERSION = "ukelections.local.v0.2.0-may2026-lcc2025";

// Lancashire districts where AI DOGE has lcc_2025_reference.json — load and
// pass to the model so Reform's actual May 2025 LCC shares feed the
// new-party-entry step instead of relying on the GE2024-only fallback.
const LANCASHIRE_LCC_REF_COUNCILS = ["burnley", "blackburn", "blackpool", "chorley", "fylde", "hyndburn", "lancaster", "pendle", "preston", "ribble-valley", "rossendale", "south-ribble", "west-lancashire", "wyre"];

function maybeLoadLcc2025(councilSlug) {
  // DC slug uses hyphens; AI DOGE dirs use underscores.
  const aidogeId = councilSlug.replace(/-/g, "_");
  const p = path.join(CLAWD, aidogeId, "lcc_2025_reference.json");
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function lcc2025ForWardName(lccRef, wardName) {
  // The reference maps division → { results, reform_pct, wards: [ward names] }.
  // Find the LCC division whose wards array contains this ward.
  if (!lccRef?.divisions || !wardName) return null;
  // Try exact match first, then case-insensitive, then alias-style normalisation.
  const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
  const target = norm(wardName);
  for (const [divName, div] of Object.entries(lccRef.divisions)) {
    const wards = (div.wards || []).map(norm);
    if (wards.includes(target)) {
      return { ...div, division_name: divName };
    }
  }
  return null;
}

function readJson(p) { return JSON.parse(readFileSync(path.join(ROOT, p), "utf8")); }

function writeJson(rel, payload) {
  const full = path.join(ROOT, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, JSON.stringify(payload, null, 2));
  return full;
}

function buildLaContext(ladCode, laProj, laImd, laGe24) {
  const proj = laProj.projections[ladCode];
  const imd = laImd.imd[ladCode];
  // Demographics (pre-computed percentages) — model skips derivation when these are set.
  const demographics = proj
    ? {
        white_british_pct: proj.white_british_pct_projected,
        asian_pct: proj.asian_pct_projected,
        // age_65_plus_pct intentionally omitted — HP carries ethnicity, not age structure.
        // The model only fires age adjustments when > 0.25, so omission == no adjustment.
        _source: "HP_v7.0_LA_2026",
      }
    : null;
  const deprivation = imd ? { avg_imd_decile: imd.avg_imd_decile, _source: "IMD2019_LSOA_to_LAD_avg" } : null;
  const ethnicProjections = proj
    ? {
        white_british_pct_projected: proj.white_british_pct_projected,
        asian_pct_projected: proj.asian_pct_projected,
        _source: "HP_v7.0_LA_2026_back_extrapolated",
      }
    : null;
  // ConstituencyResult: use LA-aggregated GE2024 if we have a per-PCON join, else fall back to national.
  // For Stage 1 we use national average for all (per-PCON join via ballot slug requires a PCON-CD lookup we don't have).
  const constituencyResult = laGe24.national;
  return { demographics, deprivation, ethnicProjections, constituencyResult };
}

function classifyConfidence(wardData, prediction) {
  if (!prediction) return "none";
  const cycleHistory = (wardData.history || []).filter((h) => h.type !== "by-election");
  const latest = wardData.history[wardData.history.length - 1];
  const yearsAgo = latest ? new Date().getFullYear() - (latest.year || 0) : 99;
  if (cycleHistory.length >= 3 && yearsAgo <= 4) return "high";
  if (cycleHistory.length >= 1 && yearsAgo <= 8) return "medium";
  if (yearsAgo > 8) return "low";
  return "low";
}

function rolledUpByCouncil(predictions, identity) {
  const byCouncil = {};
  for (const ward of identity.wards) {
    if (ward.tier !== "local") continue;
    const p = predictions[ward.ballot_paper_id];
    if (!p?.prediction) continue;
    const council = `${ward.tier}::${ward.council_slug}`;
    if (!byCouncil[council]) byCouncil[council] = {
      council_slug: ward.council_slug,
      council_name: ward.council_name,
      tier: ward.tier,
      ward_count: 0,
      seats_up: 0,
      predicted_seat_winners: {},
    };
    byCouncil[council].ward_count += 1;
    byCouncil[council].seats_up += ward.winner_count || 1;
    // Predicted top party for this ward (winner-take-seats simplification for the rollup;
    // multi-seat wards in Stage 1 are awarded to the top N parties by predicted share)
    const ranked = Object.entries(p.prediction).sort((a, b) => (b[1].pct || 0) - (a[1].pct || 0));
    const seatsContested = ward.winner_count || 1;
    const winners = ranked.slice(0, seatsContested);
    for (const [party, _data] of winners) {
      byCouncil[council].predicted_seat_winners[party] = (byCouncil[council].predicted_seat_winners[party] || 0) + 1;
    }
  }
  return Object.values(byCouncil);
}

function main() {
  console.log("Loading inputs...");
  const identity = readJson("data/identity/wards-may-2026.json");
  const history = readJson("data/history/dc-historic-results.json");
  let leapHistory = null;
  try {
    leapHistory = readJson("data/history/leap-history.json");
    const leapWards = Object.keys(leapHistory.by_gss || {}).length;
    const leapContests = leapHistory?.totals?.contests ?? 0;
    console.log(`Loaded LEAP supplemental history: ${leapContests} contests across ${leapWards} ward GSS codes`);
  } catch {
    console.log("No LEAP supplemental history found (data/history/leap-history.json) — proceeding with DC only");
  }
  let besPriors = null;
  try {
    besPriors = readJson("data/features/ward-mrp-priors.json");
    const ladCount = Object.keys(besPriors.priors || {}).length;
    console.log(`Loaded BES Wave 1-30 priors: ${ladCount} LADs, ${besPriors.snapshot?.respondents_used || 'na'} respondents`);
  } catch {
    console.log("No BES priors found (data/features/ward-mrp-priors.json) — skipping BES MRP prior step");
  }
  const slugMap = readJson("data/identity/council-slug-to-lad24.json");
  const laProj = readJson("data/features/la-ethnic-projections.json");
  const laImd = readJson("data/features/la-imd.json");
  const laGe24 = readJson("data/features/la-ge2024-shares.json");
  const { nationalPolling, ge2024Result } = pollingPair();
  const polling2025 = UK_WESTMINSTER_2025_MAY_AVERAGE.shares;

  console.log("Building per-county 2025 reference shares...");
  const county2025 = buildCounty2025Shares(history);
  console.log(`  ${Object.keys(county2025).length} counties/unitaries with 2025 cycle baseline`);

  console.log("Building 2025 county-winner candidate index (for cross-tier continuity)...");
  const county2025Winners = buildCounty2025WinnerIndex(history);
  const winnerCount = Object.values(county2025Winners).reduce((s, w) => s + w.length, 0);
  console.log(`  ${winnerCount} 2025 county winners indexed across ${Object.keys(county2025Winners).length} counties`);

  let candidateOverrides = [];
  try {
    candidateOverrides = readJson("data/overrides/candidate-bonuses.json").overrides || [];
    console.log(`Loaded ${candidateOverrides.length} hand-curated candidate overrides`);
  } catch {}

  // Load 2026 candidate rosters per ballot (for candidate-continuity detection)
  console.log("Loading 2026 candidate rosters...");
  const candidateRosters = {};
  const rosterDir = path.join(ROOT, "data/candidates/may-2026");
  try {
    for (const file of readdirSync(rosterDir)) {
      if (!file.endsWith(".json")) continue;
      const roster = JSON.parse(readFileSync(path.join(rosterDir, file), "utf8"));
      for (const b of roster.ballots || []) {
        candidateRosters[b.ballot_paper_id] = b.candidates || [];
      }
    }
    console.log(`  ${Object.keys(candidateRosters).length} ballot rosters loaded`);
  } catch (e) {
    console.log(`  ${e}`);
  }

  let calibration;
  try {
    calibration = readJson("data/calibration/regional-dampening.json").calibration;
    console.log(`Loaded regional dampening calibration: ${JSON.stringify(Object.fromEntries(Object.entries(calibration).map(([r, c]) => [r, c.dampening])))}`);
  } catch {
    calibration = {};
    console.log("No regional calibration found — using DEFAULT_ASSUMPTIONS dampening 0.65");
  }

  console.log("Building per-council GE2024 aggregates (P2 — replaces national fallback)...");
  const councilSlugs = [...new Set(identity.wards.filter((w) => w.tier === "local" || w.tier === "mayor").map((w) => w.council_slug))];
  const councilGe24 = buildCouncilGe2024Index(history, councilSlugs);
  console.log(`  ${Object.keys(councilGe24).length} of ${councilSlugs.length} councils have a per-council GE2024 baseline.`);

  let wardDemographics = {};
  const wardDemoPath = path.join(ROOT, "data/features/ward-demographics-2021.json");
  if (fsExistsSync(wardDemoPath)) {
    try {
      wardDemographics = readJson("data/features/ward-demographics-2021.json").wards || {};
      console.log(`Loaded per-ward Census 2021 demographics for ${Object.keys(wardDemographics).length} wards.`);
    } catch (e) {
      console.log(`Could not load ward demographics: ${e}`);
    }
  }
  // Build a (lad22cd, normalised ward name) → demographics index for name-based
  // fallback (covers wards with placeholder GSS like Bradford "BRD:airedale" or
  // 2026 boundary-review wards not yet in the WD25 lookup).
  const demoByLadName = {};
  for (const [, demo] of Object.entries(wardDemographics)) {
    if (!demo.lad22cd || !demo.ward_name) continue;
    const key = `${demo.lad22cd}::${demo.ward_name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;
    demoByLadName[key] = demo;
  }
  console.log(`Built ${Object.keys(demoByLadName).length} (LAD, ward-name) keys for fallback`);

  function findDemographics(ward) {
    if (ward.gss_code && wardDemographics[ward.gss_code]) return wardDemographics[ward.gss_code];
    // Name fallback: parent LAD via slug→LAD24 map, ward name match
    const lad = slugMap.map[ward.council_slug]?.lad24cd;
    if (!lad || !ward.ward_name) return null;
    const wardName = ward.ward_name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    return demoByLadName[`${lad}::${wardName}`] || null;
  }

  console.log("Running bulk predictions...");
  const predictions = {};
  const tally = { ok: 0, no_history: 0, no_baseline: 0, cancelled: 0, by_confidence: { high: 0, medium: 0, low: 0, none: 0 } };

  for (const ward of identity.wards) {
    if (ward.tier !== "local" && ward.tier !== "mayor") continue;
    if (ward.cancelled) {
      predictions[ward.ballot_paper_id] = {
        prediction: null,
        confidence: "none",
        cancelled: true,
        baseline_date: null,
        model_version: MODEL_VERSION,
        methodology: [{ step: 0, name: "Cancelled", description: "Election cancelled (likely candidate-death postponement). No prediction." }],
      };
      tally.cancelled += 1;
      continue;
    }

    const wd = buildWardData(ward, history, leapHistory);
    if (!wd.history.length) {
      // Fallback: synthesise prediction from council-level GE2024 + county-2025 anchor
      // restricted to the parties on the ballot. Marked confidence: low.
      const onBallotSet = new Set(partiesOnBallotCanonical(ward));
      const ge24 = councilGe24[ward.council_slug]?.shares || ge2024Result;
      // Apply 2024→2026 swing using national polling
      const swung = {};
      const allParties = new Set([...Object.keys(ge24), ...Object.keys(nationalPolling)]);
      for (const p of allParties) {
        const swing = (nationalPolling[p] || 0) - (ge2024Result[p] || 0);
        swung[p] = Math.max(0, (ge24[p] || 0) + swing);
      }
      // Restrict to ballot
      const restrictedShares = {};
      let kept = 0;
      for (const p of onBallotSet) restrictedShares[p] = swung[p] || 0.005;
      for (const p of Object.keys(restrictedShares)) kept += restrictedShares[p];
      if (kept > 0) for (const p of Object.keys(restrictedShares)) restrictedShares[p] /= kept;
      // Apply county-2025 anchor at 0.40 weight
      const anchored = applyCounty2025Anchor({
        prediction: Object.fromEntries(Object.entries(restrictedShares).map(([k, v]) => [k, { pct: v, votes: 0 }])),
        county2025Shares: county2025,
        councilSlug: ward.council_slug,
        nationalPollingNow: nationalPolling,
        national2025Polling: polling2025,
        anchorWeight: 0.50,
      });
      predictions[ward.ballot_paper_id] = {
        prediction: anchored.prediction,
        confidence: "low",
        baseline_date: null,
        model_version: MODEL_VERSION,
        county_2025_anchor: anchored.anchor_used ? anchored.anchor_source : null,
        methodology: [
          { step: 0, name: "Fallback (no historic match)", description: "No prior contest results in DC bundle for this ward (likely 2026 boundary change). Synthesised prediction from council-level GE2024 aggregate + national 2024→2026 swing + county-2025 anchor where available, restricted to the parties on the 2026 ballot. Marked low confidence." },
        ],
      };
      tally.no_history += 1;
      tally.by_confidence.low += 1;
      continue;
    }

    const ladCode = slugMap.map[ward.council_slug]?.lad24cd;
    let ctx = ladCode
      ? buildLaContext(ladCode, laProj, laImd, laGe24)
      : { demographics: null, deprivation: null, ethnicProjections: null, constituencyResult: laGe24.national };
    // P2: prefer per-council GE2024 aggregate over national fallback for the
    // model's stale-baseline blend + Reform new-party-entry proxy.
    const councilG24 = councilGe24[ward.council_slug];
    if (councilG24) ctx = { ...ctx, constituencyResult: councilG24.shares };
    // Per-ward Census demographics with name-based fallback for placeholder-GSS wards.
    const wardDemoFullEarly = findDemographics(ward);
    if (wardDemoFullEarly) {
      ctx = { ...ctx, demographics: { white_british_pct: wardDemoFullEarly.white_british_pct, asian_pct: wardDemoFullEarly.asian_pct, age_65_plus_pct: wardDemoFullEarly.age_65_plus_pct, _source: wardDemoFullEarly._source } };
    }
    const { demographics, deprivation, ethnicProjections, constituencyResult } = ctx;

    // Apply per-region calibrated national-swing dampening (P5).
    const region = regionOf(ward.council_slug);
    const dampening = calibration?.[region]?.dampening ?? DEFAULT_ASSUMPTIONS.nationalToLocalDampening;
    // Enable Strong Transition Model swing on locals too — it's bounded in
    // [0,1] by construction, so it can't ever produce negative shares for a
    // declining party in its weak ward (which UNS does silently). Backtest
    // lift on the GE2019→GE2024 setting was +1.23pp MAE; locals lift will
    // be smaller because the dampening is harsher (≤0.65) but still positive.
    const wardAssumptions = {
      ...DEFAULT_ASSUMPTIONS,
      nationalToLocalDampening: dampening,
      useStrongTransitionSwing: true,
    };

    // For Lancashire wards: pass per-division LCC 2025 reference so the
    // Reform new-party-entry step can use real division-level Reform shares
    // (e.g. Burnley Rural Reform 42.9%) instead of the GE2024-only proxy.
    const lcc2025Arg = lancashireLcc2025ForWard(ward.council_slug, ward.ward_name);

    const ladCodeForBes = slugMap.map[ward.council_slug]?.lad24cd;
    const besPrior = ladCodeForBes ? besPriors?.priors?.[ladCodeForBes] || null : null;

    const result = predictWard(
      wd,
      wardAssumptions,
      nationalPolling,
      ge2024Result,
      demographics,
      deprivation,
      constituencyResult,
      lcc2025Arg,
      null, // modelParams
      null, // fiscalData
      null, // candidates2026 (already in wardData)
      ethnicProjections,
      besPrior,
    );

    if (!result.prediction) {
      predictions[ward.ballot_paper_id] = {
        prediction: null,
        confidence: "none",
        baseline_date: null,
        model_version: MODEL_VERSION,
        methodology: result.methodology,
      };
      tally.no_baseline += 1;
      tally.by_confidence.none += 1;
      continue;
    }

    // 1a. Apply per-ward demographic adjustments BEFORE restriction (so that
    //     the demographic Independent boost in high-Asian wards lands before
    //     restrict-to-ballot proportional redistribution).
    const wardDemoFull = wardDemoFullEarly;
    const demoAdj = computeWardDemographicAdjustments(wardDemoFull);
    let postDemo = applyAdjustments(result.prediction, demoAdj.adjustments);

    // 1b. Restrict prediction to parties actually contesting this ballot in 2026.
    const onBallot = new Set(partiesOnBallotCanonical(ward));
    const { prediction: filtered, dropped } = restrictToBallot(postDemo, onBallot);

    // 2. Apply 2025 county-cycle anchor: blend the model's prediction toward the
    //    parent county / unitary's May 2025 cycle shares (with national swing
    //    since 2025 added back). Critical fix for Reform under-prediction in
    //    counties where Reform topped 2025 county council elections (Lancs,
    //    Lincs, Staffs, Derbys, Kent, Notts, Leics, Warks, Northumberland).
    // County-2025 anchor — bump weight when the ward's baseline is very stale
    // (>3 years old) so the most-recent local-equivalent signal dominates.
    const baselineAge = (() => {
      const latest = wd.history[wd.history.length - 1];
      if (!latest?.year) return 99;
      return 2026 - latest.year;
    })();
    const dynamicAnchorWeight = baselineAge >= 5 ? 0.65 : baselineAge >= 3 ? 0.55 : 0.45;
    const anchored = applyCounty2025Anchor({
      prediction: filtered,
      county2025Shares: county2025,
      councilSlug: ward.council_slug,
      nationalPollingNow: nationalPolling,
      national2025Polling: polling2025,
      anchorWeight: dynamicAnchorWeight,
    });
    let postAnchor = anchored.prediction;

    // 3. Local-party-strength + candidate continuity (Phases C + D)
    // Coalclough LD 8-cycle stronghold (mean 47%) gets anchored back to ~40%
    // even after Reform's national surge. Birtwistle name-match adds +5pp.
    const localStrengthOut = applyLocalStrength({
      prediction: postAnchor,
      historyRows: wd.history,
      candidates2026: candidateRosters[ward.ballot_paper_id] || [],
    });
    postAnchor = localStrengthOut.prediction;

    // 3b. Cross-tier candidate continuity: 2025 county-winner standing in
    //     this 2026 borough ward → personal-vote bonus.
    //     Mark Poulton (Burnley Rural LCC winner 2025, 1,798 votes) standing
    //     for Reform in Briercliffe → Reform +2.2pp.
    const wardCandidates = candidateRosters[ward.ballot_paper_id] || [];
    const crossTier = applyCounty2025Continuity({
      prediction: postAnchor,
      candidates2026: wardCandidates,
      councilSlug: ward.council_slug,
      wardName: ward.ward_name,
      county2025Winners,
    });
    postAnchor = crossTier.prediction;

    // 3c. Hand-curated candidate overrides (local intelligence not derivable
    //     from data alone — e.g. Mark Poulton's specifically strong Briercliffe
    //     base within the Burnley Rural division).
    const overrideOut = applyCandidateOverrides(postAnchor, candidateOverrides, ward.ballot_paper_id, wardCandidates);
    postAnchor = overrideOut.prediction;

    // 4. Demographic ceilings (Phase F): cap Reform in high-Muslim wards.
    const ceilingOut = applyDemographicCeilings(postAnchor, wardDemoFull);
    const finalPrediction = ceilingOut.prediction;

    // Recompute votes consistently from final pct so the page never displays
    // a (29%, 181 votes) inconsistency caused by transformation steps that
    // updated pct but left the original votes value untouched.
    const estimatedTurnoutVotes = (() => {
      // Prefer the latest cycle (non-by-election) turnout from history.
      // If turnout_votes is present, use it directly. Otherwise derive from
      // turnout_pct × electorate where both are available.
      const cycle = [...wd.history].filter((h) => h.type !== "by-election");
      const latest = cycle[cycle.length - 1] || wd.history[wd.history.length - 1];
      if (!latest) return null;
      if (latest.turnout_votes && latest.turnout_votes > 0) return latest.turnout_votes;
      if (latest.turnout && latest.electorate) return Math.round(latest.turnout * latest.electorate);
      // Last resort: pick from any historic row that has turnout_votes
      const fallback = wd.history.find((h) => h.turnout_votes && h.turnout_votes > 0);
      if (fallback) return fallback.turnout_votes;
      return null;
    })();
    if (finalPrediction && estimatedTurnoutVotes) {
      const seatsContested = ward.winner_count || 1;
      const totalVotesCast = estimatedTurnoutVotes * seatsContested;
      for (const party of Object.keys(finalPrediction)) {
        finalPrediction[party] = {
          ...finalPrediction[party],
          votes: Math.round((finalPrediction[party].pct || 0) * totalVotesCast),
        };
      }
    } else if (finalPrediction) {
      // No turnout signal — drop the votes field entirely so the page
      // doesn't render a misleading number.
      for (const party of Object.keys(finalPrediction)) {
        finalPrediction[party] = { pct: finalPrediction[party].pct };
      }
    }

    const confidence = classifyConfidence(wd, finalPrediction);
    predictions[ward.ballot_paper_id] = {
      prediction: finalPrediction,
      confidence,
      baseline_date: wd.history[wd.history.length - 1]?.date || null,
      lad24cd: ladCode || null,
      lad_name: slugMap.map[ward.council_slug]?.lad_name || null,
      la_features_used: { demographics: !!demographics, deprivation: !!deprivation, ethnicProjections: !!ethnicProjections },
      parties_on_ballot: [...onBallot].sort(),
      dropped_from_baseline: dropped,
      county_2025_anchor: anchored.anchor_used ? anchored.anchor_source : null,
      cross_tier_continuity: crossTier.applied,
      candidate_overrides: overrideOut.applied,
      model_version: MODEL_VERSION,
      methodology: [
        ...result.methodology,
        {
          step: "Final-A",
          name: "Restrict to ballot",
          description: dropped.length
            ? `Removed ${dropped.length} party/parties not standing in 2026 (${dropped.map((d) => `${d.party} ${(d.share * 100).toFixed(1)}pp`).join(", ")}). Their share redistributed pro-rata.`
            : "All predicted parties are on the 2026 ballot — no redistribution needed.",
        },
        anchored.anchor_used
          ? {
              step: "Final-B",
              name: "2025 county-cycle anchor",
              description: `Blended (weight ${anchored.anchor_weight}) toward May 2025 results for ${anchored.anchor_source.county_slug} (${anchored.anchor_source.ballot_count} divisions, ${anchored.anchor_source.total_votes.toLocaleString()} votes), adjusted by national swing since May 2025. This corrects the model's tendency to under-weight Reform's 2025 county breakthroughs in 2-tier districts.`,
            }
          : {
              step: "Final-B",
              name: "2025 county-cycle anchor",
              description: "No 2025 reference available for this council's parent area. Stage 1 uses national polling only.",
            },
      ],
    };
    tally.ok += 1;
    tally.by_confidence[confidence] = (tally.by_confidence[confidence] || 0) + 1;
  }

  console.log(`\nTally: ${JSON.stringify(tally, null, 2)}`);

  // P8: bootstrap P10/P50/P90 intervals + win_probability per ward using
  // residual SDs from the latest 2024 backtest.
  console.log("\nApplying bootstrap intervals from 2024 backtest residual SDs...");
  let residualSd = {};
  try {
    residualSd = readJson("data/backtests/may-2024-summary.json").residual_sd_per_party || {};
    console.log(`  residual SDs loaded for ${Object.keys(residualSd).length} parties`);
  } catch {
    console.log("  no backtest summary yet — using default sigmas in intervals.js");
  }
  applyIntervalsToBundle(predictions, residualSd, 800);

  const sha = createHash("sha256").update(JSON.stringify(predictions)).digest("hex");
  const payload = {
    snapshot: {
      generated_at: new Date().toISOString(),
      model_version: MODEL_VERSION,
      sha256: sha,
      input_polling: pollingPair().nationalPolling,
      input_ge2024_baseline: pollingPair().ge2024Result,
      assumptions: DEFAULT_ASSUMPTIONS,
      method_summary: "AI DOGE election model (Lancashire-trained, RMSE 1.65) generalised. Pipeline: ward history baseline → national swing dampened 0.65 → LA-level UKD HP v7.0 demographic adjustment → IMD-based deprivation tilt → incumbency (where holders known) → Reform-entry handling → normalisation. Per-LA GE2024 deferred to Stage 1.5 — currently uses UK national.",
    },
    tally,
    predictions,
  };
  writeJson("data/predictions/may-2026/local-and-mayor.json", payload);

  console.log("\nBuilding per-council rollup...");
  const rollups = rolledUpByCouncil(predictions, identity);
  writeJson("data/predictions/may-2026/summary.json", {
    snapshot: payload.snapshot,
    council_count: rollups.length,
    councils: rollups.sort((a, b) => a.council_name.localeCompare(b.council_name)),
  });
  console.log(`  ${rollups.length} councils rolled up.`);
}

main();
