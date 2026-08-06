import { chaikinSmooth, simplify, traceBoundary, type Pt } from './contour'

interface LabelResult {
  labels: Int32Array
  labelCount: number
  counts: number[]
}

/** Flood-fill labeling over a per-pixel class map (-1 = not part of any component). Two adjacent
 * pixels join only when they carry the same class, so a color boundary splits a component even
 * where no outline runs between the two colors.
 *
 * 4-connectivity keeps fill regions from leaking diagonally across a thin line; 8-connectivity
 * keeps a diagonal 1px stroke reading as one continuous piece. */
function labelByClass(
  classOf: Int32Array,
  width: number,
  height: number,
  connectivity: 4 | 8,
): LabelResult {
  const labels = new Int32Array(width * height)
  const counts: number[] = [0]
  let nextLabel = 1
  const stack: number[] = []

  for (let start = 0; start < width * height; start++) {
    if (classOf[start] < 0 || labels[start] !== 0) continue
    const cls = classOf[start]
    const label = nextLabel++
    let count = 0
    stack.push(start)
    labels[start] = label

    while (stack.length) {
      const idx = stack.pop()!
      count++
      const x = idx % width
      const y = (idx / width) | 0

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          if (connectivity === 4 && dx !== 0 && dy !== 0) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const n = ny * width + nx
          if (classOf[n] === cls && labels[n] === 0) {
            labels[n] = label
            stack.push(n)
          }
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

/** `cells` are the enamel wells — the areas enclosed by outline strokes. `regions` are the flat
 * color areas inside them; a well often holds several, since artwork shades one shape with more
 * than one color and no stroke between them.
 *
 * The plate's cavities are cut per cell rather than per region, so the only metal on the pin's
 * face is where a stroke actually runs. Cutting per region instead left a hairline of plating
 * showing wherever two colors met inside one well. Each cell also carries its own color, so it
 * can be laid down as a base coat under its regions — two regions traced separately still leave
 * a pixel of daylight along their shared edge, and the base coat is what that shows instead of
 * bare plating. */
export interface ExtractedFill {
  cells: ExtractedRegion[]
  regions: ExtractedRegion[]
}

/** A stroke that runs entirely inside the design without reaching the silhouette — a detail line
 * or a dot. It has no fill of its own; it's a piece of the metal plate surrounded by enamel. */
export interface ExtractedIsland {
  polygon: Pt[]
  pixelCount: number
}

const MAX_REGIONS = 60
const MAX_ISLANDS = 80

// Bucket width (per channel, 0..255) for the dominant-color histogram. Coarse enough that
// anti-aliasing/dithering noise around a flat fill collapses into one bucket, fine enough that
// two genuinely different design colors don't merge into one.
const DOMINANT_BUCKET_SIZE = 8

// Two palette entries closer than this in RGB space are treated as the same design color, so an
// anti-aliased blend between two fills doesn't become a color of its own. Kept below the closest
// pair of genuinely distinct shades measured on real artwork (52 units apart).
const PALETTE_MERGE_DISTANCE = 40
const MAX_PALETTE_COLORS = 12
// A genuine design color covers a real share of the artwork. Anti-aliased blends along every
// boundary are individually rare but collectively numerous, and letting one seed a palette entry
// turns the whole boundary into a sliver region of its own. Measured on real artwork: design
// colors run 4-37% of the fill, blend colors 0.1-0.2%.
const MIN_PALETTE_SHARE = 0.015

/** The average color within whichever quantized color bucket has the most pixels in the region.
 * A flat fill with anti-aliased edges has the vast majority of its pixels in one bucket (the
 * true color) and the edge-blend pixels scattered thinly across many others, so the winning
 * bucket recovers the intended color instead of being dragged toward the border. */
function dominantColor(imageData: ImageData, labels: Int32Array, label: number): [number, number, number] {
  const buckets = new Map<string, { count: number; rSum: number; gSum: number; bSum: number }>()
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] !== label) continue
    const r = imageData.data[i * 4]
    const g = imageData.data[i * 4 + 1]
    const b = imageData.data[i * 4 + 2]
    const key = `${(r / DOMINANT_BUCKET_SIZE) | 0},${(g / DOMINANT_BUCKET_SIZE) | 0},${(b / DOMINANT_BUCKET_SIZE) | 0}`
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = { count: 0, rSum: 0, gSum: 0, bSum: 0 }
      buckets.set(key, bucket)
    }
    bucket.count++
    bucket.rSum += r
    bucket.gSum += g
    bucket.bSum += b
  }

  let winner: { count: number; rSum: number; gSum: number; bSum: number } | null = null
  for (const bucket of buckets.values()) {
    if (!winner || bucket.count > winner.count) winner = bucket
  }
  if (!winner) return [0, 0, 0]
  return [
    Math.round(winner.rSum / winner.count),
    Math.round(winner.gSum / winner.count),
    Math.round(winner.bSum / winner.count),
  ]
}

