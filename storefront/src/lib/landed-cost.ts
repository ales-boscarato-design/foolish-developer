/**
 * Quota landed cost LIVE per il checkout extra-UE — SERVER-ONLY.
 *
 * Perche' esiste: una tariffa extra-UE costruita su un profilo stimato e' una
 * STIMA. Il costo vero (trasporto + gestione + assicurazione + dazi e IVA
 * all'importazione + fee DDP) lo conosce solo la quota DDP, e per quotare serve
 * la chiave API Packlink. Quella chiave vive sulla Pi di Alfred e NON entra nel
 * negozio: il negozio chiama il servizio di quota (`POST /landed-cost/v1/quote`)
 * server-to-server, con il segreto condiviso in una variabile d'ambiente.
 *
 * Catena di risoluzione (decisione di Alessandro, 21/09/2026 — un guasto della
 * Pi deve costare PRECISIONE, non vendite):
 *
 *   1. quota live   → il costo reale documentato (fattura doganale di checkout)
 *   2. tabella in casa → i prezzi reali misurati, tenuti nel negozio e
 *                        aggiornati dalla Pi (`landed-cost-table.json`)
 *   3. profilo per paese + pavimento → l'ultima rete, mai sotto il costo
 *   4. nessuna base di prezzo → NON si vende (unica eccezione)
 *
 * Invarianti verificati dai test, non dalla buona volonta':
 *   - su una destinazione extra-UE non esiste un percorso che torni 0,00;
 *   - il prezzo non e' mai inferiore alla base quotata (`shipping_and_import`)
 *     ne' al pavimento `EXTRA_EU_MINIMUM_SHIPPING`;
 *   - il prezzo e' sempre un intero di centesimi, mai NaN;
 *   - il segreto condiviso non esce mai da questo modulo e non finisce mai in
 *     un errore, in un log o in una risposta HTTP.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import {
  DEFAULT_EXTRA_EU_PROFILE,
  EXTRA_EU_MARGIN_RATE,
  EXTRA_EU_MINIMUM_SHIPPING,
  LANDED_COST_COUNTRIES,
  calculateLandedCost,
  getShippingZone,
  type ExtraEuProfile,
  type LandedCostBreakdown,
} from './shipping'
import landedCostTable from './landed-cost-table.json'

/** Endpoint del servizio di quota sulla Pi (dietro il tunnel di Alfred). */
export const LANDED_COST_DEFAULT_URL = 'https://alfred.thefoolishbutcher.com/landed-cost/v1/quote'

/**
 * Attesa massima della quota live: decisa da Alessandro (21/09/2026, «entro un
 * tempo breve, consiglio 1,5 s»). Oltre quella soglia il cliente non deve
 * aspettare: si usa la tabella in casa.
 */
export const LANDED_COST_DEFAULT_TIMEOUT_MS = 1500

/** Limiti di forma della richiesta al servizio: oltre, non si quota. */
export const MAX_QUOTE_ITEMS = 20
export const MAX_QUOTE_ITEM_QUANTITY = 50

/** Validita' del gettone che congela il prezzo mostrato (secondi). */
export const QUOTE_TOKEN_TTL_SECONDS = 900

export type ShippingPriceSource = 'live_quote' | 'price_table' | 'profile'

export interface LandedCostQuoteParcel {
  weightKg: number
  widthCm: number
  heightCm: number
  lengthCm: number
  packages: number
}

export interface LandedCostQuote {
  serviceId: number
  carrier: string
  serviceName: string
  /** Costo documentato della riga "spedizione e import" (quota). In centesimi. */
  shippingAndImportCents: number
  /** Trasporto del corriere della quota, in centesimi (base dei dazi/IVA). */
  transportCents: number
  /** Oneri import (dazi + IVA all'importazione) della quota, in centesimi. */
  importChargesCents: number
  /**
   * Costo reale stimato dalla quota: `shipping_and_import` + differenza
   * dichiarata di riconciliazione. In centesimi. Usato come limite PRUDENTE
   * della base di prezzo, non come sovrapprezzo nascosto: la differenza e'
   * dichiarata dal servizio, non inventata qui (evidenza 21/09/2026: la
   * differenza di assicurazione dipende dal `contentvalue` dichiarato).
   */
  landedCostCents: number
  checkoutInvoiceNumber: string | null
  parcel: LandedCostQuoteParcel | null
  /** Scadenza della quota (epoch secondi), se dichiarata. */
  expiresAt: number | null
  goodsValueCents: number | null
}

