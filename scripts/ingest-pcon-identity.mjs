#!/usr/bin/env node
/**
 * ingest-pcon-identity.mjs — build the 650-PCON identity table for the GE
 * forecast. Derives one record per parliamentary constituency from existing
 * GE2024 results and the ONS LSOA→PCON24 crosswalk.
 *
 * Output: data/identity/pcons-ge-next.json
 *
 * Per-PCON record:
 *   {
 *     slug: 'burnley',
 *     name: 'Burnley',                       // canonical PCON24NM where derivable, else Title-Case slug
 *     pcon24cd: 'E14001118' | null,          // derived where slug→PCON24NM matches; null for ~75 NI/Scot seats until enriched
 *     country: 'england' | 'scotland' | 'wales' | 'northern_ireland',
 *     region: 'north_west' | ...             // GOR for England; 'wales'/'scotland'/'northern_ireland' otherwise
 *     ballot_paper_id: 'parl.burnley.2024-07-04',
 *     lad24cds: ['E07000117', ...],          // LADs the PCON intersects — empty for NI/Scot until enriched
 *     ge2024: {
 *       turnout, electorate, winner_party, runner_up_party, majority_pct,
 *       results: [{name, party_name, party_ec_id, votes, pct, elected}]
 *     }
 *   }
 *
 * Cross-tier joins use slug as the primary key (650 unique). PCON24CD is
 * a secondary key, populated for England + Wales (575) at this phase; the
 * Scotland 57 + Northern Ireland 18 slugs are emitted with pcon24cd=null
 * pending a boundary review crosswalk ingest in a follow-up phase.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");

function readJson(p) { return JSON.parse(readFileSync(join(REPO, p), "utf8")); }
function sha256(buf) { return createHash("sha256").update(buf).digest("hex"); }

function slugify(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 -]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function titleCase(slug) {
  return String(slug || "")
    .split("-")
    .map((w) => (w === "and" || w === "of" || w === "the" ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

// ONS GOR codes → AI DOGE region slug
const ONS_REGION_MAP = {
  E12000001: "north_east",
  E12000002: "north_west",
  E12000003: "yorkshire",
  E12000004: "east_midlands",
  E12000005: "west_midlands",
  E12000006: "east_of_england",
  E12000007: "london",
  E12000008: "south_east",
  E12000009: "south_west",
};

// LAD24CD → region. Built lazily from lsoa21-pcon24 lookup which carries lad21cd.
// For region, we'll use the LAD prefix to infer: most LAD codes map cleanly via
// existing slugMap or other infra.
function inferCountry(pcon24cd, slug) {
  if (pcon24cd?.startsWith("S14")) return "scotland";
  if (pcon24cd?.startsWith("W07")) return "wales";
  if (pcon24cd?.startsWith("N06")) return "northern_ireland";
  if (pcon24cd?.startsWith("E14")) return "england";
  // Slug heuristics for unmatched PCON24CD
  // Scotland slugs commonly include: aberdeen, glasgow, edinburgh, dundee,
  // perth, dunfermline, livingston, paisley, motherwell, falkirk, renfrew,
  // arbroath, ayr, fife, lothian, lanarkshire, ross, sutherland, caithness,
  // moray, banffshire, argyll, lochaber, hebrides, orkney, shetland, na-h-eileanan
  if (/aberdeen|airdrie|alloa|angus|arbroath|argyll|ayr|bathgate|berwickshire|caithness|coatbridge|cowdenbeath|cumbernauld|dumfries|dunbartonshire|dundee|dunfermline|east-kilbride|east-lothian|edinburgh|falkirk|fife|glasgow|glenrothes|gordon|hamilton|highland|inverness|kilmarnock|kirkcaldy|lanark|livingston|lothian|midlothian|mid-dunbartonshire|mid-lanark|mid-scotland|mid-fife|midlothian|moray|na-h-eileanan|paisley|perth|renfrew|ross|rutherglen|stirling|sutherland|west-aberdeenshire|west-dunbartonshire|west-lothian|hamilton-and-clyde|gordon-and-buchan|stirling-and-strathallan|loch|tweed|borders|orkney|shetland/.test(slug)) {
    return "scotland";
  }
  // NI slugs
  if (/^belfast-|^east-antrim|^east-londonderry|^fermanagh|^foyle|^lagan-valley|^mid-ulster|^newry-and|^north-antrim|^north-down|^south-antrim|^south-down|^strangford|^upper-bann|^west-tyrone$/.test(slug)) {
    return "northern_ireland";
  }
  // Wales heuristic — most Wales seats end in distinctive suffixes; if no PCON24CD
  // and not Scotland/NI heuristic, default to England
  if (/^aberafan|^aberconwy|^alyn-and|^bangor|^blaenau|^brecon|^bridgend|^caerfyrddin|^caerphilly|^cardiff|^ceredigion|^clwyd|^dwyfor|^gower|^llanelli|^merthyr|^mid-and-south-pembrokeshire|^monmouthshire|^montgomeryshire|^neath|^newport|^pontypridd|^rhondda|^swansea|^torfaen|^vale-of-glamorgan|^ynys-mon$/.test(slug)) {
    return "wales";
  }
  return "england";
}

function regionForCountry(country, ladRegion) {
  if (country === "scotland") return "scotland";
  if (country === "wales") return "wales";
  if (country === "northern_ireland") return "northern_ireland";
  return ladRegion || null;
}

function buildLadToRegion() {
  // Load the AI DOGE LA-features file which has LAD-level data; we don't have
  // a built-in LAD→GOR mapping in this repo so we'll derive it from the
  // distribution of LAD prefixes:
  //   E06xxx (unitary auth), E07xxx (district), E08xxx (metropolitan district),
  //   E09xxx (London borough)
  // For region we need a true GOR mapping. Use the BES-derived LAD→region map
  // from data/features/ward-mrp-priors.json which already has it.
  try {
    const priors = readJson("data/features/ward-mrp-priors.json");
    const out = {};
    for (const [lad, payload] of Object.entries(priors.priors || {})) {
      out[lad] = payload.region;
    }
    return out;
  } catch {
    return {};
  }
}

function main() {
  console.log("Loading inputs ...");
  const ge24 = readJson("data/features/la-ge2024-shares.json");
  const dcRaw = readJson("data/history/dc-historic-results.json");
  const lsoaPcon = readJson("data/features/lsoa21-to-pcon24.json");
  const ladToRegion = buildLadToRegion();

  // Build slug → PCON24CD + name from lsoa21-pcon24
  const slugToCode = new Map();
  const codeToName = new Map();
  const slugToLads = new Map();
  for (const [, v] of Object.entries(lsoaPcon.lookup || {})) {
    if (!v?.pcon24cd) continue;
    const s = slugify(v.pcon24nm);
    slugToCode.set(s, v.pcon24cd);
    codeToName.set(v.pcon24cd, v.pcon24nm);
    if (!slugToLads.has(s)) slugToLads.set(s, new Set());
    if (v.lad21cd) slugToLads.get(s).add(v.lad21cd);
  }
  console.log(`  ${slugToCode.size} PCON24CD codes derivable from LSOA crosswalk (England+Wales)`);

  // Index DC parl 2024 GE results by ballot_paper_id
  const ge2024ByBallot = new Map();
  for (const r of dcRaw.results || []) {
    if (r.year !== 2024 || r.tier !== "parl" || r.is_by_election) continue;
    ge2024ByBallot.set(r.ballot_paper_id, r);
  }

  const records = [];
  let withCode = 0;
  let withRegion = 0;
  for (const ballotId of Object.keys(ge24.pcon_ballots)) {
    // ballotId pattern: parl.<slug>.2024-07-04
    const parts = ballotId.split(".");
    if (parts.length < 3) continue;
    const slug = parts.slice(1, -1).join(".");
    const pcon24cd = slugToCode.get(slug) || null;
    const name = pcon24cd ? codeToName.get(pcon24cd) : titleCase(slug);
    const country = inferCountry(pcon24cd, slug);
    const lads = pcon24cd ? [...(slugToLads.get(slug) || [])] : [];
    // Region: pick majority LAD region for English seats, else country slug
    let ladRegion = null;
    if (country === "england" && lads.length > 0) {
      const counts = {};
      for (const lad of lads) {
        const r = ladToRegion[lad];
        if (r) counts[r] = (counts[r] || 0) + 1;
      }
      let best = null, bestN = 0;
      for (const [r, n] of Object.entries(counts)) if (n > bestN) { best = r; bestN = n; }
      ladRegion = best;
    }
    const region = regionForCountry(country, ladRegion);
    if (region) withRegion += 1;
    if (pcon24cd) withCode += 1;

    // GE2024 results: prefer DC's per-candidate detail; fall back to la-ge2024-shares totals
    const dcResult = ge2024ByBallot.get(ballotId);
    let ge2024 = null;
    if (dcResult) {
      const total = dcResult.candidates.reduce((s, c) => s + (c.votes || 0), 0);
      const ranked = [...dcResult.candidates].sort((a, b) => (b.votes || 0) - (a.votes || 0));
      const candidates = ranked.map((c) => ({
        name: c.name,
        party_name: c.party_name,
        party_ec_id: c.party_ec_id,
        votes: c.votes || 0,
        pct: total > 0 ? (c.votes || 0) / total : 0,
        elected: c.elected === true,
      }));
      ge2024 = {
        turnout: dcResult.turnout_pct ?? null,
        turnout_votes: total,
        electorate: dcResult.electorate ?? null,
        winner_party: candidates[0]?.party_name || null,
        winner_name: candidates[0]?.name || null,
        runner_up_party: candidates[1]?.party_name || null,
        majority: candidates[0] && candidates[1] ? candidates[0].votes - candidates[1].votes : null,
        majority_pct: candidates[0] && candidates[1] ? candidates[0].pct - candidates[1].pct : null,
        source_url: dcResult.source || null,
        candidates,
      };
    } else {
      const fallback = ge24.pcon_ballots[ballotId];
      const ranked = Object.entries(fallback.shares || {})
        .sort((a, b) => b[1] - a[1])
        .map(([party_name, pct]) => ({ party_name, pct, votes: Math.round(pct * (fallback.total_votes || 0)), elected: false }));
      if (ranked.length > 0) ranked[0].elected = true;
      ge2024 = {
        turnout: null,
        turnout_votes: fallback.total_votes || 0,
        electorate: null,
        winner_party: ranked[0]?.party_name || null,
        winner_name: null,
        runner_up_party: ranked[1]?.party_name || null,
        majority: ranked[0] && ranked[1] ? ranked[0].votes - ranked[1].votes : null,
        majority_pct: ranked[0] && ranked[1] ? ranked[0].pct - ranked[1].pct : null,
        source_url: null,
        candidates: ranked,
      };
    }

    records.push({
      slug,
      name,
      pcon24cd,
      country,
      region,
      ballot_paper_id: ballotId,
      lad24cds: lads.sort(),
      ge2024,
    });
  }
  records.sort((a, b) => a.slug.localeCompare(b.slug));
  console.log(`  built ${records.length} PCON identity records (${withCode} with PCON24CD, ${withRegion} with region)`);

  const out = {
    snapshot: {
      snapshot_id: `pcons-ge-next-${new Date().toISOString().slice(0, 10)}`,
      generated_at: new Date().toISOString(),
      sources: [
        { path: "data/features/la-ge2024-shares.json", role: "650-ballot list + GE2024 vote totals" },
        { path: "data/history/dc-historic-results.json", role: "Per-candidate GE2024 detail" },
        { path: "data/features/lsoa21-to-pcon24.json", role: "Slug → PCON24CD crosswalk (E+W)" },
        { path: "data/features/ward-mrp-priors.json", role: "LAD → GOR region mapping" },
      ],
      coverage: {
        total: records.length,
        with_pcon24cd: withCode,
        with_region: withRegion,
        by_country: records.reduce((acc, r) => {
          acc[r.country] = (acc[r.country] || 0) + 1;
          return acc;
        }, {}),
      },
      licence: "Democracy Club CC0 (results) + ONS OGL (codes/names)",
    },
    pcons: records,
  };

  const outPath = "data/identity/pcons-ge-next.json";
  mkdirSync(dirname(join(REPO, outPath)), { recursive: true });
  const json = JSON.stringify(out, null, 2);
  out.snapshot.sha256 = sha256(json);
  // Re-stringify with sha256 included
  writeFileSync(join(REPO, outPath), JSON.stringify(out, null, 2));
  console.log(`Wrote ${outPath} (${records.length} PCONs)`);
}

main();
