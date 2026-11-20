/**
 * Lettore server-side della coda di produzione dei fogli.
 *
 * Il calcolo vive in `production-queue.ts` (puro, verificato con fixture): qui
 * c'e' solo la lettura dal CMS, la prova che la lettura sia completa e la
 * traduzione degli errori in `state: 'unavailable'`.
 *
 * PERCHE' ESISTE. Il modulo puro sa contare, ma non sa se l'elenco che riceve e'
 * completo. Un conteggio troncato o una risposta d'errore usati come elenco
 * completo producono una promessa piu' corta della realta': e' l'unico errore
 * che questa feature non si puo' permettere. Ogni strada che non dimostra la
 * completezza finisce in `unavailable`, mai in `extraDays = 0`.
 *
 * CHI LO CONSUMA:
 * - scheda prodotto (server component): `readProductionQueueEstimate({ skus })`
 *   con lo SKU della variante selezionata;
 * - carrello/checkout (client): `GET /api/produzione/coda?sku=...&sku=...`,
 *   che accetta lo stesso elenco di SKU (righe pack comprese: lo SKU di base lo
 *   ricava il modulo puro);
 * - creazione ordine (server): stessa funzione, per congelare la promessa.
 *
 * La lettura e' read-only: nessuna scrittura sul CMS.
 */
import { cmsServiceSecret } from '@/lib/cms-service-secret'
import {
  computeProductionEstimate,
  productionQueueDayKey,
  type ProductionQueueEstimate,
  type ProductionQueueOk,
  type ProductionQueueUnavailable,
} from '@/lib/production-queue'

/**
 * Finestra di lettura degli ordini, come superset della giornata di produzione.
 *
 * 96 ore e non 48: sabato e domenica si riportano al lunedi', quindi il lunedi'
 * alle 12:00 il bucket contiene ordini da sabato 00:00 — circa 84 ore prima.
 * Con una finestra di 48 ore quegli ordini non verrebbero letti e la stima
 * risulterebbe piu' corta della realta'. Le 96 ore coprono anche il cambio
 * ora legale/solare (una giornata dura 23 o 25 ore reali).
 */
export const PRODUCTION_QUEUE_ORDERS_WINDOW_HOURS = 96

/** Limite di una pagina Payload. Se la lettura eccede, la stima non e' disponibile. */
export const PRODUCTION_QUEUE_ORDERS_PAGE_LIMIT = 500

/** Limite del catalogo: oltre, gli SKU mancanti finiscono in `unknownPieces` (prudente). */
export const PRODUCTION_QUEUE_CATALOG_PAGE_LIMIT = 500

/** Coerenza con l'ISR del negozio (60 s). */
export const PRODUCTION_QUEUE_CACHE_TTL_MS = 60_000

/** Un CMS che non risponde non deve appendere il render della pagina. */
export const PRODUCTION_QUEUE_FETCH_TIMEOUT_MS = 5_000

/** Tetto agli SKU richiedibili in una chiamata (carrello molto grande). */
export const PRODUCTION_QUEUE_MAX_SKUS = 50

export interface ProductionQueueReaderDeps {
  /** Iniettabile nei test; default `globalThis.fetch`. */
  fetchImpl?: typeof fetch
  /** Istante di calcolo: iniettabile per rendere deterministici i confini. */
  now?: Date
  /** Default `PAYLOAD_PUBLIC_URL`, come il resto del client CMS. */
  cmsUrl?: string
  /** Default `STOREFRONT_API_SECRET` (fallback `PAYLOAD_API_SECRET`). */
  secret?: string
  /** `false` disabilita la cache in memoria (test e prima esecuzione reale). */
  useCache?: boolean
}

/**
 * Metadati aggiunti dal lettore, non dal calcolo puro: dicono su cosa e' stata
 * costruita la risposta, senza cambiare la formula.
 */
