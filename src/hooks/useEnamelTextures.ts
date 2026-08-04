import { useMemo } from 'react'
import { CanvasTexture, SRGBColorSpace } from 'three'
import type { EnamelType } from '../types'

const BUMP_BLUR_PX = 3

function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.replace('#', ''), 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

function buildColorTexture(
  sourceCanvas: HTMLCanvasElement,
  lineMask: Uint8Array,
  platingColor: string,
): CanvasTexture {
  const size = sourceCanvas.width
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(sourceCanvas, 0, 0)

  const imageData = ctx.getImageData(0, 0, size, size)
  const [r, g, b] = hexToRgb(platingColor)
  for (let i = 0; i < size * size; i++) {
    if (lineMask[i] === 1) {
      imageData.data[i * 4] = r
      imageData.data[i * 4 + 1] = g
      imageData.data[i * 4 + 2] = b
    }
  }
  ctx.putImageData(imageData, 0, 0)

  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

function buildBumpTexture(lineMask: Uint8Array, size: number): CanvasTexture {
  const maskCanvas = document.createElement('canvas')
  maskCanvas.width = size
  maskCanvas.height = size
  const maskCtx = maskCanvas.getContext('2d')!
  const maskData = maskCtx.createImageData(size, size)
  for (let i = 0; i < size * size; i++) {
    const v = lineMask[i] === 1 ? 255 : 0
    maskData.data[i * 4] = v
    maskData.data[i * 4 + 1] = v
    maskData.data[i * 4 + 2] = v
    maskData.data[i * 4 + 3] = 255
  }
  maskCtx.putImageData(maskData, 0, 0)

  const bumpCanvas = document.createElement('canvas')
  bumpCanvas.width = size
  bumpCanvas.height = size
  const bumpCtx = bumpCanvas.getContext('2d')!
  bumpCtx.filter = `blur(${BUMP_BLUR_PX}px)`
  bumpCtx.drawImage(maskCanvas, 0, 0)

  const texture = new CanvasTexture(bumpCanvas)
  texture.needsUpdate = true
  return texture
}

export function useEnamelTextures(
  sourceCanvas: HTMLCanvasElement | null,
  lineMask: Uint8Array | null,
  platingColor: string,
  enamelType: EnamelType,
) {
  return useMemo(() => {
    if (!sourceCanvas || !lineMask) {
      return { colorTexture: null, bumpTexture: null }
    }

    const colorTexture = buildColorTexture(sourceCanvas, lineMask, platingColor)
    const bumpTexture = enamelType === 'soft' ? buildBumpTexture(lineMask, sourceCanvas.width) : null

    return { colorTexture, bumpTexture }
  }, [sourceCanvas, lineMask, platingColor, enamelType])
}