export interface ExtraEuShippingResolution {
  /** Quello che il cliente paga: intero di centesimi, mai 0, mai sotto il pavimento. */
  costCents: number
  source: ShippingPriceSource
  /** Base di costo (senza margine) da cui nasce il prezzo, in centesimi. */
  basisCostCents: number
  marginCents: number
  minChargeCents: number
  minimumChargeApplied: boolean
  quote: LandedCostQuote | null
  /** true = prezzo verificato su una quota documentata; false = prudenziale. */
  verified: boolean
  /** Perche' non c'e' una quota: diagnostica, nessun importo. */
  quoteFailure: string | null
  /** Costo stimato dal profilo di paese, per diagnostica e confronto. */
  profileCostCents: number
  /** Costo dalla tabella in casa, se quel paese ha bande. */
  tableCostCents: number | null
}

interface LandingTableBand {
  goodsValueCents: number
  costBasisCents: number
  shippingAndImportCents: number
  serviceId: number | null
  checkoutInvoiceNumber: string | null
  quotedAt: string | null
}

interface LandingTableCountry {
  bands: LandingTableBand[]
}

let cachedTable: Map<string, LandingTableBand[]> | null = null

function toCents(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  const cents = Math.round(value * 100)
  if (!Number.isSafeInteger(cents)) return null
  return cents
}

function positiveCents(value: unknown): number | null {
  const cents = toCents(value)
  return cents !== null && cents > 0 ? cents : null
}

/**
 * Intero di centesimi GIA' in centesimi (tabella in casa, che nasce dai centesimi
 * della quota): convertirli di nuovo moltiplicherebbe il prezzo per 100.
 */
function positiveCentsInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return null
  return value
}

function boundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > maxLength) return null
  return trimmed
}

/**
 * Tabella dei prezzi reali tenuta in casa, letta una volta e validata.
 *
 * Una banda senza importi interi e positivi viene SCARTATA: una tabella
 * malformata deve degradare al profilo, mai produrre un prezzo a zero.
 */
export function loadLandedCostTable(raw: unknown = landedCostTable): Map<string, LandingTableBand[]> {
  if (cachedTable && raw === landedCostTable) return cachedTable
  const bands = new Map<string, LandingTableBand[]>()

  if (raw && typeof raw === 'object') {
    const countries = (raw as { countries?: unknown }).countries
    if (countries && typeof countries === 'object' && !Array.isArray(countries)) {
      for (const [code, value] of Object.entries(countries as Record<string, unknown>)) {
        const country = code.trim().toUpperCase()
        if (!/^[A-Z]{2}$/.test(country)) continue
        const entries = (value as LandingTableCountry | null)?.bands
        if (!Array.isArray(entries)) continue
        const parsed: LandingTableBand[] = []
        for (const entry of entries) {
          if (!entry || typeof entry !== 'object') continue
          const candidate = entry as unknown as Record<string, unknown>
          const goodsValueCents = positiveCentsInt(candidate.goods_value_cents)
          const costBasisCents = positiveCentsInt(candidate.cost_basis_cents)
          const shippingAndImportCents = positiveCentsInt(candidate.shipping_and_import_cents)
          if (goodsValueCents === null || costBasisCents === null || shippingAndImportCents === null) continue
          parsed.push({
            goodsValueCents,
            costBasisCents,
            shippingAndImportCents,
            serviceId: Number.isSafeInteger(candidate.service_id) ? candidate.service_id as number : null,
            checkoutInvoiceNumber: boundedString(candidate.checkout_invoice_number, 64),
            quotedAt: boundedString(candidate.quoted_at, 40),
          })
        }
        if (parsed.length > 0) {
          parsed.sort((a, b) => a.goodsValueCents - b.goodsValueCents)
          bands.set(country, parsed)
        }
      }
    }
  }

  if (raw === landedCostTable) cachedTable = bands
  return bands
}

