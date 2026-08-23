#!/usr/bin/env node
// build-local-byelections.mjs
//
// One page per council by-election. Builds a contest file for every scheduled
// local by-election, projects the ones with a solid baseline, and grades the
// ones that have already polled.
//
//   node scripts/build-local-byelections.mjs                 # upcoming + recent
//   node scripts/build-local-byelections.mjs --from=2026-08-01
//   node scripts/build-local-byelections.mjs --keep-days=120 # regrade further back
//   node scripts/build-local-byelections.mjs --offline       # rebuild from cache
//
// Inputs
//   Democracy Club EveryElection  scheduled ballots, ward GSS, divisionset,
//                                 voting system, vacancy reason
//   Democracy Club candidates API nomination papers: who is standing, and
//                                 whether the field is locked
//   data/history/dc-historic-results.json   prior ordinary results by ward slug
//   data/history/byelection-appends.json    the weekly sweep's tracked sidecar
//   data/history/leap-history.json          prior ordinary results by ward GSS
//
// Output
//   data/contests/local-byelections/<council>-<ward>-<date>.json
//   data/contests/local-byelections/_meta.json   corpus, swing, back-test
//
// The projection method and its limits are documented in
// scripts/lib/local-byelection-model.mjs. Contests that fail the baseline test
// still get a file and a page: they carry the structure and the reason there is
// no number, which is the Clacton precedent.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import {
  PARTIES,
  baselineEra,
  canonParty,
  sharesFromCandidates,
  fieldFromCandidates,
  buildSwingCorpus,
  estimateSwing,
  projectContest,
  runDraws,
  backtest,
  assessBaseline,
  SIGMA_INFLATION,
} from "./lib/local-byelection-model.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const p = (rel) => path.join(ROOT, rel);
const OUT_DIR = p("data/contests/local-byelections");
const CACHE_DIR = p(".cache/local-byelections");

const EE = "https://elections.democracyclub.org.uk/api/elections/";
const DC = "https://candidates.democracyclub.org.uk/api/next/ballots/";
const UA = "ukelections.co.uk contest builder (tompickup23)";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  }),
);
const OFFLINE = Boolean(args.offline);
const KEEP_DAYS = Number(args["keep-days"] ?? 90);
const PACE_MS = Number(args.pace ?? 400);
const today = new Date().toISOString().slice(0, 10);
const from = args.from || isoShift(today, -KEEP_DAYS);
// By-elections are usually called five to seven weeks out, so this reaches
// past the furthest thing anyone has scheduled.
const FUTURE_HORIZON_DAYS = Number(args["horizon-days"] ?? 180);
// A polling day this far back will not gain new ballots, so its list is cached
// permanently. Results still come from the separate candidates call.
const SETTLED_AFTER_DAYS = 21;

