// Topology-preserving Douglas-Peucker for a polygon coverage.
//
// Simplifying each polygon on its own moves a shared border differently on
// either side and opens slivers between neighbours. This splits every ring at
// its junction vertices (a vertex with other than two distinct neighbours
// across the whole coverage), simplifies each resulting arc once in a
// canonical direction, and hands the identical result to every ring that uses
// it. Coordinates must already agree exactly where features meet, which holds
// for an ONS boundary layer rounded to a fixed precision.
//
// Tolerance is in metres, on a local equirectangular projection. Pass a number
// for one tolerance everywhere, or { fraction, min, max } to scale it to the
// smallest feature that uses each arc: tolerance = clamp(fraction x that
// feature's bounding-box diagonal, min, max). Every feature on a border sees
// the same owners, so both sides still agree, while a small urban seat keeps
// detail that a Highland coastline does not need.

const R = 6371008.8;
const key = (p) => `${p[0]},${p[1]}`;

function rings(feature) {
  const g = feature.geometry;
  if (g.type === "Polygon") return [g.coordinates];
  if (g.type === "MultiPolygon") return g.coordinates;
  throw new Error(`unexpected geometry type ${g.type}`);
}

function openRing(ring) {
  const n = ring.length;
  const closed = n > 1 && ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1];
  return closed ? ring.slice(0, -1) : ring.slice();
}

function perpDistance(p, a, b, kx) {
  const ax = a[0] * kx, ay = a[1];
  const bx = b[0] * kx, by = b[1];
  const px = p[0] * kx, py = p[1];
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const ex = ax + t * dx - px, ey = ay + t * dy - py;
  return Math.sqrt(ex * ex + ey * ey) * (Math.PI / 180) * R;
}

function douglasPeucker(points, tolerance) {
  if (points.length <= 2) return points.slice();
  const lat = points[0][1] * (Math.PI / 180);
  const kx = Math.cos(lat);
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let max = 0, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = perpDistance(points[i], points[s], points[e], kx);
      if (d > max) { max = d; idx = i; }
    }
    if (idx !== -1 && max > tolerance) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function diagonalMetres(feature) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const poly of rings(feature)) for (const ring of poly) for (const [x, y] of ring) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const kx = Math.cos(((y0 + y1) / 2) * (Math.PI / 180));
  const dx = (x1 - x0) * kx, dy = y1 - y0;
  return Math.sqrt(dx * dx + dy * dy) * (Math.PI / 180) * R;
}

export function simplifyCoverage(features, tolerance) {
  const scaled = typeof tolerance === "object";
  const diag = scaled ? features.map(diagonalMetres) : null;
  const owners = new Map();
  // 1. Degree of every vertex across the coverage, and which features use it.
  const neighbours = new Map();
  const note = (a, b) => {
    const ka = key(a);
    let set = neighbours.get(ka);
    if (!set) neighbours.set(ka, (set = new Set()));
    set.add(key(b));
  };
  features.forEach((f, fi) => {
    for (const poly of rings(f)) {
      for (const raw of poly) {
        const ring = openRing(raw);
        for (let i = 0; i < ring.length; i++) {
          if (scaled) {
            const k = key(ring[i]);
            let o = owners.get(k);
            if (!o) owners.set(k, (o = new Set()));
            o.add(fi);
          }
          note(ring[i], ring[(i + 1) % ring.length]);
          note(ring[i], ring[(i - 1 + ring.length) % ring.length]);
        }
      }
    }
  });
  const isNode = (p) => (neighbours.get(key(p))?.size ?? 0) !== 2;

  function toleranceFor(arc) {
    if (!scaled) return tolerance;
    if (arc.length < 3) return tolerance.min;
    // An interior vertex of an arc is used by exactly the features on either
    // side of it, so this is the same set from both sides of the border.
    let smallest = Infinity;
    for (const fi of owners.get(key(arc[1])) ?? []) smallest = Math.min(smallest, diag[fi]);
    const t = tolerance.fraction * smallest;
    return Math.max(tolerance.min, Math.min(tolerance.max, t));
  }

  const cache = new Map();
  function simplifyArc(arc) {
    // Canonical direction so both sides of a border compute the same thing.
    const fwd = arc.map(key).join(";");
    const rev = arc.slice().reverse().map(key).join(";");
    const reversed = rev < fwd;
    const canon = reversed ? rev : fwd;
    let out = cache.get(canon);
    if (!out) {
      out = douglasPeucker(reversed ? arc.slice().reverse() : arc, toleranceFor(arc));
      cache.set(canon, out);
    }
    return reversed ? out.slice().reverse() : out;
  }

  function simplifyRing(raw) {
    const ring = openRing(raw);
    if (ring.length < 3) return null;
    let starts = [];
    for (let i = 0; i < ring.length; i++) if (isNode(ring[i])) starts.push(i);
    if (starts.length === 0) {
      // No junction: an island or an enclave. Start from the smallest vertex
      // so the enclave and its surround split the ring at the same place.
      let best = 0;
      for (let i = 1; i < ring.length; i++) if (key(ring[i]) < key(ring[best])) best = i;
      starts = [best];
    }
    const out = [];
    for (let s = 0; s < starts.length; s++) {
      const from = starts[s];
      const to = s + 1 < starts.length ? starts[s + 1] : starts[0] + ring.length;
      const arc = [];
      for (let i = from; i <= to; i++) arc.push(ring[i % ring.length]);
      let simplified;
      if (starts.length === 1) {
        // A single closed arc: split it in half so Douglas-Peucker has two
        // distinct anchors, then rejoin.
        // Split the canonical orientation, so both rings that share this
        // arc choose the same midpoint.
        const fwd = arc.map(key).join(";");
        const flip = arc.slice().reverse().map(key).join(";") < fwd;
        const canon = flip ? arc.slice().reverse() : arc;
        const mid = Math.floor(canon.length / 2);
        const a = simplifyArc(canon.slice(0, mid + 1));
        const b = simplifyArc(canon.slice(mid));
        const joined = a.concat(b.slice(1));
        simplified = flip ? joined.reverse() : joined;
      } else {
        simplified = simplifyArc(arc);
      }
      out.push(...simplified.slice(0, -1));
    }
    // A collapsed ring returns null; the caller decides whether to drop it.
    if (out.length < 3) return null;
    out.push(out[0]);
    return out;
  }

  function vertexCount(poly) {
    return poly.reduce((n, r) => n + r.length, 0);
  }

  return features.map((f) => {
    const source = rings(f);
    // The feature's main outline is the outer ring of its largest polygon. If
    // that collapses it keeps its original vertices, so no feature vanishes.
    // Any other collapsed ring (a small island, a small hole) is dropped: it
    // is under the tolerance in every direction, which is below a pixel at the
    // scale this file is drawn.
    let main = 0;
    source.forEach((poly, i) => { if (vertexCount(poly) > vertexCount(source[main])) main = i; });
    const polys = [];
    source.forEach((poly, pi) => {
      const outer = simplifyRing(poly[0]) ?? (pi === main ? poly[0] : null);
      if (!outer) return;
      const holes = poly.slice(1).map(simplifyRing).filter(Boolean);
      polys.push([outer, ...holes]);
    });
    const geometry = polys.length === 1
      ? { type: "Polygon", coordinates: polys[0] }
      : { type: "MultiPolygon", coordinates: polys };
    return { ...f, geometry };
  });
}
