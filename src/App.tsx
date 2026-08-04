import { useState } from 'react'
import { ControlPanel } from './components/ControlPanel'
import { PinCanvas } from './components/PinCanvas'
import { DEFAULT_RAISED_HEIGHT } from './components/PinMesh'
import { useEnamelTextures } from './hooks/useEnamelTextures'
import { useTracedDesign } from './hooks/useTracedDesign'
import { PLATINGS, type EnamelType, type PlatingId } from './types'

function App() {
  const [file, setFile] = useState<File | null>(null)
  const [platingId, setPlatingId] = useState<PlatingId>('gold')
  const [enamelType, setEnamelType] = useState<EnamelType>('soft')
  const [raisedHeight, setRaisedHeight] = useState(DEFAULT_RAISED_HEIGHT)

  const design = useTracedDesign(file)
  const platingColor = PLATINGS.find((p) => p.id === platingId)!.color

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
      />
      <main className="flex-1">
        <PinCanvas
          platingColor={platingColor}
          enamelType={enamelType}
          raisedHeight={raisedHeight}
          colorTexture={colorTexture}
          bumpTexture={bumpTexture}
          outline={design?.outline ?? null}
          uv={design?.uv ?? null}
          regions={design?.regions ?? null}
        />
      </main>
    </div>
  )
}

export default App
