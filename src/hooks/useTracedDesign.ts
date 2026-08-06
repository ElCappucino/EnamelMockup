import { useEffect, useState } from 'react'
import { Vector2 } from 'three'
import {
  applyTransform,
  chaikinSmooth,
  clampInsidePolygon,
  computeTransform,
  simplify,
  traceBoundary,
  type Pt,
  type UVTransform,
} from '../lib/contour'
import { extractLineIslands, extractRegions } from '../lib/regions'
import {
  buildColorLineMask,
  sampleOutlineColor,
  MAX_LINE_COVERAGE,
  MIN_PERIMETER_PURITY,
  DEFAULT_OUTLINE_TOLERANCE,
  type OutlineMode,
  type OutlineSource,
} from '../lib/outline'

const TEXTURE_SIZE = 1024
const ANALYSIS_SIZE = 480
const ALPHA_THRESHOLD = 40
export const MIN_LINE_THRESHOLD = 0
export const MAX_LINE_THRESHOLD = 160
export const DEFAULT_LINE_THRESHOLD = 70
export const DEFAULT_OUTLINE_MODE: OutlineMode = 'color'
// RDP tolerance for every traced polygon, in analysis pixels. At 1.5 the silhouette collapsed to
// ~48 points and RDP turned gentle curvature — and any dent in the source art — into visible
// angular kinks around the rim. The interior cells fail the same way and are just as visible: a
// large, smoothly curved region (the lemon design's leaf) collapsed to 17 points, faceting the
// curve and blunting its pointed tip into a wedge. They share the tighter tolerance rather than
// getting a looser one — `polygonForLabel` already scales it down per shape, which is where
// over-simplification actually bites.
const SIMPLIFY_EPSILON = 0.6
const MIN_BOUNDARY_POINTS = 8
const MIN_POLYGON_POINTS = 3
const MIN_REGION_PIXELS = 60
// Lower than the region floor: an interior detail stroke is legitimately small (the dots on the
// sample design measure ~160px, but a finer design's could be half that) and dropping one leaves
// a visible gap in the artwork rather than an unfilled cell.
const MIN_ISLAND_PIXELS = 40
// Below this fraction of line-art pixels, treat the design as "no real outline" (e.g. a
// plain photo/gradient) and fall back to the single textured face instead of segmenting.
const MIN_LINE_COVERAGE_RATIO = 0.015

export interface RegionPiece {
  points: Vector2[]
  color: string
}

export interface TracedDesign {
  sourceCanvas: HTMLCanvasElement
  lineMask: Uint8Array
  outline: Vector2[] | null
  uv: UVTransform | null
  regions: RegionPiece[] | null
  /** The stroke-bounded wells the regions sit in. The plate's cavities are cut from these, so
   * plating shows only where the artwork actually has a stroke, and each is filled with its own
   * base coat under the regions. */
  cells: RegionPiece[] | null
  /** Strokes running entirely inside the design — rendered as plating, like the outer border. */
  islands: Vector2[][] | null
  /** Which detection method produced `lineMask`, so the UI can say when the requested one
   * didn't apply. */
  outlineSource: OutlineSource
  /** The stroke color read off the design, when detection was by color. */
  outlineColor: [number, number, number] | null
}

function drawContain(ctx: CanvasRenderingContext2D, img: HTMLImageElement, size: number) {
  ctx.clearRect(0, 0, size, size)
  const scale = Math.min(size / img.width, size / img.height)
  const w = img.width * scale
  const h = img.height * scale
  ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h)
}

function buildAlphaMask(imageData: ImageData, size: number): Uint8Array {
  const mask = new Uint8Array(size * size)
  for (let i = 0; i < size * size; i++) {
    mask[i] = imageData.data[i * 4 + 3] > ALPHA_THRESHOLD ? 1 : 0
  }
  return mask
}

/** Marks dark, opaque pixels as line-art (the strokes separating enamel color fields). Any
 * intentional design color darker than `threshold` gets caught by this too — its pixels are
 * excluded from region extraction and, on the fallback texture path, overwritten with the
 * plating color outright — which is the other likely way a color can come out altered. */
