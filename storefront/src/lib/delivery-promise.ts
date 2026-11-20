import type { CartDeliveryEstimate, DeliveryZone } from './delivery-estimate'

/**
 * Promessa di consegna — lo SNAPSHOT che si congela sull'ordine al pagamento.
 *
 * PERCHE' ESISTE. La data mostrata nel carrello nasce da un calcolo che dipende
 * da cose che cambiano: le festivita' dell'anno, i `productionDays` del CMS, il
 * paese di destinazione, il margine prudente, l'ora del cutoff. Se una schermata
 * dopo il pagamento ricalcolasse la stessa formula leggerebbe i valori di OGGI,
 * e il cliente vedrebbe una data diversa da quella che ha accettato pagando. Qui
 * la promessa diventa un dato: la scrive il checkout, la persiste l'ordine, la
 * leggono (senza ricalcolare niente) conferma, pagina ordine, notifiche e viste
 * di spedizione.
 *
 * REGOLE DEL DATO
 * - `promiseShown` e' l'unica cosa che conta per decidere cosa mostrare: se e'
 *   false nessuna data e' stata promessa e nessuno ne inventa una.
 * - `reason` dice perche': `ok` (data promessa), `estimate_unavailable` (il
 *   calcolo non produce una data: durata fuori dai limiti o zona ignota),
 *   `not_shown` (il cliente non ha mai visto una data: campo assente nel
 *   checkout), `not_captured` (la sessione pagata non portava lo snapshot).
 * - `productionDays` e' il massimo delle durate note del carrello (null quando
 *   almeno un articolo ha durata ignota) e `fallback` dice se e' stato applicato
 *   il margine prudente: sono i valori che servono a rifare l'audit della data.
 * - Lo snapshot non si ricalcola e non si corregge: chi lo legge lo tratta come
 *   immutabile (la collection CMS lo ripristina se un update prova a cambiarlo).
 */

export const DELIVERY_PROMISE_VERSION = 1

export const DELIVERY_ZONES: readonly DeliveryZone[] = ['IT_EU', 'EXTRA_EU']

export type DeliveryPromiseReason = 'ok' | 'estimate_unavailable' | 'not_shown' | 'not_captured'

export const DELIVERY_PROMISE_REASONS: readonly DeliveryPromiseReason[] = [
  'ok',
  'estimate_unavailable',
  'not_shown',
  'not_captured',
]

/**
 * Margini in giorni lavorativi: gli stessi di `delivery-estimate.ts`. Sono
 * ripetuti qui SOLO per validare lo snapshot in ingresso (un dato che dichiara
 * un margine che la regola non prevede non e' una promessa: e' un errore).
 */
const MARGIN_DAYS: Record<DeliveryZone, { known: number; unknown: number }> = {
  IT_EU: { known: 2, unknown: 3 },
  EXTRA_EU: { known: 6, unknown: 7 },
}

const MAX_PRODUCTION_DAYS = 3_650

export interface DeliveryPromiseSnapshot {
  version: typeof DELIVERY_PROMISE_VERSION
  promiseShown: boolean
  zone: DeliveryZone | null
  /** Giorno di partenza (ISO `YYYY-MM-DD`, calendario italiano). */
  departureDate: string | null
  /** Giorno promesso al cliente (ISO `YYYY-MM-DD`). */
  estimatedDeliveryDate: string | null
  /** Massimo delle durate note del carrello; null = almeno un articolo a durata ignota. */
  productionDays: number | null
  marginDays: number | null
  fallback: boolean
  reason: DeliveryPromiseReason
  /** Istante in cui la promessa e' stata calcolata (ISO 8601 UTC). */
  calculatedAt: string
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/

/** Una data ISO che esiste davvero nel calendario (2026-02-31 non e' una data). */
export function isIsoCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) return false
  const [year, month, day] = value.split('-').map(Number) as [number, number, number]
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && ISO_TIMESTAMP_RE.test(value) && Number.isFinite(Date.parse(value))
}

function isDeliveryZone(value: unknown): value is DeliveryZone {
  return value === 'IT_EU' || value === 'EXTRA_EU'
}

function isDeliveryPromiseReason(value: unknown): value is DeliveryPromiseReason {
  return typeof value === 'string' && (DELIVERY_PROMISE_REASONS as readonly string[]).includes(value)
}

function isProductionDays(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_PRODUCTION_DAYS
}

/**
 * Snapshot di una stima calcolata: e' la forma che il checkout scrive nei
 * metadata della sessione. Quando la stima non produce una data
 * (`out_of_bounds`, `zone_unknown`) lo snapshot lo DICHIARA, con le date a
 * null: nessuna data inventata e nessun ricalcolo a valle.
 */
export function buildDeliveryPromiseSnapshot(args: {
  estimate: CartDeliveryEstimate
  now?: Date
}): DeliveryPromiseSnapshot {
  const now = args.now ?? new Date()
  const calculatedAt = now.toISOString()
  const { estimate } = args

  if (estimate.reason === 'ok' && isIsoCalendarDate(estimate.date)) {
    return {
      version: DELIVERY_PROMISE_VERSION,
      promiseShown: true,
      zone: estimate.zone,
      departureDate: isIsoCalendarDate(estimate.departureDate) ? estimate.departureDate : null,
      estimatedDeliveryDate: estimate.date,
      productionDays: estimate.productionDays,
      marginDays: estimate.marginDays,
      fallback: estimate.fallback,
      reason: 'ok',
      calculatedAt,
    }
  }

  return {
    version: DELIVERY_PROMISE_VERSION,
    promiseShown: false,
    zone: estimate.zone,
    departureDate: null,
    estimatedDeliveryDate: null,
    productionDays: null,
    marginDays: null,
    fallback: false,
    reason: 'estimate_unavailable',
    calculatedAt,
  }
}

