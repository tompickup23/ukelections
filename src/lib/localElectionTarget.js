/**
 * localElectionTarget.js: the candidate engine of 24 October 2026 (C2).
 *
 * The national-share calibration (Final-C in run-bulk-predictions.mjs) pulls
 * the aggregate of the wards being forecast towards the Westminster poll. That
 * compares two different things: the wards voting in a given May are not a
 * national sample (May 2026 was London- and metropolitan-heavy), and parties do
 * not poll the same in a council election as in a Westminster poll (in May 2025
 * Labour ran a third below its Westminster-implied share and Greens above it).
 *
 * This aims Final-C at a local-election target for the councils actually
 * voting instead:
 *
 *   target_p = r_p × Σ_w v_w × GE24_c(w),p × poll_p / GE24_nat,p  /  Σ_w v_w
 *
 * where c(w) is the ward's council, v_w its expected votes, and r_p the ratio of
 * each party's May 2025 county-election share to its Westminster-implied share
 * in the same counties. The five major parties' targets are then scaled to
 * leave room for the forecast's own non-major share.
 *
 * Pure functions; the fitter is scripts/fit-candidate-engine-2026-10-24.mjs.
 * See docs/local-engine-holdout-2026-10-24.md.
 */
import { ge2024ForCouncil } from "./councilGe2024.js";
import { DISTRICT_TO_PARENT_COUNTY_2025 } from "./county2025.js";

export const MAJOR_PARTIES = ["Reform UK", "Labour", "Conservative", "Liberal Democrats", "Green Party"];

export function canonicalMajor(name) {
  const n = String(name || "");
  if (/^Labour/i.test(n)) return "Labour";
  if (/^Conservative/i.test(n)) return "Conservative";
  if (/^Liberal Democrat/i.test(n)) return "Liberal Democrats";
  if (/^Reform UK/i.test(n)) return "Reform UK";
  if (/^Green Party|^Scottish Green|^Green$/i.test(n)) return "Green Party";
  return "Other";
}

function canonShares(shares) {
  const out = {};
  for (const [p, v] of Object.entries(shares || {})) {
    const k = canonicalMajor(p);
    out[k] = (out[k] || 0) + v;
  }
  return out;
}

/**
 * GE2024 shares for a council's area: its own constituency match, else (for an
 * upper-tier county) the union of the constituencies matched by its districts.
 * null when neither matches; callers then fall back to the national result.
 */
export function ge2024ForArea(history, councilSlug) {
  const own = ge2024ForCouncil(history, councilSlug);
  if (own) return { shares: canonShares(own.shares), via: "own" };
  const districts = Object.entries(DISTRICT_TO_PARENT_COUNTY_2025).filter(([, c]) => c === councilSlug).map(([d]) => d);
  const ids = new Set();
  for (const d of districts) {
    const g = ge2024ForCouncil(history, d);
    if (g) for (const id of g.constituencies) ids.add(id);
  }
  const votes = {};
  let total = 0;
  for (const id of ids) {
    const r = history.by_ballot?.[id] || (history.results || []).find((x) => x.ballot_paper_id === id);
    for (const c of r?.candidates || []) {
      const k = canonicalMajor(c.party_name);
      votes[k] = (votes[k] || 0) + (c.votes || 0);
      total += c.votes || 0;
    }
  }
  if (!total) return null;
  return { shares: Object.fromEntries(Object.entries(votes).map(([p, v]) => [p, v / total])), via: `${districts.length} districts, ${ids.size} constituencies` };
}

/**
 * r_p: each party's share in the May 2025 county and unitary elections over its
 * Westminster-implied share in the same areas (GE2024 area share carried by the
 * May 2025 poll over GE2024 nationally), vote-weighted across councils.
 */
export function fitLocalToWestminsterRatio(history, { electionDate = "2025-05-01", poll, ge24National }) {
  const byCouncil = {};
  for (const r of history.results || []) {
    if (r.election_date !== electionDate || r.is_by_election || r.tier !== "local") continue;
    const o = (byCouncil[r.council_slug] ||= { votes: {}, total: 0, contests: 0 });
    o.contests += 1;
    for (const c of r.candidates || []) {
      const k = canonicalMajor(c.party_name);
      o.votes[k] = (o.votes[k] || 0) + (c.votes || 0);
      o.total += c.votes || 0;
    }
  }
  const num = {};
  const den = {};
  const councils = [];
  for (const [slug, o] of Object.entries(byCouncil)) {
    if (!o.total) continue;
    const g = ge2024ForArea(history, slug);
    if (!g) { councils.push({ council: slug, contests: o.contests, used: false, reason: "no GE2024 constituency match" }); continue; }
    for (const p of MAJOR_PARTIES) {
      num[p] = (num[p] || 0) + (o.votes[p] || 0);
      den[p] = (den[p] || 0) + o.total * (g.shares[p] || 0) * poll[p] / ge24National[p];
    }
    councils.push({ council: slug, contests: o.contests, used: true, ge2024_via: g.via });
  }
  const ratio = Object.fromEntries(MAJOR_PARTIES.map((p) => [p, num[p] / den[p]]));
  return { ratio, councils };
}

/**
 * Final-C targets for a set of wards. `wards` is an array of
 * { council_slug, votes, shares } where shares are the forecast before Final-C.
 * `areaShares(slug)` returns GE2024 area shares or null. Parties other than the
 * five majors keep their poll value as the target, as before.
 */
export function localElectionTargets(wards, { poll, ge24National, ratio, areaShares }) {
  let total = 0;
  let nonMajor = 0;
  const implied = {};
  const cache = new Map();
  for (const w of wards) {
    if (!w.votes) continue;
    if (!cache.has(w.council_slug)) cache.set(w.council_slug, areaShares(w.council_slug));
    const g = cache.get(w.council_slug);
    for (const p of MAJOR_PARTIES) {
      implied[p] = (implied[p] || 0) + w.votes * (g ? (g[p] || 0) * poll[p] / ge24National[p] : poll[p]);
    }
    for (const [p, v] of Object.entries(w.shares)) if (!MAJOR_PARTIES.includes(p)) nonMajor += w.votes * v;
    total += w.votes;
  }
  const raw = Object.fromEntries(MAJOR_PARTIES.map((p) => [p, ratio[p] * implied[p] / total]));
  const rawSum = MAJOR_PARTIES.reduce((s, p) => s + raw[p], 0);
  const room = 1 - nonMajor / total;
  return { ...poll, ...Object.fromEntries(MAJOR_PARTIES.map((p) => [p, (raw[p] * room) / rawSum])) };
}