function buildLuminanceLineMask(imageData: ImageData, size: number, threshold: number): Uint8Array {
  const mask = new Uint8Array(size * size)
  for (let i = 0; i < size * size; i++) {
    const a = imageData.data[i * 4 + 3]
    if (a <= ALPHA_THRESHOLD) continue
    const r = imageData.data[i * 4]
    const g = imageData.data[i * 4 + 1]
    const b = imageData.data[i * 4 + 2]
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
    mask[i] = luminance < threshold ? 1 : 0
  }
  return mask
}

function lineCoverage(lineMask: Uint8Array, alphaMask: Uint8Array): number {
  let lineCount = 0
  let foregroundCount = 0
  for (let i = 0; i < lineMask.length; i++) {
    if (alphaMask[i] === 1) foregroundCount++
    if (lineMask[i] === 1) lineCount++
  }
  return foregroundCount > 0 ? lineCount / foregroundCount : 0
}

function traceSimplePolygon(mask: Uint8Array, size: number, epsilon: number): Pt[] | null {
  const boundary = traceBoundary(mask, size, size)
  if (!boundary || boundary.length < MIN_BOUNDARY_POINTS) return null

  const smoothed = chaikinSmooth(boundary, 2)
  const closed = [...smoothed, smoothed[0]]
  const simplified = simplify(closed, epsilon)
  const polygon = simplified.slice(0, -1)
  if (polygon.length < MIN_POLYGON_POINTS) return null

  return polygon
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
}

