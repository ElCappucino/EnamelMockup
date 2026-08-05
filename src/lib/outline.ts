/** Outline detection by stroke color.
 *
 * The darkness-threshold approach only ever asks "is this pixel dark?", which finds the outline
 * around the silhouette and any interior stroke that happens to be dark — but it can't tell an
 * interior stroke apart from a legitimately dark fill color, so the threshold that catches the
 * strokes often swallows a fill color too. Sampling the actual stroke color off the design's
 * perimeter and matching it everywhere targets the strokes directly, wherever they run.
 */

/** How far inside the silhouette the sampling band starts, in analysis pixels. The outermost
 * ring is anti-aliased against the transparent background, so its colors are blends rather than
 * the stroke's own color. */
const EDGE_SKIP = 2
/** Thickness of the sampling band. Wide enough to average over a decent number of pixels, narrow
 * enough to stay within a typical stroke rather than reaching through into the fill behind it. */
const BAND_DEPTH = 5
/** Quantization step for the dominant-color histogram, matching lib/regions. */
const BUCKET_SIZE = 8

/** Below this share of the perimeter band, the border isn't one consistent color, so there's no
 * stroke to sample — a photo or a gradient lands here. Measured: real line art scores 98-100%,
 * while un-outlined art (gradient, noise, a two-tone blob) scores 50% or less. */
export const MIN_PERIMETER_PURITY = 0.6
/** Above this share of the design, the "stroke" color is really a fill color — a solid one-color
 * blob has a perfectly pure perimeter but matches everywhere. Real line art measures 22-35%. */
export const MAX_LINE_COVERAGE = 0.6

export const MIN_OUTLINE_TOLERANCE = 0
export const MAX_OUTLINE_TOLERANCE = 120
/** Roughly halfway to the nearest fill color on the sample designs (the closest measured was 77
 * RGB units away), so anti-aliased stroke edges are absorbed without reaching a real color. */
export const DEFAULT_OUTLINE_TOLERANCE = 45

export type OutlineMode = 'color' | 'darkness'
/** Which method actually produced the line mask. `color` can degrade to `darkness` when the
 * design has no consistent stroke color to sample. */
export type OutlineSource = 'color' | 'darkness'

export interface SampledOutline {
  color: [number, number, number]
  /** Share of the perimeter band that is this one color, 0..1. */
  purity: number
}

export function colorDistance(
  r: number,
  g: number,
  b: number,
  [cr, cg, cb]: [number, number, number],
): number {
  return Math.hypot(r - cr, g - cg, b - cb)
}

/** Chamfer 3-4 distance transform: for every foreground pixel, its approximate distance to the
 * nearest background pixel. Two sequential passes, so it stays O(n) over the image. */
function distanceFromBackground(mask: Uint8Array, size: number): Float32Array {
  const INF = 1e9
  const dist = new Float32Array(size * size)
  for (let i = 0; i < size * size; i++) dist[i] = mask[i] === 1 ? INF : 0

  const at = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= size || y >= size ? 0 : dist[y * size + x]

  const D = 1
  const DIAG = 1.414

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x
      if (dist[i] === 0) continue
      dist[i] = Math.min(
        dist[i],
        at(x - 1, y) + D,
        at(x, y - 1) + D,
        at(x - 1, y - 1) + DIAG,
        at(x + 1, y - 1) + DIAG,
      )
    }
  }
  for (let y = size - 1; y >= 0; y--) {
    for (let x = size - 1; x >= 0; x--) {
      const i = y * size + x
      if (dist[i] === 0) continue
      dist[i] = Math.min(
        dist[i],
        at(x + 1, y) + D,
        at(x, y + 1) + D,
        at(x + 1, y + 1) + DIAG,
        at(x - 1, y + 1) + DIAG,
      )
    }
  }
  return dist
}

/** Reads the stroke color off a band just inside the design's silhouette — the one place the
 * outline is guaranteed to be, whatever the artwork looks like inside. Returns the dominant
 * color in that band plus how dominant it was, so the caller can reject designs that have no
 * real outline instead of mistaking a fill color for one. */
export function sampleOutlineColor(
  imageData: ImageData,
  alphaMask: Uint8Array,
  size: number,
): SampledOutline | null {
  const dist = distanceFromBackground(alphaMask, size)
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>()
  let banded = 0

  for (let i = 0; i < size * size; i++) {
    const d = dist[i]
    if (d < EDGE_SKIP || d >= EDGE_SKIP + BAND_DEPTH) continue
    const r = imageData.data[i * 4]
    const g = imageData.data[i * 4 + 1]
    const b = imageData.data[i * 4 + 2]
    const key =
      (((r / BUCKET_SIZE) | 0) << 16) | (((g / BUCKET_SIZE) | 0) << 8) | ((b / BUCKET_SIZE) | 0)
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = { count: 0, r: 0, g: 0, b: 0 }
      buckets.set(key, bucket)
    }
    bucket.count++
    bucket.r += r
    bucket.g += g
    bucket.b += b
    banded++
  }

  if (banded === 0) return null

  let winner: { count: number; r: number; g: number; b: number } | null = null
  for (const bucket of buckets.values()) {
    if (!winner || bucket.count > winner.count) winner = bucket
  }
  if (!winner) return null

  return {
    color: [
      Math.round(winner.r / winner.count),
      Math.round(winner.g / winner.count),
      Math.round(winner.b / winner.count),
    ],
    purity: winner.count / banded,
  }
}

/** Marks every opaque pixel within `tolerance` of the outline color as line art — interior
 * strokes included, which is the whole point over a darkness threshold. */
export function buildColorLineMask(
  imageData: ImageData,
  size: number,
  outlineColor: [number, number, number],
  tolerance: number,
  alphaThreshold: number,
): Uint8Array {
  const mask = new Uint8Array(size * size)
  for (let i = 0; i < size * size; i++) {
    if (imageData.data[i * 4 + 3] <= alphaThreshold) continue
    const d = colorDistance(
      imageData.data[i * 4],
      imageData.data[i * 4 + 1],
      imageData.data[i * 4 + 2],
      outlineColor,
    )
    mask[i] = d <= tolerance ? 1 : 0
  }
  return mask
}
