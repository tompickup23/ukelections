#!/usr/bin/env node
/**
 * fit-candidate-engine-2026-10-24.mjs: fit the two parameters of the 24 October
 * 2026 candidate local engine on data available before the May 2026 forecast
 * was locked, and nothing later. Protocol: docs/local-engine-holdout-2026-10-24.md.
 *
 *   C1  Step 9b regional multipliers, per tier: Reform's mean share in the
 *       council by-elections of 2 May 2025 to 25 April 2026 held in English
 *       councils with no 2025 county anchor, over the mean Step 9b base target
 *       of that tier's 2026 wards as recorded in the polling-day forecast.
 *       A tier with fewer than five by-elections keeps its 7 May value.
 *   C2  The local-to-Westminster ratio from the May 2025 county elections
 *       (src/lib/localElectionTarget.js), and the polls to 25 April 2026.
 *
 * Writes data/calibration/candidate-2026-10-24/{reform-regional-multiplier,local-national-ratio}.json.
 * Needs the gitignored data/history/dc-historic-results.json and the full git
 * history (it reads the polling-day forecast at 5e85c84).
 *
 * Usage: node scripts/fit-candidate-engine-2026-10-24.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { DISTRICT_TO_PARENT_COUNTY_2025 } from "../src/lib/county2025.js";
import { fitLocalToWestminsterRatio, MAJOR_PARTIES } from "../src/lib/localElectionTarget.js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT_DIR = path.join(ROOT, "data/calibration/candidate-2026-10-24");
export const CUTOFF = "2026-04-25";
const BY_FROM = "2025-05-01"; // exclusive: the day after the May 2025 elections onwards
const POLLING_DAY_COMMIT = "5e85c84";
const FORECAST = "data/predictions/may-2026/local-and-mayor.json";
const MIN_BYELECTIONS = 5;

// 7 May 2026 values, from src/lib/reformRealignmentUplift.js at 5e85c84.
export const MULTIPLIERS_7_MAY = { northern_unitary: 1.0, london: 0.5, metropolitan: 0.75, county_district: 1.0, other: 0.85 };
// The 2025 Westminster context the engine used at 5e85c84 (UK_WESTMINSTER_2025_MAY_AVERAGE).
// It is a hand-set cross-pollster average with no named source; the poll series
// in data/polling/timeseries.json has no polls between February 2025 and January 2026.
const POLL_MAY_2025 = { "Reform UK": 0.255, "Labour": 0.245, "Conservative": 0.220, "Liberal Democrats": 0.135, "Green Party": 0.085 };
// GE2024 UK result as the engine held it at 5e85c84 (snapshot.input_ge2024_baseline).
const GE24_NATIONAL = { "Labour": 0.337, "Conservative": 0.236, "Reform UK": 0.143, "Liberal Democrats": 0.122, "Green Party": 0.069 };

export const LONDON = new Set(["barking-and-dagenham", "barnet", "bexley", "brent", "bromley", "camden", "city-of-london", "croydon", "ealing", "enfield", "greenwich", "hackney", "hammersmith-and-fulham", "haringey", "harrow", "havering", "hillingdon", "hounslow", "islington", "kensington-and-chelsea", "kingston-upon-thames", "lambeth", "lewisham", "merton", "newham", "redbridge", "richmond-upon-thames", "southwark", "sutton", "tower-hamlets", "waltham-forest", "wandsworth", "westminster"]);
export const METROPOLITAN = new Set(["barnsley", "birmingham", "bolton", "bradford", "bury", "calderdale", "coventry", "doncaster", "dudley", "gateshead", "kirklees", "knowsley", "leeds", "liverpool", "manchester", "newcastle-upon-tyne", "north-tyneside", "oldham", "rochdale", "rotherham", "salford", "sandwell", "sefton", "sheffield", "solihull", "south-tyneside", "st-helens", "stockport", "sunderland", "tameside", "trafford", "wakefield", "walsall", "wigan", "wirral", "wolverhampton"]);
export const NORTHERN_UNITARY = new Set(["blackburn-with-darwen", "blackpool", "kingston-upon-hull", "north-east-lincolnshire", "north-lincolnshire", "redcar-and-cleveland", "middlesbrough", "stockton-on-tees", "darlington", "hartlepool", "york", "east-riding-of-yorkshire", "stoke-on-trent", "derby", "nottingham", "leicester", "telford-and-wrekin", "halton", "warrington"]);
const NON_ENGLISH = new Set(["blaenau-gwent", "bridgend", "caerphilly", "cardiff", "carmarthenshire", "ceredigion", "conwy", "denbighshire", "flintshire", "gwynedd", "isle-of-anglesey", "merthyr-tydfil", "monmouthshire", "neath-port-talbot", "newport", "pembrokeshire", "powys", "rhondda-cynon-taf", "swansea", "the-vale-of-glamorgan", "torfaen", "wrexham", "aberdeen", "aberdeenshire", "angus", "argyll-and-bute", "clackmannanshire", "dumfries-and-galloway", "dundee", "east-ayrshire", "east-dunbartonshire", "east-lothian", "east-renfrewshire", "edinburgh", "eilean-siar", "falkirk", "fife", "glasgow", "highland", "inverclyde", "midlothian", "moray", "north-ayrshire", "north-lanarkshire", "orkney-islands", "perth-and-kinross", "renfrewshire", "scottish-borders", "shetland-islands", "south-ayrshire", "south-lanarkshire", "stirling", "west-dunbartonshire", "west-lothian"]);

// The tier as the 7 May Step 9b saw it.
export function upliftTier(slug) {
  if (NORTHERN_UNITARY.has(slug)) return "northern_unitary";
  if (LONDON.has(slug)) return "london";
  if (METROPOLITAN.has(slug)) return "metropolitan";
  if (DISTRICT_TO_PARENT_COUNTY_2025[slug]) return "county_district";
  return "other";
}

function readJson(rel) { return JSON.parse(readFileSync(path.join(ROOT, rel), "utf8")); }

// Refuse to fit on anything polled after the cut-off: the guard the protocol relies on.
export function assertBeforeCutoff(rows, what) {
  const late = rows.filter((r) => (r.election_date || r.date) > CUTOFF);
  if (late.length) throw new Error(`${what}: ${late.length} rows dated after ${CUTOFF}; the hold-out forbids them`);
}

export function fitUpliftMultipliers(history, forecast) {
  const voted2025 = new Set(history.results.filter((r) => r.election_date === "2025-05-01" && !r.is_by_election && r.tier === "local").map((r) => r.council_slug));
  const anchored = (s) => voted2025.has(s) || Boolean(DISTRICT_TO_PARENT_COUNTY_2025[s]);
  const byelections = history.results.filter((r) => r.is_by_election && r.tier === "local" && r.election_date > BY_FROM && r.election_date <= CUTOFF);
  assertBeforeCutoff(byelections, "by-elections");
  const perTier = {};
  for (const r of byelections) {
    const s = r.council_slug;
    if (NON_ENGLISH.has(s) || anchored(s)) continue;
    const total = (r.candidates || []).reduce((a, c) => a + (c.votes || 0), 0);
    if (!total) continue;
    const reform = r.candidates.filter((c) => /reform/i.test(c.party_name || "")).reduce((a, c) => a + (c.votes || 0), 0);
    (perTier[upliftTier(s)] ||= { shares: [], councils: new Set() }).shares.push(reform / total);
    perTier[upliftTier(s)].councils.add(s);
  }
  const baseTargets = {};
  for (const [id, e] of Object.entries(forecast.predictions)) {
    const m = (e.methodology || []).find((x) => x.step === "Final-B3");
    if (!m) continue;
    const t = Number(m.description.match(/base target ([0-9.]+)%/)[1]) / 100;
    (baseTargets[upliftTier(id.split(".")[1])] ||= []).push(t);
  }
  const tiers = {};
  for (const tier of Object.keys(MULTIPLIERS_7_MAY)) {
    const b = perTier[tier]?.shares || [];
    const t = baseTargets[tier] || [];
    const meanReform = b.length ? b.reduce((a, x) => a + x, 0) / b.length : null;
    const meanTarget = t.length ? t.reduce((a, x) => a + x, 0) / t.length : null;
    const fitted = b.length >= MIN_BYELECTIONS && meanTarget ? Number((meanReform / meanTarget).toFixed(3)) : null;
    tiers[tier] = {
      multiplier: fitted ?? MULTIPLIERS_7_MAY[tier],
      was_7_may: MULTIPLIERS_7_MAY[tier],
      fitted: fitted != null,
      byelections: b.length,
      councils: [...(perTier[tier]?.councils || [])].sort(),
      mean_reform_byelection_share: meanReform,
      wards_2026_lifted: t.length,
      mean_base_target: meanTarget,
      note: fitted != null ? "Reform mean by-election share over mean Step 9b base target" : `fewer than ${MIN_BYELECTIONS} by-elections, or no lifted wards; 7 May value kept`,
    };
  }
  return tiers;
}

export function pollsToCutoff(timeseries) {
  const series = timeseries.uke_average.filter((x) => x.date <= CUTOFF);
  const last = series[series.length - 1];
  const polls = timeseries.polls.filter((p) => p.date <= CUTOFF && p.date > shiftDays(last.date, -timeseries.window_days));
  return { date: last.date, shares: last.shares, polls_in_window: last.polls_in_window, polls: polls.map((p) => `${p.date} ${p.pollster}`) };
}

function shiftDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function main() {
  const history = readJson("data/history/dc-historic-results.json");
  const forecast = JSON.parse(execFileSync("git", ["show", `${POLLING_DAY_COMMIT}:${FORECAST}`], { cwd: ROOT, maxBuffer: 256 * 1024 * 1024 }).toString("utf8"));
  const timeseries = readJson("data/polling/timeseries.json");
  mkdirSync(OUT_DIR, { recursive: true });

  const tiers = fitUpliftMultipliers(history, forecast);
  writeFileSync(path.join(OUT_DIR, "reform-regional-multiplier.json"), JSON.stringify({
    snapshot: {
      fitted_by: "scripts/fit-candidate-engine-2026-10-24.mjs",
      fitted_on: `council by-elections after ${BY_FROM} and on or before ${CUTOFF}, English councils with no 2025 county anchor; base targets from the polling-day forecast (${POLLING_DAY_COMMIT})`,
      hold_out: "No May 2026 result is read. Scored on May 2026 by scripts/replay-may-2026-candidate.mjs.",
      protocol: "docs/local-engine-holdout-2026-10-24.md",
      caveat: "By-elections are not a random sample of wards, and a council's by-election wards are not its 2026 wards; this is a tier-level average.",
    },
    tiers,
  }, null, 2) + "\n");

  const fit = fitLocalToWestminsterRatio(history, { poll: POLL_MAY_2025, ge24National: GE24_NATIONAL });
  const polls = pollsToCutoff(timeseries);
  writeFileSync(path.join(OUT_DIR, "local-national-ratio.json"), JSON.stringify({
    snapshot: {
      fitted_by: "scripts/fit-candidate-engine-2026-10-24.mjs",
      fitted_on: "May 2025 county and unitary elections (data/history/dc-historic-results.json, election_date 2025-05-01)",
      westminster_poll_may_2025: { shares: POLL_MAY_2025, source: "UK_WESTMINSTER_2025_MAY_AVERAGE in src/lib/nationalPolling.js at 5e85c84: a hand-set cross-pollster average, no named source" },
      ge2024_national: GE24_NATIONAL,
      protocol: "docs/local-engine-holdout-2026-10-24.md",
      caveat: "County GE2024 shares come from constituency-name matching, so some counties rest on a few constituencies (Lincolnshire on 3, Oxfordshire on 2); four councils had no match and are left out.",
    },
    ratio: Object.fromEntries(MAJOR_PARTIES.map((p) => [p, Number(fit.ratio[p].toFixed(4))])),
    councils: fit.councils,
    polls_to_cutoff: { ...polls, source: "data/polling/timeseries.json uke_average (trailing 14-day mean of every GB poll in the Wikipedia table), last value dated on or before the cut-off" },
    calibration_strength: 0.65,
  }, null, 2) + "\n");

  console.log("C1 multipliers:", JSON.stringify(Object.fromEntries(Object.entries(tiers).map(([t, v]) => [t, v.multiplier]))));
  console.log("C2 ratio:", JSON.stringify(Object.fromEntries(MAJOR_PARTIES.map((p) => [p, Number(fit.ratio[p].toFixed(3))]))));
  console.log(`Polls to ${polls.date}: ${polls.polls_in_window} in window`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main();
