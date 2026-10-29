import type { PriceTier } from './cms'
import { calculateUnitPrice } from './pricing'

/**
 * Risoluzione autorevole del carrello B2B.
 *
 * Il carrello viaggia nel browser (localStorage) e arriva al server con
 * SKU, prezzo e fasce decisi dal client. Nessuno di quei valori e' autorita':
 * l'autorita' e' il catalogo CMS. Questo modulo prende il carrello grezzo e
 * il catalogo, e o restituisce righe costruite *dai dati del catalogo*, o
 * rifiuta tutto con un errore controllato.
 *
 * Perche' rifiutare invece di ricalcolare in silenzio: un carrello con un
 * prezzo divergente non e' "vecchio", e' incoerente. Ricalcolarlo produrrebbe
 * un ordine che il cliente non ha mai visto in quel totale, e nasconderebbe
 * la sola cosa che va capita — che il listino e' cambiato. Un errore
 * visibile costa un'azione in piu'; un totale diverso in silenzio costa la
 * fiducia, e a volte un addebito sbagliato.
 *
 * Modulo puro: nessun I/O, nessun import da Next. Gli import sono relativi
 * cosi' i test girano con tsx senza alias.
 */

/** Il sottoinsieme del documento CMS che serve a fare i conti. */
export interface CatalogProductForPricing {
  id: number
  slug: string
  name: string
  /** Visibilita' in vetrina: NON e' la vendibilita' (i kit sono `active: false`). */
  active: boolean
  /** Presenza nel catalogo reseller: e' questa la vendibilita'. */
  resellerVisible?: boolean
  priceTiers: PriceTier[]
  variants: { sku: string; label: string; price: number; stockStatus?: string }[]
}

/** La riga come arriva dal carrello: tutto non fidato, per costruzione. */
export interface ClientLineInput {
  productId?: unknown
  productSlug?: unknown
  variantSku: unknown
  qty: unknown
  unitPrice: unknown
  priceTiers?: unknown
  productName?: unknown
  variantLabel?: unknown
}

export interface ResolvedLine {
  productName: string
  variantLabel: string
  variantSku: string
  qty: number
  unitPrice: number
  priceTiers: PriceTier[]
  lineTotalCents: number
}

export type ResolveLinesResult =
  | { ok: true; lines: ResolvedLine[]; productsTotalCents: number }
  | { ok: false; status: number; error: string; detail?: string }

/** Totale riga in centesimi: un solo arrotondamento, sul totale della riga. */
export function lineTotalCents(basePrice: number, qty: number, tiers: PriceTier[]): number {
  return Math.round(calculateUnitPrice(basePrice, qty, tiers) * qty * 100)
}

/** Un carrello rivenditore oltre 100 righe non e' un carrello. */
export const MAX_LINES = 100
/** Tetto di quantita' per riga: oltre, non e' piu' un ordine, e' un errore. */
export const MAX_QTY = 100000

type Failure = Extract<ResolveLinesResult, { ok: false }>

function fail(status: number, error: string, detail?: string): Failure {
  return detail === undefined ? { ok: false, status, error } : { ok: false, status, error, detail }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Un importo in EUR e' valido per i conti se i suoi centesimi sono interi. */
function centsOf(amountEur: number): number | null {
  const cents = amountEur * 100
  if (Math.abs(cents - Math.round(cents)) >= 1e-6) return null
  return Math.round(cents)
}

/**
 * Fasce del catalogo in forma canonica, o `null` se il catalogo stesso non
 * e' affidabile (valore ambiguo: prezzo che non si puo' decidere).
 */
function readCatalogTiers(raw: unknown): PriceTier[] | null {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) return null
  const tiers: PriceTier[] = []
  for (const entry of raw) {
    if (!isRecord(entry)) return null
    const { minQty, discountPercent } = entry
    const maxQty = entry.maxQty === undefined || entry.maxQty === null ? null : entry.maxQty
    if (typeof minQty !== 'number' || !Number.isInteger(minQty) || minQty < 1) return null
    if (maxQty !== null && (typeof maxQty !== 'number' || !Number.isInteger(maxQty) || maxQty < minQty)) return null
    if (typeof discountPercent !== 'number' || !Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) {
      return null
    }
    tiers.push({ minQty, maxQty, discountPercent })
  }
  // Fasce sovrapposte = prezzo ambiguo. `calculateUnitPrice` prenderebbe la
  // prima che capita: fail-closed, non "prima che capita".
  for (let i = 1; i < tiers.length; i += 1) {
    const previous = tiers[i - 1]
    if (previous.maxQty === null || tiers[i].minQty <= previous.maxQty) return null
  }
  return tiers
}

/** Il prezzo di una variante, o `null` se non e' un importo pulito. */
function readCatalogPrice(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return null
  if (centsOf(raw) === null) return null
  return raw
}

/** Confronto canonico: stessi numeri, stesso ordine, nessuna tolleranza. */
function sameTiers(clientRaw: unknown[], catalogTiers: PriceTier[]): boolean {
  if (clientRaw.length !== catalogTiers.length) return false
  for (let i = 0; i < catalogTiers.length; i += 1) {
    const entry = clientRaw[i]
    if (!isRecord(entry)) return false
    const maxQty = entry.maxQty === undefined || entry.maxQty === null ? null : entry.maxQty
    if (entry.minQty !== catalogTiers[i].minQty) return false
    if (maxQty !== catalogTiers[i].maxQty) return false
    if (entry.discountPercent !== catalogTiers[i].discountPercent) return false
  }
  return true
}