/** The design's distinct fill colors, most-used first: the peaks of a quantized histogram, with
 * near-duplicates dropped so anti-aliased blends don't register as their own color. */
function extractPalette(
  imageData: ImageData,
  fillMask: Uint8Array,
  size: number,
): [number, number, number][] {
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>()
  let total = 0
  for (let i = 0; i < size; i++) {
    if (fillMask[i] !== 1) continue
    total++
    const r = imageData.data[i * 4]
    const g = imageData.data[i * 4 + 1]
    const b = imageData.data[i * 4 + 2]
    const key =
      (((r / DOMINANT_BUCKET_SIZE) | 0) << 16) |
      (((g / DOMINANT_BUCKET_SIZE) | 0) << 8) |
      ((b / DOMINANT_BUCKET_SIZE) | 0)
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = { count: 0, r: 0, g: 0, b: 0 }
      buckets.set(key, bucket)
    }
    bucket.count++
    bucket.r += r
    bucket.g += g
    bucket.b += b
  }

  const sorted = [...buckets.values()].sort((a, b) => b.count - a.count)
  const palette: [number, number, number][] = []
  for (const bucket of sorted) {
    if (palette.length >= MAX_PALETTE_COLORS) break
    if (bucket.count / total < MIN_PALETTE_SHARE) break
    const color: [number, number, number] = [
      Math.round(bucket.r / bucket.count),
      Math.round(bucket.g / bucket.count),
      Math.round(bucket.b / bucket.count),
    ]
    const duplicate = palette.some(
      (p) =>
        (p[0] - color[0]) ** 2 + (p[1] - color[1]) ** 2 + (p[2] - color[2]) ** 2 <
        PALETTE_MERGE_DISTANCE ** 2,
    )
    if (!duplicate) palette.push(color)
  }
  return palette
}

function nearestPaletteIndex(
  palette: [number, number, number][],
  r: number,
  g: number,
  b: number,
): number {
  let best = 0
  let bestDistance = Infinity
  for (let k = 0; k < palette.length; k++) {
    const p = palette[k]
    const d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2
    if (d < bestDistance) {
      bestDistance = d
      best = k
    }
  }
  return best
}

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

/** Hands every pixel of an undersized component to the nearest component that did make the cut.
 *
 * Splitting the fill by color leaves speckle along each color boundary — the anti-aliased ramp
 * gets divided between its two neighbors, stranding tiny islands of one color inside the other.
 * Dropping those left holes in the enamel that showed the plating behind as hairline cracks, so
 * they're absorbed instead. A multi-source breadth-first sweep outward from the surviving
 * components assigns each stranded pixel to whichever one is closest. */
