import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");
const localRoutePath = path.join(projectRoot, "src/data/live/local-route-latest.json");
const hotelLedgerPath = path.join(projectRoot, "src/data/live/hotel-entity-ledger.json");
const outputPath = path.join(projectRoot, "src/data/live/place-boundaries.json");

const BOUNDARY_SERVICE_URL =
  "https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/Local_Authority_Districts_May_2024_Boundaries_UK_BFC/FeatureServer/0/query";

const VIEWBOX_WIDTH = 620;
const VIEWBOX_HEIGHT = 760;
const VIEWBOX_PADDING = 24;

function formatNumber(value) {
  return Number(value.toFixed(1));
}

function simplifyRing(ring) {
  if (!Array.isArray(ring) || ring.length < 4) {
    return ring;
  }

  const openRing = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring.slice(0, -1)
    : ring.slice();

  const maxPoints = 900;

  if (openRing.length <= maxPoints) {
    return [...openRing, openRing[0]];
  }

  const stride = Math.max(1, Math.ceil(openRing.length / maxPoints));
  const simplified = [];

  for (let index = 0; index < openRing.length; index += stride) {
    simplified.push(openRing[index]);
  }

  const lastPoint = openRing[openRing.length - 1];
  const lastSimplifiedPoint = simplified[simplified.length - 1];

  if (!lastSimplifiedPoint || lastSimplifiedPoint[0] !== lastPoint[0] || lastSimplifiedPoint[1] !== lastPoint[1]) {
    simplified.push(lastPoint);
  }

  if (simplified.length < 3) {
    return ring;
  }

  return [...simplified, simplified[0]];
}

function computeBounds(rings) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  return { minX, minY, maxX, maxY };
}

function createTransform(bounds) {
  const width = bounds.maxX - bounds.minX || 1;
  const height = bounds.maxY - bounds.minY || 1;
  const scale = Math.min(
    (VIEWBOX_WIDTH - VIEWBOX_PADDING * 2) / width,
    (VIEWBOX_HEIGHT - VIEWBOX_PADDING * 2) / height
  );
  const offsetX = (VIEWBOX_WIDTH - width * scale) / 2;
  const offsetY = (VIEWBOX_HEIGHT - height * scale) / 2;

  return (point) => [
    formatNumber(offsetX + (point[0] - bounds.minX) * scale),
    formatNumber(VIEWBOX_HEIGHT - offsetY - (point[1] - bounds.minY) * scale)
  ];
}

function buildPath(rings, transformPoint) {
  return rings
    .map((ring) => {
      if (!ring.length) {
        return "";
      }

      const transformedRing = [];

      for (const point of ring) {
        const transformedPoint = transformPoint(point);
        const previousPoint = transformedRing[transformedRing.length - 1];

        if (!previousPoint || Math.hypot(transformedPoint[0] - previousPoint[0], transformedPoint[1] - previousPoint[1]) >= 0.7) {
          transformedRing.push(transformedPoint);
        }
      }

      if (transformedRing.length < 3) {
        return "";
      }

      const [firstX, firstY] = transformedRing[0];
      const commands = [`M${firstX} ${firstY}`];

      for (let index = 1; index < transformedRing.length; index += 1) {
        const [x, y] = transformedRing[index];
        commands.push(`L${x} ${y}`);
      }

      commands.push("Z");
      return commands.join("");
    })
    .join("");
}

function findLargestRing(rings) {
  let winner = rings[0] ?? [];
  let winnerArea = 0;

  for (const ring of rings) {
    let area = 0;

    for (let index = 0; index < ring.length - 1; index += 1) {
      const [x1, y1] = ring[index];
      const [x2, y2] = ring[index + 1];
      area += x1 * y2 - x2 * y1;
    }

    const absoluteArea = Math.abs(area / 2);

    if (absoluteArea > winnerArea) {
      winner = ring;
      winnerArea = absoluteArea;
    }
  }

  return winner;
}

function buildLabelPoint(rings, transformPoint) {
  const ring = findLargestRing(rings);
  const bounds = computeBounds([ring]);
  const centre = [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2];
  const [labelX, labelY] = transformPoint(centre);
  return { labelX, labelY };
}