/**
 * Costo reale dalla tabella in casa per quel valore di merce.
 *
 * Si prende la banda piu' piccola che copre il carrello (mai una banda piu'
 * bassa della merce: sarebbe una sottostima). Sopra l'ultima banda si usa
 * l'ultima banda misurata: e' un PAVIMENTO del costo reale, non una stima — la
 * stima per quei carrelli la fa il profilo di paese, e il chiamante prende il
 * maggiore dei due.
 */
export function tableCostCents(countryCode: string, goodsCents: number): number | null {
  const country = String(countryCode ?? '').trim().toUpperCase()
  const bands = loadLandedCostTable().get(country)
  if (!bands || bands.length === 0) return null
  const goods = Number.isFinite(goodsCents) ? Math.max(0, Math.round(goodsCents)) : 0
  for (const band of bands) {
    if (goods <= band.goodsValueCents) return band.costBasisCents
  }
  return bands[bands.length - 1]!.costBasisCents
}

/** Stima di costo del profilo di paese (senza margine, senza pavimento). */
export function profileCostCents(countryCode: string, goodsCents: number): number | null {
  const country = String(countryCode ?? '').trim().toUpperCase()
  if (getShippingZone(country) !== 'EXTRA_EU') return null
  const profile: ExtraEuProfile = LANDED_COST_COUNTRIES[country as keyof typeof LANDED_COST_COUNTRIES]
    ?? DEFAULT_EXTRA_EU_PROFILE
  const landed: LandedCostBreakdown = calculateLandedCost(goodsCents / 100, profile)
  return toCents(landed.estimatedCost)
}

/**
 * Impronta del carrello: lega il gettone del prezzo al carrello che lo ha
 * prodotto. Senza, un gettone ottenuto su un carrello economico potrebbe essere
 * riusato su un carrello caro: il negozio ricalcola comunque tutto server-side,
 * ma il prezzo congelato non deve poter essere trapiantato.
 */
export function cartFingerprint(
  items: readonly { sku: string; quantity: number }[],
  countryCode: string,
): string {
  const country = String(countryCode ?? '').trim().toUpperCase()
  const lines = items
    .map((item) => `${String(item.sku ?? '').trim().toUpperCase()}:${Number(item.quantity) || 0}`)
    .sort()
  return createHash('sha256').update(`${country}|${lines.join('|')}`).digest('hex').slice(0, 32)
}

/**
 * Segreto che firma il gettone del prezzo mostrato. DEDICATO: non si riusa un
 * segreto di produzione che serve a un altro scopo (il segreto del CMS non
 * firma prezzi). Se non e' configurato, il gettone non esiste e il checkout
 * risolve da capo: il prezzo resta quello VERO del server, mai quello che
 * manda il browser.
 */
function quoteTokenSecret(): string {
  return (process.env.SHIPPING_QUOTE_TOKEN_SECRET || '').trim()
}

