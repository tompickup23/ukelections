/**
 * lancashireLcc2025.js — load AI DOGE's per-ward LCC 2025 reference for the
 * 14 Lancashire districts (Burnley, Blackburn, Blackpool, Chorley, Fylde,
 * Hyndburn, Lancaster, Pendle, Preston, Ribble Valley, Rossendale, South
 * Ribble, West Lancashire, Wyre).
 *
 * Each LCC division maps to multiple borough wards. This module returns
 * the division-specific shares for any ward, in the lcc2025 arg shape the
 * AI DOGE election model expects:
 *   { wardDivisionData: { division, reform_pct }, results: {...} }
 *
 * Critical for Burnley wards like Cliviger with Worsthorne whose most-recent
 * borough contest is 2019 — without per-division LCC2025, the model never
 * sees Reform's 2025 county breakthrough.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const CLAWD = "/Users/tompickup/clawd/burnley-council/data";
const LANCASHIRE_DISTRICTS = [
  "burnley", "blackburn-with-darwen", "blackpool", "chorley", "fylde",
  "hyndburn", "lancaster", "pendle", "preston", "ribble-valley",
  "rossendale", "south-ribble", "west-lancashire", "wyre",
];

const PARTY_MAP = {
  "Reform UK": "Reform UK",
  "Labour": "Labour",
  "Conservative": "Conservative",
  "Liberal Democrats": "Liberal Democrats",
  "Green Party": "Green Party",
  "Independent": "Independent",
  "Workers Party": "Workers Party",
};

function dcCouncilSlugToAidoge(slug) {
  return slug.replace(/-/g, "_").replace("blackburn_with_darwen", "blackburn");
}

function normaliseWardName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+with\s+/g, " with ")
    .replace(/\s+/g, " ")
    .trim();
}

const _cache = {};
function loadLccRef(councilSlug) {
  if (_cache[councilSlug] !== undefined) return _cache[councilSlug];
  const aidogeId = dcCouncilSlugToAidoge(councilSlug);
  const p = path.join(CLAWD, aidogeId, "lcc_2025_reference.json");
  if (!existsSync(p)) {
    _cache[councilSlug] = null;
    return null;
  }
  try {
    _cache[councilSlug] = JSON.parse(readFileSync(p, "utf8"));
    return _cache[councilSlug];
  } catch {
    _cache[councilSlug] = null;
    return null;
  }
}

/**
 * Find the LCC 2025 division covering this ward and return the lcc2025 arg
 * shape that the AI DOGE election model expects.
 */
export function lancashireLcc2025ForWard(councilSlug, wardName) {
  if (!LANCASHIRE_DISTRICTS.includes(councilSlug)) return null;
  const ref = loadLccRef(councilSlug);
  if (!ref?.divisions || !wardName) return null;
  const target = normaliseWardName(wardName);
  for (const [divName, div] of Object.entries(ref.divisions)) {
    const wards = (div.wards || []).map(normaliseWardName);
    // Handle Coalclough vs Coal Clough variant (AI DOGE uses no space, DC uses space).
    const targetVariants = [target, target.replace("coal clough", "coalclough"), target.replace("coalclough", "coal clough")];
    if (wards.some((w) => targetVariants.includes(w))) {
      // Build the model-expected shape
      const results = {};
      for (const [party, share] of Object.entries(div.results || {})) {
        const canon = PARTY_MAP[party] || party;
        results[canon] = { pct: share };
      }
      return {
        wardDivisionData: {
          division: divName,
          reform_pct: div.reform_pct,
        },
        results,
        winner: div.winner,
        turnout: div.turnout,
        electorate: div.electorate,
        _source: `AI DOGE LCC 2025 reference: ${councilSlug} division ${divName}`,
      };
    }
  }
  return null;
}

export { LANCASHIRE_DISTRICTS };
