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
const HOST_NAME = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i

/** Indirizzi del container: non devono mai finire in un `Location`. */
function isInternalHost(name: string): boolean {
  return (
    name === '0.0.0.0' ||
    name === 'localhost' ||
    name === '::1' ||
    name === '[::1]' ||
    name.startsWith('127.') ||
    name.endsWith('.internal')
  )
}

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

export interface LegacyRedirectInput {
  /** URL della richiesta: dietro un proxy puo' portare l'indirizzo interno del container. */
  requestUrl: URL
  /** Header `Host`/`X-Forwarded-Host` grezzo: puo' essere una lista e puo' avere la porta. */
  host?: string | null
  /** Header `X-Forwarded-Proto` grezzo: puo' essere una lista (`https, http`). */
  forwardedProto?: string | null
}

/**
 * Un host utilizzabile in un `Location`: un solo nome, senza schema ne' percorso,
 * senza la porta interna 8080 (la aggiunge il proxy di Railway) e senza gli
 * indirizzi del container.
 */
function usableHost(raw: string | null | undefined): string | null {
  const value = String(raw ?? '')
    .split(',')[0]
    .trim()
    .replace(/\.$/, '')
  if (!value) return null

  const [name, port] = value.split(':')
  if (!name || name.includes('..') || !HOST_NAME.test(name)) return null
  if (port !== undefined && !/^\d{1,5}$/.test(port)) return null
  if (isInternalHost(name)) return null

  return port && port !== '8080' ? `${name}:${port}` : name
}

/**
 * URL assoluto su cui dirottare una richiesta con uno slug malformato, oppure `null`.
 *
 * Il runtime del middleware pretende un `Location` assoluto (con un `Location`
 * relativo la risposta e' 500, riprodotto), quindi l'origine va costruita: si usa
 * l'host con cui il visitatore ha chiamato il sito — lo stesso che il redirect
 * www -> apex in `proxy.ts` gia' usa — e un host diverso puo' sceglierlo solo chi
 * controlla gia' la richiesta. Se nessun host e' utilizzabile si restituisce `null`:
 * meglio il 404 di prima che un `Location` con l'indirizzo interno del container.
 */
export function legacyRedirectUrl(pathname: string, input: LegacyRedirectInput): string | null {
  const target = canonicalLegacyPath(pathname)
  if (!target) return null

  const forwardedProto = String(input.forwardedProto ?? '')
    .split(',')[0]
    .trim()
    .toLowerCase()
  const protocol =
    forwardedProto === 'http' || forwardedProto === 'https'
      ? forwardedProto
      : input.requestUrl.protocol.replace(':', '')

  const host = usableHost(input.host) ?? usableHost(input.requestUrl.host)
  if (!host) return null

  try {
    return new URL(target, `${protocol}://${host}`).toString()
  } catch {
    return null
  }
}