interface CatalogMatch {
  product: Record<string, unknown>
  variant: Record<string, unknown>
}

/** Cerca lo SKU nel catalogo: confronto esatto, case-sensitive. */
function findVariant(catalog: unknown[], sku: string): CatalogMatch | null {
  for (const product of catalog) {
    if (!isRecord(product) || !Array.isArray(product.variants)) continue
    for (const variant of product.variants) {
      if (isRecord(variant) && variant.sku === sku) return { product, variant }
    }
  }
  return null
}

function labelOf(raw: unknown): string {
  return typeof raw === 'string' ? raw : ''
}

/**
 * Trasforma il carrello del client in righe autorevoli, o lo rifiuta.
 * Si ferma al primo errore, nell'ordine documentato.
 */
export function resolveAuthoritativeLines(items: unknown, catalog: unknown): ResolveLinesResult {
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_LINES) {
    return fail(400, 'righe_non_valide')
  }
  // Difesa in profondita': la rotta passa il catalogo del fetcher, che e'
  // gia' un array. Un catalogo che non lo e' non si presta a fare conti.
  if (!Array.isArray(catalog)) return fail(503, 'catalogo_non_valido')

  const lines: ResolvedLine[] = []
  let productsTotalCents = 0

  for (let index = 0; index < items.length; index += 1) {
    const rawLine = items[index]
    const where = `riga ${index + 1}`
    if (!isRecord(rawLine)) return fail(400, 'riga_non_valida', where)

    const line = rawLine as unknown as ClientLineInput
    const sku = typeof line.variantSku === 'string' ? line.variantSku.trim() : ''
    if (!sku) return fail(400, 'sku_mancante', where)

    // L'identificativo prodotto e' un secondo riferimento al catalogo: se
    // c'e' deve risolvere allo stesso documento dello SKU, altrimenti il
    // client sta descrivendo due prodotti diversi. Non e' autorita' di
    // prezzo, ma un id inventato non deve passare.
    if (typeof line.productId !== 'number' || !Number.isInteger(line.productId)) {
      return fail(400, 'prodotto_non_valido', where)
    }

    const qty = line.qty
    if (typeof qty !== 'number' || !Number.isFinite(qty) || !Number.isInteger(qty) || qty <= 0 || qty > MAX_QTY) {
      return fail(400, 'quantita_non_valida', where)
    }

    const clientUnitPrice = line.unitPrice
    if (typeof clientUnitPrice !== 'number' || !Number.isFinite(clientUnitPrice) || clientUnitPrice < 0) {
      return fail(400, 'prezzo_non_valido', where)
    }
    // Il prezzo del client deve essere un importo in centesimi interi: 14.989
    // non e' 14.99 e non deve essere arrotondato per farlo combaciare.
    const clientUnitPriceCents = centsOf(clientUnitPrice)
    if (clientUnitPriceCents === null) return fail(400, 'prezzo_non_valido', where)

    if (!Array.isArray(line.priceTiers)) return fail(400, 'fasce_non_valide', where)

    const match = findVariant(catalog, sku)
    if (!match) return fail(400, 'sku_non_disponibile', where)
    const { product, variant } = match
    // `stockStatus` e' lo stato di magazzino: `unavailable` non si vende.
    // `low`, `available` e il campo assente restano vendibili; `active` non
    // e' un gate di vendibilita' (i kit sono `active: false` e si vendono).
    if (variant.stockStatus === 'unavailable') return fail(400, 'variante_non_disponibile', where)
    // Vendibile = presente nel catalogo reseller. `active` e' solo la
    // visibilita' in vetrina: i 6 kit di produzione sono `active: false` ma
    // `resellerVisible: true` e si vendono. Il catalogo del checkout e' gia'
    // filtrato per `resellerVisible`; questo controllo esplicito difende un
    // chiamante che passasse un catalogo non filtrato.
    if (product.resellerVisible === false) return fail(400, 'prodotto_non_disponibile', where)
    if (product.id !== line.productId) return fail(400, 'prodotto_non_disponibile', where)
    if (
      typeof line.productSlug === 'string' &&
      line.productSlug.trim() !== '' &&
      line.productSlug !== product.slug
    ) {
      return fail(400, 'prodotto_non_disponibile', where)
    }

    const catalogPrice = readCatalogPrice(variant.price)
    const catalogTiers = readCatalogTiers(product.priceTiers)
    if (catalogPrice === null || catalogTiers === null) return fail(503, 'catalogo_non_valido', where)

    if (clientUnitPriceCents !== Math.round(catalogPrice * 100)) {
      return fail(400, 'prezzo_non_allineato', where)
    }
    if (!sameTiers(line.priceTiers, catalogTiers)) return fail(400, 'fasce_non_allineate', where)

    // Arrotondamento una volta sola, sul totale di riga in centesimi: e' qui
    // che il difetto storico (8,125 x 50 = 406,25 invece di 406,50) sarebbe
    // reintrodotto arrotondando prima il prezzo unitario.
    const lineCents = lineTotalCents(catalogPrice, qty, catalogTiers)
    productsTotalCents += lineCents
    lines.push({
      productName: labelOf(product.name),
      variantLabel: labelOf(variant.label),
      variantSku: sku,
      qty,
      unitPrice: catalogPrice,
      priceTiers: catalogTiers.map((tier) => ({ ...tier })),
      lineTotalCents: lineCents,
    })
  }

  return { ok: true, lines, productsTotalCents }
}
