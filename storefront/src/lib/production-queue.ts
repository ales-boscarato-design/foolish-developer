/**
 * Coda di produzione dei fogli — implementazione di riferimento del contratto
 * descritto in `docs/production-queue-contract.md`.
 *
 * Regola: `giorniProduzione = productionDays + extraDays`, dove `extraDays`
 * dipende SOLO dai pezzi dello stesso formato creati nella giornata di
 * calendario corrente (Europe/Rome, azzeramento a mezzanotte, sabato e
 * domenica riportati al lunedi' successivo). La soglia e' inclusa: fino a 20
 * pezzi il giorno base basta, dal 21esimo scatta +1, da 41 +2.
 *
 * Il modulo e' puro: non fa fetch, non legge env, non scrive. Il chiamante gli
 * passa gli ordini e il catalogo gia' letti dal CMS, cosi' i confini di tempo e
 * di stato sono verificabili con fixture.
 */

/** Capacita' giornaliera per formato (decisione: 20 pezzi al giorno). */
export const PRODUCTION_BATCH_SIZE = 20

/** Fuso in cui si azzera la giornata di produzione. */
export const PRODUCTION_QUEUE_TIME_ZONE = 'Europe/Rome'

/** Chiave di formato normalizzata: `a5`, `a4`, `a3`, `l`, `xxl`, `roll`, `15x15`, ... */
export type SheetFormat = string

export type QueueExclusionReason = 'payment_failed' | 'cancelled'

export interface QueueLineItem {
  sku: string
  quantity: number
}

export interface QueueOrderInput {
  id?: string | number
  orderNumber?: string | null
  createdAt?: string | null
  paymentStatus?: string | null
  source?: string | null
  lineItems?: unknown
}

export interface CatalogVariantInput {
  sku?: string | null
  label?: string | null
  dimensions?: string | null
}

export interface CatalogProductInput {
  slug?: string | null
  name?: string | null
  variants?: CatalogVariantInput[] | null
}

export interface ProductionQueueRequested {
  sku: string
  format: SheetFormat | null
}

export interface ProductionQueueOk {
  state: 'ok'
  /** Giornata di produzione (Europe/Rome) a cui appartiene `now`. */
  dayKey: string
  computedAt: string
  batchSize: number
  /** Pezzi contati per formato, con i pezzi a formato ignoto prudenzialmente
   *  attribuiti a ogni formato. */
  loads: Record<SheetFormat, number>
  extraDaysByFormat: Record<SheetFormat, number>
  /** Giorni da aggiungere alla promessa: il massimo fra i formati richiesti. */
  extraDays: number
  requested: ProductionQueueRequested[]
  unknownSkus: string[]
  unknownPieces: number
  excludedOrders: Array<{ orderNumber: string | null; reason: QueueExclusionReason }>
}

export interface ProductionQueueUnavailable {
  state: 'unavailable'
  /**
   * `cms_unavailable`: il CMS non ha risposto (rete, 401/5xx, corpo illeggibile).
   * E' distinto da `incomplete_orders`, che invece dice "ha risposto ma non so
   * se l'elenco e' completo": in entrambi i casi non esiste un numero.
   */
  reason: 'invalid_payload' | 'incomplete_orders' | 'cms_unavailable'
  detail: string
}

export type ProductionQueueEstimate = ProductionQueueOk | ProductionQueueUnavailable

const DAY_KEY_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: PRODUCTION_QUEUE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Giornata di calendario Europe/Rome di un istante, come `YYYY-MM-DD`. */
export function romeDayKey(instant: Date): string {
  const parts = DAY_KEY_FORMATTER.formatToParts(instant)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value
  if (!year || !month || !day) throw new Error('Impossibile calcolare la giornata Europe/Rome')
  return `${year}-${month}-${day}`
}