function signWith(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

/**
 * Gettone che congela il prezzo mostrato al cliente: al momento di aprire il
 * pagamento il negozio riusa ESATTAMENTE quel prezzo invece di ricalcolarlo,
 * cosi' la riga "spedizione e import" mostrata e quella incassata coincidono.
 * Il gettone e' firmato con un segreto che sta solo sul server: il browser non
 * puo' fabbricarne uno piu' basso.
 */
export function signQuoteToken(args: {
  countryCode: string
  fingerprint: string
  costCents: number
  now?: Date
  ttlSeconds?: number
}): string | null {
  const secret = quoteTokenSecret()
  if (!secret) return null
  if (!Number.isSafeInteger(args.costCents) || args.costCents <= 0) return null
  const now = args.now ?? new Date()
  const exp = Math.floor(now.getTime() / 1000) + (args.ttlSeconds ?? QUOTE_TOKEN_TTL_SECONDS)
  const payload = JSON.stringify({
    v: 1,
    c: String(args.countryCode ?? '').trim().toUpperCase(),
    f: args.fingerprint,
    k: args.costCents,
    e: exp,
  })
  return `${Buffer.from(payload, 'utf8').toString('base64url')}.${signWith(payload, secret)}`
}

export function verifyQuoteToken(
  token: unknown,
  args: { countryCode: string; fingerprint: string; now?: Date },
): number | null {
  if (typeof token !== 'string' || token.length === 0 || token.length > 1024) return null
  const secret = quoteTokenSecret()
  if (!secret) return null
  const separator = token.lastIndexOf('.')
  if (separator <= 0) return null
  const encoded = token.slice(0, separator)
  const signature = token.slice(separator + 1)
  let payload: string
  try {
    payload = Buffer.from(encoded, 'base64url').toString('utf8')
  } catch {
    return null
  }
  const expected = signWith(payload, secret)
  const expectedBuffer = Buffer.from(expected, 'utf8')
  const providedBuffer = Buffer.from(signature, 'utf8')
  if (expectedBuffer.length !== providedBuffer.length) return null
  if (!timingSafeEqual(expectedBuffer, providedBuffer)) return null

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(payload) as Record<string, unknown>
  } catch {
    return null
  }
  if (parsed.v !== 1) return null
  if (parsed.c !== String(args.countryCode ?? '').trim().toUpperCase()) return null
  if (parsed.f !== args.fingerprint) return null
  const costCents = parsed.k
  if (!Number.isSafeInteger(costCents) || (costCents as number) <= 0) return null
  const exp = parsed.e
  if (!Number.isSafeInteger(exp)) return null
  const nowSeconds = Math.floor((args.now ?? new Date()).getTime() / 1000)
  if ((exp as number) <= nowSeconds) return null
  return costCents as number
}

/** Configurazione del client di quota, tutta server-side. */
export function quoteClientConfig(): {
  url: string
  secret: string
  timeoutMs: number
  enabled: boolean
} {
  const url = (process.env.LANDED_COST_URL || '').trim() || LANDED_COST_DEFAULT_URL
  const secret = (process.env.LANDED_COST_SHARED_SECRET || '').trim()
  const configured = Number(process.env.LANDED_COST_TIMEOUT_MS)
  const timeoutMs = Number.isFinite(configured) && configured >= 200 && configured <= 10_000
    ? Math.round(configured)
    : LANDED_COST_DEFAULT_TIMEOUT_MS
  return { url, secret, timeoutMs, enabled: secret.length > 0 }
}

/**
 * Tetto di plausibilita' sugli oneri import di una quota.
 *
 * MISURATO il 21/09/2026 su 25 quote reali: quando il carrello ha piu' di un
 * pezzo il servizio dichiara la base dei dazi/IVA come `quantita' x (merce +
 * trasporto)` invece di `merce + trasporto`, e gli oneri import crescono del
 * fattore quantita' (CH 10 pezzi: 210,86 su merce 239 invece di ~21; GB 10
 * pezzi: 574,36 su merce 239 invece di ~52; aliquota implicita fino al 241%).
 * Su un carrello a un pezzo la stessa quota e' coerente (aliquota implicita
 * 10,3%-31,4% contro aliquote di legge dell'8,1%-25%).
 *
 * Senza questa guardia il cliente pagherebbe dazi e IVA moltiplicati per il
 * numero di pezzi, e la fattura doganale dichiarerebbe piu' di quanto ha
 * pagato — cioe' esattamente il caso in cui il pacco si blocca in dogana.
 * La quota incoerente viene SCARTATA: si usa la base prudenziale in casa.
 */
export const MAX_IMPLIED_IMPORT_RATE = 0.60

/** Margine oltre l'aliquota di legge del paese, solo per i carrelli multi-pezzo. */
export const MULTI_UNIT_IMPORT_RATE_TOLERANCE = 0.08

/** Aliquota dazi+IVA di legge del paese di destinazione (profilo prudenziale). */
export function referenceImportRate(countryCode: string): number {
  const country = String(countryCode ?? '').trim().toUpperCase()
  const profile: ExtraEuProfile = LANDED_COST_COUNTRIES[country as keyof typeof LANDED_COST_COUNTRIES]
    ?? DEFAULT_EXTRA_EU_PROFILE
  const rate = (Number.isFinite(profile.importVatRate) ? profile.importVatRate : 0)
    + (Number.isFinite(profile.dutyRate) ? profile.dutyRate : 0)
  return rate > 0 ? rate : 0
}

