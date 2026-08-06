import { useState } from 'react'
import { ControlPanel } from './components/ControlPanel'
import { PinCanvas } from './components/PinCanvas'
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
        />
      </main>
    </div>
  )
}

export default App
