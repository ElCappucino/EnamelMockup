import { useCallback, useRef, useState } from 'react'
import { ControlPanel } from './components/ControlPanel'
import { PinCanvas, type CaptureFn } from './components/PinCanvas'
import {
  DEFAULT_ENAMEL_REFLECTIVITY,
  DEFAULT_METAL_REFLECTIVITY,
  DEFAULT_RAISED_HEIGHT,
} from './components/PinMesh'
import { useEnamelTextures } from './hooks/useEnamelTextures'
import { usePinPlacements } from './hooks/usePinPlacements'
import {
  DEFAULT_LINE_THRESHOLD,
  DEFAULT_OUTLINE_MODE,
  useTracedDesign,
} from './hooks/useTracedDesign'
import { downloadBlob, mockupFilename, nextFrames } from './lib/exportImage'
import { DEFAULT_OUTLINE_TOLERANCE, type OutlineMode } from './lib/outline'
import {
  DEFAULT_BACKGROUND_COLOR,
  PLATINGS,
  PRODUCTS,
  type EnamelType,
  type PinPlacement,
  type PlatingId,
  type ProductId,
} from './types'

function App() {
  const [file, setFile] = useState<File | null>(null)
  const [platingId, setPlatingId] = useState<PlatingId>('gold')
  const [enamelType, setEnamelType] = useState<EnamelType>('soft')
  const [raisedHeight, setRaisedHeight] = useState(DEFAULT_RAISED_HEIGHT)
  const [metalReflectivity, setMetalReflectivity] = useState(DEFAULT_METAL_REFLECTIVITY)
  const [enamelReflectivity, setEnamelReflectivity] = useState(DEFAULT_ENAMEL_REFLECTIVITY)
  const [productId, setProductId] = useState<ProductId>('none')
  const [lineThreshold, setLineThreshold] = useState(DEFAULT_LINE_THRESHOLD)
  const [outlineMode, setOutlineMode] = useState<OutlineMode>(DEFAULT_OUTLINE_MODE)
  const [outlineTolerance, setOutlineTolerance] = useState(DEFAULT_OUTLINE_TOLERANCE)
  const [wireframe, setWireframe] = useState(false)
  const [backgroundColor, setBackgroundColor] = useState(DEFAULT_BACKGROUND_COLOR)

  const design = useTracedDesign(file, outlineMode, outlineTolerance, lineThreshold)
  const platingColor = PLATINGS.find((p) => p.id === platingId)!.color
  const product = PRODUCTS.find((p) => p.id === productId)!

  const { placements, update, reset } = usePinPlacements()
  const placement = placements[productId]

  const handlePlacementChange = (patch: Partial<PinPlacement>) => update(productId, patch)

  const { colorTexture, bumpTexture } = useEnamelTextures(
    design?.sourceCanvas ?? null,
    design?.lineMask ?? null,
    platingColor,
    enamelType,
  )

  const captureRef = useRef<CaptureFn | null>(null)
  const framedWaiters = useRef(new Map<ProductId, () => void>())
  const [exportProgress, setExportProgress] = useState<{ done: number; total: number } | null>(null)

  const handleCaptureReady = useCallback((capture: CaptureFn) => {
    captureRef.current = capture
  }, [])

  const handleProductFramed = useCallback((id: ProductId) => {
    const resolve = framedWaiters.current.get(id)
    if (resolve) {
      framedWaiters.current.delete(id)
      resolve()
    }
  }, [])

  /** Resolves once the canvas has framed `id`. The rig only reports when it actually re-frames,
   * so a product that never reports (an unreadable model, say) would hang the run — the timeout
   * lets the export carry on and produce the remaining mockups rather than stalling on one. */
  const waitForFramed = (id: ProductId) =>
    new Promise<void>((resolve) => {
      framedWaiters.current.set(id, resolve)
      setTimeout(() => {
        if (framedWaiters.current.delete(id)) resolve()
      }, 8000)
    })

  const saveCurrentFrame = async (label: string) => {
    const blob = await captureRef.current?.()
    if (blob) downloadBlob(blob, mockupFilename(file?.name ?? null, label))
  }

  const handleExportCurrent = async () => {
    if (!captureRef.current || exportProgress) return
    setExportProgress({ done: 0, total: 1 })
    try {
      await saveCurrentFrame(product.label)
    } finally {
      setExportProgress(null)
    }
  }

  /** Walks every product, letting each one load and frame before capturing it, then puts the
   * viewer back where it started. */
  const handleExportAll = async () => {
    if (!captureRef.current || exportProgress) return
    const startedOn = productId
    let showing = productId
    setExportProgress({ done: 0, total: PRODUCTS.length })

    try {
      for (const [index, item] of PRODUCTS.entries()) {
        if (item.id !== showing) {
          const framed = waitForFramed(item.id)
          setProductId(item.id)
          showing = item.id
          await framed
        }
        // The rig reports from an effect, which runs before the frame it caused is painted.
        await nextFrames(2)
        await saveCurrentFrame(item.label)
        setExportProgress({ done: index + 1, total: PRODUCTS.length })
      }
    } finally {
      setProductId(startedOn)
      setExportProgress(null)
    }
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <ControlPanel
        file={file}
        onFileChange={setFile}
        platingId={platingId}
        onPlatingChange={setPlatingId}
        enamelType={enamelType}
        onEnamelTypeChange={setEnamelType}
        raisedHeight={raisedHeight}
        onRaisedHeightChange={setRaisedHeight}
        metalReflectivity={metalReflectivity}
        onMetalReflectivityChange={setMetalReflectivity}
        enamelReflectivity={enamelReflectivity}
        onEnamelReflectivityChange={setEnamelReflectivity}
        backgroundColor={backgroundColor}
        onBackgroundColorChange={setBackgroundColor}
        outlineMode={outlineMode}
        onOutlineModeChange={setOutlineMode}
        outlineTolerance={outlineTolerance}
        onOutlineToleranceChange={setOutlineTolerance}
        outlineSource={design?.outlineSource ?? null}
        outlineColor={design?.outlineColor ?? null}
        lineThreshold={lineThreshold}
        onLineThresholdChange={setLineThreshold}
        wireframe={wireframe}
        onWireframeChange={setWireframe}
        productId={productId}
        onProductChange={setProductId}
        placement={placement}
        onPlacementChange={handlePlacementChange}
        onPlacementReset={() => reset(productId)}
        canExport={!!design}
        exportProgress={exportProgress}
        onExportCurrent={handleExportCurrent}
        onExportAll={handleExportAll}
      />
      <main className="flex-1">
        <PinCanvas
          platingColor={platingColor}
          enamelType={enamelType}
          raisedHeight={raisedHeight}
          metalReflectivity={metalReflectivity}
          enamelReflectivity={enamelReflectivity}
          colorTexture={colorTexture}
          bumpTexture={bumpTexture}
          outline={design?.outline ?? null}
          uv={design?.uv ?? null}
          regions={design?.regions ?? null}
          cells={design?.cells ?? null}
          islands={design?.islands ?? null}
          product={product}
          placement={placement}
          baseUrl={import.meta.env.BASE_URL}
          wireframe={wireframe}
          backgroundColor={backgroundColor}
          onCaptureReady={handleCaptureReady}
          onProductFramed={handleProductFramed}
        />
      </main>
    </div>
  )
}

export default App
