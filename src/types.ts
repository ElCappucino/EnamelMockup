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