export function useTracedDesign(
  file: File | null,
  outlineMode: OutlineMode = DEFAULT_OUTLINE_MODE,
  outlineTolerance: number = DEFAULT_OUTLINE_TOLERANCE,
  lineThreshold: number = DEFAULT_LINE_THRESHOLD,
) {
  const [design, setDesign] = useState<TracedDesign | null>(null)

  useEffect(() => {
    if (!file) {
      setDesign(null)
      return
    }

    const url = URL.createObjectURL(file)
    const img = new Image()
    let cancelled = false

    img.onload = () => {
      if (cancelled) return

      const analysisCanvas = document.createElement('canvas')
      analysisCanvas.width = ANALYSIS_SIZE
      analysisCanvas.height = ANALYSIS_SIZE
      const analysisCtx = analysisCanvas.getContext('2d')!
      drawContain(analysisCtx, img, ANALYSIS_SIZE)
      const analysisData = analysisCtx.getImageData(0, 0, ANALYSIS_SIZE, ANALYSIS_SIZE)
      const alphaMask = buildAlphaMask(analysisData, ANALYSIS_SIZE)

      // Decide how to detect outlines once, on the analysis image, then apply the same decision
      // to the full-resolution texture mask — the criterion is resolution-independent either way.
      let outlineColor: [number, number, number] | null = null
      let outlineSource: OutlineSource = 'darkness'
      let lineMaskAnalysis: Uint8Array | null = null

      if (outlineMode === 'color') {
        const sampled = sampleOutlineColor(analysisData, alphaMask, ANALYSIS_SIZE)
        if (sampled && sampled.purity >= MIN_PERIMETER_PURITY) {
          const candidate = buildColorLineMask(
            analysisData,
            ANALYSIS_SIZE,
            sampled.color,
            outlineTolerance,
            ALPHA_THRESHOLD,
          )
          // A design with no strokes at all still has a perfectly uniform perimeter — it's just
          // the fill color, which then matches nearly the whole design. Rejecting on coverage
          // catches that case, which purity alone can't.
          const coverage = lineCoverage(candidate, alphaMask)
          if (coverage <= MAX_LINE_COVERAGE && coverage >= MIN_LINE_COVERAGE_RATIO) {
            lineMaskAnalysis = candidate
            outlineColor = sampled.color
            outlineSource = 'color'
          }
        }
      }

      if (!lineMaskAnalysis) {
        lineMaskAnalysis = buildLuminanceLineMask(analysisData, ANALYSIS_SIZE, lineThreshold)
      }

      const sourceCanvas = document.createElement('canvas')
      sourceCanvas.width = TEXTURE_SIZE
      sourceCanvas.height = TEXTURE_SIZE
      const sourceCtx = sourceCanvas.getContext('2d')!
      drawContain(sourceCtx, img, TEXTURE_SIZE)
      const sourceData = sourceCtx.getImageData(0, 0, TEXTURE_SIZE, TEXTURE_SIZE)
      const lineMask =
        outlineSource === 'color' && outlineColor
          ? buildColorLineMask(sourceData, TEXTURE_SIZE, outlineColor, outlineTolerance, ALPHA_THRESHOLD)
          : buildLuminanceLineMask(sourceData, TEXTURE_SIZE, lineThreshold)

      const fillMask = new Uint8Array(ANALYSIS_SIZE * ANALYSIS_SIZE)
      for (let i = 0; i < fillMask.length; i++) {
        fillMask[i] = alphaMask[i] === 1 && lineMaskAnalysis[i] === 0 ? 1 : 0
      }
      const hasMeaningfulLineArt =
        lineCoverage(lineMaskAnalysis, alphaMask) >= MIN_LINE_COVERAGE_RATIO

      let outline: Vector2[] | null = null
      let uv: UVTransform | null = null
      let regions: RegionPiece[] | null = null
      let cells: RegionPiece[] | null = null
      let islands: Vector2[][] | null = null

      try {
        const silhouette = traceSimplePolygon(alphaMask, ANALYSIS_SIZE, SIMPLIFY_EPSILON)
        if (silhouette) {
          const transform = computeTransform(silhouette, ANALYSIS_SIZE)
          outline = applyTransform(silhouette, transform).map((p) => new Vector2(p.x, p.y))
          uv = transform

          if (hasMeaningfulLineArt) {
            const extracted = extractRegions(
              fillMask,
              analysisData,
              ANALYSIS_SIZE,
              ANALYSIS_SIZE,
              MIN_REGION_PIXELS,
              SIMPLIFY_EPSILON,
            )
            if (extracted.regions.length > 0) {
              // A region traced from the fill mask can stray a pixel or two outside the outline
              // (the two are traced independently, and simplifying the outline chords slightly
              // inside the true silhouette). A hole that pokes outside its containing shape is
              // invalid topology and corrupts the plate's triangulation — but discarding the
              // region would leave that area as bare metal, so repair the stray points instead
              // by pulling them just inside the outline.
              const center = { x: transform.cx, y: transform.cy }
              const toShapeSpace = (polygon: Pt[]) =>
                applyTransform(
                  polygon.map((p) => clampInsidePolygon(p, silhouette, center)),
                  transform,
                ).map((p) => new Vector2(p.x, p.y))

              const toPiece = (r: { polygon: Pt[]; color: [number, number, number] }) => ({
                points: toShapeSpace(r.polygon),
                color: rgbToHex(r.color),
              })
              regions = extracted.regions.map(toPiece)
              cells = extracted.cells.map(toPiece)

              // Interior strokes are enclosed by the regions around them, so they need no
              // clamping — they can't reach the silhouette by definition.
              const extractedIslands = extractLineIslands(
                lineMaskAnalysis,
                alphaMask,
                ANALYSIS_SIZE,
                ANALYSIS_SIZE,
                MIN_ISLAND_PIXELS,
                SIMPLIFY_EPSILON,
              )
              islands = extractedIslands.map((piece) =>
                applyTransform(piece.polygon, transform).map((p) => new Vector2(p.x, p.y)),
              )
            }
          }
        }
      } catch {
        outline = null
        uv = null
        regions = null
        cells = null
        islands = null
      }

      setDesign({
        sourceCanvas,
        lineMask,
        outline,
        uv,
        regions,
        cells,
        islands,
        outlineSource,
        outlineColor,
      })
    }

    img.src = url

    return () => {
      cancelled = true
      URL.revokeObjectURL(url)
    }
  }, [file, outlineMode, outlineTolerance, lineThreshold])

  return design
}