export interface ProductionQueueReadMetadata {
  catalogState: 'ok' | 'unavailable'
  ordersWindowHours: number
  ordersRead: number
}

export type ProductionQueueReadResult =
  | (ProductionQueueOk & ProductionQueueReadMetadata)
  | ProductionQueueUnavailable

/**
 * Proiezione pubblica: e' quello che esce dall'endpoint HTTP, raggiungibile da
 * chiunque (carrello e checkout sono client-side, prima del login).
 *
 * Fuori restano `loads`, `extraDaysByFormat`, `unknownSkus`, `unknownPieces`,
 * `excludedOrders` e i metadati di lettura: dicono quanto lavoro c'e' in
 * laboratorio oggi, quali SKU sono fuori catalogo e — soprattutto — quali numeri
 * d'ordine sono stati esclusi. Sono dati operativi, non del cliente che sta
 * chiedendo la propria stima; `excludedOrders` porterebbe numeri d'ordine di
 * terzi su una rotta pubblica.
 */
export type PublicProductionQueueEstimate =
  | {
      state: 'ok'
      dayKey: string
      computedAt: string
      batchSize: number
      extraDays: number
      requested: ProductionQueueOk['requested']
      catalogState: ProductionQueueReadMetadata['catalogState']
    }
  | ProductionQueueUnavailable

export function toPublicProductionQueueEstimate(
  result: ProductionQueueReadResult,
): PublicProductionQueueEstimate {
  if (result.state !== 'ok') {
    return { state: 'unavailable', reason: result.reason, detail: result.detail }
  }
  return {
    state: 'ok',
    dayKey: result.dayKey,
    computedAt: result.computedAt,
    batchSize: result.batchSize,
    extraDays: result.extraDays,
    requested: result.requested,
    catalogState: result.catalogState,
  }
}

interface CachedDay {
  dayKey: string
  storedAt: number
  orders: unknown[]
  products: unknown[] | null
  catalogState: 'ok' | 'unavailable'
}

/**
 * Cache di processo: solo letture riuscite e complete. Un errore non viene mai
 * messo in cache, altrimenti un guasto di un secondo diventerebbe un minuto di
 * "stima non disponibile" (o, peggio, un elenco parziale riusato).
 */
let cachedDay: CachedDay | null = null

/** Solo per i test: azzera la cache di processo. */
export function resetProductionQueueReadCache(): void {
  cachedDay = null
}

const QUEUE_SKU_MAX_LENGTH = 200

/**
 * Normalizza l'elenco di SKU richiesti: deduplica, conserva l'ordine e rifiuta
 * qualunque voce che non sia una stringa non vuota e ragionevole. Rifiutare e'
 * meglio che filtrare: un SKU scartato in silenzio toglierebbe un formato dal
 * calcolo e renderebbe la stima piu' corta.
 *
 * Il tetto vale sugli SKU **distinti**: 51 parametri che ripetono lo stesso SKU
 * sono una richiesta legittima da un carrello costruito male, non 51 formati.
 */
export function parseQueueSkus(
  raw: unknown,
): { ok: true; skus: string[] } | { ok: false; detail: 'sku_missing' | 'sku_invalid' | 'too_many_skus' } {
  if (!Array.isArray(raw)) return { ok: false, detail: 'sku_invalid' }
  if (raw.length === 0) return { ok: false, detail: 'sku_missing' }
  const seen = new Set<string>()
  const skus: string[] = []
  for (const candidate of raw) {
    if (typeof candidate !== 'string') return { ok: false, detail: 'sku_invalid' }
    const sku = candidate.trim()
    if (!sku || sku.length > QUEUE_SKU_MAX_LENGTH) return { ok: false, detail: 'sku_invalid' }
    if (seen.has(sku)) continue
    seen.add(sku)
    skus.push(sku)
  }
  if (skus.length === 0) return { ok: false, detail: 'sku_missing' }
  if (skus.length > PRODUCTION_QUEUE_MAX_SKUS) return { ok: false, detail: 'too_many_skus' }
  return { ok: true, skus }
}