function absorbFragments(
  labels: Int32Array,
  counts: number[],
  minPixels: number,
  width: number,
  height: number,
): number[] {
  const survives = (label: number) => label > 0 && counts[label] >= minPixels

  const queue: number[] = []
  for (let i = 0; i < labels.length; i++) {
    if (survives(labels[i])) queue.push(i)
  }
  if (queue.length === 0) return counts

  for (let head = 0; head < queue.length; head++) {
    const idx = queue[head]
    const label = labels[idx]
    const x = idx % width
    const y = (idx / width) | 0

    const visit = (n: number) => {
      // Only stranded pixels get reassigned; anything already on a surviving component stays put.
      if (labels[n] > 0 && !survives(labels[n])) {
        labels[n] = label
        queue.push(n)
      }
    }
    if (x > 0) visit(idx - 1)
    if (x < width - 1) visit(idx + 1)
    if (y > 0) visit(idx - width)
    if (y < height - 1) visit(idx + width)
  }

  const updated = new Array<number>(counts.length).fill(0)
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] > 0) updated[labels[i]]++
  }
  return updated
}

/** Traces one labeled component into a smoothed, simplified polygon, or null when the result
 * would be degenerate. */
function polygonForLabel(
  labels: Int32Array,
  label: number,
  width: number,
  height: number,
  simplifyEpsilon: number,
): Pt[] | null {
  const regionMask = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) {
    if (labels[i] === label) regionMask[i] = 1
  }

  const boundary = traceBoundary(regionMask, width, height)
  if (!boundary || boundary.length < 8) return null

  const smoothed = chaikinSmooth(boundary, 2)
  const closed = [...smoothed, smoothed[0]]

  // A fixed pixel tolerance over-simplifies small regions (a 1.5px wobble is negligible on a
  // 300px blob but can collapse a 20px-wide sliver into a degenerate/self-intersecting shape),
  // which is what broke the plate's hole triangulation on tightly-packed thin regions. Scale
  // the tolerance down for small shapes instead.
  const localEpsilon = Math.min(simplifyEpsilon, Math.max(0.25, boundingSize(smoothed) * 0.02))
  const simplified = simplify(closed, localEpsilon)
  const polygon = simplified.slice(0, -1)
  if (polygon.length < 3) return null

  // Sanity check: if simplification collapsed the shape's area drastically, the result is
  // likely degenerate (near-zero area or self-intersecting) — skip it rather than risk
  // corrupting the plate's triangulation. The region just won't get its own cavity.
  const originalArea = shoelaceArea(smoothed)
  const simplifiedArea = shoelaceArea(polygon)
  if (originalArea > 0 && simplifiedArea / originalArea < 0.5) return null

  return polygon
}

/** Segments a fill mask into enamel wells (`cells`, bounded by the outline strokes) and the flat
 * color areas inside them (`regions`, each with a color sampled by whichever quantized bucket
 * dominates the region).
 *
 * The two levels exist because artwork uses strokes and color changes to mean different things.
 * A stroke is a divider the pin should render in metal; a color change with no stroke — shading,
 * a highlight, a gradient step — is just paint inside one well. Splitting only on strokes lost
 * the second color of a well entirely; cutting the plate per color put metal where the artwork
 * had none. Cells carry the metal, regions carry the color. */
