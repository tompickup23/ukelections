// Page through an ONS Open Geography Portal feature layer as GeoJSON and
// round its coordinates to 5 decimal places (about 1m), which is well inside
// the 20m generalisation of a BGC layer and makes shared borders agree
// exactly, as scripts/lib/simplify-shared-borders.mjs needs.

const BASE = "https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/";

const round = (n) => Math.round(n * 1e5) / 1e5;

function roundRing(ring) {
  const out = [];
  for (const [x, y] of ring) {
    const p = [round(x), round(y)];
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  return out;
}

export function roundGeometry(g) {
  if (g.type === "Polygon") return { type: g.type, coordinates: g.coordinates.map(roundRing) };
  if (g.type === "MultiPolygon") {
    return { type: g.type, coordinates: g.coordinates.map((poly) => poly.map(roundRing)) };
  }
  throw new Error(`unexpected geometry type ${g.type}`);
}

async function page(service, fields, offset, pageSize) {
  const params = new URLSearchParams({
    where: "1=1",
    outFields: fields.join(","),
    outSR: "4326",
    orderByFields: fields[0],
    resultOffset: String(offset),
    resultRecordCount: String(pageSize),
    f: "geojson",
  });
  const url = `${BASE}${service}/FeatureServer/0/query?${params}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`ONS layer ${service} answered ${res.status} at offset ${offset}`);
      const body = await res.json();
      if (!Array.isArray(body.features)) throw new Error(`no features from ${service} at offset ${offset}`);
      return body.features;
    } catch (error) {
      if (attempt >= 3) throw error;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

/**
 * Every feature of `service`, keeping only `fields` (the first is the code the
 * pages are ordered by). The walk ends on an empty page, not a short one, so a
 * server that caps pages below `pageSize` is still read to the end.
 */
export async function fetchLayer({ service, fields, pageSize = 50 }) {
  const features = [];
  for (;;) {
    const batch = await page(service, fields, features.length, pageSize);
    if (batch.length === 0) break;
    for (const f of batch) {
      features.push({
        type: "Feature",
        geometry: roundGeometry(f.geometry),
        properties: Object.fromEntries(fields.map((k) => [k, f.properties[k]])),
      });
    }
  }
  return features;
}
