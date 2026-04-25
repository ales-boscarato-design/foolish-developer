/**
 * Calcolo spedizione Foolish Butcher.
 *
 * Italia:        7,65€  → gratis sopra 50€
 * Europa:       14,99€  → gratis sopra 150€
 * Resto mondo:  37,95€  → gratis sopra 250€
 */

const EU_COUNTRIES = new Set([
  'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU',
  'IE','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE',
  'NO','IS','LI','CH', // SEE / Svizzera inclusi
])

export type ShippingZone = 'IT' | 'EU' | 'WORLD'

export interface ShippingRate {
  zone: ShippingZone
  cost: number
  freeAbove: number
  isFree: boolean
}

export function getShippingZone(countryCode: string): ShippingZone {
  const c = countryCode.toUpperCase()
  if (c === 'IT') return 'IT'
  if (EU_COUNTRIES.has(c)) return 'EU'
  return 'WORLD'
}

export function calculateShipping(cartTotal: number, countryCode: string): ShippingRate {
  const zone = getShippingZone(countryCode)

  const config: Record<ShippingZone, { cost: number; freeAbove: number }> = {
    IT:    { cost: 7.65,  freeAbove: 50 },
    EU:    { cost: 14.99, freeAbove: 150 },
    WORLD: { cost: 37.95, freeAbove: 250 },
  }

  const { cost, freeAbove } = config[zone]
  const isFree = cartTotal >= freeAbove

  return { zone, cost: isFree ? 0 : cost, freeAbove, isFree }
}

export function shippingLabel(zone: ShippingZone): string {
  const labels: Record<ShippingZone, string> = {
    IT:    'Italia',
    EU:    'Europa',
    WORLD: 'Resto del mondo',
  }
  return labels[zone]
}

export function freeShippingRemaining(cartTotal: number, countryCode: string): number {
  const zone = getShippingZone(countryCode)
  const thresholds: Record<ShippingZone, number> = { IT: 50, EU: 150, WORLD: 250 }
  const remaining = thresholds[zone] - cartTotal
  return Math.max(0, remaining)
}