/**
 * Snapshot quando la promessa NON e' stata mostrata al cliente (campo assente
 * nel corpo del checkout). Non e' un errore: e' il caso di un tab aperto prima
 * che la stima esistesse, e la vendita non si blocca. Quello che non si fa e'
 * scrivere una data che il cliente non ha mai visto.
 */
export function noPromiseSnapshot(now: Date = new Date()): DeliveryPromiseSnapshot {
  return {
    version: DELIVERY_PROMISE_VERSION,
    promiseShown: false,
    zone: null,
    departureDate: null,
    estimatedDeliveryDate: null,
    productionDays: null,
    marginDays: null,
    fallback: false,
    reason: 'not_shown',
    calculatedAt: now.toISOString(),
  }
}

/**
 * Snapshot di un ordine pagato la cui sessione non portava la promessa
 * (sessione creata da codice vecchio, metadata corrotti). Registra il fatto
 * invece di tacere: l'ordine pagato si crea comunque, ma l'assenza e' leggibile.
 */
export function notCapturedSnapshot(now: Date = new Date()): DeliveryPromiseSnapshot {
  return {
    version: DELIVERY_PROMISE_VERSION,
    promiseShown: false,
    zone: null,
    departureDate: null,
    estimatedDeliveryDate: null,
    productionDays: null,
    marginDays: null,
    fallback: false,
    reason: 'not_captured',
    calculatedAt: now.toISOString(),
  }
}

/**
 * Validazione completa e fail-closed di uno snapshot in ingresso.
 *
 * Il criterio non e' "i campi ci sono" ma "la promessa e' coerente con la regola
 * che l'ha prodotta": una data promessa senza partenza, una consegna prima
 * della partenza, un margine che la zona non prevede, `promiseShown` false con
 * una data dentro, sono tutti errori — e chi legge non deve indovinare quale
 * delle due meta' credere.
 */
export function parseDeliveryPromise(value: unknown): DeliveryPromiseSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>

  if (raw.version !== DELIVERY_PROMISE_VERSION) return null
  if (!isDeliveryPromiseReason(raw.reason)) return null
  if (typeof raw.promiseShown !== 'boolean') return null
  if (typeof raw.fallback !== 'boolean') return null
  if (!isIsoTimestamp(raw.calculatedAt)) return null
  if (raw.zone !== null && !isDeliveryZone(raw.zone)) return null
  if (raw.marginDays !== null && !isProductionDays(raw.marginDays)) return null
  if (raw.productionDays !== null && !isProductionDays(raw.productionDays)) return null
  if (raw.departureDate !== null && !isIsoCalendarDate(raw.departureDate)) return null
  if (raw.estimatedDeliveryDate !== null && !isIsoCalendarDate(raw.estimatedDeliveryDate)) return null

  const zone = raw.zone as DeliveryZone | null
  const departureDate = raw.departureDate as string | null
  const estimatedDeliveryDate = raw.estimatedDeliveryDate as string | null
  const productionDays = raw.productionDays as number | null
  const marginDays = raw.marginDays as number | null
  const fallback = raw.fallback

  if (raw.promiseShown) {
    if (raw.reason !== 'ok') return null
    if (!zone || !departureDate || !estimatedDeliveryDate) return null
    if (estimatedDeliveryDate < departureDate) return null
    if (marginDays === null) return null
    const expectedMargin = fallback ? MARGIN_DAYS[zone].unknown : MARGIN_DAYS[zone].known
    if (marginDays !== expectedMargin) return null
    // `fallback` e' l'unica giustificazione per una durata ignota: con il
    // margine prudente `productionDays` puo' essere null, con quello normale no.
    if (!fallback && productionDays === null) return null
  } else {
    if (raw.reason === 'ok') return null
    if (departureDate !== null || estimatedDeliveryDate !== null) return null
    if (productionDays !== null || marginDays !== null) return null
    if (fallback) return null
    // Una zona ignota e' ammessa solo quando il motivo e' l'assenza della
    // stima o della cattura: `estimate_unavailable` con zona null significa
    // "nessun paese conosciuto", che e' un altro caso e non va travestito.
    if (raw.reason === 'estimate_unavailable' && zone === null) return null
  }

  return {
    version: DELIVERY_PROMISE_VERSION,
    promiseShown: raw.promiseShown,
    zone,
    departureDate,
    estimatedDeliveryDate,
    productionDays,
    marginDays,
    fallback,
    reason: raw.reason,
    calculatedAt: raw.calculatedAt,
  }
}

/** Metadata Stripe: stringa JSON. Malformata = `null`, mai un'eccezione. */
export function parseDeliveryPromiseMetadataValue(value: unknown): DeliveryPromiseSnapshot | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  try {
    return parseDeliveryPromise(JSON.parse(value))
  } catch {
    return null
  }
}

/** Serializzazione per i metadata Stripe (una sola chiave, `delivery_promise`). */
export function serializeDeliveryPromise(snapshot: DeliveryPromiseSnapshot): string {
  return JSON.stringify(snapshot)
}

/**
 * La data da mostrare dopo il pagamento, formattata nella lingua della pagina.
 * Riceve lo SNAPSHOT, non il calcolo: nessuna festivita', nessun
 * `productionDays`, nessun indirizzo vengono letti qui.
 */
export function formatDeliveryPromiseDate(locale: string, isoDate: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long',
  }).format(new Date(`${isoDate}T00:00:00.000Z`))
}
