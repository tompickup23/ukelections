// Shared helpers for the May 2027 ward list and baselines.
// Used by scripts/build-wards-2027.mjs and scripts/wards-2027-validate-notional.mjs.
//
// Share convention: full-slate party shares, the same as
// scripts/score-may-2026-like-for-like.mjs. Every candidate's votes are summed
// by party and divided by the sum of all candidates' votes in the ward, so a
// multi-member ward counts every vote cast, not one per voter.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const MAJOR = ["Reform UK", "Labour", "Conservative", "Liberal Democrats", "Green Party"];
export const POOLED = [...MAJOR, "Others"];
const MAJOR_SET = new Set(MAJOR);

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

// RFC 4180 style CSV parse: quoted fields, doubled quotes, commas and
// newlines inside quotes. Returns an array of objects keyed by header. When a
// header repeats (LEAP's two "ons_code" columns) later copies get a suffix:
// ons_code, ons_code_2.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += c;
      continue;
    }
    if (c === '"') { inQ = true; continue; }
    if (c === ",") { row.push(field); field = ""; continue; }
    if (c === "\r") continue;
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const seen = {};
  const header = rows.shift().map((h) => {
    seen[h] = (seen[h] || 0) + 1;
    return seen[h] > 1 ? `${h}_${seen[h]}` : h;
  });
  return rows
    .filter((r) => r.length > 1 || r[0] !== "")
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