/**
 * true quando gli oneri import della quota non possono essere i dazi/IVA di
 * quella destinazione: la quota non si incassa (fail-closed sulla prudenziale).
 */
export function quoteImportChargesImplausible(
  quote: LandedCostQuote,
  args: { countryCode: string; totalQuantity: number },
): boolean {
  const transport = quote.transportCents
  const base = transport + (quote.goodsValueCents ?? 0)
  if (base <= 0) return false
  const impliedRate = quote.importChargesCents / base
  if (impliedRate > MAX_IMPLIED_IMPORT_RATE) return true
  const reference = referenceImportRate(args.countryCode)
  const quantity = Number.isFinite(args.totalQuantity) ? Math.max(1, Math.round(args.totalQuantity)) : 1
  if (quantity > 1 && impliedRate > reference + MULTI_UNIT_IMPORT_RATE_TOLERANCE) return true
  return false
}

function parseParcel(value: unknown): LandedCostQuoteParcel | null {
  if (!value || typeof value !== 'object') return null
  const parcel = value as Record<string, unknown>
  const weight = Number(parcel.weight)
  const width = Number(parcel.width)
  const height = Number(parcel.height)
  const length = Number(parcel.length)
  const packages = Number(parcel.packages ?? 1)
  if (![weight, width, height, length, packages].every((n) => Number.isFinite(n) && n > 0)) return null
  return {
    weightKg: Math.round(weight * 100) / 100,
    widthCm: width,
    heightCm: height,
    lengthCm: length,
    packages: Math.round(packages),
  }
}

/**
 * Legge la risposta del servizio di quota con la stessa severita' del servizio
 * stesso: una quota senza dazi/IVA, senza fee DDP o senza collo NON e' una
 * quota. Meglio nessun prezzo che un prezzo falso (trappola misurata il
 * 21/09/2026: senza fattura doganale Packlink risponde 200 con dazi a 0,00).
 */
export function parseQuoteResponse(value: unknown): LandedCostQuote | null {
  if (!value || typeof value !== 'object') return null
  const body = value as Record<string, unknown>
  if (body.status !== 'ok') return null
  const services = body.services
  if (!Array.isArray(services) || services.length === 0) return null

  const candidates: LandedCostQuote[] = []
  for (const entry of services) {
    if (!entry || typeof entry !== 'object') continue
    const service = entry as Record<string, unknown>
    const shippingAndImportCents = positiveCents(service.shipping_and_import)
    const landedCostCents = positiveCents(service.landed_cost_estimate)
    const importChargesCents = toCents(service.import_charges)
    const ddpFeeCents = positiveCents(service.ddp_fee)
    const transportCents = positiveCents(service.transport)
    if (shippingAndImportCents === null || transportCents === null) continue
    if (importChargesCents === null || ddpFeeCents === null) continue
    if (importChargesCents <= 0 || ddpFeeCents <= 0) continue
    if (landedCostCents === null || landedCostCents < shippingAndImportCents) continue

    const expiresAt = Number(service.expires_at)
    candidates.push({
      serviceId: Number.isSafeInteger(service.service_id) ? service.service_id as number : 0,
      carrier: boundedString(service.carrier, 40) ?? '',
      serviceName: boundedString(service.service_name, 80) ?? '',
      shippingAndImportCents,
      transportCents,
      importChargesCents,
      landedCostCents,
      checkoutInvoiceNumber: boundedString(service.checkout_invoice_number, 64),
      parcel: parseParcel(body.parcel),
      expiresAt: Number.isFinite(expiresAt) && expiresAt > 0 ? Math.floor(expiresAt) : null,
      goodsValueCents: toCents(body.goods_value),
    })
  }
  if (candidates.length === 0) return null

  // `services` e' ordinato per costo crescente: si prende il servizio DDP piu'
  // economico fra quelli validi, cioe' quello che Foolish paga davvero.
  candidates.sort((a, b) => a.shippingAndImportCents - b.shippingAndImportCents)
  return candidates[0]!
}

