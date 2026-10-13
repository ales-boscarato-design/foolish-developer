/**
 * URL di prodotto storicamente non recuperabili, pubblicati dal CMS.
 *
 * Due prodotti sono stati creati con uno slug che contiene spazi
 * (`t-sheet-dbl - abbonamento`). Lo slug finisce grezzo nell'`href` della scheda
 * prodotto, quindi il browser chiede `/prodotto/t-sheet-dbl%20-%20abbonamento`:
 * la richiesta arriva codificata e `where[slug][equals]` nel CMS non trova mai la
 * stringa, cosi' la pagina risponde 404 in tutte le lingue — pur essendo il
 * prodotto attivo, in griglia e nella sitemap.
 *
 * Lo slug e' stato corretto nel CMS; questi URL restano nella sitemap, nei link
 * condivisi e nella cronologia dei clienti, quindi si dirottano sul percorso
 * canonico invece di lasciare un 404 a chi stava comprando.
 *
 * La ricaduta e' impedita a monte: `cms/src/collections/Products.ts` rifiuta uno
 * slug che non sia minuscole/numeri/trattini.
 */

export const LEGACY_PRODUCT_SLUGS: Record<string, string> = {
  't-sheet-dbl - abbonamento': 't-sheet-dbl-abbonamento',
  'skin-face-3d - abbonamento': 'skin-face-3d-abbonamento',
}

const LOCALES = ['it', 'en', 'fr', 'es', 'de'] as const
const PRODUCT_PATH = /^\/(?:([a-z]{2})\/)?prodotto\/(.+)$/

/**
 * Restituisce il percorso canonico per un URL di prodotto basato su uno slug
 * malformato, altrimenti `null`.
 *
 * Accetta il percorso cosi' come arriva (codificato, `%20`) e la forma gia'
 * decodificata; il `+` e' trattato come spazio solo come difesa, perche' un URL
 * di questo tipo e' circolato anche in quella forma.
 */
export function canonicalLegacyPath(pathname: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    // Percent-encoding malformato: non e' uno di questi URL.
    return null
  }

  for (const path of [decoded, decoded.replace(/\+/g, ' ')]) {
    const match = path.match(PRODUCT_PATH)
    if (!match) continue

    const [, locale, slug] = match
    if (locale && !(LOCALES as readonly string[]).includes(locale)) continue

    const canonical = LEGACY_PRODUCT_SLUGS[slug]
    if (!canonical) continue

    return `${locale ? `/${locale}` : ''}/prodotto/${canonical}`
  }

  return null
}
