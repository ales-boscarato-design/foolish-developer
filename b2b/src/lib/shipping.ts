/**
 * Calcolo spedizione rivenditori.
 *
 * Sotto i 500€ di ordine: stesse TARIFFE del sito retail, soglie diverse — e
 * questa differenza e' dichiarata qui apposta, non e' una svista.
 *   Italia:        7,65€  → gratis sopra 50€   (retail: gratis sopra 60€)
 *   Unione Europea:14,99€  → gratis sopra 150€ (retail: identico)
 *
 * Perche' la soglia italiana del canale rivenditori resta 50: e' una scelta
 * commerciale, non un riflesso del codice. Il retail ha spostato la soglia
 * italiana a 60 il 12/11/2026 (`storefront/src/lib/shipping.ts`, voce di
 * prezzo decisa da Alessandro); allineare il B2B cambierebbe il costo di
 * spedizione che un rivenditore paga su un ordine fra 50 e 60€, e quella
 * decisione non e' stata presa. Finche' non lo e', il valore resta 50 e questa
 * riga lo dice: il commento precedente («stesse fasce del sito retail»)
 * affermava il falso e faceva sembrare le due configurazioni allineate.
 * Allineare = portare `freeAbove` a 60 e aggiornare questa nota e il test.
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
    // Soglia B2B italiana diversa dal retail (50 vs 60): differenza dichiarata,
    // non allineata — vedi la nota in testa al file.
    IT: { cost: 7.65, freeAbove: 50 },
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
