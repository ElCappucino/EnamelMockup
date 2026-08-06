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

export interface BackgroundOption {
  id: string
  label: string
  color: string
}

/** Quick picks for the viewer backdrop. Any colour at all is reachable through the custom picker;
 * these are just the ones worth a single click — the dark studio default the pin was lit for, plus
 * the neutral backdrops a product shot usually wants. */
export const BACKGROUNDS: BackgroundOption[] = [
  { id: 'studio', label: 'Studio', color: '#1b1b1f' },
  { id: 'slate', label: 'Slate', color: '#454b5a' },
  { id: 'light', label: 'Light', color: '#e8e8ea' },
  { id: 'white', label: 'White', color: '#ffffff' },
]

export const DEFAULT_BACKGROUND_COLOR = BACKGROUNDS[0].color

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

/** How the pin sits on a product, applied on top of the anchor baked into each model. All three
 * angles are in the anchor's own frame, so they stay meaningful whichever way the anchor faces. */
export interface PinPlacement {
  /** Slide across the surface, in millimetres along the anchor's local X. */
  offsetXMm: number
  /** Slide up and down the surface, in millimetres along the anchor's local Y. */
  offsetYMm: number
  /** Lift off or sink into the surface, in millimetres along the anchor's outward normal. */
  offsetZMm: number
  /** Tilt about the anchor's local X — leans the pin's top toward or away from the surface. */
  pitchDeg: number
  /** Swivel about the anchor's local Y — turns one side edge away from the surface. */
  yawDeg: number
  /** Spin about the anchor's outward normal (local Z) — which way is "up" on the design. */
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

/** Zero offset and no tilt, i.e. sitting exactly on the anchor baked into the model. */
const AT_ANCHOR = {
  offsetXMm: 0,
  offsetYMm: 0,
  offsetZMm: 0,
  pitchDeg: 0,
  yawDeg: 0,
  rollDeg: 0,
}

export const PRODUCTS: Product[] = [
  { id: 'none', label: 'Pin only', file: null, defaultPlacement: { ...AT_ANCHOR, diameterMm: 32 } },
  {
    id: 'toteBag',
    label: 'Tote Bag',
    file: 'models/tote-bag.glb',
    defaultPlacement: { ...AT_ANCHOR, diameterMm: 32 },
  },
  {
    id: 'denimJacket',
    label: 'Denim Jacket',
    file: 'models/denim-jacket.glb',
    defaultPlacement: { ...AT_ANCHOR, diameterMm: 32 },
  },
  {
    id: 'denimCap',
    label: 'Cap',
    file: 'models/denim-cap.glb',
    defaultPlacement: { ...AT_ANCHOR, diameterMm: 28 },
  },
]

export const MIN_PIN_DIAMETER_MM = 10
export const MAX_PIN_DIAMETER_MM = 80

/** Roughly half the widest product (the jacket is ~555mm across), so the pin can be moved
 * anywhere on a garment without the slider feeling unusably coarse. */
export const PIN_OFFSET_RANGE_MM = 200

/** Every numeric field of a placement, used to validate stored data field by field. */
export const PLACEMENT_KEYS: (keyof PinPlacement)[] = [
  'offsetXMm',
  'offsetYMm',
  'offsetZMm',
  'pitchDeg',
  'yawDeg',
  'rollDeg',
  'diameterMm',
]