function daysAgo(iso) {
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${iso}T00:00:00Z`)) / 86400000);
}

function isoShift(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Requests that did not get an answer, as opposed to answering "nothing here".
// Reported at the end because a run that quietly degrades is the failure mode
// this whole pipeline keeps hitting.
const transientFailures = [];
const readJson = (rel) => JSON.parse(readFileSync(p(rel), "utf8"));

// ---------------------------------------------------------------------------
// Fetching, with a cache that expires. A cache with no expiry is how the
// by-election feed sat frozen at 23 April 2026 for four months while every
// timestamp on it looked fresh, so this one is keyed by day.
// ---------------------------------------------------------------------------

// Democracy Club rate-limits a sweep of this length. Backing off after a 429
// costs seconds; spacing requests costs milliseconds, so every uncached request
// goes through one global throttle rather than each caller pacing itself.
const MIN_REQUEST_GAP_MS = Number(args["gap-ms"] ?? 900);
let lastRequestAt = 0;
async function throttle() {
  const wait = lastRequestAt + MIN_REQUEST_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

async function getJson(url, cacheKey, { permanent = false, cacheMisses = false } = {}) {
  const cacheFile = cacheKey ? path.join(CACHE_DIR, `${permanent ? "settled" : today}-${cacheKey}.json`) : null;
  if (cacheFile && existsSync(cacheFile)) {
    const hit = JSON.parse(readFileSync(cacheFile, "utf8"));
    if (hit && hit.__miss) throw new Error(`cached miss: ${url}`);
    return hit;
  }
  if (OFFLINE) throw new Error(`offline and not cached: ${url}`);
  for (let attempt = 0; attempt < 5; attempt++) {
    await throttle();
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (res.ok) {
      const json = await res.json();
      if (cacheFile) {
        mkdirSync(CACHE_DIR, { recursive: true });
        writeFileSync(cacheFile, JSON.stringify(json));
      }
      return json;
    }
    if (res.status === 429 || res.status >= 500) {
      await sleep(1500 * 2 ** attempt);
      continue;
    }
    // A probe for a ward contest that never happened is a normal answer, not a
    // failure, so record it and stop asking on every run.
    if (cacheMisses && cacheFile && res.status === 404) {
      mkdirSync(CACHE_DIR, { recursive: true });
      writeFileSync(cacheFile, JSON.stringify({ __miss: true, status: 404 }));
    }
    throw new Error(`${res.status} ${url}`);
  }
  throw new Error(`gave up after retries: ${url}`);
}

async function fetchScheduledBallots() {
  // Swept one polling day at a time, NOT by paging a date-range query.
  //
  // EveryElection's range pagination silently drops rows: asking for the 276
  // elections from 25 May 2026 onward and walking `next` to the end returns
  // 256 distinct ids, and adding `ordering=poll_open_date` makes it worse, at
  // 226. Twenty scheduled contests simply never appear, and nothing in the
  // response says so. `limit` is capped at 100 whatever you ask for. A per-day
  // query fits in one page, which is why the weekly sweep in
  // refresh-byelections.mjs works the same way.
  const horizonEnd = isoShift(today, FUTURE_HORIZON_DAYS);
  const days = [];
  for (let d = from; d <= horizonEnd; d = isoShift(d, 1)) days.push(d);

  const byId = new Map();
  let short = 0;
  for (const date of days) {
    // The ballot list for a day well in the past is settled, so it is cached
    // permanently. Recent and future days expire with the daily cache key.
    const settled = daysAgo(date) > SETTLED_AFTER_DAYS;
    let d;
    try {
      d = await getJson(`${EE}?poll_open_date=${date}&limit=100`, `day-${date}`, { permanent: settled });
    } catch (e) {
      console.warn(`  day sweep failed for ${date}: ${e.message}`);
      continue;
    }
    const rows = d.results || [];
    // If a single day carries more than one page we are back in the lossy
    // regime, so say so rather than quietly under-reporting that day.
    if (d.next) {
      short += 1;
      console.warn(`  ${date}: more than 100 elections in one day, contests may be missed`);
    }
    for (const r of rows) {
      if (!/^local\..+\.by\.\d{4}-\d{2}-\d{2}$/.test(r.election_id || "")) continue;
      if (r.group_type || r.cancelled || r.deleted) continue;
      if (!byId.has(r.election_id)) byId.set(r.election_id, r);
    }
  }
  if (short) console.warn(`  ${short} day(s) exceeded one page`);
  console.log(`  swept ${days.length} polling days from ${from} to ${horizonEnd}`);
  return [...byId.values()];
}

// ---------------------------------------------------------------------------
// Prior ordinary results
// ---------------------------------------------------------------------------

function loadHistory() {
  const rows = [];
  // The big DC history file is gitignored and regenerated on the server. A
  // fresh clone has the tracked sidecar only, which is enough to build the
  // corpus but not the ward baselines, so its absence is reported, not fatal.
  if (existsSync(p("data/history/dc-historic-results.json"))) {
    rows.push(...readJson("data/history/dc-historic-results.json").results);
  } else {
    console.warn("  note: data/history/dc-historic-results.json absent, ward baselines will be LEAP-only");
  }
  const seen = new Set(rows.map((r) => r.ballot_paper_id));
  for (const r of readJson("data/history/byelection-appends.json").results) {
    if (!seen.has(r.ballot_paper_id)) rows.push(r);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Ward demographics
// ---------------------------------------------------------------------------

// The fields worth putting in front of a reader: the ones the model itself
// leans on, plus the tenure and age split that decides who turns out for a
// by-election. Each is shown against the median ward so the number means
// something without a reader knowing the national distribution.
const DEMO_FIELDS = [
  ["no_quals_pct", "No qualifications"],
  ["degree_pct", "Degree or above"],
  ["white_british_pct", "White British"],
  ["muslim_pct", "Muslim"],
  ["owned_outright_pct", "Owned outright"],
  ["social_rented_pct", "Social rented"],
  ["private_rented_pct", "Private rented"],
  ["retired_pct", "Retired"],
  ["avg_imd_decile", "Deprivation decile"],
];

/**
 * Who held the seat. Hand verified, never derived, and absent by default.
 * See data/contests/local-byelection-holders.json for why deriving it is wrong.
 */
function loadHolders() {
  const file = p("data/contests/local-byelection-holders.json");
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, "utf8")).holders || {};
}

function loadWardDemographics() {
  const file = p("data/features/ward-demographics-2021.json");
  if (!existsSync(file)) return { wards: {}, medians: {} };
  const wards = JSON.parse(readFileSync(file, "utf8")).wards || {};
  const medians = {};
  for (const [key] of DEMO_FIELDS) {
    const xs = Object.values(wards)
      .map((w) => w[key])
      .filter((v) => typeof v === "number")
      .sort((a, b) => a - b);
    if (xs.length) medians[key] = xs[xs.length >> 1];
  }
  return { wards, medians };
}

function wardProfile(demo, gss) {
  const w = gss ? demo.wards[gss] : null;
  if (!w) return null;
  return {
    gss,
    ward_name: w.ward_name ?? null,
    total_residents: w.total_residents ?? null,
    source: "ONS Census 2021 (LSOA aggregation) plus IMD 2019",
    fields: DEMO_FIELDS.filter(([k]) => typeof w[k] === "number").map(([key, label]) => ({
      key,
      label,
      value: w[key],
      median: demo.medians[key] ?? null,
      is_decile: key === "avg_imd_decile",
    })),
  };
}

function buildPriorIndex(history) {
  const ordinaryBySlug = new Map();
  const byelectionRows = [];
  for (const r of history) {
    if (r.tier !== "local" && r.tier !== undefined) continue;
    if (r.is_by_election) {
      byelectionRows.push(r);
      continue;
    }
    const key = `${r.council_slug}/${r.ward_slug}`;
    if (!ordinaryBySlug.has(key)) ordinaryBySlug.set(key, []);
    ordinaryBySlug.get(key).push(r);
  }
  for (const list of ordinaryBySlug.values()) list.sort((a, b) => a.election_date.localeCompare(b.election_date));

  const leap = existsSync(p("data/history/leap-history.json")) ? readJson("data/history/leap-history.json").by_gss : {};

  /** Most recent ordinary contest in this ward strictly before `before`. */
  function find({ council_slug, ward_slug, gss, before }) {
    const slugRows = (ordinaryBySlug.get(`${council_slug}/${ward_slug}`) || []).filter((r) => r.election_date < before);
    const leapRows = (leap[gss] || [])
      .filter((r) => r.date < before)
      .map((r) => ({
        election_date: r.date,
        seats_contested: r.seats_contested ?? null,
        turnout_votes: r.turnout_votes ?? null,
        electorate: r.electorate ?? null,
        candidates: (r.candidates || []).map((c) => ({ name: c.name || null, party_name: c.party, votes: c.votes })),
        source_label: "Local Elections Archive Project (Andrew Teale), CC BY-SA 3.0",
        source: "https://www.andrewteale.me.uk/leap/",
      }));
    const all = [...slugRows, ...leapRows].sort((a, b) => a.election_date.localeCompare(b.election_date));
    const best = all.at(-1);
    if (!best) return null;
    return {
      ...best,
      source_label: best.source_label || "Democracy Club",
      source: best.source || null,
    };
  }

  return { find, byelectionRows, ordinaryCount: ordinaryBySlug.size };
}

// ---------------------------------------------------------------------------
// Baseline of last resort
// ---------------------------------------------------------------------------

// Ordinary local polling days. Democracy Club holds ward results the two local
// archives here do not, and it answers on a predictable ballot id, so where the
// archives have nothing (or nothing recent) these are probed directly. Newest
// first, stopping at the first full result better than what we already hold.
const ORDINARY_DATES = ["2026-05-07", "2025-05-01", "2024-05-02", "2023-05-04", "2022-05-05", "2021-05-06"];

async function fetchPriorFromDc(council_slug, ward_slug, before, haveDate) {
  for (const date of ORDINARY_DATES) {
    if (date >= before) continue;
    if (haveDate && date <= haveDate) break; // the archive already has this or better
    const id = `local.${council_slug}.${ward_slug}.${date}`;
    let b;
    try {
      b = await getJson(`${DC}${id}/`, `prior-${id}`, { permanent: true, cacheMisses: true });
    } catch (e) {
      // A 404 means the contest never happened and is cached as such. Anything
      // else means we simply did not get an answer, which must not be recorded
      // as "this ward has no history".
      if (!/^cached miss|^404 /.test(e.message)) {
        transientFailures.push({ id, what: "prior", message: e.message });
      }
      continue;
    }
    const cands = b.candidacies || [];
    const withVotes = cands.filter((c) => Number.isFinite(Number(c.result?.num_ballots)));
    if (!cands.length || withVotes.length !== cands.length) continue;
    return {
      election_date: date,
      seats_contested: b.seats_contested ?? null,
      candidates: cands.map((c) => ({
        name: c.person?.name ?? null,
        party_name: c.party_name ?? c.party?.name ?? null,
        votes: Number(c.result.num_ballots),
      })),
      source_label: "Democracy Club",
      source: `https://candidates.democracyclub.org.uk/elections/${id}/`,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Contest assembly
// ---------------------------------------------------------------------------

const REASON_TEXT = {
  RESIGNATION: "the sitting councillor resigned",
  DEATH: "the sitting councillor died",
  DISQUALIFICATION: "the sitting councillor was disqualified",
  ELECTED_SCOTTISH_PARLIAMENT: "the sitting councillor was elected to the Scottish Parliament",
  ELECTED_SENEDD: "the sitting councillor was elected to the Senedd",
  ELECTED_PARLIAMENT: "the sitting councillor was elected to the House of Commons",
  ELECTED_STRATEGIC_AUTHORITY_MAYOR: "the sitting councillor was elected a strategic authority mayor",
  ELECTED_MAYOR: "the sitting councillor was elected mayor",
  FAILURE_TO_ATTEND: "the sitting councillor ceased to be a member through failure to attend",
};

function slugFor(id) {
  const m = id.match(/^local\.([^.]+)\.(.+)\.by\.(\d{4}-\d{2}-\d{2})$/);
  return m ? { council_slug: m[1], ward_slug: m[2], date: m[3], slug: `${m[1]}-${m[2]}-${m[3]}` } : null;
}

/**
 * Everything that needs the network: the ballot record, who is standing, and
 * the ward's prior ordinary result. Kept separate from the projection so that
 * results declared since the last archive refresh can be folded into the swing
 * corpus BEFORE anything is projected off it.
 */
async function gather(ballot, priors) {
  const ids = slugFor(ballot.election_id);
  if (!ids) return null;
  const division = ballot.division || {};
  const gss = String(division.official_identifier || "").replace(/^gss:/, "");
  const votingSystem = ballot.voting_system?.slug || null;

  let dc = null;
  let fieldUnavailable = false;
  // A contest that has polled and declared a full result never changes again,
  // so once we have one it is cached permanently. Without this every nightly
  // run re-fetches all ~120 contests; with it, only the live ones move.
  const settledKey = `settled-dc-${ballot.election_id}`;
  const settledFile = path.join(CACHE_DIR, `${settledKey}.json`);
  try {
    dc = existsSync(settledFile)
      ? JSON.parse(readFileSync(settledFile, "utf8"))
      : await getJson(`${DC}${ballot.election_id}/`, `dc-${ballot.election_id}`);
  } catch (e) {
    // A rate-limited fetch is NOT an empty ballot paper. Recorded as unknown
    // so the run reports it and the next one retries, rather than publishing
    // "fewer than two parties on the ballot" for a six-candidate contest.
    fieldUnavailable = true;
    transientFailures.push({ id: ballot.election_id, what: "candidates", message: e.message });
  }
  const candidacies = dc?.candidacies || [];
  const candidates = candidacies.map((c) => ({
    name: c.person?.name ?? null,
    party_name: c.party_name ?? c.party?.name ?? null,
    party: canonParty(c.party_name ?? c.party?.name),
    votes: Number.isFinite(Number(c.result?.num_ballots)) ? Number(c.result.num_ballots) : null,
    elected: c.result?.elected ?? null,
  }));
  const field = fieldFromCandidates(candidates);

  // Promote to the permanent cache once the result is complete and the poll is
  // comfortably past, so a late correction still has a window to land.
  const declared = candidates.length > 0 && candidates.every((c) => c.votes !== null);
  if (dc && declared && daysAgo(ids.date) > SETTLED_AFTER_DAYS && !existsSync(settledFile)) {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(settledFile, JSON.stringify(dc));
  }

  let prior = priors.find({
    council_slug: ids.council_slug,
    ward_slug: ids.ward_slug,
    gss,
    before: ids.date,
  });
  // The two local archives miss whole councils (Dover has no rows at all) and
  // lag the most recent ordinary round, so ask Democracy Club directly for
  // anything better than what they hold.
  const fromDc = await fetchPriorFromDc(ids.council_slug, ids.ward_slug, ids.date, prior?.election_date ?? null);
  if (fromDc) prior = fromDc;

  // A boundary review invalidates the baseline. The divisionset start date is
  // the authoritative test: a prior contest fought before the current set began
  // was fought on different lines, whatever the ward is called now.
  const setStart = division.divisionset?.start_date || null;
  const boundaryChanged = Boolean(prior && setStart && prior.election_date < setStart);

  return { ballot, ids, division, gss, setStart, votingSystem, dc, candidates, field, prior, boundaryChanged, fieldUnavailable };
}

/** The pure half: assess, project, grade, and shape the contest file. */
function assemble(ctx, corpus, demo, holders) {
  const { ballot, ids, division, gss, setStart, votingSystem, dc, candidates, field, prior, boundaryChanged, fieldUnavailable } = ctx;

  const reformEntering =
    prior !== null && field.has("Reform UK")
      ? (sharesFromCandidates(prior.candidates)["Reform UK"] || 0) < 0.02
      : null;
  const era = prior ? baselineEra(prior.election_date) : null;
  const swing = estimateSwing(corpus, { asOf: ids.date, era, reformEntering });

  const baseline = assessBaseline({ prior, field, swing, votingSystem, boundaryChanged, fieldLocked: dc?.candidates_locked ?? false });
  if (fieldUnavailable) {
    baseline.forecastable = false;
    baseline.blockers = ["The candidate list could not be read from Democracy Club when this page was built, so we do not know who is standing."];
  }

  // Has it polled, and do we have the result?
  const polled = ids.date <= today;
  const declaredCandidates = candidates.filter((c) => c.votes !== null);
  const haveResult = declaredCandidates.length > 0 && declaredCandidates.length === candidates.length;

  let forecast = null;
  if (baseline.forecastable) {
    const base = sharesFromCandidates(prior.candidates);
    const projected = projectContest(base, field, swing);
    const draws = runDraws(projected.central, swing, ids.slug);
    forecast = {
      method: "ward_prior_plus_byelection_swing",
      method_label: `${prior.election_date} ward result plus measured by-election swing`,
      never_blended: true,
      baseline: {
        election_date: prior.election_date,
        seats_contested: prior.seats_contested,
        notional_single_seat: (prior.seats_contested ?? 1) > 1,
        shares: base,
        source_label: prior.source_label,
        source: prior.source,
      },
      swing: {
        stratum: swing.stratum,
        stratum_used: swing.stratum_used,
        contests_used: swing.n,
        window_days: swing.window_days,
        logodds_shifts: swing.shifts,
        ratio_at_25pct: swing.ratios,
        entry_shares: swing.entry,
        party_counts: swing.counts,
      },
      central: projected.central,
      win_probability: draws.win_probability,
      bands: draws.bands,
      winner: draws.winner,
      runner_up: draws.runner_up,
      margin_pp: draws.margin_pp,
      leader_probability: draws.leader_probability,
      too_close_to_call: draws.too_close_to_call,
      sigma_inflation: draws.sigma_inflation,
      caveats: projected.notes,
      unpriced_parties: projected.unpriced,
      cannot_see: [
        "Candidate quality and local name recognition, which decide more local by-elections than national swing does.",
        "Any ward-level campaign, and which parties actually knocked on doors.",
        "Turnout. Council by-elections routinely fall below a quarter of the electorate and small electorates move fast.",
      ],
    };
  }

  let result = null;
  if (haveResult) {
    const shares = sharesFromCandidates(candidates);
    const ordered = [...candidates].sort((a, b) => (b.votes || 0) - (a.votes || 0));
    const totalVotes = candidates.reduce((a, c) => a + (c.votes || 0), 0);
    const winnerParty = ordered[0] ? canonParty(ordered[0].party_name) : null;
    result = {
      declared: true,
      shares,
      winner_party: winnerParty,
      winner_candidate: ordered[0]?.name ?? null,
      runner_up_party: ordered[1] ? canonParty(ordered[1].party_name) : null,
      majority_votes: ordered.length > 1 ? (ordered[0].votes || 0) - (ordered[1].votes || 0) : null,
      total_votes: totalVotes,
      source: `https://candidates.democracyclub.org.uk/elections/${ballot.election_id}/`,
      outcome: holders[ballot.election_id]
        ? winnerParty === holders[ballot.election_id].party
          ? `${winnerParty} hold`
          : `${winnerParty} gain from ${holders[ballot.election_id].party}`
        : null,
      grading: forecast
        ? {
            projected_winner: forecast.winner,
            call_correct: forecast.winner === winnerParty,
            mae_pp:
              PARTIES.filter((q) => field.has(q)).reduce(
                (a, q) => a + Math.abs((forecast.central[q] || 0) - (shares[q] || 0)) * 100,
                0,
              ) / Math.max(1, [...field].length),
          }
        : null,
    };
  }

  const status = result ? "concluded" : polled ? "polls_closed" : "upcoming";

  return {
    schema_version: "1.0.0",
    generated_at: new Date().toISOString(),
    slug: ids.slug,
    status,
    contest: {
      ballot_paper_id: ballot.election_id,
      polling_day: ids.date,
      council_slug: ids.council_slug,
      council_name: ballot.organisation?.common_name || ids.council_slug,
      ward_name: division.name || ids.ward_slug,
      ward_slug: ids.ward_slug,
      ward_gss: gss || null,
      division_type: division.division_type || null,
      seats_contested: ballot.seats_contested ?? 1,
      seats_total: division.seats_total ?? null,
      territory: division.territory_code || null,
      voting_system: votingSystem,
      boundary_set_start: setStart,
      boundary_changed_since_prior: boundaryChanged,
      vacancy_reason_code: ballot.by_election_reason || null,
      vacancy_reason: REASON_TEXT[ballot.by_election_reason] || null,
      requires_voter_id: ballot.requires_voter_id ?? null,
      nominations_close: ballot.timetable?.close_of_nominations || null,
      registration_deadline: ballot.timetable?.registration_deadline || null,
      postal_vote_deadline: ballot.timetable?.postal_vote_application_deadline || null,
    },
    field: {
      candidate_count: candidates.length,
      locked: dc?.candidates_locked ?? false,
      sopn_published: Boolean(dc?.sopn),
      sopn_url: dc?.sopn?.uploaded_file || dc?.sopn?.source_url || null,
      parties: [...field].sort(),
      candidates,
    },
    previous_holder: holders[ballot.election_id]
      ? { ...holders[ballot.election_id], established: true }
      : {
          established: false,
          note: "We have not established which party held this seat. Local by-elections are usually reported as a gain or a hold, and we will not say which until the previous holder is verified: in a ward that returns several councillors the last ordinary result does not tell you.",
        },
    ward_profile: wardProfile(demo, gss),
    prior_result: prior
      ? {
          election_date: prior.election_date,
          seats_contested: prior.seats_contested,
          shares: sharesFromCandidates(prior.candidates),
          candidates: prior.candidates,
          source_label: prior.source_label,
          source: prior.source,
          usable_as_baseline: !boundaryChanged,
        }
      : null,
    forecast,
    no_forecast_reason: baseline.forecastable ? null : baseline.blockers,
    result,
    sources: [
      { label: "Democracy Club, EveryElection", url: `https://elections.democracyclub.org.uk/elections/${ballot.election_id}/` },
      { label: "Democracy Club, candidates", url: `https://candidates.democracyclub.org.uk/elections/${ballot.election_id}/` },
    ],
  };
}

// ---------------------------------------------------------------------------

async function main() {
  console.log(`Local by-election contests, ${from} onward`);
  const history = loadHistory();
  const priors = buildPriorIndex(history);
  console.log(`  history: ${history.length} rows, ${priors.ordinaryCount} wards with an ordinary result`);

  const holders = loadHolders();
  console.log(`  verified seat holders: ${Object.keys(holders).length}`);
  const demo = loadWardDemographics();
  console.log(`  ward demographics: ${Object.keys(demo.wards).length} wards`);

  const ballots = await fetchScheduledBallots();
  console.log(`  ${ballots.length} scheduled ballots`);

  // Pass one: everything that touches the network.
  const gathered = [];
  for (const b of ballots.sort((x, y) => x.poll_open_date.localeCompare(y.poll_open_date))) {
    const ctx = await gather(b, priors);
    if (ctx) gathered.push(ctx);
  }

  // Results declared since the archive was last refreshed are folded into the
  // corpus before anything is projected off it. The archive rebuild runs on the
  // server on its own schedule, so without this the model is systematically a
  // round or two behind the results it has already fetched and is displaying:
  // the corpus stopped at 13 August while the pages carried the 20 August round.
  const fresh = [];
  const known = new Set(priors.byelectionRows.map((r) => r.ballot_paper_id));
  for (const ctx of gathered) {
    if (known.has(ctx.ballot.election_id)) continue;
    if (ctx.votingSystem === "STV") continue;
    const withVotes = ctx.candidates.filter((c) => c.votes !== null);
    if (!ctx.candidates.length || withVotes.length !== ctx.candidates.length) continue;
    if (!ctx.prior || ctx.boundaryChanged) continue;
    fresh.push({
      ballot_paper_id: ctx.ballot.election_id,
      election_date: ctx.ids.date,
      tier: "local",
      council_slug: ctx.ids.council_slug,
      ward_slug: ctx.ids.ward_slug,
      is_by_election: true,
      candidates: ctx.candidates,
      _prior: ctx.prior,
    });
  }

  const corpus = buildSwingCorpus([...priors.byelectionRows, ...fresh], (row) =>
    row._prior ??
      priors.find({
        council_slug: row.council_slug,
        ward_slug: row.ward_slug,
        gss: null,
        before: row.election_date,
      }),
  );
  console.log(
    `  swing corpus: ${corpus.length} by-elections paired with a prior ward result` +
      (fresh.length ? `, including ${fresh.length} declared since the archive was last rebuilt` : ""),
  );
  console.log(`  newest contest in the corpus: ${corpus.at(-1)?.date ?? "none"}`);

  const bt = backtest(corpus);
  console.log(
    `  back-test, all time: n=${bt.n}, MAE ${bt.mae_pp === null ? "n/a" : bt.mae_pp.toFixed(2)}pp, winner ${bt.winner_called}/${bt.n}`,
  );
  console.log(
    `  back-test, since ${bt.recent_since}: n=${bt.recent.n}, MAE ${bt.recent.mae_pp?.toFixed(2)}pp, ` +
      `winner ${bt.recent.winner_called}/${bt.recent.n} (${(bt.recent.winner_called_pct * 100).toFixed(1)}%), ` +
      `excluding too-close ${bt.recent.confident_called}/${bt.recent.confident_n}`,
  );
  for (const b of bt.calibration) {
    console.log(`    said ${(b.from * 100).toFixed(0)}-${(b.to * 100).toFixed(0)}%: n=${b.n}, right ${(b.observed * 100).toFixed(0)}%`);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const written = new Set();
  let forecast = 0;
  for (const ctx of gathered) {
    const contest = assemble(ctx, corpus, demo, holders);
    if (!contest) continue;
    writeFileSync(path.join(OUT_DIR, `${contest.slug}.json`), `${JSON.stringify(contest, null, 2)}\n`);
    written.add(`${contest.slug}.json`);
    if (contest.forecast) forecast += 1;
    const tag = contest.forecast
      ? `${contest.forecast.winner} ${(contest.forecast.central[contest.forecast.winner] * 100).toFixed(1)}%`
      : `no forecast (${contest.no_forecast_reason.length})`;
    console.log(`  ${contest.contest.polling_day} ${contest.contest.council_name} / ${contest.contest.ward_name}: ${tag}`);
  }

  // Drop contests that have aged out of the window so the directory does not
  // grow without bound. Concluded contests older than the window keep their
  // page only if they are still inside KEEP_DAYS.
  for (const f of readdirSync(OUT_DIR)) {
    if (f.startsWith("_") || !f.endsWith(".json") || written.has(f)) continue;
    unlinkSync(path.join(OUT_DIR, f));
    console.log(`  removed aged-out contest ${f}`);
  }

  writeFileSync(
    path.join(OUT_DIR, "_meta.json"),
    `${JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        window_from: from,
        contests: written.size,
        forecast_count: forecast,
        corpus_size: corpus.length,
        corpus_newest: corpus.at(-1)?.date ?? null,
        corpus_oldest: corpus[0]?.date ?? null,
        backtest: {
          n: bt.n,
          mae_pp: bt.mae_pp,
          winner_called: bt.winner_called,
          winner_called_pct: bt.winner_called_pct,
          reform_bias_pp: bt.reform_bias_pp,
          reform_n: bt.reform_n,
          recent_since: bt.recent_since,
          recent: bt.recent,
        },
        calibration_table: bt.calibration,
        party_accuracy: bt.party_accuracy,
        sigma_inflation: SIGMA_INFLATION,
        method_note:
          "One method, never blended: the ward's own last ordinary result moved by the median swing measured across recent council by-elections that we hold a paired prior result for. Contests without a like-for-like baseline get no number.",
      },
      null,
      2,
    )}\n`,
  );
  console.log(`  wrote ${written.size} contests, ${forecast} with a projection`);
  if (transientFailures.length) {
    console.warn(`\n  ${transientFailures.length} request(s) got no answer and were NOT recorded as absence:`);
    for (const t of transientFailures) console.warn(`    ${t.what}: ${t.id}`);
    console.warn("  Re-run to pick them up. Failures are deliberately not cached.");
    process.exitCode = 2;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
