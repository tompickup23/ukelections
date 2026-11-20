/**
 * Match the areas a council elected by on 7 May 2026 to boundaries on file.
 *
 * Most councils carry ONS ward codes in `wards-may-2026.json` and match
 * `wd26-bgc.geojson` directly. Two groups do not:
 *
 * - councils whose wards were redrawn for 2026 carry Democracy Club slugs in
 *   place of codes, so they are matched by ward name inside the council;
 * - county councils elect by division. Some carry ONS division codes and the
 *   rest slugs, so they are matched to `ced26-bgc.geojson` by code, then by
 *   name inside the county.
 *
 * A name match is only ever made inside one council or county, and only when
 * the name is unique there. Nothing is matched across councils, and nothing
 * is matched on a near miss: the one spelling that differs between Democracy
 * Club and ONS is listed in ALIASES.
 */

export type AreaKind = "ward" | "division";

export interface BoundaryFeature {
  type: string;
  geometry: any;
  properties: Record<string, string>;
}

export interface AreaRow {
  gss_code?: string | null;
  ward_name: string;
}

export interface BoundaryMatch<T> {
  kind: AreaKind;
  /** Every boundary of the council or county, voting or not. */
  features: BoundaryFeature[];
  /** Boundary code to the row that voted there. */
  byCode: Map<string, T>;
  codeField: string;
  nameField: string;
}

// Democracy Club spelling to ONS spelling, after normalising, per council.
const ALIASES: Record<string, Record<string, string>> = {
  Essex: { "harlow parndon and toddbrook": "harlow parndon and todbrook" },
};

export function normaliseAreaName(name: string): string {
  return name
    .toLowerCase()
    .replace(/ ed$/, "")
    .replace(/&/g, "and")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** A map with areas missing would mislead, so it needs nearly all of them. */
const enough = (matched: number, total: number) => total >= 3 && matched >= Math.ceil(total * 0.9);

function joinWithin<T extends AreaRow>(
  rows: T[],
  councilName: string,
  pool: BoundaryFeature[],
  codeField: string,
  nameField: string,
): Map<string, T> {
  const byName = new Map<string, BoundaryFeature[]>();
  for (const f of pool) {
    const key = normaliseAreaName(f.properties[nameField]);
    byName.set(key, [...(byName.get(key) ?? []), f]);
  }
  const codes = new Set(pool.map((f) => f.properties[codeField]));
  const out = new Map<string, T>();
  for (const row of rows) {
    if (row.gss_code && codes.has(row.gss_code)) {
      out.set(row.gss_code, row);
      continue;
    }
    const key = normaliseAreaName(row.ward_name);
    const candidates = byName.get(ALIASES[councilName]?.[key] ?? key) ?? [];
    if (candidates.length === 1) out.set(candidates[0].properties[codeField], row);
  }
  return out;
}

export function matchCouncilBoundaries<T extends AreaRow>(
  rows: T[],
  councilName: string,
  wards: BoundaryFeature[],
  divisions: BoundaryFeature[],
): BoundaryMatch<T> | null {
  // 1. ONS ward codes, the ordinary case. The council is whichever one the
  //    matched wards sit in, so its name need not agree with ours.
  const wardCodes = new Map(wards.map((f) => [f.properties.WD26CD, f]));
  const coded = rows.filter((r) => r.gss_code && wardCodes.has(r.gss_code));
  if (enough(coded.length, rows.length)) {
    const lad = wardCodes.get(coded[0].gss_code!)!.properties.LAD26CD;
    return {
      kind: "ward",
      features: wards.filter((f) => f.properties.LAD26CD === lad),
      byCode: new Map(coded.map((r) => [r.gss_code!, r])),
      codeField: "WD26CD",
      nameField: "WD26NM",
    };
  }

  // 2. Ward names inside the council of the same name, then 3. divisions
  //    inside the county of the same name.
  const attempts: [AreaKind, BoundaryFeature[], string, string][] = [
    ["ward", wards.filter((f) => f.properties.LAD26NM === councilName), "WD26CD", "WD26NM"],
    ["division", divisions.filter((f) => f.properties.CTY25NM === councilName), "CED26CD", "CED26NM"],
  ];
  for (const [kind, pool, codeField, nameField] of attempts) {
    if (pool.length === 0) continue;
    const byCode = joinWithin(rows, councilName, pool, codeField, nameField);
    if (enough(byCode.size, rows.length)) return { kind, features: pool, byCode, codeField, nameField };
  }
  return null;
}

/**
 * What a council elects by. County councils elect by division: the county is
 * one of the counties named in the ONS division layer. This is the same test
 * the map's division attempt applies (CTY25NM equal to the council name), so
 * the page's headings and the map's label cannot disagree. East Surrey and
 * West Surrey are not "Surrey" and stay ward councils.
 */
export function councilAreaKind(councilName: string | null | undefined, divisions: BoundaryFeature[]): AreaKind {
  if (!councilName) return "ward";
  return divisions.some((f) => f.properties.CTY25NM === councilName) ? "division" : "ward";
}

export interface AreaNoun {
  kind: AreaKind;
  /** "ward" or "division" */
  one: string;
  /** "wards" or "divisions" */
  many: string;
  /** "Ward" or "Division" */
  One: string;
  /** "Wards" or "Divisions" */
  Many: string;
}

export function areaNoun(kind: AreaKind): AreaNoun {
  const one = kind === "division" ? "division" : "ward";
  const One = one[0].toUpperCase() + one.slice(1);
  return { kind, one, many: `${one}s`, One, Many: `${One}s` };
}
