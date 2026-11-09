// Server-only reorder planner. No `next/headers` here: the thin route
// authenticates and delegates, so this module can be tested with injected
// dependencies and no cookies, network, or Stripe.
//
// FAIL-CLOSED ON DISCOUNTS — declared behaviour, not an oversight:
// a paid order that used a promo stores NET prices in its `lineItems`, while
// the current catalog exposes the LIST price. The price comparison below can
// therefore never match for a discounted order, and the reorder is refused
// with `prezzo_cambiato`. That is intentional: rebuilding the cart is the only
// place where the promo is recalculated, and inventing a net price from the
// list price would charge the customer more than the order says. The client
// must recreate the cart to see the current, discounted total.
import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { resolveCheckoutCatalog, type CatalogProductFetcher } from '@/lib/catalog'
import {
  allocateProductDiscount,
  buildCheckoutMetadata,
  calculateServerShippingCostCents,
  cartSubtotalCents,
  moneyToCents,
  normalizeCheckoutCustomer,
} from '@/lib/promo'
import {
  getShippingZone,
  isAllowedShippingCountry,
  shippingRequiresQuote,
} from '@/lib/shipping'
import {
  resolveExtraEuShipping,
  type ExtraEuShippingResolution,
} from '@/lib/landed-cost'
import {
  buildCarrierShippingMetadata,
  buildExtraEuShippingMetadata,
  buildStripeLineItems,
} from '@/lib/checkout-session'

export type ReorderCode =
  | 'order_not_found'
  | 'righe_non_disponibili'
  | 'prezzo_cambiato'
  | 'spedizione_da_quotare'
  | 'ordine_troppo_grande'
  | 'catalogo_non_disponibile'
  | 'dati_ordine_non_validi'

export interface ReorderPriceRow {
  sku: string
  previousTotalCents: number
  currentTotalCents: number
}

export type ReorderPlan =
  | { status: 'ok'; orderRef: string; sessionParams: Record<string, unknown> }
  | {
      status: 'refused'
      code: ReorderCode
      httpStatus: number
      message: string
      skus?: string[]
      rows?: ReorderPriceRow[]
    }

type ExtraEuArgs = {
  countryCode: string
  goodsCents: number
  destination: { zip?: string; city?: string }
  items: Array<{ sku: string; quantity: number }>
}

type ExtraEuResolver = (args: ExtraEuArgs) => Promise<ExtraEuShippingResolution | null>

const STOREFRONT_URL_FALLBACK = 'https://thefoolishbutcher.com'

/** Same shape the account order lookup already trusts. */
export const REORDER_ORDER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

const REFUSAL_MESSAGES: Record<ReorderCode, string> = {
  order_not_found: 'Ordine non trovato.',
  righe_non_disponibili:
    'Alcuni prodotti di questo ordine non sono più disponibili: aggiungili di nuovo al carrello per verificare i prezzi.',
  prezzo_cambiato:
    'I prezzi di questo ordine sono cambiati: aggiungi di nuovo i prodotti al carrello per vedere il totale aggiornato.',
  spedizione_da_quotare:
    'Per questa destinazione calcoliamo la spedizione con lo sdoganamento incluso: scrivici e la quotiamo prima del pagamento.',
  ordine_troppo_grande:
    "Questo ordine ha troppe righe per il riordino automatico: conviene rifare l'ordine dal carrello.",
  catalogo_non_disponibile: 'Catalogo temporaneamente non disponibile. Riprova tra poco.',
  dati_ordine_non_validi:
    "L'indirizzo di questo ordine non è più utilizzabile per un nuovo acquisto: aggiornalo nel carrello.",
}

const REFUSAL_STATUS: Record<ReorderCode, number> = {
  order_not_found: 404,
  righe_non_disponibili: 409,
  prezzo_cambiato: 409,
  spedizione_da_quotare: 409,
  ordine_troppo_grande: 409,
  catalogo_non_disponibile: 503,
  dati_ordine_non_validi: 409,
}

