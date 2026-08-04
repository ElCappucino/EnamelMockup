import { useCallback, useEffect, useState } from 'react'
import { PRODUCTS, type PinPlacement, type ProductId } from '../types'

const STORAGE_KEY = 'enamel-pin-placements-v1'

type PlacementMap = Record<ProductId, PinPlacement>

function defaults(): PlacementMap {
  return Object.fromEntries(
    PRODUCTS.map((p) => [p.id, { ...p.defaultPlacement }]),
  ) as PlacementMap
}

/** Reads saved placements, keeping only keys that still correspond to a known product and
 * discarding anything malformed — stored data outlives code changes. */
function load(): PlacementMap {
  const base = defaults()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return base

    const saved = JSON.parse(raw) as Partial<Record<string, Partial<PinPlacement>>>
    for (const product of PRODUCTS) {
      const entry = saved[product.id]
      if (!entry) continue
      if (typeof entry.rollDeg === 'number' && Number.isFinite(entry.rollDeg)) {
        base[product.id].rollDeg = entry.rollDeg
      }
      if (typeof entry.diameterMm === 'number' && Number.isFinite(entry.diameterMm)) {
        base[product.id].diameterMm = entry.diameterMm
      }
    }
  } catch {
    // Unreadable or unavailable storage (private mode, quota, corrupt JSON) — defaults are fine.
  }
  return base
}

/** Per-product pin placement, persisted so an adjustment made once becomes the placement the
 * product opens with next time. */
export function usePinPlacements() {
  const [placements, setPlacements] = useState<PlacementMap>(load)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(placements))
    } catch {
      // Persistence is a convenience; losing it shouldn't break the session.
    }
  }, [placements])

  const update = useCallback((id: ProductId, patch: Partial<PinPlacement>) => {
    setPlacements((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  }, [])

  const reset = useCallback((id: ProductId) => {
    const product = PRODUCTS.find((p) => p.id === id)
    if (!product) return
    setPlacements((prev) => ({ ...prev, [id]: { ...product.defaultPlacement } }))
  }, [])

  return { placements, update, reset }
}
