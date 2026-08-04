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

export interface Product {
  id: ProductId
  label: string
  /** Served from public/, so the deploy base path has to be prepended at load time. */
  file: string | null
  /** Pin diameter in the model's world units. These models all sit at roughly 1 unit = 10cm,
   * so 0.32 gives a ~32mm pin — a common real-world enamel pin size. */
  pinDiameter: number
}

export const PRODUCTS: Product[] = [
  { id: 'none', label: 'Pin only', file: null, pinDiameter: 0 },
  { id: 'toteBag', label: 'Tote Bag', file: 'models/tote-bag.glb', pinDiameter: 0.32 },
  { id: 'denimJacket', label: 'Denim Jacket', file: 'models/denim-jacket.glb', pinDiameter: 0.32 },
  { id: 'denimCap', label: 'Cap', file: 'models/denim-cap.glb', pinDiameter: 0.28 },
]
