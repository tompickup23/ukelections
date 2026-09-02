#!/usr/bin/env node
// simplify-boundaries.mjs
//
// Turn the raw ONS boundary downloads into the files the site reads. Run it
// after scripts/fetch-boundaries.mjs; the outputs are committed, so neither
// script runs in the nightly pipeline.
//
//   node scripts/simplify-boundaries.mjs           # rebuild every layer
//   node scripts/simplify-boundaries.mjs pcon24    # rebuild one
//
// TWO TIERS PER LAYER, because the two consumers want opposite things.
//
//   *-detail.geojson      MiniMap.astro. Zooms to a single seat/council/ward
//                         at 220x150, so it needs a real outline. Costs the
//                         browser nothing: MiniMap runs at build time and
//                         emits finished SVG, the GeoJSON never ships.
//
//   *-simplified.geojson  The whole-UK maps (ConstituencyChoropleth.astro and
//                         the by-region map) at 800x1000, where one urban seat
//                         is a few pixels. ALSO the grey neighbour context in
//                         every MiniMap: a mini-map draws its focal feature
//                         from the detail tier and everything around it from
//                         this one, because the surrounding shapes are
//                         background and nobody reads their outlines. Building
//                         the context from the detail tier instead tripled the
//                         site build (1m56s to 6m16s) and added ~7KB of path
//                         data to every seat and ward page for no visible gain.
//
//                         These render server-side too, so the file size is not
//                         the payload. what ships is the SVG path data, and
//                         that scales with vertex count. Keep it lean.
//
// WHY interval SCALES WITH sqrt(area).
//
// The old files were simplified at a single global tolerance. Visvalingam
// drops points by "effective area", so a uniform tolerance spends its budget
// where the polygons are big and strips small urban seats to nothing: the
// shipped pcon24-simplified.geojson had a median of 8 vertices per seat and a
// floor of 4. Holborn and St Pancras rendered as a pentagon, Exeter as a
// quadrilateral. Scaling the interval by each feature's own linear size
// (sqrt of its area) asks instead for the same RELATIVE fidelity everywhere,
// so a compact borough keeps its shape while the Highlands still simplify hard.
//
// Measured on the choropleth's own 800x1000 projection, area-proportional is
// about 4x more efficient than uniform at the thing that was actually broken.
// To lift Holborn and St Pancras from 5 vertices to 19, area-proportional cost
// 80KB of gzipped path data and a uniform interval cost 311KB.
//
// SOURCE RESOLUTION. The pcon24/lad24 raws used to be the BUC product, which
// is generalised to 500m. Holborn and St Pancras is an 8-vertex octagon in raw
// BUC, so re-simplifying could never have fixed this. These now build from BGC
// (20m). Wards stay on BSC (200m) because the ward BGC service is published
// TilesOnly and will not answer a feature query. see fetch-boundaries.mjs.

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const LAYERS = {
  pcon24: {
    raw: "data/geography/pcon24-bgc-raw.geojson",
    nameField: "PCON24NM",
    expect: 650,
  },
  lad24: {
    raw: "data/geography/lad24-bgc-raw.geojson",
    nameField: "LAD24NM",
    expect: 361,
  },
  wd25: {
    raw: "data/geography/wd25-bsc-raw.geojson",
    nameField: "WD25NM",
    expect: 8405,
    // BSC is already coarse enough that the floor here is set by the download
    // rather than by this script: Brackla East Central is a 4-vertex
    // quadrilateral in wd25-bsc-raw.geojson itself, and several City of London
    // wards are 5. Nothing here can invent detail the source does not carry,
    // so the guard is set to what BSC can actually deliver.
    floor: 4,
    // Wards are small, so `k * sqrt(area)` stays tiny for them and the shared
    // web k barely simplifies at all. This lands the context tier on 80,553
    // vertices, level with the file it replaces, so mini-map context costs the
    // build exactly what it did before.
    webK: 0.2,
  },
};

// k in `interval = k * sqrt(area)`. Smaller k keeps more points.
const TIERS = {
  detail: { k: 0.012, precision: 0.00001, suffix: "detail", floor: 40 },
  web: { k: 0.1, precision: 0.0001, suffix: "simplified", floor: 10 },
};

function vertexCount(geometry) {
  let n = 0;
  const walk = (node) => {
    if (typeof node[0] === "number") { n++; return; }
    for (const child of node) walk(child);
  };
  if (geometry?.coordinates) walk(geometry.coordinates);
  return n;
}

function build(key, tierName) {
  const layer = LAYERS[key];
  const tier = TIERS[tierName];
  const out = `data/geography/${key}-${tier.suffix}.geojson`;
  const floor = layer.floor ?? tier.floor;
  const k = (tierName === "web" && layer.webK) || tier.k;

  execFileSync(
    "npx",
    [
      "--yes", "mapshaper", layer.raw,
      "-simplify", "variable", `interval=${k} * Math.sqrt(this.area)`,
      // Without keep-shapes a feature whose every point falls below the
      // tolerance is dropped from the layer entirely, and MiniMap's lookup
      // would then find no geometry for that code and silently render nothing.
      "keep-shapes",
      "-o", out, `precision=${tier.precision}`, "force",
    ],
    { stdio: ["ignore", "ignore", "inherit"] }
  );

  const parsed = JSON.parse(readFileSync(out, "utf8"));
  if (parsed.features.length !== layer.expect) {
    throw new Error(`${out}: expected ${layer.expect} features, got ${parsed.features.length}`);
  }

  // Guard the defect this script exists to fix. A feature simplified below a
  // handful of points is not a coarse outline, it is a triangle wearing the
  // name of a constituency, and it looks like a broken graphic rather than a
  // map. Fail the build rather than ship one.
  const counts = parsed.features.map((f) => ({ name: f.properties[layer.nameField], n: vertexCount(f.geometry) }));
  const starved = counts.filter((c) => c.n < floor).sort((a, b) => a.n - b.n);
  if (starved.length) {
    const sample = starved.slice(0, 5).map((c) => `${c.name} (${c.n})`).join(", ");
    throw new Error(`${out}: ${starved.length} feature(s) below the ${floor}-vertex floor: ${sample}`);
  }

  const ns = counts.map((c) => c.n).sort((a, b) => a - b);
  const kb = Math.round(statSync(out).size / 1024);
  console.log(
    `  ${out.padEnd(44)} ${String(kb).padStart(5)}KB  ` +
    `min ${String(ns[0]).padStart(4)}  median ${String(ns[Math.floor(ns.length / 2)]).padStart(4)}  ` +
    `total ${ns.reduce((s, n) => s + n, 0)} vertices`
  );
}

const wanted = process.argv.slice(2);
const keys = wanted.length ? wanted : Object.keys(LAYERS);
for (const key of keys) {
  if (!LAYERS[key]) throw new Error(`unknown layer "${key}" (have: ${Object.keys(LAYERS).join(", ")})`);
  console.log(`${key} (from ${LAYERS[key].raw})`);
  build(key, "detail");
  build(key, "web");
}
