/**
 * county2025.js — Use May 2025 county-cycle election results as a recent-local
 * baseline reference for May 2026 district predictions.
 *
 * Why: the AI DOGE model's Reform-entry step only fires when the ward's
 * baseline Reform share is < 1%. If Reform stood in 2024 with even 5%, the
 * model relies on dampened national swing — which significantly under-weights
 * Reform's actual 2025 county-level breakthroughs (Reform topped 9 county
 * councils in May 2025 with 30-42% shares).
 *
 * This module:
 *   1. Maps every 2-tier district to its parent county slug
 *   2. Aggregates per-party shares from May 2025 county-cycle results
 *      (county divisions or unitary wards)
 *   3. Provides applyCounty2025Anchor(prediction, councilSlug, county2025Map)
 *      which blends the model's prediction toward the county's 2025 baseline,
 *      proportional to Reform's gap (Reform-led swing carries other parties).
 *
 * Pure functions. Inputs are read-only.
 */

// Districts whose May 2025 county elections are the relevant recent-local baseline.
// Source: ONS LAD24 / GSS hierarchy + the 17 English counties that held county
// council elections on 2025-05-01. Unitaries / mets that themselves had 2025
// elections (Doncaster, Northumberland, Cornwall, Buckinghamshire, etc.) map to
// themselves below.
export const DISTRICT_TO_PARENT_COUNTY_2025 = {
  // Cambridgeshire
  "cambridge": "cambridgeshire",
  "east-cambridgeshire": "cambridgeshire",
  "fenland": "cambridgeshire",
  "huntingdonshire": "cambridgeshire",
  "south-cambridgeshire": "cambridgeshire",

  // Derbyshire (Derby is unitary — excluded)
  "amber-valley": "derbyshire",
  "bolsover": "derbyshire",
  "chesterfield": "derbyshire",
  "derbyshire-dales": "derbyshire",
  "erewash": "derbyshire",
  "high-peak": "derbyshire",
  "north-east-derbyshire": "derbyshire",
  "south-derbyshire": "derbyshire",

  // Devon (Plymouth, Torbay are unitaries)
  "east-devon": "devon",
  "exeter": "devon",
  "mid-devon": "devon",
  "north-devon": "devon",
  "south-hams": "devon",
  "teignbridge": "devon",
  "torridge": "devon",
  "west-devon": "devon",

  // Gloucestershire
  "cheltenham": "gloucestershire",
  "cotswold": "gloucestershire",
  "forest-of-dean": "gloucestershire",
  "gloucester": "gloucestershire",
  "stroud": "gloucestershire",
  "tewkesbury": "gloucestershire",

  // Hertfordshire
  "broxbourne": "hertfordshire",
  "dacorum": "hertfordshire",
  "east-hertfordshire": "hertfordshire",
  "hertsmere": "hertfordshire",
  "north-hertfordshire": "hertfordshire",
  "st-albans": "hertfordshire",
  "stevenage": "hertfordshire",
  "three-rivers": "hertfordshire",
  "watford": "hertfordshire",
  "welwyn-hatfield": "hertfordshire",

  // Kent (Medway is unitary)
  "ashford": "kent",
  "canterbury": "kent",
  "dartford": "kent",
  "dover": "kent",
  "folkestone-and-hythe": "kent",
  "gravesham": "kent",
  "maidstone": "kent",
  "sevenoaks": "kent",
  "swale": "kent",
  "thanet": "kent",
  "tonbridge-and-malling": "kent",
  "tunbridge-wells": "kent",

  // Lancashire — own AI DOGE per-ward LCC reference handled separately for
  // burnley/blackburn/blackpool/chorley/fylde/hyndburn/lancaster/pendle/preston/
  // ribble-valley/rossendale/south-ribble/west-lancashire/wyre. We still keep
  // them in this map so the county-wide fallback applies if AI DOGE ref is
  // missing for a particular ward (graceful degradation).
  "burnley": "lancashire",
  "chorley": "lancashire",
  "fylde": "lancashire",
  "hyndburn": "lancashire",
  "lancaster": "lancashire",
  "pendle": "lancashire",
  "preston": "lancashire",
  "ribble-valley": "lancashire",
  "rossendale": "lancashire",
  "south-ribble": "lancashire",
  "west-lancashire": "lancashire",
  "wyre": "lancashire",

  // Leicestershire (Leicester is unitary)
  "blaby": "leicestershire",
  "charnwood": "leicestershire",
  "harborough": "leicestershire",
  "hinckley-and-bosworth": "leicestershire",
  "melton": "leicestershire",
  "north-west-leicestershire": "leicestershire",
  "oadby-and-wigston": "leicestershire",

  // Lincolnshire (North Lincs, NE Lincs are unitaries)
  "boston": "lincolnshire",
  "east-lindsey": "lincolnshire",
  "lincoln": "lincolnshire",
  "north-kesteven": "lincolnshire",
  "south-holland": "lincolnshire",
  "south-kesteven": "lincolnshire",
  "west-lindsey": "lincolnshire",

  // Nottinghamshire (Nottingham is unitary)
  "ashfield": "nottinghamshire",
  "bassetlaw": "nottinghamshire",
  "broxtowe": "nottinghamshire",
  "gedling": "nottinghamshire",
  "mansfield": "nottinghamshire",
  "newark-and-sherwood": "nottinghamshire",
  "rushcliffe": "nottinghamshire",

  // Oxfordshire
  "cherwell": "oxfordshire",
  "oxford": "oxfordshire",
  "south-oxfordshire": "oxfordshire",
  "vale-of-white-horse": "oxfordshire",
  "west-oxfordshire": "oxfordshire",

  // Staffordshire (Stoke is unitary)
  "cannock-chase": "staffordshire",
  "east-staffordshire": "staffordshire",
  "lichfield": "staffordshire",
  "newcastle-under-lyme": "staffordshire",
  "south-staffordshire": "staffordshire",
  "stafford": "staffordshire",
  "staffordshire-moorlands": "staffordshire",
  "tamworth": "staffordshire",

  // Warwickshire
  "north-warwickshire": "warwickshire",
  "nuneaton-and-bedworth": "warwickshire",
  "rugby": "warwickshire",
  "stratford-on-avon": "warwickshire",
  "warwick": "warwickshire",

  // Worcestershire
  "bromsgrove": "worcestershire",
  "malvern-hills": "worcestershire",
  "redditch": "worcestershire",
  "worcester": "worcestershire",
  "wychavon": "worcestershire",
  "wyre-forest": "worcestershire",

  // Self-mapped unitaries / mets that had their own 2025 cycle:
  "doncaster": "doncaster",
  "north-northamptonshire": "north-northamptonshire",
  "west-northamptonshire": "west-northamptonshire",
};

