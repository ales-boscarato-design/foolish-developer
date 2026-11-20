/**
 * Promessa di consegna sull'ordine — validazione dello snapshot congelato.
 *
 * PERCHE' STA QUI E NON NELLA COLLECTION. Lo sapeva gia' il difetto dei campi
 * promo: una validazione scritta dentro l'hook e' verificabile solo avviando
 * Payload. Questa e' una funzione pura che riceve i valori del gruppo
 * `deliveryPromise` e risponde `{ snapshot, error }`, quindi si prova con un
 * test normale.
 *
 * REGOLE
 * - Lo snapshot e' un DATO STORICO: si valida che sia coerente, non che
 *   corrisponda al calcolo di oggi (le festivita', i `productionDays` e il
 *   margine possono essere cambiati dopo il pagamento: e' esattamente il motivo
 *   per cui la promessa si congela).
 * - `promiseShown: true` richiede partenza, consegna, zona e margine previsto
 *   dalla zona; `promiseShown: false` richiede che le date siano assenti —
 *   nessuna delle due forme puo' portare dati dell'altra.
 * - Un gruppo con tutti i campi vuoti non e' uno snapshot: e' l'assenza, e
 *   l'assenza e' ammessa solo per gli ordini storici e per i percorsi che non
 *   sono il checkout (il gate sull'obbligo sta nell'hook della collection).
 */

export const DELIVERY_PROMISE_VERSION = 1

export const DELIVERY_PROMISE_ZONES = ['IT_EU', 'EXTRA_EU'] as const
export type DeliveryPromiseZone = (typeof DELIVERY_PROMISE_ZONES)[number]

export const DELIVERY_PROMISE_REASONS = [
  'ok',
  'estimate_unavailable',
  'not_shown',
  'not_captured',
] as const
export type DeliveryPromiseReason = (typeof DELIVERY_PROMISE_REASONS)[number]

/** Margine in giorni lavorativi previsto dalla regola, per zona e per tipo di durata. */
const MARGIN_DAYS: Record<DeliveryPromiseZone, { known: number; unknown: number }> = {
  IT_EU: { known: 2, unknown: 3 },
  EXTRA_EU: { known: 6, unknown: 7 },
}

const MAX_PRODUCTION_DAYS = 3_650

export interface StoredDeliveryPromise {
  version: number
  promiseShown: boolean
  zone: DeliveryPromiseZone | null
  departureDate: string | null
  estimatedDeliveryDate: string | null
  productionDays: number | null
  marginDays: number | null
  fallback: boolean
  reason: DeliveryPromiseReason
  calculatedAt: string
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function isIsoCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) return false
  const [year, month, day] = value.split('-').map(Number) as [number, number, number]
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
}

/** Payload puo' consegnare la data come stringa ISO o come `Date`: entrambe valgono. */
function toIsoTimestamp(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (typeof value !== 'string') return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

function isProductionDays(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_PRODUCTION_DAYS
}

function isZone(value: unknown): value is DeliveryPromiseZone {
  return typeof value === 'string' && (DELIVERY_PROMISE_ZONES as readonly string[]).includes(value)
}

function isReason(value: unknown): value is DeliveryPromiseReason {
  return typeof value === 'string' && (DELIVERY_PROMISE_REASONS as readonly string[]).includes(value)
}

/** I campi del gruppo, come li consegna Payload a `beforeChange`. */
const PROMISE_FIELDS = [
  'version',
  'promiseShown',
  'zone',
  'departureDate',
  'estimatedDeliveryDate',
  'productionDays',
  'marginDays',
  'fallback',
  'reason',
  'calculatedAt',
] as const

/** Chiavi non previste: un campo in piu' non e' uno snapshot, e' un errore. */
function unexpectedKeys(raw: Record<string, unknown>): string[] {
  return Object.keys(raw).filter((key) => !(PROMISE_FIELDS as readonly string[]).includes(key))
}

function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined || value === ''
}

/**
 * Esito della validazione del gruppo in ingresso.
 * `snapshot: null` + `error: null` = nessuno snapshot (assenza legittima).
 */
