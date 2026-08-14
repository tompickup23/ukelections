/**
 * Ring-winding normalisation for the boundary files in `data/geography/`.
 *
 * d3-geo does spherical geometry, where a ring wound the wrong way is not "the
 * same polygon drawn backwards", it is the COMPLEMENT: everything on the globe
 * except the shape. Every feature in `pcon24-simplified.geojson`,
 * `lad24-simplified.geojson` and `wd25-simplified.geojson` is wound the
 * opposite way to what d3 wants. All 650 PCON, 361 LAD and 8,405 WD features
 * returned `geoArea` = 12.566 steradians, which is 4*pi, the whole sphere, and
 * `geoBounds` = [[-180, -90], [180, 90]].
 *
 * Downstream that made every fit target the whole world, so `fitExtent` /
 * `fitSize` squeezed the globe into the frame, every boundary collapsed to a
 * sub-pixel speck, and each feature painted the clipped sphere as a
 * full-canvas rectangle. The visible result was a solid coloured square in
 * place of a map, on the general-election choropleth, the by-region map and
 * every MiniMap on the site.
 *
 * The sister site `ukdemographics` hit and fixed the same defect in its own
 * copy of MiniMap; this is that fix, factored out so the three UKE consumers
 * of these files share one implementation.
 *
 * Anything reading `data/geography/*.geojson` and handing it to d3-geo must
 * pass it through `rewindFeatures` first.
 */

/**
 * Planar shoelace. A negative signed area is clockwise in lon/lat, where y
 * (latitude) increases northward. These are small extents, so the planar test
 * is a sound proxy for the spherical winding d3 cares about.
 */
export function ringIsClockwise(ring: number[][]): boolean {
  let area = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    area += x1 * y2 - x2 * y1;
  }
  return area < 0;
}

/** Exterior ring (index 0) clockwise, holes counter-clockwise. */
export function rewindRings(rings: number[][][]): number[][][] {
  return rings.map((ring, i) => {
    const wantClockwise = i === 0;
    return ringIsClockwise(ring) === wantClockwise ? ring : [...ring].reverse();
  });
}

/** Rewind a single geometry. Non-polygon geometries pass through untouched. */
export function rewindGeometry(geometry: any): any {
  if (!geometry) return geometry;
  if (geometry.type === "Polygon") {
    return { ...geometry, coordinates: rewindRings(geometry.coordinates) };
  }
  if (geometry.type === "MultiPolygon") {
    return { ...geometry, coordinates: geometry.coordinates.map(rewindRings) };
  }
  return geometry;
}

/**
 * Rewind every feature in a list, preserving properties. Returns new feature
 * objects; the input is not mutated.
 */
export function rewindFeatures<T extends { geometry: any }>(features: T[]): T[] {
  return features.map((f) => ({ ...f, geometry: rewindGeometry(f.geometry) }));
}

/**
 * Build the clockwise-wound rectangle polygon for a `[x0, y0, x1, y1]` bbox.
 *
 * Counter-clockwise here makes d3 read the rectangle as "the whole globe
 * except this box", which keeps `fitExtent` scaling the world into the frame
 * even once the source rings are fixed.
 */
export function bboxPolygon(bbox: [number, number, number, number]): any {
  const [x0, y0, x1, y1] = bbox;
  return {
    type: "Polygon",
    coordinates: [
      [
        [x0, y0],
        [x0, y1],
        [x1, y1],
        [x1, y0],
        [x0, y0],
      ],
    ],
  };
}
