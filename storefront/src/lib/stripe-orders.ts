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

  let parsedItems: ParsedItem[] = []
  try {
    parsedItems = JSON.parse(meta.items_json ?? '[]') as ParsedItem[]
  } catch {
    // Un ordine pagato deve comunque essere visibile anche con metadata
    // parzialmente corrotti; il riconciliatore lo segnalerà con righe vuote.
  }

  const itemsTotal = parsedItems.reduce((sum, item) => sum + item.price * item.qty, 0)
  const shippingCost = Math.max(0, Number((total - itemsTotal).toFixed(2)))

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
}): Promise<StripeOrderReconciliationResult> {
  const { stripe, lookbackDays, maxSessions = 1_000 } = params
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
      if (await findCmsOrder(orderRef)) {
        result.alreadyPresent += 1
        continue
      }

      // Recuperiamo la sessione completa: gli indirizzi nelle API Stripe
      // recenti vivono in collected_information e non sempre nella lista.
      const session = await stripe.checkout.sessions.retrieve(sessionSummary.id)
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
