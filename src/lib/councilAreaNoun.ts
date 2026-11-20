/**
 * "ward" or "division" for a council, for page text. Reads the ONS county
 * electoral division layer the results map draws from, once per build, and
 * applies the map's own rule (councilAreaKind in wardBoundaryJoin.ts).
 * Routes and data fields keep the word "ward"; only reader-facing text moves.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { areaNoun, councilAreaKind, type AreaNoun, type BoundaryFeature } from "./wardBoundaryJoin";

let divisions: BoundaryFeature[] | null = null;

function divisionFeatures(): BoundaryFeature[] {
  if (!divisions) {
    const raw = JSON.parse(readFileSync(resolve(process.cwd(), "data/geography/ced26-bgc.geojson"), "utf8"));
    // Only the county name is needed; drop the geometry so the cache stays small.
    divisions = (raw.features as BoundaryFeature[]).map((f) => ({ type: f.type, geometry: null, properties: f.properties }));
  }
  return divisions;
}

export function councilAreaNoun(councilName: string | null | undefined): AreaNoun {
  return areaNoun(councilAreaKind(councilName, divisionFeatures()));
}