function refuse(
  code: ReorderCode,
  extra?: { skus?: string[]; rows?: ReorderPriceRow[] },
): Extract<ReorderPlan, { status: 'refused' }> {
  return {
    status: 'refused',
    code,
    httpStatus: REFUSAL_STATUS[code],
    message: REFUSAL_MESSAGES[code],
    ...(extra?.skus ? { skus: extra.skus } : {}),
    ...(extra?.rows ? { rows: extra.rows } : {}),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

type OrderLine = {
  sku: string
  quantity: number
  unitAmountCents: number
}

function readOrderLines(rawLines: unknown): OrderLine[] | null {
  if (!Array.isArray(rawLines) || rawLines.length === 0) return null

  const lines: OrderLine[] = []
  for (const row of rawLines) {
    if (!isRecord(row)) return null
    const sku = row.sku
    const quantity = row.quantity
    const unitPrice = row.unitPrice
    if (
      typeof sku !== 'string'
      || sku.trim().length === 0
      || typeof quantity !== 'number'
      || !Number.isSafeInteger(quantity)
      || quantity <= 0
      || typeof unitPrice !== 'number'
      || !Number.isFinite(unitPrice)
      || unitPrice < 0
    ) return null

    const unitAmountCents = Math.round(unitPrice * 100)
    if (!Number.isSafeInteger(unitAmountCents)) return null
    lines.push({ sku, quantity, unitAmountCents })
  }
  return lines
}

function readableSkus(rawLines: unknown): string[] {
  if (!Array.isArray(rawLines)) return []
  const skus = new Set<string>()
  for (const row of rawLines) {
    if (isRecord(row) && typeof row.sku === 'string' && row.sku.trim().length > 0) {
      skus.add(row.sku)
    }
  }
  return [...skus]
}

function sameEmail(left: unknown, right: string): boolean {
  return typeof left === 'string' && left.toLowerCase() === right.toLowerCase()
}

function storefrontUrl(): string {
  return process.env.STOREFRONT_URL || STOREFRONT_URL_FALLBACK
}

export async function planReorder(args: {
  order: unknown
  sessionEmail: string
  fetchProduct?: CatalogProductFetcher
  resolveExtraEu?: ExtraEuResolver
  now?: Date
}): Promise<ReorderPlan> {
  const { order, sessionEmail } = args

  // Ownership is checked here as well as in `handleReorder`: this function is
  // the pure boundary that decides whether money can be charged, so it must
  // never return `ok` for somebody else's order even if called directly.
  if (!isRecord(order) || !sameEmail(order.customerEmail, sessionEmail)) {
    return refuse('order_not_found')
  }

  const rawLines = order.lineItems
  const lines = readOrderLines(rawLines)
  if (!lines) {
    const skus = readableSkus(rawLines)
    return refuse('righe_non_disponibili', skus.length > 0 ? { skus } : undefined)
  }

  // Resolve every row on the CURRENT catalog. The order's own prices are only
  // used for the comparison below, never to build the session.
  const catalogResult = await resolveCheckoutCatalog(
    lines.map((line) => ({ sku: line.sku, quantity: line.quantity })),
    args.fetchProduct ? { fetchProduct: args.fetchProduct } : {},
  ).catch(() => ({ status: 'unavailable' as const }))

  if (catalogResult.status === 'unavailable') {
    return refuse('catalogo_non_disponibile')
  }
  if (catalogResult.status !== 'ok') {
    return refuse('righe_non_disponibili', { skus: [...new Set(lines.map((line) => line.sku))] })
  }

  const normalizedItems = catalogResult.items
  const previousBySku = new Map<string, number>()
  for (const line of lines) {
    previousBySku.set(
      line.sku,
      (previousBySku.get(line.sku) ?? 0) + line.unitAmountCents * line.quantity,
    )
  }

  const currentBySku = new Map<string, number>()
  for (const item of normalizedItems) {
    const unitAmountCents = moneyToCents(item.price)
    if (unitAmountCents === null) {
      return refuse('righe_non_disponibili', { skus: [...new Set(lines.map((line) => line.sku))] })
    }
    currentBySku.set(
      item.sku,
      (currentBySku.get(item.sku) ?? 0) + unitAmountCents * item.quantity,
    )
  }

  const changedRows: ReorderPriceRow[] = []
  for (const [sku, previousTotalCents] of previousBySku) {
    const currentTotalCents = currentBySku.get(sku)
    if (currentTotalCents === undefined) {
      return refuse('righe_non_disponibili', { skus: [sku] })
    }
    if (currentTotalCents !== previousTotalCents) {
      changedRows.push({ sku, previousTotalCents, currentTotalCents })
    }
  }
  if (changedRows.length > 0) {
    return refuse('prezzo_cambiato', { rows: changedRows })
  }

  const shippingAddress = isRecord(order.shippingAddress) ? order.shippingAddress : null
  const countryValue = shippingAddress?.country ?? order.customerCountry
  const country = typeof countryValue === 'string' ? countryValue.trim().toUpperCase() : ''
  if (!country || !isAllowedShippingCountry(country)) {
    return refuse('dati_ordine_non_validi')
  }

  // Stessa guardia del checkout canonico (`api/stripe/checkout`): una
  // destinazione che si quota a mano non ha un prezzo da incassare. Va fermata
  // PRIMA di risolvere la spedizione, altrimenti un profilo prudenziale
  // produrrebbe comunque una riga Spedizione per un pacco che non parte.
  if (shippingRequiresQuote(country)) {
    return refuse('spedizione_da_quotare')
  }

  const rawPhone = order.customerPhone
  const customer = normalizeCheckoutCustomer({
    email: sessionEmail,
    name: shippingAddress?.name,
    country,
    address: shippingAddress?.address1,
    city: shippingAddress?.city,
    postalCode: shippingAddress?.postalCode,
    // `normalizeCheckoutCustomer` treats an absent phone as empty but rejects an
    // explicitly empty string; an old order without a phone is still reusable.
    phone: typeof rawPhone === 'string' && rawPhone.trim().length > 0 ? rawPhone : undefined,
  })
  if (!customer) {
    return refuse('dati_ordine_non_validi')
  }

  const goodsCents = cartSubtotalCents(normalizedItems)
  if (goodsCents === null || goodsCents <= 0) {
    return refuse('dati_ordine_non_validi')
  }

  let shippingCostCents: number
  let shippingMetadata: Record<string, string>
  if (getShippingZone(country) === 'EXTRA_EU') {
    const resolveExtraEu = args.resolveExtraEu ?? resolveExtraEuShipping
    let resolution: ExtraEuShippingResolution | null
    try {
      resolution = await resolveExtraEu({
        countryCode: country,
        goodsCents,
        destination: { zip: customer.postalCode, city: customer.city },
        items: normalizedItems.map((item) => ({ sku: item.sku, quantity: item.quantity })),
      })
    } catch {
      resolution = null
    }
    if (!resolution) {
      return refuse('spedizione_da_quotare')
    }
    shippingCostCents = resolution.costCents
    shippingMetadata = buildExtraEuShippingMetadata(resolution)
  } else {
    const carrierCostCents = calculateServerShippingCostCents(normalizedItems, country, false)
    if (carrierCostCents === null) {
      return refuse('dati_ordine_non_validi')
    }
    shippingCostCents = carrierCostCents
    shippingMetadata = buildCarrierShippingMetadata()
  }

  if (!Number.isSafeInteger(shippingCostCents) || shippingCostCents < 0) {
    return refuse('dati_ordine_non_validi')
  }

  const chargedProductLines = allocateProductDiscount(normalizedItems, 0)
  if (!chargedProductLines) {
    return refuse('dati_ordine_non_validi')
  }

  const orderRef = `FOOLISH-${args.now?.getTime() ?? Date.now()}`
  const metadata = buildCheckoutMetadata({
    orderRef,
    customer,
    chargedProductLines,
    promo: null,
  })
  if (!metadata) {
    // Con `promo: null` l'unico valore che puo` superare i 500 caratteri e`
    // `items_json`: l'ordine ha troppe righe per il riordino automatico. Non e`
    // un indirizzo inutilizzabile, quindi merita il suo codice.
    return refuse('ordine_troppo_grande')
  }

  const sessionParams: Record<string, unknown> = {
    mode: 'payment',
    line_items: buildStripeLineItems(chargedProductLines, shippingCostCents),
    customer_email: sessionEmail,
    billing_address_collection: 'auto',
    shipping_address_collection: { allowed_countries: [country] },
    success_url: `${storefrontUrl()}/grazie?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${storefrontUrl()}/checkout`,
    metadata: { ...metadata, ...shippingMetadata },
  }

  return { status: 'ok', orderRef, sessionParams }
}

function refusalResponse(
  plan: Extract<ReorderPlan, { status: 'refused' }>,
): NextResponse {
  return NextResponse.json(
    {
      error: plan.code,
      message: plan.message,
      ...(plan.skus ? { skus: plan.skus } : {}),
      ...(plan.rows ? { rows: plan.rows } : {}),
    },
    { status: plan.httpStatus },
  )
}

async function findOrderInCms(orderNumber: string, email: string): Promise<unknown | null> {
  const cmsUrl = process.env.NEXT_PUBLIC_CMS_URL ?? process.env.PAYLOAD_PUBLIC_URL
  if (!cmsUrl) throw new Error('CMS URL non configurato')

  // Both values are encoded: an order id is not allowed to inject a second
  // `where` clause into the CMS query.
  const query = `?where[orderNumber][equals]=${encodeURIComponent(orderNumber)}`
    + `&where[customerEmail][equals]=${encodeURIComponent(email)}&depth=0&limit=1`
  const response = await fetch(`${cmsUrl}/api/orders${query}`, {
    headers: { 'x-storefront-secret': process.env.PAYLOAD_API_SECRET! },
    cache: 'no-store',
  })

  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(`CMS order lookup failed ${response.status}`)
  }

  const data = await response.json() as { docs?: unknown[] }
  return data.docs?.[0] ?? null
}

class CheckoutNotConfiguredError extends Error {}

async function createStripeCheckoutSession(
  params: Record<string, unknown>,
): Promise<{ url: string | null }> {
  const secretKey = process.env.STRIPE_SECRET_KEY
  if (!secretKey) throw new CheckoutNotConfiguredError('STRIPE_SECRET_KEY non configurata')

  const stripe = new Stripe(secretKey)
  const session = await stripe.checkout.sessions.create(
    params as Stripe.Checkout.SessionCreateParams,
  )
  return { url: session.url }
}

export async function handleReorder(args: {
  orderId: string
  sessionEmail: string
  findOrder?: (orderNumber: string, email: string) => Promise<unknown | null>
  fetchProduct?: CatalogProductFetcher
  createCheckoutSession?: (params: Record<string, unknown>) => Promise<{ url: string | null }>
}): Promise<NextResponse> {
  if (!args.sessionEmail) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Validate BEFORE any query: a malformed id never reaches the CMS.
  if (!REORDER_ORDER_ID_RE.test(args.orderId)) {
    return refusalResponse(refuse('order_not_found'))
  }

  const findOrder = args.findOrder ?? findOrderInCms
  let order: unknown
  try {
    order = await findOrder(args.orderId, args.sessionEmail)
  } catch (error) {
    console.error(
      '[account/reorder] CMS order lookup failed:',
      error instanceof Error ? error.message : error,
    )
    return refusalResponse(refuse('catalogo_non_disponibile'))
  }

  if (!order) {
    return refusalResponse(refuse('order_not_found'))
  }

  // Defense in depth: the CMS filter already asked for the session email, but
  // the decision is re-made in application code. A CMS that ignores a filter
  // must not turn into a checkout for somebody else's order.
  if (!isRecord(order) || !sameEmail(order.customerEmail, args.sessionEmail)) {
    return refusalResponse(refuse('order_not_found'))
  }

  const plan = await planReorder({
    order,
    sessionEmail: args.sessionEmail,
    fetchProduct: args.fetchProduct,
  })
  if (plan.status === 'refused') {
    return refusalResponse(plan)
  }

  const createCheckoutSession = args.createCheckoutSession ?? createStripeCheckoutSession
  try {
    const { url } = await createCheckoutSession(plan.sessionParams)
    return NextResponse.json({ url })
  } catch (error) {
    if (error instanceof CheckoutNotConfiguredError) {
      return NextResponse.json(
        { error: 'pagamento_non_disponibile', message: 'Pagamento temporaneamente non disponibile.' },
        { status: 503 },
      )
    }
    // Never leak the provider's message: it can contain keys or internal ids.
    console.error(
      '[account/reorder] Stripe session creation failed:',
      error instanceof Error ? error.message : error,
    )
    return NextResponse.json(
      { error: 'pagamento_non_disponibile', message: 'Pagamento temporaneamente non disponibile.' },
      { status: 502 },
    )
  }
}
