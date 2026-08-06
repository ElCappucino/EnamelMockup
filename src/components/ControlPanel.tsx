import { useRef, useState } from 'react'
import { MIN_RAISED_HEIGHT, MAX_RAISED_HEIGHT } from './PinMesh'
import { MIN_LINE_THRESHOLD, MAX_LINE_THRESHOLD } from '../hooks/useTracedDesign'
import {
  MAX_OUTLINE_TOLERANCE,
  MIN_OUTLINE_TOLERANCE,
  type OutlineMode,
  type OutlineSource,
} from '../lib/outline'
import {
  ENAMEL_TYPES,
  MAX_PIN_DIAMETER_MM,
  MIN_PIN_DIAMETER_MM,
  PIN_OFFSET_RANGE_MM,
  PLATINGS,
  PRODUCTS,
  type EnamelType,
  type PinPlacement,
  type PlatingId,
  type ProductId,
} from '../types'

const OUTLINE_MODES: { id: OutlineMode; label: string; description: string }[] = [
  {
    id: 'color',
    label: 'Stroke color',
    description:
      "Reads the outline color off the design's border, then finds every stroke in that color — including the ones inside the artwork",
  },
  {
    id: 'darkness',
    label: 'Darkness',
    description: 'Treats any pixel darker than the threshold as an outline',
  },
]

function PlacementSlider({
  label,
  unit,
  min,
  max,
  value,
  onChange,
}: {
  label: string
  unit: string
  min: number
  max: number
  value: number
  onChange: (value: number) => void
}) {
  return (
    <>
      <label className="text-xs text-white/50 mb-1 flex items-center justify-between">
        <span>{label}</span>
        <span className="text-white/40">
          {Math.round(value)}
          {unit}
        </span>
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-blue-400 mb-3"
      />
    </>
  )
}

/** For 0..1 controls displayed as a percentage — reflectivity sliders. */
function PercentSlider({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <>
      <label className="text-xs text-white/50 mb-1 flex items-center justify-between">
        <span>{label}</span>
        <span className="text-white/40">{Math.round(value * 100)}%</span>
      </label>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-blue-400 mb-3"
      />
    </>
  )
}

interface ControlPanelProps {
  file: File | null
  onFileChange: (file: File | null) => void
  platingId: PlatingId
  onPlatingChange: (id: PlatingId) => void
  enamelType: EnamelType
  onEnamelTypeChange: (id: EnamelType) => void
  raisedHeight: number
  onRaisedHeightChange: (value: number) => void
  metalReflectivity: number
  onMetalReflectivityChange: (value: number) => void
  enamelReflectivity: number
  onEnamelReflectivityChange: (value: number) => void
  outlineMode: OutlineMode
  onOutlineModeChange: (mode: OutlineMode) => void
  outlineTolerance: number
  onOutlineToleranceChange: (value: number) => void
  /** What detection actually ran — may differ from `outlineMode` when the design has no
   * consistent stroke color to read. */
  outlineSource: OutlineSource | null
  outlineColor: [number, number, number] | null
  lineThreshold: number
  onLineThresholdChange: (value: number) => void
  wireframe: boolean
  onWireframeChange: (value: boolean) => void
  productId: ProductId
  onProductChange: (id: ProductId) => void
  placement: PinPlacement
  onPlacementChange: (patch: Partial<PinPlacement>) => void
  onPlacementReset: () => void
}