function cmsBaseUrl(deps: ProductionQueueReaderDeps | undefined): string {
  return (deps?.cmsUrl ?? process.env.PAYLOAD_PUBLIC_URL ?? 'https://cms-production-1e56.up.railway.app')
    .replace(/\/+$/, '')
}

function unavailable(
  reason: ProductionQueueUnavailable['reason'],
  detail: string,
): ProductionQueueUnavailable {
  return { state: 'unavailable', reason, detail }
}

interface CmsListPage {
  docs: unknown[]
  totalDocs: number
  hasNextPage: boolean
}

type CmsListRead =
  | { ok: true; page: CmsListPage }
  | { ok: false; result: ProductionQueueUnavailable }

/**
 * Una lettura di lista Payload con la prova di completezza.
 *
 * `totalDocs` mancante o non coerente con `docs.length` significa che non si puo'
 * dimostrare che l'elenco sia completo: la risposta diventa `unavailable` invece
 * di un numero calcolato su un sottoinsieme.
 */
async function readCmsList(args: {
  path: string
  params: Record<string, string>
  deps: ProductionQueueReaderDeps | undefined
  label: 'orders' | 'products'
}): Promise<CmsListRead> {
  const fetchImpl = args.deps?.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    return { ok: false, result: unavailable('cms_unavailable', `${args.label}_fetch_unavailable`) }
  }

  const secret = args.deps?.secret ?? cmsServiceSecret()
  if (!secret) {
    return { ok: false, result: unavailable('cms_unavailable', `${args.label}_secret_missing`) }
  }

  let url: URL
  try {
    url = new URL(`${cmsBaseUrl(args.deps)}/api/${args.path}`)
    for (const [key, value] of Object.entries(args.params)) url.searchParams.set(key, value)
  } catch {
    // `PAYLOAD_PUBLIC_URL` malformato (es. senza schema): anche questa e' una
    // lettura impossibile, non un'eccezione da far uscire dalla rotta.
    return { ok: false, result: unavailable('cms_unavailable', `${args.label}_url_invalid`) }
  }

  let response: Response
  try {
    response = await fetchImpl(url.toString(), {
      headers: { 'Content-Type': 'application/json', 'x-storefront-secret': secret },
      // Il caching e' gestito qui (cache di processo), non dal data cache di
      // Next: cosi' una risposta d'errore non resta appesa per 60 secondi.
      cache: 'no-store',
      signal: AbortSignal.timeout(PRODUCTION_QUEUE_FETCH_TIMEOUT_MS),
    })
  } catch {
    // Niente dettaglio dell'eccezione: puo' contenere l'URL completo.
    return { ok: false, result: unavailable('cms_unavailable', `${args.label}_fetch_failed`) }
  }

  if (!response.ok) {
    return {
      ok: false,
      result: unavailable('cms_unavailable', `${args.label}_http_${response.status}`),
    }
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    return { ok: false, result: unavailable('cms_unavailable', `${args.label}_response_not_json`) }
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, result: unavailable('cms_unavailable', `${args.label}_response_invalid`) }
  }

  const record = body as Record<string, unknown>
  const docs = record.docs
  if (!Array.isArray(docs)) {
    return { ok: false, result: unavailable('cms_unavailable', `${args.label}_docs_missing`) }
  }

  const totalDocs = record.totalDocs
  if (typeof totalDocs !== 'number' || !Number.isSafeInteger(totalDocs) || totalDocs < 0) {
    // Senza `totalDocs` non c'e' modo di distinguere un elenco completo da uno
    // troncato: si fail-chiuso.
    return { ok: false, result: unavailable('incomplete_orders', `${args.label}_total_docs_missing`) }
  }

  const hasNextPage = record.hasNextPage === true
  if (hasNextPage || docs.length < totalDocs) {
    return { ok: false, result: unavailable('incomplete_orders', `${args.label}_read_truncated`) }
  }
  if (docs.length > totalDocs) {
    // Impossibile in Payload: se succede, la forma della risposta non e' quella
    // attesa e non ci si puo' fidare del conteggio.
    return { ok: false, result: unavailable('cms_unavailable', `${args.label}_docs_inconsistent`) }
  }

  return { ok: true, page: { docs, totalDocs, hasNextPage } }
}

