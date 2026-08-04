import { useRef, useState } from 'react'
import { MIN_RAISED_HEIGHT, MAX_RAISED_HEIGHT } from './PinMesh'
import { ENAMEL_TYPES, PLATINGS, type EnamelType, type PlatingId } from '../types'

interface ControlPanelProps {
  file: File | null
  onFileChange: (file: File | null) => void
  platingId: PlatingId
  onPlatingChange: (id: PlatingId) => void
  enamelType: EnamelType
  onEnamelTypeChange: (id: EnamelType) => void
  raisedHeight: number
  onRaisedHeightChange: (value: number) => void
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
}: ControlPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  function handleFiles(files: FileList | null) {
    const picked = files?.[0]
    if (picked && picked.type.startsWith('image/')) {
      onFileChange(picked)
    }
  }

  return (
    <aside className="w-80 shrink-0 border-r border-white/10 bg-[#151517] p-6 flex flex-col gap-8">
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

      <div className="mt-auto text-xs text-white/30">
        Drag to rotate the pin. Scroll to zoom.
      </div>
    </aside>
  )
}