const PARTY_CANON_2025 = (n) => {
  if (!n) return "Unknown";
  const p = String(n).trim();
  if (/^Labour Party$/i.test(p)) return "Labour";
  if (/^Labour and Co-operative Party$/i.test(p)) return "Labour";
  if (/^Conservative and Unionist Party$/i.test(p)) return "Conservative";
  if (/^Liberal Democrats?$/i.test(p)) return "Liberal Democrats";
  if (/^Reform UK$/i.test(p)) return "Reform UK";
  if (/^Green Party$/i.test(p)) return "Green Party";
  if (/independent/i.test(p)) return "Independent";
  return p;
};

/**
 * Build per-county 2025 baseline shares from the DC historic results bundle.
 * Output: { county_slug: { shares: {party: pct}, source_ballot_count, sources: [...] } }
 */
export function buildCounty2025Shares(historyBundle) {
  const out = {};
  const grouped = {};
  for (const r of historyBundle.results || []) {
    if (r.year !== 2025) continue;
    if (r.tier !== "local") continue;
    if (r.is_by_election) continue;
    if (!r.council_slug) continue;
    if (!grouped[r.council_slug]) grouped[r.council_slug] = [];
    grouped[r.council_slug].push(r);
  }
  for (const [slug, rows] of Object.entries(grouped)) {
    let totalVotes = 0;
    const partyVotes = {};
    const sources = [];
    for (const r of rows) {
      const ballot = (r.candidates || []).reduce((s, c) => s + (c.votes || 0), 0);
      if (ballot <= 0) continue;
      for (const c of r.candidates || []) {
        const p = PARTY_CANON_2025(c.party_name);
        partyVotes[p] = (partyVotes[p] || 0) + (c.votes || 0);
      }
      totalVotes += ballot;
      if (r.source) sources.push(r.source);
    }
    if (totalVotes <= 0) continue;
    const shares = {};
    for (const [p, v] of Object.entries(partyVotes)) shares[p] = +(v / totalVotes).toFixed(4);
    out[slug] = { shares, source_ballot_count: rows.length, total_votes: totalVotes, sources: sources.slice(0, 5) };
  }
  return out;
}