async function readCatalog(
  deps: ProductionQueueReaderDeps | undefined,
): Promise<{ products: unknown[] | null; catalogState: 'ok' | 'unavailable' }> {
  const read = await readCmsList({
    path: 'products',
    params: {
      'where[active][equals]': 'true',
      sort: 'order',
      'depth': '0',
      limit: String(PRODUCTION_QUEUE_CATALOG_PAGE_LIMIT),
    },
    deps,
    label: 'products',
  })

  if (read.ok) return { products: read.page.docs, catalogState: 'ok' }

  // Un catalogo non leggibile non blocca la stima: senza indice ogni pezzo
  // finisce in `unknownPieces` e viene attribuito a ogni formato, quindi la
  // stima sale. E' prudente, ed e' l'unico ripiego ammesso dal contratto.
  console.warn('[production-queue] catalogo non leggibile, formato ignoto per ogni pezzo:', read.result.detail)
  return { products: null, catalogState: 'unavailable' }
}

/**
 * Stima per gli SKU richiesti (scheda prodotto: uno; carrello/checkout: tutte le
 * righe). Non solleva mai: ogni errore e' un `state: 'unavailable'` tipizzato.
 */
export async function readProductionQueueEstimate(
  args: { skus: unknown; deps?: ProductionQueueReaderDeps },
): Promise<ProductionQueueReadResult> {
  const parsed = parseQueueSkus(args.skus)
  if (!parsed.ok) {
    return unavailable(
      'invalid_payload',
      parsed.detail === 'too_many_skus' ? 'too_many_skus' : 'skus_invalid',
    )
  }
  const { skus } = parsed

  const deps = args.deps
  const now = deps?.now instanceof Date && !Number.isNaN(deps.now.getTime())
    ? deps.now
    : new Date()
  const dayKey = productionQueueDayKey(now)

  const cached = deps?.useCache === false ? null : cachedDay
  const cacheValid = cached !== null
    && cached.dayKey === dayKey
    && now.getTime() - cached.storedAt <= PRODUCTION_QUEUE_CACHE_TTL_MS

  let snapshot: CachedDay
  if (cacheValid && cached !== null) {
    snapshot = cached
  } else {
    const startedAt = new Date(now.getTime() - PRODUCTION_QUEUE_ORDERS_WINDOW_HOURS * 3_600_000)
    const ordersRead = await readCmsList({
      path: 'orders',
      params: {
        'where[createdAt][greater_than_equal]': startedAt.toISOString(),
        sort: '-createdAt',
        depth: '0',
        limit: String(PRODUCTION_QUEUE_ORDERS_PAGE_LIMIT),
      },
      deps,
      label: 'orders',
    })
    if (!ordersRead.ok) return ordersRead.result

    const catalog = await readCatalog(deps)
    snapshot = {
      dayKey,
      storedAt: now.getTime(),
      orders: ordersRead.page.docs,
      products: catalog.products,
      catalogState: catalog.catalogState,
    }
    if (deps?.useCache !== false) cachedDay = snapshot
  }

  const estimate: ProductionQueueEstimate = computeProductionEstimate({
    orders: snapshot.orders,
    products: snapshot.products,
    now,
    skus,
    ordersComplete: true,
  })
  if (estimate.state !== 'ok') return estimate

  return {
    ...estimate,
    catalogState: snapshot.catalogState,
    ordersWindowHours: PRODUCTION_QUEUE_ORDERS_WINDOW_HOURS,
    ordersRead: snapshot.orders.length,
  }
}
