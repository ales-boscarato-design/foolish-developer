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

const cmsUrl = () => process.env.PAYLOAD_PUBLIC_URL || 'https://cms-production-1e56.up.railway.app'
const cmsHeaders = () => ({
  'Content-Type': 'application/json',
  'x-storefront-secret': process.env.PAYLOAD_API_SECRET || '',
})

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Importo incassato per la spedizione, dichiarato dal checkout nella sessione
 * (`shipping_cost_cents`, in centesimi). `null` quando la chiave manca o non e' un
 * intero non negativo: sono le sessioni create prima di questo contratto, per le
 * quali resta il residuo `amount_total - righe prodotto`.
 */
export function parseDeclaredShippingCostCents(meta: Record<string, string>): number | null {
  const raw = meta.shipping_cost_cents
  if (typeof raw !== 'string' || !/^\d{1,9}$/.test(raw)) return null
  const cents = Number(raw)
  return Number.isSafeInteger(cents) ? cents : null
}

export function getStripeOrderRef(session: Stripe.Checkout.Session): string {
  return session.metadata?.order_ref ?? `FOOLISH-${session.id}`
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
    const parsed: unknown = JSON.parse(meta.items_json ?? '[]')
    // Un ordine pagato deve comunque essere visibile anche con metadata
    // parzialmente corrotti; il riconciliatore lo segnalerà con righe vuote. Anche
    // un `items_json` che è JSON valido ma non una lista deve finire qui e non far
    // fallire la create: le righe restano vuote e la spedizione arriva dalla chiave
    // dichiarata dal checkout.
    parsedItems = Array.isArray(parsed) ? (parsed as ParsedItem[]) : []
  } catch {
    // JSON non valido: stesso esito, righe vuote.
  }

  const itemsTotalCents = parsedItems.reduce(
    (sum, item) => sum + Math.round(item.price * 100) * item.qty,
    0,
  )
  // La spedizione registrata e' quella incassata davvero: il checkout la dichiara
  // nei metadata (`shipping_cost_cents`). Il residuo `amount_total - righe
  // prodotto` resta solo come ripiego per le sessioni create prima di questo
  // contratto; senza righe prodotto quel residuo e' l'intero totale, cioe' il
  // valore merce nel campo spedizione.
  const declaredShippingCents = parseDeclaredShippingCostCents(meta)
  const residualShippingCents = Math.max(0, (session.amount_total ?? 0) - itemsTotalCents)
  if (declaredShippingCents === null && parsedItems.length === 0) {
    console.error(
      `[stripe-order] ${orderRef}: nessuna riga prodotto nei metadata, la spedizione registrata e' un residuo non verificabile`,
    )
  } else if (declaredShippingCents !== null && declaredShippingCents !== residualShippingCents) {
    console.error(
      `[stripe-order] ${orderRef}: spedizione dichiarata ${declaredShippingCents} cent, residuo ${residualShippingCents} cent`,
    )
  }
  const shippingCost = Number(((declaredShippingCents ?? residualShippingCents) / 100).toFixed(2))

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

  // items_json identifica i checkout Storefront anche nell'eventualità che
  // order_ref sia assente; gli altri Checkout Stripe non vanno trasformati.
  const eligible = sessions.filter((session) => (
    session.livemode
    && session.mode === 'payment'
    && session.payment_status === 'paid'
    && Boolean(session.metadata?.order_ref || session.metadata?.items_json)
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
    const orderRef = getStripeOrderRef(sessionSummary)
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
