import { chaikinSmooth, simplify, traceBoundary, type Pt } from './contour'

interface LabelResult {
  labels: Int32Array
  labelCount: number
  counts: number[]
}

/** 4-connectivity flood-fill labeling so regions don't leak diagonally across a thin line. */
function labelRegions(mask: Uint8Array, width: number, height: number): LabelResult {
  const labels = new Int32Array(width * height)
  const counts: number[] = [0]
  let nextLabel = 1
  const stack: number[] = []

  for (let start = 0; start < width * height; start++) {
    if (mask[start] !== 1 || labels[start] !== 0) continue
    const label = nextLabel++
    let count = 0
    stack.push(start)
    labels[start] = label

    while (stack.length) {
      const idx = stack.pop()!
      count++
      const x = idx % width
      const y = (idx / width) | 0

      if (x > 0) {
        const n = idx - 1
        if (mask[n] === 1 && labels[n] === 0) {
          labels[n] = label
          stack.push(n)
        }
      }
      if (x < width - 1) {
        const n = idx + 1
        if (mask[n] === 1 && labels[n] === 0) {
          labels[n] = label
          stack.push(n)
        }
      }
      if (y > 0) {
        const n = idx - width
        if (mask[n] === 1 && labels[n] === 0) {
          labels[n] = label
          stack.push(n)
        }
      }
      if (y < height - 1) {
        const n = idx + width
        if (mask[n] === 1 && labels[n] === 0) {
          labels[n] = label
          stack.push(n)
        }
      }
    }

    counts.push(count)
  }

  return { labels, labelCount: nextLabel - 1, counts }
}

export interface ExtractedRegion {
  polygon: Pt[]
  color: [number, number, number]
  pixelCount: number
}

const MAX_REGIONS = 60

function boundingSize(points: Pt[]): number {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  return Math.min(maxX - minX, maxY - minY)
}

function shoelaceArea(points: Pt[]): number {
  let area = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    area += a.x * b.y - b.x * a.y
  }
  return Math.abs(area) / 2
}

/** Segments a fill mask into distinct color cells, each with a traced outline and average color. */
export function extractRegions(
  fillMask: Uint8Array,
  imageData: ImageData,
  width: number,
  height: number,
  minPixels: number,
  simplifyEpsilon: number,
): ExtractedRegion[] {
  const { labels, labelCount, counts } = labelRegions(fillMask, width, height)

  const candidates: { label: number; count: number }[] = []
  for (let label = 1; label <= labelCount; label++) {
    if (counts[label] >= minPixels) candidates.push({ label, count: counts[label] })
  }
  candidates.sort((a, b) => b.count - a.count)
  const selected = candidates.slice(0, MAX_REGIONS)

  const results: ExtractedRegion[] = []

  for (const { label } of selected) {
    const regionMask = new Uint8Array(width * height)
    let rSum = 0
    let gSum = 0
    let bSum = 0
    let n = 0
    for (let i = 0; i < width * height; i++) {
      if (labels[i] === label) {
        regionMask[i] = 1
        rSum += imageData.data[i * 4]
        gSum += imageData.data[i * 4 + 1]
        bSum += imageData.data[i * 4 + 2]
        n++
      }
    }

    const boundary = traceBoundary(regionMask, width, height)
    if (!boundary || boundary.length < 8) continue

    const smoothed = chaikinSmooth(boundary, 2)
    const closed = [...smoothed, smoothed[0]]

    // A fixed pixel tolerance over-simplifies small regions (a 1.5px wobble is negligible on a
    // 300px blob but can collapse a 20px-wide sliver into a degenerate/self-intersecting shape),
    // which is what broke the plate's hole triangulation on tightly-packed thin regions. Scale
    // the tolerance down for small shapes instead.
    const localEpsilon = Math.min(simplifyEpsilon, Math.max(0.25, boundingSize(smoothed) * 0.02))
    const simplified = simplify(closed, localEpsilon)
    const polygon = simplified.slice(0, -1)
    if (polygon.length < 3) continue

    // Sanity check: if simplification collapsed the shape's area drastically, the result is
    // likely degenerate (near-zero area or self-intersecting) — skip it rather than risk
    // corrupting the plate's triangulation. The region just won't get its own cavity.
    const originalArea = shoelaceArea(smoothed)
    const simplifiedArea = shoelaceArea(polygon)
    if (originalArea > 0 && simplifiedArea / originalArea < 0.5) continue

    results.push({
      polygon,
      color: [Math.round(rSum / n), Math.round(gSum / n), Math.round(bSum / n)],
      pixelCount: n,
    })
  }

  return results
}
