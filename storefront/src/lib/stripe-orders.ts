import { randomUUID } from 'node:crypto'
import Stripe from 'stripe'
import { countryToLocale } from '@/lib/resend'

interface ParsedItem {
  sku: string
  qty: number
  name: string
  variantLabel: string
  price: number
}

interface CmsOrder {
  id: string | number
  orderNumber: string
  pipelineState?: string
}

interface CmsFindResponse {
  docs?: CmsOrder[]
}

export interface OrderPersistenceResult {
  orderRef: string
  created: boolean
  orderId?: string | number
}

export interface OrderPersistenceRetryOptions {
  delays?: readonly number[]
  persist?: (session: Stripe.Checkout.Session) => Promise<OrderPersistenceResult>
}

export interface StripeOrderReconciliationResult {
  lookbackDays: number
  sessionsScanned: number
  eligiblePaidSessions: number
  alreadyPresent: number
  recovered: Array<{
    orderRef: string
    stripeSessionId: string
    amount: number
    currency: string | null
  }>
  errors: Array<{
    orderRef: string
    stripeSessionId: string
    error: string
  }>
}

// Normal storefront payment checkouts historically used `FOOLISH-${Date.now()}`.
// Reorders add UUID entropy so two requests in the same millisecond cannot
// reuse an order number. Keep both formats valid for existing Stripe sessions.
const STOREFRONT_ORDER_REF_RE = /^FOOLISH-(?:\d{13}|\d{13}-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/

export function createStorefrontOrderRef(timestamp = Date.now(), entropy = randomUUID()): string {
  return `FOOLISH-${timestamp}-${entropy}`
}

export function isValidStorefrontOrderRef(value: unknown): value is string {
  return typeof value === 'string' && STOREFRONT_ORDER_REF_RE.test(value)
}

const cmsUrl = () => process.env.PAYLOAD_PUBLIC_URL || 'https://cms-production-1e56.up.railway.app'
const cmsHeaders = () => ({
  'Content-Type': 'application/json',
  'x-storefront-secret': process.env.PAYLOAD_API_SECRET || '',
})

/** Formato di un codice promo: identico al vincolo di `PromoCodes.code` (uppercase). */
const PROMO_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

/**
 * Tipi promo realmente supportati: copia della lista canonica in
 * `cms/src/collections/promoTypes.ts` (lo storefront e il CMS sono due pacchetti
 * separati e non si importano a vicenda). La deriva e' intercettata da
 * `promo-types-parity.test.ts`: aggiungere un tipo solo qui perde il `promoType`
 * sugli ordini in silenzio.
 */
export const PROMO_TYPES = new Set(['free_shipping', 'percent_pro', 'percent', 'amount', 'percent_tiered'])

export interface PromoSnapshot {
  promoCode?: string
  promoType?: string
  promoDiscountCents?: number
}

/**
 * Snapshot promo dai metadata Stripe scritti al checkout (`buildCheckoutMetadata`).
 *
 * Regola: un codice conforme e' la traccia che conta, quindi viene conservato anche
 * quando l'importo manca o e' illeggibile (in quel caso lo sconto resta nullo, non si
 * inventa). Senza un codice conforme nessun campo viene salvato, nemmeno se un importo
 * e' presente: senza codice non c'e' attribuzione. Non solleva mai: un metadata sporco
 * non deve impedire la creazione di un ordine pagato.
 */
export function parsePromoSnapshot(meta: Stripe.Metadata | null | undefined): PromoSnapshot {
  const rawCode = meta?.promo_code
  const code = typeof rawCode === 'string' ? rawCode.trim().toUpperCase() : ''
  if (!PROMO_CODE_RE.test(code)) return {}

  const snapshot: PromoSnapshot = { promoCode: code }

  const rawType = meta?.promo_type
  if (typeof rawType === 'string' && PROMO_TYPES.has(rawType)) snapshot.promoType = rawType

  // I metadata Stripe sono stringhe: accettiamo solo cifre (intero non negativo in
  // centesimi). "12.5", "-1", "1e3" e "" restano fuori e producono `null`.
  const rawDiscount = meta?.promo_discount_amount_cents
  if (typeof rawDiscount === 'string' && /^\d+$/.test(rawDiscount)) {
    const cents = Number(rawDiscount)
    if (Number.isSafeInteger(cents) && cents >= 0) snapshot.promoDiscountCents = cents
  }

  return snapshot
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function getStripeOrderRef(session: Stripe.Checkout.Session): string | null {
  const orderRef = session.metadata?.order_ref
  return isValidStorefrontOrderRef(orderRef) ? orderRef : null
}

export async function findCmsOrder(orderRef: string): Promise<CmsOrder | null> {
  const response = await fetch(
    `${cmsUrl()}/api/orders?where[orderNumber][equals]=${encodeURIComponent(orderRef)}&limit=1&depth=0`,
    { headers: cmsHeaders(), cache: 'no-store' },
  )
  if (!response.ok) {
    throw new Error(`CMS order lookup failed ${response.status}: ${await response.text()}`)
  }
  const data = await response.json() as CmsFindResponse
  return data.docs?.[0] ?? null
}

export async function createOrderInCMS(session: Stripe.Checkout.Session): Promise<OrderPersistenceResult> {
  const meta = session.metadata ?? {}
  const orderRef = getStripeOrderRef(session)
  if (!orderRef) throw new Error('Stripe storefront order_ref is missing or invalid')
  const existing = await findCmsOrder(orderRef)
  if (existing) {
    return { orderRef, created: false, orderId: existing.id }
  }

  const customerName = meta.customer_name ?? session.customer_details?.name ?? ''
  const customerPhone = meta.customer_phone ?? ''
  const customerEmail = session.customer_email ?? session.customer_details?.email ?? ''
  const total = (session.amount_total ?? 0) / 100
  const stripePaymentIntentId = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent?.id

  let parsedItems: ParsedItem[] = []
  try {
    parsedItems = JSON.parse(meta.items_json ?? '[]') as ParsedItem[]
  } catch {
    // Un ordine pagato deve comunque essere visibile anche con metadata
    // parzialmente corrotti; il riconciliatore lo segnalerà con righe vuote.
  }

  const itemsTotal = parsedItems.reduce((sum, item) => sum + item.price * item.qty, 0)
  const shippingCost = Math.max(0, Number((total - itemsTotal).toFixed(2)))

  // Snapshot del promo: e' la traccia che il vecchio flusso perdeva (lo sconto viveva
  // solo come prezzo netto per riga). Assente o illeggibile => campi omessi, ordine creato.
  const promoSnapshot = parsePromoSnapshot(meta)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const legacyShipping = (session as any).shipping_details as {
    address?: { line1?: string; line2?: string; city?: string; postal_code?: string; country?: string }
  } | null
  const shipping = session.collected_information?.shipping_details ?? legacyShipping
  const shippingAddress = shipping
    ? {
        name: customerName,
        address1: shipping.address?.line1 ?? '',
        address2: shipping.address?.line2 ?? '',
        city: shipping.address?.city ?? '',
        postalCode: shipping.address?.postal_code ?? '',
        country: shipping.address?.country ?? meta.customer_country ?? '',
      }
    : (() => {
        const parts = (meta.customer_address ?? '').split('|')
        return {
          name: customerName,
          address1: parts[0] ?? '',
          address2: '',
          city: parts[1] ?? '',
          postalCode: parts[2] ?? '',
          country: meta.customer_country ?? '',
        }
      })()

  const response = await fetch(`${cmsUrl()}/api/orders`, {
    method: 'POST',
    headers: cmsHeaders(),
    body: JSON.stringify({
      orderNumber: orderRef,
      source: 'storefront',
      customerEmail,
      customerName,
      customerPhone: customerPhone || undefined,
      lineItems: parsedItems.map((item) => ({
        sku: item.sku,
        name: item.name,
        variantLabel: item.variantLabel,
        quantity: item.qty,
        unitPrice: item.price,
      })),
      total,
      shippingCost,
      ...promoSnapshot,
      shippingAddress,
      customerLocale: countryToLocale(shippingAddress.country),
      pipelineState: 'received',
      paymentStatus: session.payment_status === 'paid' ? 'paid' : 'pending',
      paymentMethod: 'stripe',
      stripePaymentIntentId: stripePaymentIntentId || undefined,
    }),
  })

  if (!response.ok) {
    // Webhook e cron possono correre insieme. Il vincolo unique su orderNumber
    // decide il vincitore; se l'altro processo ha creato l'ordine, è successo.
    const racedOrder = await findCmsOrder(orderRef).catch(() => null)
    if (racedOrder) {
      return { orderRef, created: false, orderId: racedOrder.id }
    }
    throw new Error(`CMS create order failed ${response.status}: ${await response.text()}`)
  }

  const created = await response.json() as CmsOrder
  return { orderRef, created: true, orderId: created.id }
}

export async function createOrderInCMSWithRetry(
  session: Stripe.Checkout.Session,
  options: OrderPersistenceRetryOptions = {},
): Promise<OrderPersistenceResult> {
  const delays = options.delays ?? [0, 2_000, 5_000, 10_000]
  const persist = options.persist ?? createOrderInCMS
  let lastError: Error | null = null

  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    const delay = delays[attempt]!
    if (delay > 0) await sleep(delay)
    try {
      return await persist(session)
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      console.error(`[stripe-order] CMS persistence attempt ${attempt + 1}/${delays.length} failed:`, lastError.message)
    }
  }

  throw lastError ?? new Error('CMS order persistence failed')
}

export async function reconcilePaidStripeOrders(params: {
  stripe: Stripe
  lookbackDays: number
  maxSessions?: number
  affiliateAttribution?: (session: Stripe.Checkout.Session, orderNumber: string) => Promise<void>
}): Promise<StripeOrderReconciliationResult> {
  const { stripe, lookbackDays, maxSessions = 1_000, affiliateAttribution } = params
  const createdAfter = Math.floor(Date.now() / 1000) - lookbackDays * 86_400
  const sessions = await stripe.checkout.sessions
    .list({ created: { gte: createdAfter }, limit: 100 })
    .autoPagingToArray({ limit: maxSessions })

  for (const session of sessions) {
    if (
      session.livemode
      && session.mode === 'payment'
      && session.payment_status === 'paid'
      && !isValidStorefrontOrderRef(session.metadata?.order_ref)
    ) {
      const paymentIntentId = typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id ?? null
      console.error('[stripe-reconcile] paid payment checkout quarantined', {
        stripeSessionId: session.id,
        paymentIntentId,
      })
    }
  }

  // Reconciliation must obey the same order_ref contract as the webhook. The
  // previous session-id fallback could turn unrelated paid Checkout sessions
  // into storefront orders.
  const eligible = sessions.filter((session) => (
    session.livemode
    && session.mode === 'payment'
    && session.payment_status === 'paid'
    && isValidStorefrontOrderRef(session.metadata?.order_ref)
  ))

  const result: StripeOrderReconciliationResult = {
    lookbackDays,
    sessionsScanned: sessions.length,
    eligiblePaidSessions: eligible.length,
    alreadyPresent: 0,
    recovered: [],
    errors: [],
  }

  for (const sessionSummary of eligible) {
    const orderRef = sessionSummary.metadata?.order_ref
    if (!isValidStorefrontOrderRef(orderRef)) continue
    try {
      // Retrieve the complete session before checking the order so attribution
      // can repair a missed ledger even when the order already exists.
      const session = await stripe.checkout.sessions.retrieve(sessionSummary.id)
      if (await findCmsOrder(orderRef)) {
        result.alreadyPresent += 1
      } else {
        const persistence = await createOrderInCMSWithRetry(session)
        if (persistence.created) {
          result.recovered.push({
            orderRef,
            stripeSessionId: session.id,
            amount: (session.amount_total ?? 0) / 100,
            currency: session.currency?.toUpperCase() ?? null,
          })
        } else {
          result.alreadyPresent += 1
        }
      }

      if (affiliateAttribution) await affiliateAttribution(session, orderRef)
    } catch (error) {
      result.errors.push({
        orderRef,
        stripeSessionId: sessionSummary.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return result
}
