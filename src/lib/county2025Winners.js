/**
 * county2025Winners.js — cross-tier candidate-continuity detection.
 *
 * For each 2025 county-cycle winner (LCC, Kent CC, Hants CC, etc.), record
 * the candidate name + party + votes. When a 2026 borough candidate has the
 * same surname AND party AND is standing in a borough ward whose parent
 * county had 2025 elections, treat them as a sitting county councillor and
 * apply a personal-vote bonus.
 *
 * Specific case Tom flagged: Mark Poulton (Reform UK) won Burnley Rural
 * LCC division in May 2025 with 1,798 votes. He's standing for Reform UK
 * in Briercliffe (one of the 3 wards covered by Burnley Rural). Without
 * this module, he gets no continuity bonus.
 *
 * Pure functions.
 */

import { DISTRICT_TO_PARENT_COUNTY_2025 } from "./county2025.js";
import { lancashireLcc2025ForWard } from "./lancashireLcc2025.js";

function dcPartyToCanonical(name) {
  if (!name) return "Unknown";
  const p = String(name).trim();
  if (/^Labour Party$/i.test(p)) return "Labour";
  if (/^Labour and Co-operative Party$/i.test(p)) return "Labour";
  if (/^Conservative and Unionist Party$/i.test(p)) return "Conservative";
  if (/^Liberal Democrats?$/i.test(p)) return "Liberal Democrats";
  if (/^Reform UK$/i.test(p)) return "Reform UK";
  if (/^Green Party$/i.test(p)) return "Green Party";
  if (/independent/i.test(p)) return "Independent";
  return p;
}

function lastSurname(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((t) => t.length > 2)
    .slice(-1)[0] || "";
}

/**
 * Build per-(county, party, surname) → winner record from the historic
 * results bundle. Only includes 2025 cycle wins.
 */
export function buildCounty2025WinnerIndex(historyBundle) {
  const out = {}; // county_slug → array of { surname, party, name, votes, ward_slug, division_name }
  for (const r of historyBundle.results || []) {
    if (r.year !== 2025) continue;
    if (r.tier !== "local") continue;
    if (r.is_by_election) continue;
    if (!r.council_slug) continue;
    if (!r.candidates || r.candidates.length === 0) continue;
    const ranked = [...r.candidates].sort((a, b) => (b.votes || 0) - (a.votes || 0));
    const top = ranked[0];
    if (!top || !top.elected) continue;
    const entry = {
      name: top.name,
      surname: lastSurname(top.name),
      party: dcPartyToCanonical(top.party_name),
      votes: top.votes || 0,
      ward_slug: r.ward_slug,
      division_name: r.ward_slug, // best label we have
    };
    if (!out[r.council_slug]) out[r.council_slug] = [];
    out[r.council_slug].push(entry);
  }
  return out;
}

/**
 * For a 2026 borough candidate, check if their surname + party matches a
 * 2025 county-cycle winner — AND the 2025 division geographically overlaps
 * the 2026 borough ward.
 *
 * For Lancashire: use the AI DOGE LCC 2025 reference to look up which LCC
 * division covers this ward. Match only if the 2025 winner's division equals
 * the ward's parent LCC division. Same-name candidates in non-overlapping
 * geographies (e.g. Hartley in Pendle Hill vs Coal Clough in Burnley) are
 * correctly excluded.
 *
 * For other counties: until per-county division→ward mappings exist, restrict
 * to same-council slug only (i.e. the 2025 winner must have stood in a
 * division that matches this council's slug — which is true only for
 * unitaries that had 2025 cycles directly).
 *
 * Returns { matched, winner, county_slug, geography_check }.
 */
export function findCounty2025Match(candidate, councilSlug, wardName, county2025Winners) {
  const cand = candidate || {};
  const candSurname = lastSurname(cand.name);
  const candParty = dcPartyToCanonical(cand.party_name || cand.party);
  if (!candSurname || !candParty) return { matched: false };

  // For Lancashire: the LCC division covering this ward (e.g. "Burnley Rural"
  // covers Cliviger / Hapton / Briercliffe). Convert AI DOGE division name to
  // a DC-style slug.
  function toSlug(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/\b(and|&)\b/g, "")  // strip "and"/"&" so "Padiham and Burnley West" matches DC's "padiham-burnley-west"
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }
  const lccRef = lancashireLcc2025ForWard(councilSlug, wardName);
  const wardLccDivisionSlug = lccRef?.wardDivisionData?.division ? toSlug(lccRef.wardDivisionData.division) : null;

  const parentCounty = DISTRICT_TO_PARENT_COUNTY_2025[councilSlug];
  const candidateSlugs = [parentCounty, councilSlug].filter(Boolean);

  for (const slug of candidateSlugs) {
    const winners = county2025Winners[slug] || [];
    for (const w of winners) {
      if (w.surname !== candSurname || w.party !== candParty) continue;
      // GEOGRAPHIC GATE
      let geographyOk = false;
      let geographyCheck = "";
      if (wardLccDivisionSlug && slug === "lancashire") {
        // Lancashire: must match the LCC division covering this ward
        if (w.ward_slug === wardLccDivisionSlug) {
          geographyOk = true;
          geographyCheck = `LCC division ${w.ward_slug} covers this ward`;
        } else {
          geographyCheck = `LCC division ${w.ward_slug} does NOT cover this ward (covered by ${wardLccDivisionSlug}) — match rejected as geographically irrelevant`;
        }
      } else if (slug === councilSlug) {
        // Same-council unitary/met (Doncaster, Northumberland etc.) — accept
        geographyOk = true;
        geographyCheck = `Same council slug (${slug})`;
      } else {
        // Non-Lancashire 2-tier county where we don't have division→ward mapping —
        // reject by default (avoid the Pendle Hill / Coal Clough false positive).
        geographyCheck = `No division→ward overlap data for county ${slug} — match rejected`;
      }
      if (geographyOk) {
        return { matched: true, winner: w, county_slug: slug, geography_check: geographyCheck };
      }
    }
  }
  return { matched: false };
}

/**
 * Apply a county-2025-winner personal-vote bonus to a prediction. The winner
 * brings a per-vote following: bonus = min(7pp, votes / 5000 × 6pp).
 * Mark Poulton (1,798 votes) → bonus ≈ 2.2pp; Big-name LCC winners (3000+)
 * → ~3.6pp; cap at 7pp.
 *
 * Returns { prediction, applied: [{candidate, party, bonus, source_division}] }.
 */
export function applyCounty2025Continuity({ prediction, candidates2026, councilSlug, wardName, county2025Winners }) {
  if (!prediction || !candidates2026?.length) return { prediction, applied: [] };
  const out = { ...prediction };
  const applied = [];
  for (const cand of candidates2026) {
    const { matched, winner, county_slug, geography_check } = findCounty2025Match(cand, councilSlug, wardName, county2025Winners);
    if (!matched) continue;
    const party = winner.party;
    if (!out[party]) continue;
    const bonus = Math.min(0.07, Math.max(0.015, (winner.votes / 5000) * 0.06));
    const before = out[party].pct || 0;
    out[party] = { ...out[party], pct: before + bonus };
    applied.push({
      candidate: cand.name,
      party,
      bonus,
      source_division: winner.ward_slug,
      county: county_slug,
      winner_votes: winner.votes,
      geography_check,
    });
  }
  if (applied.length) {
    // Re-normalise
    const sum = Object.values(out).reduce((s, v) => s + (v.pct || 0), 0);
    if (sum > 0) for (const p of Object.keys(out)) out[p].pct = out[p].pct / sum;
  }
  return { prediction: out, applied };
}