export type QuoteFetchResult =
  | { ok: true; quote: LandedCostQuote }
  | { ok: false; reason: string }

/**
 * Chiamata al servizio di quota, con attesa massima e nessun segreto in uscita
 * dal modulo (l'errore riporta il motivo, mai l'header).
 */
export async function fetchLandedCostQuote(args: {
  cartId: string
  countryCode: string
  destination: { zip?: string; city?: string }
  items: readonly { sku: string; quantity: number }[]
  fetchImpl?: typeof fetch
  timeoutMs?: number
  config?: { url: string; secret: string; enabled: boolean }
}): Promise<QuoteFetchResult> {
  const config = args.config ?? quoteClientConfig()
  if (!config.enabled) return { ok: false, reason: 'disabled' }
  const timeoutMs = args.timeoutMs ?? quoteClientConfig().timeoutMs
  const doFetch = args.fetchImpl ?? fetch

  const payload = JSON.stringify({
    cart_id: args.cartId,
    destination: {
      country: args.countryCode,
      zip: args.destination.zip ?? '',
      city: args.destination.city ?? '',
    },
    items: args.items.map((item) => ({ sku: item.sku, quantity: item.quantity })),
  })

  try {
    const response = await doFetch(config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-TFC-Key': config.secret,
      },
      body: payload,
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) return { ok: false, reason: `http_${response.status}` }
    const parsed = parseQuoteResponse(await response.json())
    return parsed ? { ok: true, quote: parsed } : { ok: false, reason: 'response_invalid' }
  } catch (error) {
    const name = error instanceof Error ? error.name : 'Error'
    return { ok: false, reason: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'unreachable' }
  }
}

/** Normalizza le righe per la quota: sku non vuoto e quantita' intera positiva. */
export function normalizeQuoteItems(
  items: unknown,
): { sku: string; quantity: number }[] | null {
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_QUOTE_ITEMS) return null
  const normalized: { sku: string; quantity: number }[] = []
  for (const entry of items) {
    if (!entry || typeof entry !== 'object') return null
    const item = entry as { sku?: unknown; quantity?: unknown }
    const sku = boundedString(item.sku, 64)
    const quantity = Number(item.quantity)
    if (!sku) return null
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > MAX_QUOTE_ITEM_QUANTITY) return null
    normalized.push({ sku, quantity })
  }
  return normalized
}

/**
 * Uno sku di pack (`<variant-sku>-pack-<pack-id>`) non e' una variante del
 * catalogo doganale: il servizio di quota non lo conosce e quoterebbe un
 * carrello diverso da quello che si paga. Definizione UNICA, usata sia dalla
 * route della quota sia dal resolver usato dal checkout.
 */
export function isPackSku(sku: unknown): boolean {
  return typeof sku === 'string' && sku.toLowerCase().includes('-pack-')
}

/**
 * Catena di risoluzione del prezzo extra-UE. Restituisce `null` SOLO quando non
 * esiste alcuna base di prezzo per quella destinazione: e' l'unico caso in cui
 * non si vende (regola di Alessandro), perche' non c'e' niente da addebitare.
 */
