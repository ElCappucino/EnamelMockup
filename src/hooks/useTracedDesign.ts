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
import { extractRegions } from '../lib/regions'

const TEXTURE_SIZE = 1024
const ANALYSIS_SIZE = 480
const ALPHA_THRESHOLD = 40
const LINE_LUMINANCE_THRESHOLD = 70
const SIMPLIFY_EPSILON = 1.5
// The silhouette is the pin's most visible edge, so it gets a tighter tolerance than the interior
// colour cells. At 1.5 it collapsed to ~48 points and RDP turned gentle curvature — and any dent
// in the source art — into visible angular kinks around the rim.
const OUTLINE_SIMPLIFY_EPSILON = 0.6
const MIN_BOUNDARY_POINTS = 8
const MIN_POLYGON_POINTS = 3
const MIN_REGION_PIXELS = 60
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
}

function drawContain(ctx: CanvasRenderingContext2D, img: HTMLImageElement, size: number) {
  ctx.clearRect(0, 0, size, size)
  const scale = Math.min(size / img.width, size / img.height)
  const w = img.width * scale
  const h = img.height * scale
  ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h)
}

function buildAlphaMask(ctx: CanvasRenderingContext2D, size: number): Uint8Array {
  const data = ctx.getImageData(0, 0, size, size).data
  const mask = new Uint8Array(size * size)
  for (let i = 0; i < size * size; i++) {
    mask[i] = data[i * 4 + 3] > ALPHA_THRESHOLD ? 1 : 0
  }
  return mask
}

/** Marks dark, opaque pixels as line-art (the strokes separating enamel color fields). */
function buildLineMask(ctx: CanvasRenderingContext2D, size: number): Uint8Array {
  const data = ctx.getImageData(0, 0, size, size).data
  const mask = new Uint8Array(size * size)
  for (let i = 0; i < size * size; i++) {
    const a = data[i * 4 + 3]
    if (a <= ALPHA_THRESHOLD) continue
    const r = data[i * 4]
    const g = data[i * 4 + 1]
    const b = data[i * 4 + 2]
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
    mask[i] = luminance < LINE_LUMINANCE_THRESHOLD ? 1 : 0
  }
  return mask
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

export function useTracedDesign(file: File | null) {
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

      const sourceCanvas = document.createElement('canvas')
      sourceCanvas.width = TEXTURE_SIZE
      sourceCanvas.height = TEXTURE_SIZE
      const sourceCtx = sourceCanvas.getContext('2d')!
      drawContain(sourceCtx, img, TEXTURE_SIZE)
      const lineMask = buildLineMask(sourceCtx, TEXTURE_SIZE)

      const analysisCanvas = document.createElement('canvas')
      analysisCanvas.width = ANALYSIS_SIZE
      analysisCanvas.height = ANALYSIS_SIZE
      const analysisCtx = analysisCanvas.getContext('2d')!
      drawContain(analysisCtx, img, ANALYSIS_SIZE)

      const alphaMask = buildAlphaMask(analysisCtx, ANALYSIS_SIZE)
      const lineMaskAnalysis = buildLineMask(analysisCtx, ANALYSIS_SIZE)
      const fillMask = new Uint8Array(ANALYSIS_SIZE * ANALYSIS_SIZE)
      let foregroundCount = 0
      let lineCount = 0
      for (let i = 0; i < fillMask.length; i++) {
        if (alphaMask[i] === 1) foregroundCount++
        if (lineMaskAnalysis[i] === 1) lineCount++
        fillMask[i] = alphaMask[i] === 1 && lineMaskAnalysis[i] === 0 ? 1 : 0
      }
      const hasMeaningfulLineArt =
        foregroundCount > 0 && lineCount / foregroundCount >= MIN_LINE_COVERAGE_RATIO

      let outline: Vector2[] | null = null
      let uv: UVTransform | null = null
      let regions: RegionPiece[] | null = null

      try {
        const silhouette = traceSimplePolygon(alphaMask, ANALYSIS_SIZE, OUTLINE_SIMPLIFY_EPSILON)
        if (silhouette) {
          const transform = computeTransform(silhouette, ANALYSIS_SIZE)
          outline = applyTransform(silhouette, transform).map((p) => new Vector2(p.x, p.y))
          uv = transform

          if (hasMeaningfulLineArt) {
            const imageData = analysisCtx.getImageData(0, 0, ANALYSIS_SIZE, ANALYSIS_SIZE)
            const extracted = extractRegions(
              fillMask,
              imageData,
              ANALYSIS_SIZE,
              ANALYSIS_SIZE,
              MIN_REGION_PIXELS,
              SIMPLIFY_EPSILON,
            )
            if (extracted.length > 0) {
              // A region traced from the fill mask can stray a pixel or two outside the outline
              // (the two are traced independently, and simplifying the outline chords slightly
              // inside the true silhouette). A hole that pokes outside its containing shape is
              // invalid topology and corrupts the plate's triangulation — but discarding the
              // region would leave that area as bare metal, so repair the stray points instead
              // by pulling them just inside the outline.
              const center = { x: transform.cx, y: transform.cy }
              regions = extracted.map((r) => ({
                points: applyTransform(
                  r.polygon.map((p) => clampInsidePolygon(p, silhouette, center)),
                  transform,
                ).map((p) => new Vector2(p.x, p.y)),
                color: rgbToHex(r.color),
              }))
            }
          }
        }
      } catch {
        outline = null
        uv = null
        regions = null
      }

      setDesign({ sourceCanvas, lineMask, outline, uv, regions })
    }

    img.src = url

    return () => {
      cancelled = true
      URL.revokeObjectURL(url)
    }
  }, [file])

  return design
}
