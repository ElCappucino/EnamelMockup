interface Pt {
  x: number
  y: number
}

function isForeground(mask: Uint8Array, width: number, height: number, x: number, y: number) {
  if (x < 0 || y < 0 || x >= width || y >= height) return false
  return mask[y * width + x] === 1
}

// 8-neighborhood offsets in clockwise order, starting West (screen coords, y-down).
const NEIGHBORS: Pt[] = [
  { x: -1, y: 0 },
  { x: -1, y: -1 },
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
]

/** Moore-neighbor boundary trace of the first foreground blob found in raster order. */
export function traceBoundary(mask: Uint8Array, width: number, height: number): Pt[] | null {
  let start: Pt | null = null
  outer: for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isForeground(mask, width, height, x, y)) {
        start = { x, y }
        break outer
      }
    }
  }
  if (!start) return null

  const boundary: Pt[] = [start]
  let backtrack: Pt = { x: start.x - 1, y: start.y }
  let current = start
  const maxSteps = width * height * 4

  for (let step = 0; step < maxSteps; step++) {
    let bIdx = NEIGHBORS.findIndex(
      (d) => current.x + d.x === backtrack.x && current.y + d.y === backtrack.y,
    )
    if (bIdx === -1) bIdx = 0

    let found = false
    for (let i = 1; i <= 8; i++) {
      const idx = (bIdx + i) % 8
      const nx = current.x + NEIGHBORS[idx].x
      const ny = current.y + NEIGHBORS[idx].y
      if (isForeground(mask, width, height, nx, ny)) {
        backtrack = current
        current = { x: nx, y: ny }
        boundary.push(current)
        found = true
        break
      }
    }
    if (!found) break
    if (current.x === start.x && current.y === start.y) break
  }

  return boundary
}

/** Chaikin corner-cutting smoothing on a closed polyline. */
export function chaikinSmooth(points: Pt[], iterations: number): Pt[] {
  let pts = points
  for (let it = 0; it < iterations; it++) {
    const next: Pt[] = []
    const n = pts.length
    for (let i = 0; i < n; i++) {
      const p0 = pts[i]
      const p1 = pts[(i + 1) % n]
      next.push({ x: 0.75 * p0.x + 0.25 * p1.x, y: 0.75 * p0.y + 0.25 * p1.y })
      next.push({ x: 0.25 * p0.x + 0.75 * p1.x, y: 0.25 * p0.y + 0.75 * p1.y })
    }
    pts = next
  }
  return pts
}

function perpendicularDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len
}

/** Ramer-Douglas-Peucker simplification of an (approximately closed) polyline. */
export function simplify(points: Pt[], epsilon: number): Pt[] {
  if (points.length < 3) return points
  let dmax = 0
  let index = 0
  const end = points.length - 1
  for (let i = 1; i < end; i++) {
    const d = perpendicularDistance(points[i], points[0], points[end])
    if (d > dmax) {
      dmax = d
      index = i
    }
  }
  if (dmax > epsilon) {
    const left = simplify(points.slice(0, index + 1), epsilon)
    const right = simplify(points.slice(index), epsilon)
    return left.slice(0, -1).concat(right)
  }
  return [points[0], points[end]]
}

export interface UVTransform {
  scale: number
  cx: number
  cy: number
  canvasSize: number
}

export interface NormalizedOutline {
  points: { x: number; y: number }[]
  uv: UVTransform
}

/** Computes a shape-space transform (center + scale) from a polygon's bounding box. */
export function computeTransform(poly: Pt[], canvasSize: number, halfExtent = 0.92): UVTransform {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const p of poly) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  const w = maxX - minX
  const h = maxY - minY
  const scale = (2 * halfExtent) / Math.max(w, h, 1)
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  return { scale, cx, cy, canvasSize }
}

/** Applies a shape-space transform (y-up) to a polygon, e.g. one produced by computeTransform. */
export function applyTransform(poly: Pt[], t: UVTransform): { x: number; y: number }[] {
  return poly.map((p) => ({
    x: (p.x - t.cx) * t.scale,
    y: -(p.y - t.cy) * t.scale,
  }))
}