export async function resolveExtraEuShipping(args: {
  countryCode: string
  goodsCents: number
  destination?: { zip?: string; city?: string }
  items?: readonly { sku: string; quantity: number }[]
  quoteToken?: unknown
  now?: Date
  fetchImpl?: typeof fetch
  quoteConfig?: { url: string; secret: string; enabled: boolean }
  timeoutMs?: number
}): Promise<ExtraEuShippingResolution | null> {
  const country = String(args.countryCode ?? '').trim().toUpperCase()
  if (getShippingZone(country) !== 'EXTRA_EU') return null
  const goodsCents = Number.isFinite(args.goodsCents) ? Math.max(0, Math.round(args.goodsCents)) : 0

  const items = args.items ? [...args.items] : []
  const fingerprint = cartFingerprint(items, country)

  // Uno sku di pack non e' una variante del catalogo doganale del servizio:
  // quotare quel carrello significherebbe quotare un carrello piu' piccolo di
  // quello che si paga. La guardia sta QUI, non solo nella route della quota,
  // cosi' vale anche per il checkout (che altrimenti manda gli sku-pack alla Pi
  // e dipende dal 409 del servizio per non incassare un prezzo sbagliato).
  const packLine = items.some((item) => isPackSku(item.sku))

  // 1. prezzo congelato dal gettone: e' quello che il cliente ha visto.
  const frozenCents = verifyQuoteToken(args.quoteToken, {
    countryCode: country,
    fingerprint,
    now: args.now,
  })

  // 2. quota live (se c'e' un segreto configurato e un carrello da quotare).
  let quote: LandedCostQuote | null = null
  let quoteFailure: string | null = null
  const config = args.quoteConfig ?? quoteClientConfig()
  if (!config.enabled) {
    quoteFailure = 'disabled'
  } else if (packLine) {
    quoteFailure = 'unsupported_cart_line'
  } else if (items.length === 0) {
    quoteFailure = 'no_items'
  } else {
    const result = await fetchLandedCostQuote({
      cartId: `tfc-web-${fingerprint}`,
      countryCode: country,
      destination: args.destination ?? {},
      items,
      fetchImpl: args.fetchImpl,
      timeoutMs: args.timeoutMs,
      config,
    })
    if (result.ok) {
      const totalQuantity = items.reduce(
        (sum, item) => sum + (Number.isFinite(item.quantity) ? item.quantity : 0),
        0,
      )
      if (quoteImportChargesImplausible(result.quote, { countryCode: country, totalQuantity })) {
        quoteFailure = 'inconsistent_import_charges'
      } else {
        quote = result.quote
      }
    } else {
      quoteFailure = result.reason
    }
  }

  const profileCost = profileCostCents(country, goodsCents)
  const tableCost = tableCostCents(country, goodsCents)

  let basisCostCents: number
  let source: ShippingPriceSource
  if (quote) {
    // Base = costo documentato dalla quota, con il limite prudente dichiarato
    // dal servizio (`landed_cost_estimate`). Mai sotto `shipping_and_import`.
    basisCostCents = Math.max(quote.shippingAndImportCents, quote.landedCostCents)
    source = 'live_quote'
  } else if (profileCost === null && tableCost === null) {
    return null
  } else {
    const fromProfile = profileCost ?? 0
    const fromTable = tableCost ?? 0
    basisCostCents = Math.max(fromProfile, fromTable)
    source = fromTable > fromProfile ? 'price_table' : 'profile'
  }

  // Stessa aritmetica del profilo di paese (`calculateLandedCost`): margine
  // arrotondato al mezzo centesimo per eccesso, poi somma. Cosi' il prezzo
  // della quota e quello del profilo nascono con la stessa regola.
  const marginRate = Number.isFinite(EXTRA_EU_MARGIN_RATE) ? Math.max(0, EXTRA_EU_MARGIN_RATE) : 0
  const marginCents = Math.round(basisCostCents * marginRate)
  const withMargin = basisCostCents + marginCents
  const minChargeCents = Math.ceil(EXTRA_EU_MINIMUM_SHIPPING * 100)

  // Il gettone congela il PREZZO mostrato (margine GIA' dentro), non una base
  // di costo: si applica come pavimento sul prezzo finale, fuori dalla base.
  // Se entrasse nella base, il margine verrebbe applicato una seconda volta e
  // il cliente pagherebbe piu' di quello che ha visto (misurato il 21/09/2026:
  // mostrato 52,49, incassato 57,74). Regola invariata: il gettone non ABBASSA
  // mai il prezzo — se il costo verificato adesso e' piu' alto, si addebita
  // quello piu' alto, mai meno del costo sdoganato.
  const frozenFloorCents = frozenCents ?? 0
  const costCents = Math.max(withMargin, minChargeCents, frozenFloorCents)

  if (!Number.isSafeInteger(costCents) || costCents <= 0) return null

  return {
    costCents,
    source,
    basisCostCents,
    marginCents,
    minChargeCents,
    minimumChargeApplied: minChargeCents > withMargin && minChargeCents > frozenFloorCents,
    quote,
    verified: quote !== null,
    quoteFailure,
    profileCostCents: profileCost ?? 0,
    tableCostCents: tableCost,
  }
}
