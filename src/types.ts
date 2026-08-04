export type PlatingId = 'gold' | 'silver' | 'blackNickel' | 'copper'

export interface Plating {
  id: PlatingId
  label: string
  color: string
}

export const PLATINGS: Plating[] = [
  { id: 'gold', label: 'Gold', color: '#d4af37' },
  { id: 'silver', label: 'Silver', color: '#c7c9cc' },
  { id: 'blackNickel', label: 'Black Nickel', color: '#2b2b2e' },
  { id: 'copper', label: 'Copper', color: '#b87333' },
]

export type EnamelType = 'soft' | 'hard'

export interface EnamelOption {
  id: EnamelType
  label: string
  description: string
}

export const ENAMEL_TYPES: EnamelOption[] = [
  { id: 'soft', label: 'Soft Enamel', description: 'Raised metal outline' },
  { id: 'hard', label: 'Hard Enamel', description: 'Flush, polished flat' },
]

export type ProductId = 'none' | 'toteBag' | 'denimJacket' | 'denimCap'

/** All three product models are authored at roughly 1 world unit = 10cm, which lets the size
 * control be expressed in millimetres instead of abstract units. A model at a different scale
 * would need this reconsidered. */
export const MM_PER_WORLD_UNIT = 100

/** How the pin sits on a product. The anchor baked into each model already fixes position and
 * makes the pin face outward; these are the adjustments left on top of that. */
export interface PinPlacement {
  /** Spin about the surface normal, in degrees. Pitch and yaw are deliberately not exposed —
   * they would tilt the pin off the fabric it is supposed to be lying against. */
  rollDeg: number
  /** Pin diameter in millimetres. */
  diameterMm: number
}

export interface Product {
  id: ProductId
  label: string
  /** Served from public/, so the deploy base path has to be prepended at load time. */
  file: string | null
  /** Starting placement, overridden by anything the user has saved for this product. */
  defaultPlacement: PinPlacement
}

export const PRODUCTS: Product[] = [
  { id: 'none', label: 'Pin only', file: null, defaultPlacement: { rollDeg: 0, diameterMm: 32 } },
  {
    id: 'toteBag',
    label: 'Tote Bag',
    file: 'models/tote-bag.glb',
    defaultPlacement: { rollDeg: 0, diameterMm: 32 },
  },
  {
    id: 'denimJacket',
    label: 'Denim Jacket',
    file: 'models/denim-jacket.glb',
    defaultPlacement: { rollDeg: 0, diameterMm: 32 },
  },
  {
    id: 'denimCap',
    label: 'Cap',
    file: 'models/denim-cap.glb',
    defaultPlacement: { rollDeg: 0, diameterMm: 28 },
  },
]

export const MIN_PIN_DIAMETER_MM = 10
export const MAX_PIN_DIAMETER_MM = 80
