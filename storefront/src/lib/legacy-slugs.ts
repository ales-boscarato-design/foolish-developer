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

/** Un IPv4 che non puo' essere un indirizzo pubblico (RFC1918, loopback, link-local, CGNAT, multicast). */
function isPrivateIpv4(name: string): boolean {
  const parts = name.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!parts) return false
  const [a, b] = [Number(parts[1]), Number(parts[2])]
  return (
    a === 0 ||
    a === 10 ||
    (a === 100 && b >= 64 && b <= 127) ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}

/** Indirizzi del container o della rete interna: non devono mai finire in un `Location`. */
function isInternalHost(name: string): boolean {
  const host = name.toLowerCase()
  return (
    host === 'localhost' ||
    host.endsWith('.internal') ||
    host.endsWith('.local') ||
    isPrivateIpv4(host) ||
    (host.includes(':') && /^(?:\[?::1\]?|\[?::\]?|fc|fd|fe80)/.test(host))
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
  /**
   * Header di host grezzi in ordine di preferenza (`host`, poi `x-forwarded-host`): il
   * primo utilizzabile vince, quindi un `x-forwarded-host` scritto dal client decide solo
   * se l'host della richiesta non e' utilizzabile. Possono essere liste e avere la porta.
   */
  hosts?: (string | null | undefined)[]
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

  const segments = value.split(':')
  // Piu' di un ':' significa IPv6 senza parentesi (o due porte): non e' un host valido qui.
  if (segments.length > 2) return null
  const [name, port] = segments
  if (!name || name.includes('..') || !HOST_NAME.test(name)) return null
  // Una sola etichetta (`metadata`, `internal`, ...) non e' un host di questo sito: nessun
  // dominio servito qui e' un nome nudo.
  if (!name.includes('.')) return null
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

  let host: string | null = null
  for (const candidate of [...(input.hosts ?? []), input.requestUrl.host]) {
    host = usableHost(candidate)
    if (host) break
  }
  if (!host) return null

  try {
    // La query string resta: un link storico puo' portare parametri di tracciamento.
    const redirected = new URL(`${target}${input.requestUrl.search}`, `${protocol}://${host}`)
    // La validazione testuale non basta: il parser normalizza le notazioni alternative
    // (`127.1`, `0`, `2130706433`, `0x7f000001`, `10.1`) proprio su indirizzi interni,
    // quindi si ricontrolla l'host come lo vede il browser.
    if (isInternalHost(redirected.hostname)) return null
    return redirected.toString()
  } catch {
    return null
  }
}