export function validateDeliveryPromiseInput(value: unknown): {
  snapshot: StoredDeliveryPromise | null
  error: string | null
} {
  if (value === null || value === undefined) return { snapshot: null, error: null }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { snapshot: null, error: 'deliveryPromise deve essere un oggetto' }
  }
  const raw = value as Record<string, unknown>
  if (PROMISE_FIELDS.every((field) => isEmptyValue(raw[field]))) {
    return { snapshot: null, error: null }
  }
  const extras = unexpectedKeys(raw)
  if (extras.length > 0) {
    return { snapshot: null, error: `deliveryPromise: campi non previsti (${extras.join(', ')})` }
  }

  if (raw.version !== DELIVERY_PROMISE_VERSION) {
    return { snapshot: null, error: 'deliveryPromise.version non supportata' }
  }
  if (typeof raw.promiseShown !== 'boolean') {
    return { snapshot: null, error: 'deliveryPromise.promiseShown deve essere booleano' }
  }
  if (typeof raw.fallback !== 'boolean') {
    return { snapshot: null, error: 'deliveryPromise.fallback deve essere booleano' }
  }
  if (!isReason(raw.reason)) {
    return { snapshot: null, error: 'deliveryPromise.reason non riconosciuto' }
  }
  if (raw.zone !== null && !isZone(raw.zone)) {
    return { snapshot: null, error: 'deliveryPromise.zone non riconosciuta' }
  }
  if (raw.marginDays !== null && !isProductionDays(raw.marginDays)) {
    return { snapshot: null, error: 'deliveryPromise.marginDays non valido' }
  }
  if (raw.productionDays !== null && !isProductionDays(raw.productionDays)) {
    return { snapshot: null, error: 'deliveryPromise.productionDays non valido' }
  }
  if (raw.departureDate !== null && !isIsoCalendarDate(raw.departureDate)) {
    return { snapshot: null, error: 'deliveryPromise.departureDate non e\' una data ISO' }
  }
  if (raw.estimatedDeliveryDate !== null && !isIsoCalendarDate(raw.estimatedDeliveryDate)) {
    return { snapshot: null, error: 'deliveryPromise.estimatedDeliveryDate non e\' una data ISO' }
  }
  const calculatedAt = toIsoTimestamp(raw.calculatedAt)
  if (!calculatedAt) {
    return { snapshot: null, error: 'deliveryPromise.calculatedAt non e\' un istante ISO' }
  }

  const snapshot: StoredDeliveryPromise = {
    version: DELIVERY_PROMISE_VERSION,
    promiseShown: raw.promiseShown,
    zone: raw.zone as DeliveryPromiseZone | null,
    departureDate: raw.departureDate as string | null,
    estimatedDeliveryDate: raw.estimatedDeliveryDate as string | null,
    productionDays: raw.productionDays as number | null,
    marginDays: raw.marginDays as number | null,
    fallback: raw.fallback,
    reason: raw.reason,
    calculatedAt,
  }

  if (snapshot.promiseShown) {
    if (snapshot.reason !== 'ok') {
      return { snapshot: null, error: 'deliveryPromise: una data promessa ha reason diversa da ok' }
    }
    if (!snapshot.zone || !snapshot.departureDate || !snapshot.estimatedDeliveryDate) {
      return { snapshot: null, error: 'deliveryPromise: data promessa senza partenza, consegna o zona' }
    }
    if (snapshot.estimatedDeliveryDate < snapshot.departureDate) {
      return { snapshot: null, error: 'deliveryPromise: la consegna precede la partenza' }
    }
    if (snapshot.marginDays === null) {
      return { snapshot: null, error: 'deliveryPromise: margine mancante su una data promessa' }
    }
    const expected = snapshot.fallback
      ? MARGIN_DAYS[snapshot.zone].unknown
      : MARGIN_DAYS[snapshot.zone].known
    if (snapshot.marginDays !== expected) {
      return { snapshot: null, error: `deliveryPromise: margine ${snapshot.marginDays} non previsto per la zona` }
    }
    if (!snapshot.fallback && snapshot.productionDays === null) {
      return { snapshot: null, error: 'deliveryPromise: durata di produzione ignota senza margine prudente' }
    }
  } else {
    if (snapshot.reason === 'ok') {
      return { snapshot: null, error: 'deliveryPromise: reason ok senza una data promessa' }
    }
    if (snapshot.departureDate !== null || snapshot.estimatedDeliveryDate !== null) {
      return { snapshot: null, error: 'deliveryPromise: date presenti su una promessa non mostrata' }
    }
    if (snapshot.productionDays !== null || snapshot.marginDays !== null || snapshot.fallback) {
      return { snapshot: null, error: 'deliveryPromise: valori di produzione su una promessa non mostrata' }
    }
    if (snapshot.reason === 'estimate_unavailable' && snapshot.zone === null) {
      return { snapshot: null, error: 'deliveryPromise: stima non disponibile senza zona' }
    }
  }

  return { snapshot, error: null }
}

/**
 * Un ordine creato dalla macchina (checkout Stripe) DEVE portare lo snapshot:
 * e' l'unico percorso in cui il cliente ha visto una data prima di pagare. Un
 * ordine inserito a mano dal CMS, un rinnovo di abbonamento o un ordine B2B
 * non hanno una promessa di carrello e restano legittimamente senza.
 */
export function requiresDeliveryPromise(args: {
  source?: string | null
  paymentMethod?: string | null
  stripeSessionId?: string | null
}): boolean {
  return args.source === 'storefront'
    && args.paymentMethod === 'stripe'
    && typeof args.stripeSessionId === 'string'
    && args.stripeSessionId.trim().length > 0
}
