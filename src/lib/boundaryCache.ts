/**
 * Shared, process-lifetime cache of the boundary files in `data/geography/`.
 *
 * WHY THIS IS A MODULE AND NOT A CONST IN MiniMap.astro.
 *
 * An `.astro` frontmatter fence is the component's render body: it re-runs on
 * every single render, so a `const _cache = new Map()` written there is a
 * fresh, empty Map for each page, not a module-level singleton. MiniMap.astro
 * held its cache that way and claimed in a comment to load "once per Astro
 * process". Instrumenting the build on 2 Sep 2026 showed it re-read, rewound
 * and re-indexed every boundary file 2,957 times, once per page that draws a
 * mini-map, for a cumulative 149 seconds. It was the single largest cost in
 * the site build and had been there for as long as the component had.
 *
 * A real ES module is evaluated once per process, so the cache below actually
 * caches. Anything that wants boundaries should come through here.
 *
 * TWO TIERS PER KIND. `file` is the detail tier, used for the feature a
 * mini-map is actually about; `contextFile` is the cheap tier, used for the
 * grey neighbours drawn behind it. See scripts/simplify-boundaries.mjs.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { rewindFeatures } from "./geoRewind";

export const BOUNDARY_REGISTRY = {
  pcon: {
    file: "data/geography/pcon24-detail.geojson",
    contextFile: "data/geography/pcon24-simplified.geojson",
    codeField: "PCON24CD",
    nameField: "PCON24NM",
  },
  lad: {
    file: "data/geography/lad24-detail.geojson",
    contextFile: "data/geography/lad24-simplified.geojson",
    codeField: "LAD24CD",
    nameField: "LAD24NM",
  },
  ward: {
    file: "data/geography/wd25-detail.geojson",
    contextFile: "data/geography/wd25-simplified.geojson",
    codeField: "WD25CD",
    nameField: "WD25NM",
  },
} as const;

export type BoundaryKind = keyof typeof BOUNDARY_REGISTRY;
export type Bbox = [number, number, number, number];

export type BoundaryCache = {
  /** Context features, from the simplified tier. Scanned for neighbours. */
  features: Array<any>;
  /** Focal lookup, from the detail tier. */
  byCode: Map<string, any>;
  byName: Map<string, any>;
  /**
   * Every context feature's bounding box, computed once at index time.
   *
   * The neighbour scan tests the focal bbox against every other feature in the
   * layer, so computing these on demand meant re-walking every coordinate of
   * all 8,405 ward features on each ward page. Hoisting it here makes the scan
   * cost depend on the number of features rather than on their detail.
   */
  bboxes: WeakMap<any, Bbox>;
};

/**
 * A plain planar coordinate min/max, which is all the neighbour-bbox
 * intersection check needs. Rings reaching here have already been rewound at
 * load, so d3-geo's `geoBounds` would work too, but it costs a spherical pass
 * we have no use for at this scale.
 */
export function flatBbox(feature: any): Bbox {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const visit = (n: any): void => {
    if (typeof n[0] === "number" && typeof n[1] === "number") {
      if (n[0] < x0) x0 = n[0];
      if (n[1] < y0) y0 = n[1];
      if (n[0] > x1) x1 = n[0];
      if (n[1] > y1) y1 = n[1];
      return;
    }
    for (const c of n) visit(c);
  };
  visit(feature.geometry?.coordinates ?? []);
  if (!Number.isFinite(x0)) return [0, 0, 0, 0];
  return [x0, y0, x1, y1];
}

export function normName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[,'’]/g, "")
    .replace(/[-‐‑‒–.]/g, " ")
    .replace(/&/g, "and")
    .replace(/\s+/g, " ")
    .trim();
}

const _cache = new Map<BoundaryKind, BoundaryCache>();

function readBoundaries(file: string): any[] | null {
  const p = resolve(process.cwd(), file);
  if (!existsSync(p)) return null;
  const raw = JSON.parse(readFileSync(p, "utf8")) as { features: any[] };
  // Rewinding at load time fixes the winding for every consumer of the cache
  // at once. See src/lib/geoRewind.ts for why this is necessary.
  return rewindFeatures(raw.features);
}

export function loadBoundaries(kind: BoundaryKind): BoundaryCache | null {
  const hit = _cache.get(kind);
  if (hit) return hit;
  const reg = BOUNDARY_REGISTRY[kind];

  const detail = readBoundaries(reg.file);
  if (!detail) return null;
  // The context tier is an optimisation, not a requirement. If it is missing,
  // fall back to drawing neighbours from the detail features so the map still
  // renders, just more expensively.
  const context = readBoundaries(reg.contextFile) ?? detail;

  const byCode = new Map<string, any>();
  const byName = new Map<string, any>();
  for (const f of detail) {
    const code = f?.properties?.[reg.codeField];
    const name = f?.properties?.[reg.nameField];
    if (code) byCode.set(code, f);
    if (name) byName.set(normName(name), f);
  }
  const bboxes = new WeakMap<any, Bbox>();
  for (const f of context) bboxes.set(f, flatBbox(f));

  const cache: BoundaryCache = { features: context, byCode, byName, bboxes };
  _cache.set(kind, cache);
  return cache;
}