export function extractRegions(
  fillMask: Uint8Array,
  imageData: ImageData,
  width: number,
  height: number,
  minPixels: number,
  simplifyEpsilon: number,
): ExtractedFill {
  const empty: ExtractedFill = { cells: [], regions: [] }
  const palette = extractPalette(imageData, fillMask, width * height)
  if (palette.length === 0) return empty

  // Wells first: connected fill, ignoring color, so a boundary only ever falls on a stroke.
  const cellClass = new Int32Array(width * height).fill(-1)
  for (let i = 0; i < width * height; i++) {
    if (fillMask[i] === 1) cellClass[i] = 0
  }
  const cellLabels = labelByClass(cellClass, width, height, 4)
  const cellCounts = absorbFragments(
    cellLabels.labels,
    cellLabels.counts,
    minPixels,
    width,
    height,
  )

  // Then the color areas within them.
  const classOf = new Int32Array(width * height).fill(-1)
  for (let i = 0; i < width * height; i++) {
    if (fillMask[i] !== 1) continue
    classOf[i] = nearestPaletteIndex(
      palette,
      imageData.data[i * 4],
      imageData.data[i * 4 + 1],
      imageData.data[i * 4 + 2],
    )
  }
  const regionLabels = labelByClass(classOf, width, height, 4)
  const regionCounts = absorbFragments(
    regionLabels.labels,
    regionLabels.counts,
    minPixels,
    width,
    height,
  )

  const rank = (counts: number[], labelCount: number, limit: number) => {
    const candidates: { label: number; count: number }[] = []
    for (let label = 1; label <= labelCount; label++) {
      if (counts[label] >= minPixels) candidates.push({ label, count: counts[label] })
    }
    candidates.sort((a, b) => b.count - a.count)
    return candidates.slice(0, limit)
  }

  const regions: ExtractedRegion[] = []
  const cellsWithColor = new Set<number>()
  for (const { label, count } of rank(regionCounts, regionLabels.labelCount, MAX_REGIONS)) {
    const polygon = polygonForLabel(regionLabels.labels, label, width, height, simplifyEpsilon)
    if (!polygon) continue

    const color = dominantColor(imageData, regionLabels.labels, label)

    regions.push({ polygon, color, pixelCount: count })

    const seed = regionLabels.labels.indexOf(label)
    if (seed >= 0) cellsWithColor.add(cellLabels.labels[seed])
  }

  // A well with no surviving color area would open a cavity with nothing to fill it, showing
  // straight through to the plating behind.
  const cells: ExtractedRegion[] = []
  for (const { label, count } of rank(cellCounts, cellLabels.labelCount, MAX_REGIONS)) {
    if (!cellsWithColor.has(label)) continue
    const polygon = polygonForLabel(cellLabels.labels, label, width, height, simplifyEpsilon)
    if (!polygon) continue
    const color = dominantColor(imageData, cellLabels.labels, label)
    cells.push({ polygon, color, pixelCount: count })
  }

  return { cells, regions }
}

/** Finds the stroke pieces that float entirely inside the design — detail lines and dots that
 * never reach the silhouette.
 *
 * The plate is built as the silhouette minus one hole per fill region, which makes every stroke
 * that touches the silhouette metal for free. An interior stroke has no such connection: it sits
 * inside a region's hole, so unless it's extracted here it is simply paved over by that region's
 * enamel and vanishes from the pin. */
export function extractLineIslands(
  lineMask: Uint8Array,
  alphaMask: Uint8Array,
  width: number,
  height: number,
  minPixels: number,
  simplifyEpsilon: number,
): ExtractedIsland[] {
  const classOf = new Int32Array(width * height).fill(-1)
  for (let i = 0; i < width * height; i++) {
    if (lineMask[i] === 1) classOf[i] = 0
  }

  const { labels, labelCount, counts } = labelByClass(classOf, width, height, 8)

  // A stroke that reaches the silhouette — i.e. touches a transparent pixel or the canvas edge —
  // is already part of the plate's own body, so only the fully enclosed ones need geometry.
  const reachesSilhouette = new Uint8Array(labelCount + 1)
  for (let i = 0; i < width * height; i++) {
    const label = labels[i]
    if (label === 0 || reachesSilhouette[label]) continue
    const x = i % width
    const y = (i / width) | 0
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
      reachesSilhouette[label] = 1
      continue
    }
    for (let dy = -1; dy <= 1 && !reachesSilhouette[label]; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (alphaMask[(y + dy) * width + (x + dx)] === 0) {
          reachesSilhouette[label] = 1
          break
        }
      }
    }
  }

  const candidates: { label: number; count: number }[] = []
  for (let label = 1; label <= labelCount; label++) {
    if (reachesSilhouette[label]) continue
    if (counts[label] >= minPixels) candidates.push({ label, count: counts[label] })
  }
  candidates.sort((a, b) => b.count - a.count)

  const results: ExtractedIsland[] = []
  for (const { label, count } of candidates.slice(0, MAX_ISLANDS)) {
    const polygon = polygonForLabel(labels, label, width, height, simplifyEpsilon)
    if (!polygon) continue
    results.push({ polygon, pixelCount: count })
  }
  return results
}
