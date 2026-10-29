/**
 * Bounded 2D Voronoi cells by half-plane clipping: each site's cell starts as the bounding
 * rectangle and is cut by the perpendicular bisector against every other site
 * (Sutherland–Hodgman against a line). O(k² · vertices), fine for a handful of centroids.
 */

export type Point = [number, number]

export interface Bounds {
  xMin: number
  xMax: number
  yMin: number
  yMax: number
}

/** Keeps the part of `polygon` where a·x + b·y <= c. */
function clipHalfPlane(polygon: Point[], a: number, b: number, c: number): Point[] {
  const out: Point[] = []
  const n = polygon.length
  for (let i = 0; i < n; i++) {
    const p = polygon[i]
    const q = polygon[(i + 1) % n]
    const fp = a * p[0] + b * p[1] - c
    const fq = a * q[0] + b * q[1] - c
    const pIn = fp <= 0
    const qIn = fq <= 0
    if (pIn) out.push(p)
    if (pIn !== qIn) {
      const t = fp / (fp - fq)
      out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])])
    }
  }
  return out
}

/** Returns one clipped polygon per site (empty when the site is a duplicate of a previous one). */
export function voronoiCells(sites: Point[], bounds: Bounds): Point[][] {
  const rect: Point[] = [
    [bounds.xMin, bounds.yMin],
    [bounds.xMax, bounds.yMin],
    [bounds.xMax, bounds.yMax],
    [bounds.xMin, bounds.yMax],
  ]
  return sites.map((s, i) => {
    let cell = rect
    for (let j = 0; j < sites.length && cell.length > 0; j++) {
      if (j === i) continue
      const o = sites[j]
      const dx = o[0] - s[0]
      const dy = o[1] - s[1]
      if (dx === 0 && dy === 0) {
        // Coincident sites: give the cell to the first one
        if (j < i) return []
        continue
      }
      // Points closer to s than to o: (p - m)·(o - s) <= 0 with m the midpoint
      const mx = (s[0] + o[0]) / 2
      const my = (s[1] + o[1]) / 2
      cell = clipHalfPlane(cell, dx, dy, dx * mx + dy * my)
    }
    return cell
  })
}

/** Bounding box of the points padded by `pad` × the larger side (at least `minPad`). */
export function paddedBounds(points: Point[], pad = 0.35, minPad = 0.5): Bounds {
  if (points.length === 0) return { xMin: -1, xMax: 1, yMin: -1, yMax: 1 }
  let xMin = Infinity
  let xMax = -Infinity
  let yMin = Infinity
  let yMax = -Infinity
  for (const [x, y] of points) {
    if (x < xMin) xMin = x
    if (x > xMax) xMax = x
    if (y < yMin) yMin = y
    if (y > yMax) yMax = y
  }
  const side = Math.max(xMax - xMin, yMax - yMin)
  const p = Math.max(side * pad, minPad)
  return { xMin: xMin - p, xMax: xMax + p, yMin: yMin - p, yMax: yMax + p }
}

/** Ray-casting point-in-polygon (polygon is a simple ring without the closing duplicate vertex). */
export function pointInPolygon(p: Point, polygon: Point[]): boolean {
  let inside = false
  const n = polygon.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    const crosses = yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi
    if (crosses) inside = !inside
  }
  return inside
}

/** Shortest distance from a point to the polygon's edges (radius of the largest centred circle that fits). */
export function distanceToEdges(p: Point, polygon: Point[]): number {
  let best = Infinity
  const n = polygon.length
  for (let i = 0; i < n; i++) {
    const [ax, ay] = polygon[i]
    const [bx, by] = polygon[(i + 1) % n]
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / len2)) : 0
    const d = Math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy))
    if (d < best) best = d
  }
  return best
}

/** Distance from `center` along direction `theta` to the polygon's boundary (Infinity when no edge is hit). */
export function rayDistance(center: Point, theta: number, polygon: Point[]): number {
  const dx = Math.cos(theta)
  const dy = Math.sin(theta)
  let best = Infinity
  const n = polygon.length
  for (let i = 0; i < n; i++) {
    const [ax, ay] = polygon[i]
    const [bx, by] = polygon[(i + 1) % n]
    const ex = bx - ax
    const ey = by - ay
    const denom = dx * ey - dy * ex
    if (Math.abs(denom) < 1e-12) continue
    const t = ((ax - center[0]) * ey - (ay - center[1]) * ex) / denom
    const u = ((ax - center[0]) * dy - (ay - center[1]) * dx) / denom
    if (t >= 0 && u >= 0 && u <= 1 && t < best) best = t
  }
  return best
}

/**
 * A point inside `cell` at fraction `f` (0 = centre, 1 = boundary) of the cell's extent in
 * direction `theta`. Without a cell, `f` is applied to `fallbackRadius` instead.
 */
export function placeInCell(center: Point, f: number, theta: number, cell: Point[] | undefined, fallbackRadius: number): Point {
  const reach = cell && cell.length >= 3 ? rayDistance(center, theta, cell) : Infinity
  const r = (isFinite(reach) ? reach : fallbackRadius) * f
  return [center[0] + r * Math.cos(theta), center[1] + r * Math.sin(theta)]
}

/** The cell shrunk towards `center` by factor `f`, closed (first vertex repeated) for drawing. */
export function scaledCell(center: Point, f: number, cell: Point[]): { xs: number[]; ys: number[] } {
  const pts = cell.map(([x, y]): Point => [center[0] + (x - center[0]) * f, center[1] + (y - center[1]) * f])
  if (pts.length > 0) pts.push(pts[0])
  return { xs: pts.map((p) => p[0]), ys: pts.map((p) => p[1]) }
}
