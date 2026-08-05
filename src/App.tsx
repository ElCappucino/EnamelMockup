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
  DEFAULT_COLOR_MODE,
  DEFAULT_LINE_THRESHOLD,
  useTracedDesign,
} from './hooks/useTracedDesign'
import type { ColorSamplingMode } from './lib/regions'
import {
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
  const [colorMode, setColorMode] = useState<ColorSamplingMode>(DEFAULT_COLOR_MODE)

  const design = useTracedDesign(file, lineThreshold, colorMode)
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
        lineThreshold={lineThreshold}
        onLineThresholdChange={setLineThreshold}
        colorMode={colorMode}
        onColorModeChange={setColorMode}
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
          product={product}
          placement={placement}
          baseUrl={import.meta.env.BASE_URL}
        />
      </main>
    </div>
  )
}

export default App