/**
 * Resolve a 2026 council slug to its 2025 reference council slug (or null).
 * Uses DISTRICT_TO_PARENT_COUNTY_2025; falls back to slug-self if the council
 * itself has 2025 data (covers unitaries / mets directly).
 */
export function resolve2025Reference(councilSlug, county2025Shares) {
  if (!councilSlug) return null;
  // 1. Direct (unitary / met that had 2025 election directly)
  if (county2025Shares[councilSlug]) return councilSlug;
  // 2. Mapped parent county
  const parent = DISTRICT_TO_PARENT_COUNTY_2025[councilSlug];
  if (parent && county2025Shares[parent]) return parent;
  return null;
}

/**
 * Blend a 2026 ward prediction toward the 2025 reference shares for that
 * ward's parent area.
 *
 * Method:
 *   - Compute per-party "anchor" share from 2025 reference + national swing
 *     since 2025 (so the anchor reflects May-2026 polling, not stale May-2025
 *     numbers).
 *   - Blend prediction with anchor at weight = anchorWeight (default 0.40)
 *   - Re-normalise.
 *
 * The blending only kicks in for parties present in BOTH the prediction and
 * the anchor. New-on-ballot parties (added via restrictToBallot floor) are
 * untouched. Parties dropped by restrictToBallot stay dropped.
 *
 * Returns { prediction: blended, anchor_used, anchor_source, anchor_weight }.
 */
export function applyCounty2025Anchor({
  prediction,
  county2025Shares,
  councilSlug,
  nationalPollingNow,
  national2025Polling,
  anchorWeight = 0.40,
}) {
  if (!prediction) return { prediction: null, anchor_used: false };
  const refSlug = resolve2025Reference(councilSlug, county2025Shares);
  if (!refSlug) return { prediction, anchor_used: false };
  const ref = county2025Shares[refSlug];
  if (!ref) return { prediction, anchor_used: false };

  // National swing since May 2025 (per party)
  const partyKeys = new Set([...Object.keys(prediction), ...Object.keys(ref.shares)]);
  const anchor = {};
  for (const p of partyKeys) {
    const ref2025 = ref.shares[p] || 0;
    const swingSince2025 = (nationalPollingNow[p] || 0) - (national2025Polling[p] || 0);
    anchor[p] = Math.max(0, ref2025 + swingSince2025);
  }
  // Re-normalise anchor to sum to 1 over parties currently in prediction
  const anchorSumOverPredictionParties = Object.keys(prediction).reduce((s, p) => s + (anchor[p] || 0), 0);
  if (anchorSumOverPredictionParties <= 0) return { prediction, anchor_used: false };

  const blended = {};
  let totalNew = 0;
  for (const [party, payload] of Object.entries(prediction)) {
    const anchorShareNorm = (anchor[party] || 0) / anchorSumOverPredictionParties;
    const blendedPct = (1 - anchorWeight) * (payload.pct || 0) + anchorWeight * anchorShareNorm;
    blended[party] = { pct: blendedPct, votes: payload.votes };
    totalNew += blendedPct;
  }
  // Re-normalise (should already be ~1)
  if (totalNew > 0) {
    for (const p of Object.keys(blended)) blended[p].pct = blended[p].pct / totalNew;
  }
  return {
    prediction: blended,
    anchor_used: true,
    anchor_source: { county_slug: refSlug, ballot_count: ref.source_ballot_count, total_votes: ref.total_votes },
    anchor_weight: anchorWeight,
  };
}