export function ControlPanel({
  file,
  onFileChange,
  platingId,
  onPlatingChange,
  enamelType,
  onEnamelTypeChange,
  raisedHeight,
  onRaisedHeightChange,
  metalReflectivity,
  onMetalReflectivityChange,
  enamelReflectivity,
  onEnamelReflectivityChange,
  outlineMode,
  onOutlineModeChange,
  outlineTolerance,
  onOutlineToleranceChange,
  outlineSource,
  outlineColor,
  lineThreshold,
  onLineThresholdChange,
  wireframe,
  onWireframeChange,
  productId,
  onProductChange,
  placement,
  onPlacementChange,
  onPlacementReset,
}: ControlPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)

  function handleFiles(files: FileList | null) {
    const picked = files?.[0]
    if (picked && picked.type.startsWith('image/')) {
      onFileChange(picked)
    }
  }

  return (
    <aside className="w-80 shrink-0 overflow-y-auto border-r border-white/10 bg-[#151517] p-6 flex flex-col gap-8">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Enamel Pin Studio</h1>
        <p className="text-sm text-white/50 mt-1">
          Upload your 2D design and preview it as a 3D enamel pin.
        </p>
      </div>

      <div>
        <label className="text-sm font-medium text-white/70 mb-2 block">Design</label>
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            handleFiles(e.dataTransfer.files)
          }}
          onClick={() => inputRef.current?.click()}
          className={`cursor-pointer rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
            dragging ? 'border-blue-400 bg-blue-400/10' : 'border-white/15 hover:border-white/30'
          }`}
        >
          {file ? (
            <p className="text-sm text-white/80 break-all">{file.name}</p>
          ) : (
            <p className="text-sm text-white/50">
              Drag &amp; drop an image, or click to browse
            </p>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        {file && (
          <button
            onClick={() => onFileChange(null)}
            className="mt-2 text-xs text-white/40 hover:text-white/70"
          >
            Remove design
          </button>
        )}
      </div>

      <div>
        <label className="text-sm font-medium text-white/70 mb-2 block">Outline Detection</label>
        <div className="grid grid-cols-2 gap-2 mb-3">
          {OUTLINE_MODES.map((mode) => (
            <button
              key={mode.id}
              onClick={() => onOutlineModeChange(mode.id)}
              title={mode.description}
              className={`rounded-md border px-3 py-2 text-sm transition-colors ${
                outlineMode === mode.id
                  ? 'border-blue-400 bg-blue-400/10 text-white'
                  : 'border-white/10 text-white/70 hover:border-white/25'
              }`}
            >
              {mode.label}
            </button>
          ))}
        </div>

        {outlineMode === 'color' && (
          <>
            <label className="text-xs text-white/50 mb-1 flex items-center justify-between">
              <span>Tolerance</span>
              <span className="text-white/40">{Math.round(outlineTolerance)}</span>
            </label>
            <input
              type="range"
              min={MIN_OUTLINE_TOLERANCE}
              max={MAX_OUTLINE_TOLERANCE}
              step={1}
              value={outlineTolerance}
              onChange={(e) => onOutlineToleranceChange(Number(e.target.value))}
              className="w-full accent-blue-400"
            />
            <p className="mt-1 mb-2 text-xs text-white/30">
              How close a pixel must be to the outline color to count as a stroke. Raise it if
              parts of the outline are being filled with enamel; lower it if a design color is
              turning into plating.
            </p>
            {outlineColor && outlineSource === 'color' && (
              <p className="flex items-center gap-2 text-xs text-white/40">
                <span
                  className="h-3.5 w-3.5 shrink-0 rounded-full border border-white/20"
                  style={{ backgroundColor: `rgb(${outlineColor.join(',')})` }}
                />
                Outline color found on your design
              </p>
            )}
            {outlineSource === 'darkness' && (
              <p className="text-xs text-amber-300/70">
                No single outline color runs around this design, so darkness is being used
                instead.
              </p>
            )}
          </>
        )}

        {/* Also shown when color detection fell back to darkness, since the threshold is then
            what's actually in effect. */}
        {(outlineMode === 'darkness' || outlineSource === 'darkness') && (
          <>
            <label className="mt-3 text-xs text-white/50 mb-1 flex items-center justify-between">
              <span>Darkness Threshold</span>
              <span className="text-white/40">{Math.round(lineThreshold)}</span>
            </label>
            <input
              type="range"
              min={MIN_LINE_THRESHOLD}
              max={MAX_LINE_THRESHOLD}
              step={1}
              value={lineThreshold}
              onChange={(e) => onLineThresholdChange(Number(e.target.value))}
              className="w-full accent-blue-400"
            />
            <p className="mt-1 text-xs text-white/30">
              How dark a pixel must be to count as an outline rather than a design color. Lower
              this if a dark fill color is being replaced by the plating.
            </p>
          </>
        )}
      </div>

      <div>
        <label className="text-sm font-medium text-white/70 mb-2 block">Enamel Type</label>
        <div className="grid grid-cols-2 gap-2">
          {ENAMEL_TYPES.map((option) => (
            <button
              key={option.id}
              onClick={() => onEnamelTypeChange(option.id)}
              className={`rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                enamelType === option.id
                  ? 'border-blue-400 bg-blue-400/10 text-white'
                  : 'border-white/10 text-white/70 hover:border-white/25'
              }`}
            >
              <div>{option.label}</div>
              <div className="text-xs text-white/40">{option.description}</div>
            </button>
          ))}
        </div>
      </div>

      {enamelType === 'soft' && (
        <div>
          <label className="text-sm font-medium text-white/70 mb-2 flex items-center justify-between">
            <span>Raised Outline Height</span>
            <span className="text-xs text-white/40">
              {Math.round(
                ((raisedHeight - MIN_RAISED_HEIGHT) / (MAX_RAISED_HEIGHT - MIN_RAISED_HEIGHT)) *
                  100,
              )}
              %
            </span>
          </label>
          <input
            type="range"
            min={MIN_RAISED_HEIGHT}
            max={MAX_RAISED_HEIGHT}
            step={0.0005}
            value={raisedHeight}
            onChange={(e) => onRaisedHeightChange(Number(e.target.value))}
            className="w-full accent-blue-400"
          />
        </div>
      )}

      <div>
        <label className="text-sm font-medium text-white/70 mb-2 block">Plating</label>
        <div className="grid grid-cols-2 gap-2">
          {PLATINGS.map((plating) => (
            <button
              key={plating.id}
              onClick={() => onPlatingChange(plating.id)}
              className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
                platingId === plating.id
                  ? 'border-blue-400 bg-blue-400/10 text-white'
                  : 'border-white/10 text-white/70 hover:border-white/25'
              }`}
            >
              <span
                className="h-3.5 w-3.5 rounded-full border border-white/20"
                style={{ backgroundColor: plating.color }}
              />
              {plating.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-sm font-medium text-white/70 mb-2 block">Reflection</label>
        <PercentSlider
          label="Metal"
          value={metalReflectivity}
          onChange={onMetalReflectivityChange}
        />
        <PercentSlider
          label="Enamel"
          value={enamelReflectivity}
          onChange={onEnamelReflectivityChange}
        />
      </div>

      <div>
        <label className="text-sm font-medium text-white/70 mb-2 block">Show On</label>
        <div className="grid grid-cols-2 gap-2">
          {PRODUCTS.map((product) => (
            <button
              key={product.id}
              onClick={() => onProductChange(product.id)}
              className={`rounded-md border px-3 py-2 text-sm transition-colors ${
                productId === product.id
                  ? 'border-blue-400 bg-blue-400/10 text-white'
                  : 'border-white/10 text-white/70 hover:border-white/25'
              }`}
            >
              {product.label}
            </button>
          ))}
        </div>
      </div>

      {productId !== 'none' && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-white/70">Pin Placement</label>
            <button
              onClick={onPlacementReset}
              className="text-xs text-white/40 hover:text-white/70"
            >
              Reset
            </button>
          </div>

          <PlacementSlider
            label="X — across"
            unit=" mm"
            min={-PIN_OFFSET_RANGE_MM}
            max={PIN_OFFSET_RANGE_MM}
            value={placement.offsetXMm}
            onChange={(offsetXMm) => onPlacementChange({ offsetXMm })}
          />
          <PlacementSlider
            label="Y — up"
            unit=" mm"
            min={-PIN_OFFSET_RANGE_MM}
            max={PIN_OFFSET_RANGE_MM}
            value={placement.offsetYMm}
            onChange={(offsetYMm) => onPlacementChange({ offsetYMm })}
          />
          <PlacementSlider
            label="Z — off surface"
            unit=" mm"
            min={-PIN_OFFSET_RANGE_MM}
            max={PIN_OFFSET_RANGE_MM}
            value={placement.offsetZMm}
            onChange={(offsetZMm) => onPlacementChange({ offsetZMm })}
          />
          <PlacementSlider
            label="Pitch"
            unit="°"
            min={-180}
            max={180}
            value={placement.pitchDeg}
            onChange={(pitchDeg) => onPlacementChange({ pitchDeg })}
          />
          <PlacementSlider
            label="Yaw"
            unit="°"
            min={-180}
            max={180}
            value={placement.yawDeg}
            onChange={(yawDeg) => onPlacementChange({ yawDeg })}
          />
          <PlacementSlider
            label="Roll"
            unit="°"
            min={-180}
            max={180}
            value={placement.rollDeg}
            onChange={(rollDeg) => onPlacementChange({ rollDeg })}
          />
          <PlacementSlider
            label="Size"
            unit=" mm"
            min={MIN_PIN_DIAMETER_MM}
            max={MAX_PIN_DIAMETER_MM}
            value={placement.diameterMm}
            onChange={(diameterMm) => onPlacementChange({ diameterMm })}
          />

          <p className="mt-1 text-xs text-white/30">Saved per product.</p>
        </div>
      )}

      <div className="mt-auto border-t border-white/10 pt-4">
        <button
          onClick={() => setAdvancedOpen((open) => !open)}
          className="flex w-full items-center justify-between text-sm font-medium text-white/70 hover:text-white"
        >
          Advanced
          <span
            className={`text-white/40 transition-transform ${advancedOpen ? 'rotate-180' : ''}`}
          >
            ▾
          </span>
        </button>

        {advancedOpen && (
          <div className="mt-3">
            <label className="text-xs text-white/50 mb-2 block">
              Rendering, for development
            </label>
            <button
              onClick={() => onWireframeChange(!wireframe)}
              className={`w-full rounded-md border px-3 py-2 text-sm transition-colors ${
                wireframe
                  ? 'border-blue-400 bg-blue-400/10 text-white'
                  : 'border-white/10 text-white/70 hover:border-white/25'
              }`}
            >
              Wireframe: {wireframe ? 'On' : 'Off'}
            </button>
          </div>
        )}
      </div>

      <div className="text-xs text-white/30">Drag to rotate. Scroll to zoom.</div>
    </aside>
  )
}
