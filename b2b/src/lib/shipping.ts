/**
 * Calcolo spedizione rivenditori.
 *
 * Sotto i 500€ di ordine: stesse fasce del sito retail.
 *   Italia:        7,65€  → gratis sopra 50€
 *   Europa:       14,99€  → gratis sopra 150€
 *   Resto mondo:  37,95€  → gratis sopra 250€
 *
 * Da 500€ in su: peso/volume troppo variabile per una tariffa flat —
 * si comunica il costo via email entro 24h invece di stimarlo.
 */

const EU_COUNTRIES = new Set([
  'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU',
  'IE','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE',
  'NO','IS','LI','CH', // SEE / Svizzera inclusi
])

export type ShippingZone = 'IT' | 'EU' | 'WORLD'

export const WHOLESALE_QUOTE_THRESHOLD = 500

export interface ResellerShippingResult {
  mode: 'calculated' | 'quote'
  cost: number
  zone: ShippingZone
}

export function getShippingZone(countryCode: string): ShippingZone {
  const c = countryCode.toUpperCase()
  if (c === 'IT') return 'IT'
  if (EU_COUNTRIES.has(c)) return 'EU'
  return 'WORLD'
}

export function calculateResellerShipping(cartTotal: number, countryCode: string): ResellerShippingResult {
  const zone = getShippingZone(countryCode)

  if (cartTotal >= WHOLESALE_QUOTE_THRESHOLD) {
    return { mode: 'quote', cost: 0, zone }
  }

  const config: Record<ShippingZone, { cost: number; freeAbove: number }> = {
    IT:    { cost: 7.65,  freeAbove: 50 },
    EU:    { cost: 14.99, freeAbove: 150 },
    WORLD: { cost: 37.95, freeAbove: 250 },
  }

  const { cost, freeAbove } = config[zone]
  return { mode: 'calculated', cost: cartTotal >= freeAbove ? 0 : cost, zone }
}
