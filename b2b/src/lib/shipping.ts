/**
 * Calcolo spedizione rivenditori.
 *
 * Sotto i 500€ di ordine: stesse TARIFFE e stesse SOGLIE del sito retail, in un
 * file proprio — i due pacchetti non si importano a vicenda, quindi la stessa
 * regola vive anche in `storefront/src/lib/shipping.ts` e una modifica qui va
 * replicata li' (e viceversa).
 *   Italia:        7,65€  → gratis sopra 60€   (retail: identico dal 12/11/2026)
 *   Unione Europea:14,99€  → gratis sopra 150€ (retail: identico)
 *
 * La soglia italiana del canale rivenditori era 50 mentre il retail era gia' a
 * 60: un disallineamento dichiarato, in attesa di una decisione commerciale.
 * Il 12/11/2026 Alessandro l'ha presa — il B2B si allinea al retail — quindi la
 * nota sul disallineamento non serve piu'. `shipping.test.ts` fissa i confini
 * 59,99 / 60,00 / 60,01: se il valore cambia di nuovo, il test lo dice.
 *
 * Extra-UE (Svizzera, Norvegia, Regno Unito, resto del mondo): la tariffa
 * piatta non copre lo sdoganamento — dazi, IVA all'importazione, fee DDP,
 * assicurazione crescono col valore della merce e su un ordine rivenditore il
 * peso e il volume sono troppo variabili per stimarli. Si quota a parte, come
 * gia' si fa sopra i 500€: meglio un preventivo che una spedizione sotto costo.
 *
 * Da 500€ in su: peso/volume troppo variabile per una tariffa flat —
 * si comunica il costo via email entro 24h invece di stimarlo.
 */

const EU_CUSTOMS_UNION = new Set([
  'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU',
  'IE','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE',
])

export type ShippingZone = 'IT' | 'EU' | 'EXTRA_EU'

export const WHOLESALE_QUOTE_THRESHOLD = 500

export interface ResellerShippingResult {
  mode: 'calculated' | 'quote'
  cost: number
  zone: ShippingZone
}

export function getShippingZone(countryCode: string): ShippingZone {
  const c = String(countryCode ?? '').toUpperCase()
  if (c === 'IT') return 'IT'
  if (EU_CUSTOMS_UNION.has(c)) return 'EU'
  return 'EXTRA_EU'
}

export function calculateResellerShipping(cartTotal: number, countryCode: string): ResellerShippingResult {
  const zone = getShippingZone(countryCode)

  if (cartTotal >= WHOLESALE_QUOTE_THRESHOLD || zone === 'EXTRA_EU') {
    return { mode: 'quote', cost: 0, zone }
  }

  const config: Record<'IT' | 'EU', { cost: number; freeAbove: number }> = {
    // Stesse soglie del retail (`storefront/src/lib/shipping.ts`): IT 60 dal
    // 12/11/2026, EU 150. Non importare dall'altro pacchetto: si replica.
    IT: { cost: 7.65, freeAbove: 60 },
    EU: { cost: 14.99, freeAbove: 150 },
  }

  const { cost, freeAbove } = config[zone]
  return { mode: 'calculated', cost: cartTotal >= freeAbove ? 0 : cost, zone }
}

/**
 * Nota da mettere sull'ordine quando il trasporto non e' stato incassato.
 * Un ordine in modalita' `quote` viaggia con costo 0: senza questa riga, chi
 * prepara il pacco vede un ordine pagato e lo spedisce. La nota sta nelle note
 * dell'ordine perche' e' li' che guarda chi spedisce (stesso posto dell'esito
 * VIES), non in un campo che nessuno apre.
 */
export function shippingQuoteNote(mode: ResellerShippingResult['mode']): string | null {
  if (mode !== 'quote') return null
  return '[SPEDIZIONE DA QUOTARE — trasporto non incassato: completare il preventivo (sdoganamento incluso se extra-UE) prima di spedire]'
}
