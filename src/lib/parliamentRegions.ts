import { readFileSync } from "node:fs";
import path from "node:path";
import { geoContains } from "d3-geo";

/**
 * The twelve nations and English regions used as constituency hubs at
 * /seats/parliament/<slug>/.
 *
 * `key` is the region value the GE model writes on each constituency record;
 * `ons` is the ONS region name in data/geography/lad24-to-region.json, used
 * only for the fallback below. The hub slugs share a URL level with the 650
 * constituency slugs, so tests/parliament-regions.test.ts fails on a clash.
 */
export interface ParliamentRegion {
  key: string;
  slug: string;
  name: string;
  /** As it reads mid-sentence: "the North East", "London". */
  prose: string;
  ons: string;
}

export const PARLIAMENT_REGIONS: ParliamentRegion[] = [
  { key: "north_east", slug: "north-east", name: "North East", prose: "the North East", ons: "North East" },
  { key: "north_west", slug: "north-west", name: "North West", prose: "the North West", ons: "North West" },
  { key: "yorkshire", slug: "yorkshire-and-the-humber", name: "Yorkshire and the Humber", prose: "Yorkshire and the Humber", ons: "Yorkshire and The Humber" },
  { key: "east_midlands", slug: "east-midlands", name: "East Midlands", prose: "the East Midlands", ons: "East Midlands" },
  { key: "west_midlands", slug: "west-midlands", name: "West Midlands", prose: "the West Midlands", ons: "West Midlands" },
  { key: "east_of_england", slug: "east-of-england", name: "East of England", prose: "the East of England", ons: "East of England" },
  { key: "london", slug: "london", name: "London", prose: "London", ons: "London" },
  { key: "south_east", slug: "south-east", name: "South East", prose: "the South East", ons: "South East" },
  { key: "south_west", slug: "south-west", name: "South West", prose: "the South West", ons: "South West" },
  { key: "wales", slug: "wales", name: "Wales", prose: "Wales", ons: "Wales" },
  { key: "scotland", slug: "scotland", name: "Scotland", prose: "Scotland", ons: "Scotland" },
  { key: "northern_ireland", slug: "northern-ireland", name: "Northern Ireland", prose: "Northern Ireland", ons: "Northern Ireland" },
];

const BY_KEY = new Map(PARLIAMENT_REGIONS.map((r) => [r.key, r]));
const BY_ONS = new Map(PARLIAMENT_REGIONS.map((r) => [r.ons, r]));

type GeoFeature = { properties: Record<string, string>; geometry: { type: string; coordinates: any } };

let _pcon: Map<string, GeoFeature> | null = null;
let _lad: GeoFeature[] | null = null;
let _ladRegion: Record<string, { region_name: string }> | null = null;

function readJson(rel: string) {
  return JSON.parse(readFileSync(path.join(process.cwd(), rel), "utf8"));
}

function boundaryPoints(feature: GeoFeature): Array<[number, number]> {
  const rings: Array<Array<[number, number]>> =
    feature.geometry.type === "MultiPolygon"
      ? feature.geometry.coordinates.flat()
      : feature.geometry.coordinates;
  const points = rings.flat();
  const step = Math.max(1, Math.floor(points.length / 60));
  return points.filter((_, i) => i % step === 0);
}

/**
 * Region for an English seat the model left without one.
 *
 * Fifteen seats in Cumberland, Westmorland and Furness, North Yorkshire and
 * Somerset carry pre-2023 district codes that the ONS region lookup no longer
 * lists, so their model record has region null. Rather than type a table,
 * this places the seat in whichever current local authority contains most of
 * a sample of its own boundary points (a centroid can fall in the sea: Barrow
 * and Furness's lies in Morecambe Bay), then reads that authority's region from
 * the ONS lookup.
 */
const _fromBoundary = new Map<string, ParliamentRegion | null>();
function regionFromBoundary(pcon24cd: string): ParliamentRegion | null {
  if (_fromBoundary.has(pcon24cd)) return _fromBoundary.get(pcon24cd)!;
  _pcon ||= new Map(
    (readJson("data/geography/pcon24-buc-raw.geojson").features as GeoFeature[]).map((f) => [f.properties.PCON24CD, f]),
  );
  _lad ||= readJson("data/geography/lad24-buc-raw.geojson").features as GeoFeature[];
  const ladRegion: Record<string, { region_name: string }> = (_ladRegion ||= readJson("data/geography/lad24-to-region.json"));
  const seat = _pcon.get(pcon24cd);
  if (!seat) {
    _fromBoundary.set(pcon24cd, null);
    return null;
  }
  const votes = new Map<string, number>();
  for (const point of boundaryPoints(seat)) {
    const lad = _lad.find((f) => geoContains(f as any, point));
    const region = lad && ladRegion[lad.properties.LAD24CD]?.region_name;
    if (region) votes.set(region, (votes.get(region) || 0) + 1);
  }
  const winner = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const region = winner ? BY_ONS.get(winner) || null : null;
  _fromBoundary.set(pcon24cd, region);
  return region;
}

const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
let _codeByName: Map<string, string> | null = null;
function pconCode(record: { name?: string | null; pcon24cd?: string | null }): string | null {
  if (record.pcon24cd) return record.pcon24cd;
  if (!record.name) return null;
  _pcon ||= new Map(
    (readJson("data/geography/pcon24-buc-raw.geojson").features as GeoFeature[]).map((f) => [f.properties.PCON24CD, f]),
  );
  _codeByName ||= new Map([..._pcon.values()].map((f) => [normName(f.properties.PCON24NM), f.properties.PCON24CD]));
  return _codeByName.get(normName(record.name)) || null;
}

const NATION_BY_PREFIX: Record<string, string> = { E: "england", S: "scotland", W: "wales", N: "northern_ireland" };

/**
 * The hub a constituency belongs to. The ONS code decides the nation where
 * there is one, because the model record can be wrong: Motherwell, Wishaw and
 * Carluke carries country "england" and no code (found 4 Oct 2026), and is
 * matched here by name to S14000099 in the ONS boundary file.
 */
export function regionForSeat(record: { name?: string | null; country?: string | null; region?: string | null; pcon24cd?: string | null }): ParliamentRegion | null {
  const code = pconCode(record);
  const nation = (code && NATION_BY_PREFIX[code[0]]) || record.country || null;
  if (nation && nation !== "england") return BY_KEY.get(nation) || null;
  if (record.region && BY_KEY.has(record.region)) return BY_KEY.get(record.region)!;
  return code ? regionFromBoundary(code) : null;
}

export function getParliamentRegion(slug: string): ParliamentRegion | null {
  return PARLIAMENT_REGIONS.find((r) => r.slug === slug) || null;
}

export function getParliamentRegionPaths(): string[] {
  return PARLIAMENT_REGIONS.map((r) => `/seats/parliament/${r.slug}/`);
}

let _byRegion: Map<string, any[]> | null = null;
/** Every constituency record grouped by hub slug, alphabetical within each. */
export function seatsByRegion(records: any[]): Map<string, any[]> {
  if (_byRegion) return _byRegion;
  const out = new Map<string, any[]>(PARLIAMENT_REGIONS.map((r) => [r.slug, []]));
  for (const rec of records) {
    const region = regionForSeat(rec);
    if (region) out.get(region.slug)!.push(rec);
  }
  for (const list of out.values()) list.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  _byRegion = out;
  return out;
}