/** Centers + scales a traced polygon into roughly [-halfExtent, halfExtent] shape space, y-up. */
export function normalizeOutline(
  poly: Pt[],
  canvasSize: number,
  halfExtent = 0.92,
): NormalizedOutline {
  const uv = computeTransform(poly, canvasSize, halfExtent)
  return { points: applyTransform(poly, uv), uv }
}

/** Ray-casting point-in-polygon test. */
export function pointInPolygon(point: { x: number; y: number }, polygon: { x: number; y: number }[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x
    const yi = polygon[i].y
    const xj = polygon[j].x
    const yj = polygon[j].y
    const intersect =
      yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

/** Positive for a counter-clockwise polygon in a y-up coordinate system. Matches the convention
 * three.js `ShapeUtils.area` uses, so winding decisions here agree with ExtrudeGeometry's. */
export function signedArea(points: { x: number; y: number }[]): number {
  let a = 0
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    const q = points[(i + 1) % points.length]
    a += p.x * q.y - q.x * p.y
  }
  return a / 2
}

/** Returns the polygon wound in the requested direction, reversing a copy only when needed. */
export function ensureWinding<T extends { x: number; y: number }>(
  points: T[],
  clockwise: boolean,
): T[] {
  const isClockwise = signedArea(points) < 0
  return isClockwise === clockwise ? points : [...points].reverse()
}

/** Pulls a point toward `center` until it lands inside `polygon`. Returns the original point if
 * it was already inside. Used to repair region boundaries that stray a pixel or two outside the
 * outline, without discarding the region entirely. */
export function clampInsidePolygon(
  point: { x: number; y: number },
  polygon: { x: number; y: number }[],
  center: { x: number; y: number },
  steps = 24,
): { x: number; y: number } {
  if (pointInPolygon(point, polygon)) return point
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const candidate = {
      x: point.x + (center.x - point.x) * t,
      y: point.y + (center.y - point.y) * t,
    }
    if (pointInPolygon(candidate, polygon)) return candidate
  }
  return center
}

/** Miter-based inward polygon offset. Winding-aware, with the miter length clamped so sharp
 * corners don't shoot out into spikes. */
export function insetPolygon(
  points: { x: number; y: number }[],
  distance: number,
): { x: number; y: number }[] {
  const n = points.length
  if (n < 3 || distance === 0) return points

  // Interior lies to the left of each directed edge for a counter-clockwise polygon; the sign
  // flips that convention for clockwise input.
  let area2 = 0
  for (let i = 0; i < n; i++) {
    const a = points[i]
    const b = points[(i + 1) % n]
    area2 += a.x * b.y - b.x * a.y
  }
  const sign = area2 >= 0 ? 1 : -1

  const result: { x: number; y: number }[] = []
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n]
    const cur = points[i]
    const next = points[(i + 1) % n]

    const e1x = cur.x - prev.x
    const e1y = cur.y - prev.y
    const e2x = next.x - cur.x
    const e2y = next.y - cur.y
    const l1 = Math.hypot(e1x, e1y) || 1
    const l2 = Math.hypot(e2x, e2y) || 1

    const n1x = (-e1y / l1) * sign
    const n1y = (e1x / l1) * sign
    const n2x = (-e2y / l2) * sign
    const n2y = (e2x / l2) * sign

    let mx = n1x + n2x
    let my = n1y + n2y
    const denom = 1 + (n1x * n2x + n1y * n2y)
    if (Math.abs(denom) < 1e-6) {
      // Edges double back on themselves; a single edge normal is the safe fallback.
      mx = n1x
      my = n1y
    } else {
      mx /= denom
      my /= denom
    }

    const len = Math.hypot(mx, my)
    const maxMiter = 3
    if (len > maxMiter) {
      mx = (mx / len) * maxMiter
      my = (my / len) * maxMiter
    }

    result.push({ x: cur.x + mx * distance, y: cur.y + my * distance })
  }
  return result
}

export type { Pt }
