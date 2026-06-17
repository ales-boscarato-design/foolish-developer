import type { PriceTier } from './cms'

/**
 * Calcola il prezzo unitario scontato per una variante dato il numero di pezzi.
 * Se nessuna fascia corrisponde, ritorna il prezzo base.
 */
export function calculateUnitPrice(basePrice: number, qty: number, tiers: PriceTier[]): number {
  if (!tiers || tiers.length === 0) return basePrice
  const tier = tiers.find(
    t => qty >= t.minQty && (t.maxQty === null || qty <= t.maxQty)
  )
  if (!tier) return basePrice
  return basePrice * (1 - tier.discountPercent / 100)
}

export function calculateLineTotal(basePrice: number, qty: number, tiers: PriceTier[]): number {
  return calculateUnitPrice(basePrice, qty, tiers) * qty
}

export function formatPrice(eur: number): string {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(eur)
}

/** Determina la fascia attiva per una certa quantità */
export function getActiveTier(qty: number, tiers: PriceTier[]): PriceTier | null {
  return tiers.find(t => qty >= t.minQty && (t.maxQty === null || qty <= t.maxQty)) ?? null
}