function collectPublicAreaMap(localRouteLatest, hotelLedger) {
  const topCodes = new Set(
    (localRouteLatest.topAreasByMetric ?? []).flatMap((group) =>
      (group.rows ?? []).map((row) => row.areaCode).filter(Boolean)
    )
  );
  const hotelLinkedCodes = new Set(
    [
      ...(hotelLedger.sites ?? []).map((site) => site.areaCode),
      ...(hotelLedger.areas ?? []).map((area) => area.areaCode)
    ].filter(Boolean)
  );

  return new Map(
    (localRouteLatest.areas ?? [])
      .filter(
        (area) => topCodes.has(area.areaCode) || area.supportedAsylum >= 200 || hotelLinkedCodes.has(area.areaCode)
      )
      .map((area) => [area.areaCode, area])
  );
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Boundary fetch failed with ${response.status}`);
  }

  return response.json();
}

async function fetchBoundaryFeatures() {
  const idsUrl = `${BOUNDARY_SERVICE_URL}?where=1%3D1&returnIdsOnly=true&f=pjson`;
  const idsPayload = await fetchJson(idsUrl);
  const objectIds = Array.isArray(idsPayload.objectIds) ? idsPayload.objectIds : [];

  if (!objectIds.length) {
    throw new Error("Boundary response did not include object ids");
  }

  const chunkSize = 24;
  const features = [];

  for (let index = 0; index < objectIds.length; index += chunkSize) {
    const chunk = objectIds.slice(index, index + chunkSize).join(",");
    const chunkUrl =
      `${BOUNDARY_SERVICE_URL}?objectIds=${chunk}&outFields=LAD24CD%2CLAD24NM` +
      "&returnGeometry=true&outSR=27700&f=pjson";
    const payload = await fetchJson(chunkUrl);

    if (!Array.isArray(payload.features)) {
      throw new Error(`Boundary chunk ${index / chunkSize + 1} did not include a features array`);
    }

    features.push(...payload.features);
  }

  return features;
}

async function main() {
  const [localRouteLatest, hotelLedger] = await Promise.all([
    fs.readFile(localRoutePath, "utf8").then((value) => JSON.parse(value)),
    fs.readFile(hotelLedgerPath, "utf8").then((value) => JSON.parse(value))
  ]);
  const publicAreaByCode = collectPublicAreaMap(localRouteLatest, hotelLedger);
  const features = await fetchBoundaryFeatures();
  const regionBuckets = new Map();

  for (const feature of features) {
    const areaCode = feature?.attributes?.LAD24CD;
    const area = publicAreaByCode.get(areaCode);

    if (!area) {
      continue;
    }

    const rawRings = Array.isArray(feature?.geometry?.rings) ? feature.geometry.rings : [];
    const rings = rawRings
      .filter((ring) => Array.isArray(ring) && ring.length >= 4)
      .map((ring) => simplifyRing(ring));

    if (!rings.length) {
      continue;
    }

    const bucket = regionBuckets.get(area.regionName) ?? {
      regionName: area.regionName,
      countryName: area.countryName,
      entries: []
    };

    bucket.entries.push({
      areaCode: area.areaCode,
      areaName: area.areaName,
      rings
    });

    regionBuckets.set(area.regionName, bucket);
  }

  const regions = {};

  for (const [regionName, bucket] of [...regionBuckets.entries()].sort((left, right) =>
    left[0].localeCompare(right[0])
  )) {
    const bounds = computeBounds(bucket.entries.flatMap((entry) => entry.rings));
    const transformPoint = createTransform(bounds);

    regions[regionName] = {
      countryName: bucket.countryName,
      areaCount: bucket.entries.length,
      areas: bucket.entries
        .sort((left, right) => left.areaName.localeCompare(right.areaName))
        .map((entry) => ({
          areaCode: entry.areaCode,
          areaName: entry.areaName,
          path: buildPath(entry.rings, transformPoint),
          ...buildLabelPoint(entry.rings, transformPoint)
        }))
    };
  }

  const output = {
    generatedAt: new Date().toISOString(),
    source: {
      name: "ONS Open Geography Portal via ArcGIS",
      dataset: "Local Authority Districts (May 2024) Boundaries UK BFC",
      url: BOUNDARY_SERVICE_URL
    },
    width: VIEWBOX_WIDTH,
    height: VIEWBOX_HEIGHT,
    regions
  };

  await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);

  console.log(
    `Wrote ${Object.keys(regions).length} regional authority maps to ${path.relative(projectRoot, outputPath)}`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