// Slug in the Democracy Club style: lower case, "&" as "and", apostrophes
// dropped, every other run of non-alphanumerics a single hyphen.
export function slugify(name) {
  return String(name || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Party labels, mirroring party_canonical in
// data/results/may-2026/local-and-mayor.merged.json: the five parties the
// yardstick keeps get one label each ("Labour and Co-operative Party" counts
// as Labour, as it does there). Everything else keeps its own name.
const EC_IDS = {
  PP52: "Conservative",
  PP53: "Labour",
  "joint-party:53-119": "Labour",
  PP90: "Liberal Democrats",
  PP63: "Green Party",
  PP7931: "Reform UK",
};
const LEAP_ABBREV = {
  Con: "Conservative",
  C: "Conservative",
  Lab: "Labour",
  "Lab Co-op": "Labour",
  LabCoop: "Labour",
  LD: "Liberal Democrats",
  Grn: "Green Party",
  Green: "Green Party",
  Ref: "Reform UK",
  Reform: "Reform UK",
  RefUK: "Reform UK",
  RUK: "Reform UK",
  "RUK/BFC": "Reform UK",
  Ind: "Independent",
  UKIP: "UKIP",
  BxP: "Brexit Party",
  Brexit: "Brexit Party",
};
export function canonicalParty(name, ecId) {
  if (ecId && EC_IDS[ecId]) return EC_IDS[ecId];
  const raw = String(name || "").trim();
  if (LEAP_ABBREV[raw]) return LEAP_ABBREV[raw];
  const n = raw.toLowerCase();
  if (!n) return "Unknown";
  if (n.startsWith("reform uk")) return "Reform UK";
  if (/^(the )?conservative/.test(n) || n.startsWith("scottish conservative")) return "Conservative";
  if (/^labour( party| and co-operative| co-operative|$)/.test(n)) return "Labour";
  if (n.startsWith("liberal democrat")) return "Liberal Democrats";
  if (n.startsWith("green party")) return "Green Party";
  if (n === "independent" || n === "independent politician" || n.startsWith("independent (")) return "Independent";
  return raw;
}

// Full-slate shares from [{party, votes}]. Returns null when no votes.
export function fullSlateShares(cands) {
  const byParty = {};
  let total = 0;
  for (const c of cands) {
    const v = Number(c.votes);
    if (!Number.isFinite(v) || v < 0) continue;
    byParty[c.party] = (byParty[c.party] || 0) + v;
    total += v;
  }
  if (!total) return null;
  const shares = {};
  for (const [p, v] of Object.entries(byParty)) shares[p] = round6(v / total);
  return { shares, total_votes: total };
}

export function pooledShares(shares) {
  const out = Object.fromEntries(POOLED.map((p) => [p, 0]));
  for (const [party, v] of Object.entries(shares || {})) {
    out[MAJOR_SET.has(party) ? party : "Others"] += v || 0;
  }
  for (const p of POOLED) out[p] = round6(out[p]);
  return out;
}

export function topParty(shares) {
  const entries = Object.entries(shares || {}).filter(([, v]) => v > 0);
  if (!entries.length) return null;
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

// Mean absolute error across the six pooled groups, in share points (0 to 1).
export function pooledMae(a, b) {
  const pa = pooledShares(a);
  const pb = pooledShares(b);
  return POOLED.reduce((s, p) => s + Math.abs(pa[p] - pb[p]), 0) / POOLED.length;
}

// Notional shares for a target ward from the old wards' results, weighted by
// the LSOAs they share. targetLsoas: LSOA codes best-fitted to the target
// ward. lsoaToOld: Map LSOA -> old ward key. oldShares: Map old ward key ->
// shares. Returns the weights kept per old ward (LSOA counts and fractions)
// and the share of the target's LSOAs that had an old ward with a result.
export function notionalShares(targetLsoas, lsoaToOld, oldShares) {
  const counts = new Map();
  let unmapped = 0;
  let noResult = 0;
  for (const l of targetLsoas) {
    const o = lsoaToOld.get(l);
    if (!o) { unmapped++; continue; }
    if (!oldShares.has(o)) { noResult++; continue; }
    counts.set(o, (counts.get(o) || 0) + 1);
  }
  const used = [...counts.values()].reduce((s, v) => s + v, 0);
  if (!used) return { shares: null, weights: [], lsoas_total: targetLsoas.length, lsoas_used: 0, lsoas_unmapped: unmapped, lsoas_old_ward_without_result: noResult };
  const shares = {};
  const weights = [];
  for (const [o, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    const w = n / used;
    weights.push({ from: o, lsoas: n, weight: round6(w) });
    for (const [p, v] of Object.entries(oldShares.get(o))) shares[p] = (shares[p] || 0) + w * v;
  }
  for (const p of Object.keys(shares)) shares[p] = round6(shares[p]);
  return { shares, weights, lsoas_total: targetLsoas.length, lsoas_used: used, lsoas_unmapped: unmapped, lsoas_old_ward_without_result: noResult };
}

export function round6(x) {
  return Math.round(x * 1e6) / 1e6;
}

export function sumShares(shares) {
  return Object.values(shares || {}).reduce((s, v) => s + v, 0);
}

// British National Grid (OSGB36 easting/northing) to WGS84 longitude and
// latitude: inverse Transverse Mercator on Airy 1830, then a seven-parameter
// Helmert shift to WGS84 (Ordnance Survey, "A guide to coordinate systems in
// Great Britain", sections 6.2 and annex C). Good to a few metres, which is
// ample for placing an LSOA's population-weighted centroid inside a ward.
export function bngToWgs84(E, N) {
  const a = 6377563.396, b = 6356256.909;
  const F0 = 0.9996012717, lat0 = (49 * Math.PI) / 180, lon0 = (-2 * Math.PI) / 180;
  const N0 = -100000, E0 = 400000;
  const e2 = 1 - (b * b) / (a * a);
  const n = (a - b) / (a + b), n2 = n * n, n3 = n * n * n;
  let lat = lat0, M = 0;
  do {
    lat = (N - N0 - M) / (a * F0) + lat;
    const Ma = (1 + n + (5 / 4) * n2 + (5 / 4) * n3) * (lat - lat0);
    const Mb = (3 * n + 3 * n * n + (21 / 8) * n3) * Math.sin(lat - lat0) * Math.cos(lat + lat0);
    const Mc = ((15 / 8) * n2 + (15 / 8) * n3) * Math.sin(2 * (lat - lat0)) * Math.cos(2 * (lat + lat0));
    const Md = (35 / 24) * n3 * Math.sin(3 * (lat - lat0)) * Math.cos(3 * (lat + lat0));
    M = b * F0 * (Ma - Mb + Mc - Md);
  } while (N - N0 - M >= 0.00001);
  const cosLat = Math.cos(lat), sinLat = Math.sin(lat);
  const nu = (a * F0) / Math.sqrt(1 - e2 * sinLat * sinLat);
  const rho = (a * F0 * (1 - e2)) / Math.pow(1 - e2 * sinLat * sinLat, 1.5);
  const eta2 = nu / rho - 1;
  const tanLat = Math.tan(lat), tan2 = tanLat * tanLat, tan4 = tan2 * tan2, tan6 = tan4 * tan2;
  const secLat = 1 / cosLat;
  const nu3 = nu * nu * nu, nu5 = nu3 * nu * nu, nu7 = nu5 * nu * nu;
  const VII = tanLat / (2 * rho * nu);
  const VIII = (tanLat / (24 * rho * nu3)) * (5 + 3 * tan2 + eta2 - 9 * tan2 * eta2);
  const IX = (tanLat / (720 * rho * nu5)) * (61 + 90 * tan2 + 45 * tan4);
  const X = secLat / nu;
  const XI = (secLat / (6 * nu3)) * (nu / rho + 2 * tan2);
  const XII = (secLat / (120 * nu5)) * (5 + 28 * tan2 + 24 * tan4);
  const XIIA = (secLat / (5040 * nu7)) * (61 + 662 * tan2 + 1320 * tan4 + 720 * tan6);
  const dE = E - E0;
  const phi = lat - VII * dE ** 2 + VIII * dE ** 4 - IX * dE ** 6;
  const lam = lon0 + X * dE - XI * dE ** 3 + XII * dE ** 5 - XIIA * dE ** 7;
  // OSGB36 geodetic to cartesian (Airy 1830).
  const sP = Math.sin(phi), cP = Math.cos(phi);
  const nuA = a / Math.sqrt(1 - e2 * sP * sP);
  const x1 = nuA * cP * Math.cos(lam), y1 = nuA * cP * Math.sin(lam), z1 = (1 - e2) * nuA * sP;
  // Helmert OSGB36 -> WGS84.
  const tx = 446.448, ty = -125.157, tz = 542.06;
  const s = 20.4894e-6 * -1; // scale is -20.4894 ppm going OSGB36 -> WGS84
  const rx = ((0.1502 / 3600) * Math.PI) / 180, ry = ((0.247 / 3600) * Math.PI) / 180, rz = ((0.8421 / 3600) * Math.PI) / 180;
  const x2 = tx + (1 + s) * x1 - rz * y1 + ry * z1;
  const y2 = ty + rz * x1 + (1 + s) * y1 - rx * z1;
  const z2 = tz - ry * x1 + rx * y1 + (1 + s) * z1;
  // Cartesian to WGS84 geodetic (GRS80 ellipsoid).
  const a2 = 6378137.0, b2 = 6356752.3142, e22 = 1 - (b2 * b2) / (a2 * a2);
  const p = Math.sqrt(x2 * x2 + y2 * y2);
  let la = Math.atan2(z2, p * (1 - e22)), prev = 2 * Math.PI;
  while (Math.abs(la - prev) > 1e-12) {
    prev = la;
    const nu2 = a2 / Math.sqrt(1 - e22 * Math.sin(la) ** 2);
    la = Math.atan2(z2 + e22 * nu2 * Math.sin(la), p);
  }
  return [(Math.atan2(y2, x2) * 180) / Math.PI, (la * 180) / Math.PI];
}

// Planar even-odd point-in-polygon over every ring of a GeoJSON Polygon or
// MultiPolygon. Ring orientation does not matter, and holes fall out of the
// even-odd rule, so it is safe on files of either winding convention.
export function geometryContains(geom, [x, y]) {
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.type === "MultiPolygon" ? geom.coordinates : [];
  let inside = false;
  for (const poly of polys) {
    for (const ring of poly) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
    }
  }
  return inside;
}

export function geometryBbox(geom) {
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const poly of polys) for (const ring of poly) for (const [x, y] of ring) {
    if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

// Democracy Club ward results (the Drive library's
// ward_results_2016-2026_candidates.csv) grouped by ballot. Returns
// Map ballot_paper_id -> { ballot_paper_id, date, council_slug, ward_slug,
// by_election, rows, elected, shares, total_votes, source }.
export function groupDcBallots(rows) {
  const by = new Map();
  for (const r of rows) {
    if (r.tier && r.tier !== "local") continue;
    let b = by.get(r.ballot_paper_id);
    if (!b) {
      b = { ballot_paper_id: r.ballot_paper_id, date: r.election_date, council_slug: r.council_slug, ward_slug: r.ward_slug, by_election: r.is_by_election === "True", cands: [], elected: 0, source: r.source || null };
      by.set(r.ballot_paper_id, b);
    }
    b.cands.push({ party: canonicalParty(r.party_name, r.party_ec_id), votes: r.votes === "" ? NaN : Number(r.votes) });
    if (r.elected === "True") b.elected++;
    if (!b.source && r.source) b.source = r.source;
  }
  for (const b of by.values()) finishBallot(b);
  return by;
}

export function finishBallot(b) {
  const s = fullSlateShares(b.cands);
  b.rows = b.cands.length;
  b.votes_missing = b.cands.some((c) => !Number.isFinite(c.votes));
  b.shares = s && !b.votes_missing ? s.shares : null;
  b.total_votes = s && !b.votes_missing ? s.total_votes : null;
  delete b.cands;
  return b;
}

// ONS best-fit LSOA lookup CSV (lsoa21cd, wardcd, wardnm, ladcd, ladnm) into
// { lsoaToWard: Map, wards: Map code -> {code, name, slug, lad, ladSlug, lsoas: []} }.
export function loadWardLookupCsv(text) {
  const lsoaToWard = new Map();
  const wards = new Map();
  for (const r of parseCsv(text)) {
    if (!r.lsoa21cd?.startsWith("E")) continue;
    lsoaToWard.set(r.lsoa21cd, r.wardcd);
    if (!wards.has(r.wardcd)) wards.set(r.wardcd, { code: r.wardcd, name: r.wardnm, slug: slugify(r.wardnm), lad: r.ladcd, ladName: r.ladnm, ladSlug: ladSlug(r.ladnm), lsoas: [] });
    wards.get(r.wardcd).lsoas.push(r.lsoa21cd);
  }
  return { lsoaToWard, wards };
}

// Council slugs whose Democracy Club spelling differs from the slug of the
// ONS district name.
export const COUNCIL_TO_ONS_SLUG = {
  "city-of-lincoln": "lincoln",
  "folkestone-hythe": "folkestone-and-hythe",
};

// District slug as a council slug: ONS writes some names inverted in some
// vintages ("Kingston upon Hull, City of", "Herefordshire, County of").
export function ladSlug(ladName) {
  return slugify(ladName).replace(/-(city|county)-of$/, "");
}
export function councilLadSlug(councilSlug) {
  return COUNCIL_TO_ONS_SLUG[councilSlug] || councilSlug;
}

// Democracy Club often drops "and", "the" and "with" from ward slugs
// ("Basing and Upton Grey" is basing-upton-grey), so both sides are also
// compared with those words removed. A key that two wards share is dropped
// rather than guessed.
export function looseSlug(slug) {
  return slug.split("-").filter((t) => !["and", "the", "with", "st", "saint"].includes(t)).join("-");
}

// Index ward codes by "<council slug>/<ward slug>" for one ward set.
export function wardSlugIndex(wards) {
  const byLad = new Map();
  for (const w of wards.values()) {
    if (!byLad.has(w.ladSlug)) byLad.set(w.ladSlug, new Map());
    const m = byLad.get(w.ladSlug);
    for (const k of new Set([w.slug, looseSlug(w.slug)])) m.set(k, m.has(k) && m.get(k) !== w.code ? "AMBIGUOUS" : w.code);
  }
  return (councilSlug, wardSlug) => {
    const lad = byLad.get(councilLadSlug(councilSlug));
    if (!lad) return null;
    let c = lad.get(wardSlug);
    if (!c || c === "AMBIGUOUS") c = lad.get(looseSlug(wardSlug));
    return c && c !== "AMBIGUOUS" ? c : null;
  };
}

// Read an Electoral Changes Order's article 1 (citation and commencement) and
// say in which years its changes take effect for "all other purposes".
// Parish-only changes ("election of parish councillors ... in 2027") are kept
// apart: they do not move a district ward boundary.
export function parseOrderCommencement(text) {
  const ward = new Set();
  const parish = new Set();
  const quotes = [];
  const re = /for all other purposes,? on the ordinary day of (?:the )?election of (parish )?councillors(?: in England)?(?: in| for)? (?:the year )?(\d{4})/g;
  for (const m of text.matchAll(re)) {
    const y = Number(m[2]);
    (m[1] ? parish : ward).add(y);
    if (y === 2027 && !m[1]) {
      // From the "Article(s) ..." that the clause belongs to. The statute's
      // em dash after "comes into force" is written as a colon here.
      const art = Math.max(text.lastIndexOf("Article", m.index), text.lastIndexOf("article", m.index));
      const start = art >= 0 && m.index - art < 400 ? art : Math.max(0, m.index - 200);
      quotes.push(text.slice(start, m.index + m[0].length).replace(/\s*\u2014\s*/g, ": ").trim());
    }
  }
  return { ward_change_years: [...ward].sort(), parish_change_years: [...parish].sort(), quotes_2027: quotes };
}
