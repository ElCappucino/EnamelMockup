import { Vector2 } from 'three'
import type { UVTransform } from './contour'

/**
 * ExtrudeGeometry UVGenerator that maps shape-space (x, y) back to the
 * normalized (0..1) pixel space of the canvas the outline was traced from,
 * so the face texture lines up with the traced silhouette.
 */
export function makeUVGenerator(uv: UVTransform | null) {
  const toUV = uv
    ? (x: number, y: number) => {
        const px = x / uv.scale + uv.cx
        const py = -y / uv.scale + uv.cy
        return new Vector2(px / uv.canvasSize, 1 - py / uv.canvasSize)
      }
    : (x: number, y: number) => new Vector2((x + 1) / 2, (y + 1) / 2)

  return {
    generateTopUV(
      _geometry: unknown,
      vertices: number[],
      indexA: number,
      indexB: number,
      indexC: number,
    ) {
      return [indexA, indexB, indexC].map((i) => toUV(vertices[i * 3], vertices[i * 3 + 1]))
    },
    generateSideWallUV() {
      return [new Vector2(0, 0), new Vector2(1, 0), new Vector2(1, 1), new Vector2(0, 1)]
    },
  }
}