function dayKeyToUtcDate(dayKey: string): Date {
  const [year, month, day] = dayKey.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

/** 0 = domenica ... 5 = venerdi', 6 = sabato. */
function weekdayOfDayKey(dayKey: string): number {
  return dayKeyToUtcDate(dayKey).getUTCDay()
}

function shiftDayKey(dayKey: string, days: number): string {
  const shifted = new Date(dayKeyToUtcDate(dayKey).getTime() + days * 86_400_000)
  return shifted.toISOString().slice(0, 10)
}

/**
 * Giornata di produzione: la giornata di calendario, con sabato e domenica
 * riportati al lunedi' successivo. Azzeramento a mezzanotte Europe/Rome, fuso
 * reale (DST compreso) perche' la chiave e' calcolata con `Intl`.
 */
export function productionQueueDayKey(instant: Date): string {
  const dayKey = romeDayKey(instant)
  const weekday = weekdayOfDayKey(dayKey)
  if (weekday === 6) return shiftDayKey(dayKey, 2)
  if (weekday === 0) return shiftDayKey(dayKey, 1)
  return dayKey
}

const PACK_SEPARATOR = '-pack-'
const LABEL_FORMAT = /^(a[3-6]|l|xxl|roll)\b/
const DIMENSION_FORMAT = /(\d{1,3})\s*[x×*]\s*(\d{1,3})/

/**
 * Formato del foglio dichiarato dalla variante, oppure `null` quando la
 * variante non ne dichiara uno (prodotto non-foglio o etichetta fuori schema).
 * La fonte e' il catalogo CMS: etichetta variante prima, dimensioni poi.
 */
export function formatFromVariant(variant: CatalogVariantInput): SheetFormat | null {
  const label = typeof variant.label === 'string' ? variant.label.trim() : ''
  const labelToken = LABEL_FORMAT.exec(label.toLowerCase())
  if (labelToken) return labelToken[1]!

  const labelDimensions = DIMENSION_FORMAT.exec(label)
  if (labelDimensions) return `${Number(labelDimensions[1])}x${Number(labelDimensions[2])}`

  const dimensions = typeof variant.dimensions === 'string' ? variant.dimensions : ''
  const dimensionMatch = DIMENSION_FORMAT.exec(dimensions)
  if (dimensionMatch) return `${Number(dimensionMatch[1])}x${Number(dimensionMatch[2])}`

  return null
}

/** SKU di base: le righe pack registrano `<skuVariante>-pack-<id>`, i pezzi sono in `quantity`. */
export function baseSkuOf(sku: string): string {
  const normalized = sku.trim()
  const index = normalized.toLowerCase().indexOf(PACK_SEPARATOR)
  return index > 0 ? normalized.slice(0, index) : normalized
}

/** Indice `sku -> formato` costruito dal catalogo CMS. `null` = formato non dichiarato. */
export function buildFormatIndex(products: CatalogProductInput[] | null | undefined): Map<string, SheetFormat | null> {
  const index = new Map<string, SheetFormat | null>()
  if (!Array.isArray(products)) return index
  for (const product of products) {
    if (!product || !Array.isArray(product.variants)) continue
    for (const variant of product.variants) {
      if (!variant || typeof variant.sku !== 'string') continue
      const sku = variant.sku.trim()
      if (!sku) continue
      index.set(sku, formatFromVariant(variant))
    }
  }
  return index
}

/**
 * Un ordine entra nella coda quando non e' esplicitamente fallito o annullato.
 * `pending` e `refunded` restano contati: un ordine in attesa puo' essere un
 * pagamento non ancora riconciliato (i rinnovi abbonamento nascono `pending`) e
 * un rimborso non restituisce fogli gia' prodotti. L'errore cade sempre dal lato
 * prudente: un giorno in piu', mai in meno.
 */
export function orderExclusionReason(order: QueueOrderInput | null | undefined): QueueExclusionReason | null {
  const status = typeof order?.paymentStatus === 'string' ? order.paymentStatus.trim().toLowerCase() : ''
  if (status === 'failed') return 'payment_failed'
  if (status === 'cancelled' || status === 'canceled') return 'cancelled'
  return null
}

/** Pezzi in eccesso rispetto alla capacita' giornaliera, con soglia inclusa. */
export function extraDaysForPieces(pieces: number): number {
  if (!Number.isFinite(pieces) || pieces <= PRODUCTION_BATCH_SIZE) return 0
  return Math.ceil(pieces / PRODUCTION_BATCH_SIZE) - 1
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readLineItems(raw: unknown): QueueLineItem[] | null {
  if (!Array.isArray(raw)) return null
  const items: QueueLineItem[] = []
  for (const candidate of raw) {
    if (!isPlainObject(candidate)) return null
    const sku = typeof candidate.sku === 'string' ? candidate.sku.trim() : ''
    const quantity = candidate.quantity
    if (!sku) return null
    if (typeof quantity !== 'number' || !Number.isSafeInteger(quantity) || quantity <= 0) return null
    items.push({ sku, quantity })
  }
  return items
}

interface DayLoads {
  dayKey: string
  loads: Record<SheetFormat, number>
  unknownSkus: Set<string>
  unknownPieces: number
  excludedOrders: Array<{ orderNumber: string | null; reason: QueueExclusionReason }>
}

function collectDayLoads(args: {
  orders: unknown[]
  index: Map<string, SheetFormat | null>
  now: Date
}): DayLoads | ProductionQueueUnavailable {
  const dayKey = productionQueueDayKey(args.now)
  const loads: Record<SheetFormat, number> = {}
  const unknownSkus = new Set<string>()
  const excludedOrders: Array<{ orderNumber: string | null; reason: QueueExclusionReason }> = []
  let unknownPieces = 0

  for (const rawOrder of args.orders) {
    if (!isPlainObject(rawOrder)) {
      return { state: 'unavailable', reason: 'invalid_payload', detail: 'order_not_an_object' }
    }
    const order = rawOrder as QueueOrderInput
    const createdAtRaw = typeof order.createdAt === 'string' ? order.createdAt : ''
    const createdAt = createdAtRaw ? new Date(createdAtRaw) : null
    if (!createdAt || Number.isNaN(createdAt.getTime())) {
      return { state: 'unavailable', reason: 'invalid_payload', detail: 'order_created_at_invalid' }
    }
    if (productionQueueDayKey(createdAt) !== dayKey) continue

    const exclusion = orderExclusionReason(order)
    if (exclusion) {
      excludedOrders.push({
        orderNumber: typeof order.orderNumber === 'string' ? order.orderNumber : null,
        reason: exclusion,
      })
      continue
    }

    const items = readLineItems(order.lineItems)
    if (!items) {
      return { state: 'unavailable', reason: 'invalid_payload', detail: 'order_line_items_invalid' }
    }

    for (const item of items) {
      const format = args.index.get(baseSkuOf(item.sku)) ?? null
      if (format === null) {
        unknownSkus.add(item.sku)
        unknownPieces += item.quantity
        continue
      }
      loads[format] = (loads[format] ?? 0) + item.quantity
    }
  }

  return { dayKey, loads, unknownSkus, unknownPieces, excludedOrders }
}

function requestedFormats(skus: unknown, index: Map<string, SheetFormat | null>): ProductionQueueRequested[] | null {
  if (skus === undefined) return []
  if (!Array.isArray(skus)) return null
  const requested: ProductionQueueRequested[] = []
  for (const candidate of skus) {
    if (typeof candidate !== 'string' || !candidate.trim()) return null
    requested.push({ sku: candidate.trim(), format: index.get(baseSkuOf(candidate)) ?? null })
  }
  return requested
}

/**
 * Calcolo della stima. `ordersComplete` deve essere `false` (o assente) quando
 * la lettura CMS e' troncata: in quel caso la stima non e' un numero, perche'
 * un conteggio parziale produrrebbe una promessa ottimistica.
 */
export function computeProductionEstimate(args: {
  orders: unknown
  products: unknown
  now: Date
  skus?: unknown
  ordersComplete?: boolean
}): ProductionQueueEstimate {
  if (!(args.now instanceof Date) || Number.isNaN(args.now.getTime())) {
    return { state: 'unavailable', reason: 'invalid_payload', detail: 'now_invalid' }
  }
  if (args.ordersComplete !== true) {
    return { state: 'unavailable', reason: 'incomplete_orders', detail: 'orders_read_not_declared_complete' }
  }
  if (!Array.isArray(args.orders)) {
    return { state: 'unavailable', reason: 'invalid_payload', detail: 'orders_not_an_array' }
  }

  const index = buildFormatIndex(Array.isArray(args.products) ? (args.products as CatalogProductInput[]) : null)
  const requested = requestedFormats(args.skus, index)
  if (requested === null) {
    return { state: 'unavailable', reason: 'invalid_payload', detail: 'skus_invalid' }
  }
  // Senza SKU non c'e' formato da stimare: restituire `ok` con `extraDays: 0`
  // sarebbe la stima piu' ottimistica possibile, ed e' la trappola che si apre
  // dimenticando l'argomento in un nuovo consumatore (es. il congelamento al
  // checkout). Fail-closed.
  if (requested.length === 0) {
    return { state: 'unavailable', reason: 'invalid_payload', detail: 'skus_missing' }
  }

  const collected = collectDayLoads({ orders: args.orders, index, now: args.now })
  if ('state' in collected) return collected

  const formats = new Set<SheetFormat>(Object.keys(collected.loads))
  for (const item of requested) {
    if (item.format !== null) formats.add(item.format)
  }
  if (collected.unknownPieces > 0) formats.add('unknown')

  const loads: Record<SheetFormat, number> = {}
  for (const format of formats) {
    loads[format] = (collected.loads[format] ?? 0) + collected.unknownPieces
  }

  const extraDaysByFormat: Record<SheetFormat, number> = {}
  for (const [format, pieces] of Object.entries(loads)) {
    extraDaysByFormat[format] = extraDaysForPieces(pieces)
  }

  // Uno SKU richiesto senza formato dichiarato puo' essere qualunque formato
  // della giornata: la stima prudente e' il massimo carico del giorno, non 0.
  // Con 0 la promessa sarebbe piu' corta della realta' proprio nel caso in cui
  // non sappiamo dove finira' il pezzo.
  let unknownFormatExtraDays = extraDaysForPieces(collected.unknownPieces)
  for (const pieces of Object.values(extraDaysByFormat)) {
    unknownFormatExtraDays = Math.max(unknownFormatExtraDays, pieces)
  }

  let extraDays = 0
  for (const item of requested) {
    const itemExtraDays = item.format === null
      ? unknownFormatExtraDays
      : extraDaysForPieces(loads[item.format] ?? collected.unknownPieces)
    extraDays = Math.max(extraDays, itemExtraDays)
  }

  return {
    state: 'ok',
    dayKey: collected.dayKey,
    computedAt: args.now.toISOString(),
    batchSize: PRODUCTION_BATCH_SIZE,
    loads,
    extraDaysByFormat,
    extraDays,
    requested,
    unknownSkus: [...collected.unknownSkus].sort(),
    unknownPieces: collected.unknownPieces,
    excludedOrders: collected.excludedOrders,
  }
}
