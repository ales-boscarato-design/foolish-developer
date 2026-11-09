/**
 * Tipi promo realmente supportati dalla collezione `PromoCodes`.
 *
 * Questa lista e' l'unica fonte: il `select` di `PromoCodes` e quello degli snapshot
 * sugli ordini devono restare allineati (vedi `promoTypes.test.ts`). Aggiungere un tipo
 * qui senza una migration che estenda `enum_promo_codes_type`/`enum_orders_promo_type`
 * rompe la scrittura su Postgres: i due passi vanno insieme.
 */
export const PROMO_TYPES = ['free_shipping', 'percent_pro', 'percent', 'amount', 'percent_tiered'] as const

export type PromoType = (typeof PROMO_TYPES)[number]

export const PROMO_TYPE_LABELS: Record<PromoType, string> = {
  free_shipping: 'Spedizione gratuita',
  percent_pro: 'Sconto % Pro',
  percent: 'Sconto %',
  amount: 'Sconto importo fisso (€)',
  percent_tiered: 'Sconto percentuale progressivo',
}

/** Validatore dei valori ammessi; `null`/`undefined` restano validi (campo nullable). */
export function isPromoType(value: unknown): value is PromoType {
  return typeof value === 'string' && (PROMO_TYPES as readonly string[]).includes(value)
}
