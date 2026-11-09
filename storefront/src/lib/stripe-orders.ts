import Stripe from 'stripe'
import { countryToLocale } from '@/lib/resend'
import { ORDER_REF_PREFIX } from '@/lib/order-ref'

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

/**
 * Un pagamento che non dichiara `order_ref` e a cui nessun ordine corrisponde.
 *
 * PERCHE' ESISTE. Il codice vecchio, in questo caso, inventava
 * `FOOLISH-${session.id}`: un numero di ~74 caratteri che rompeva il deep link
 * Telegram (`order_` + numero oltre i 64 ammessi, parametro `start` scartato in
 * silenzio) e che non era ne' un riferimento legittimo ne' una traccia
 * dell'ordine. Adesso il caso si ferma: nessun ordine viene creato con un numero
 * inventato, l'errore ha un codice riconoscibile nei log e il webhook risponde
 * non-2xx (vedi `createOrderInCMSWithRetry`, che non ritenta un errore
 * deterministico).
 */
export class OrderReferenceUnresolvedError extends Error {
  readonly code = 'order_ref_unresolved' as const
  readonly stripeSessionId: string

  constructor(stripeSessionId: string) {
    super(
      `nessun order_ref nei metadata e nessun ordine per la sessione ${stripeSessionId}: `
      + 'ordine non creato (il numero d\'ordine non si inventa)',
    )
    this.name = 'OrderReferenceUnresolvedError'
    this.stripeSessionId = stripeSessionId
  }
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
    /** `null` quando la sessione non dichiara alcun numero d'ordine: non se ne inventa uno. */
    orderRef: string | null
    stripeSessionId: string
    error: string
  }>
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

/**
 * Il riferimento leggibile scritto dal checkout nei metadata.
 *
 * `null` quando manca o e' vuoto: NON si sostituisce con l'id di sessione. L'id
 * di sessione e' una chiave di risoluzione (`stripeSessionId` sull'ordine), non
 * un numero d'ordine: diventandolo produceva un riferimento inventato, troppo
 * lungo per il deep link Telegram e mai letto dal cliente.
 */
export function getSessionOrderRef(session: Stripe.Checkout.Session): string | null {
  const raw = session.metadata?.order_ref
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
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

/**
 * L'ordine di una Checkout Session, per id di sessione.
 *
 * E' la chiave che regge quando il metadata `order_ref` manca: il campo e'
 * unico sull'ordine, quindi webhook, retry Stripe e cron di riconciliazione
 * convergono sempre sullo stesso documento.
 */
export async function findCmsOrderBySessionId(stripeSessionId: string): Promise<CmsOrder | null> {
  const response = await fetch(
    `${cmsUrl()}/api/orders?where[stripeSessionId][equals]=${encodeURIComponent(stripeSessionId)}&limit=1&depth=0`,
    { headers: cmsHeaders(), cache: 'no-store' },
  )
  if (!response.ok) {
    throw new Error(`CMS order lookup by session failed ${response.status}: ${await response.text()}`)
  }
  const data = await response.json() as CmsFindResponse
  return data.docs?.[0] ?? null
}

/**
 * Ordini del flusso vecchio: quando il metadata `order_ref` mancava, il numero
 * salvato era `FOOLISH-<session.id>`. Si cercano per non lasciare irraggiungibile
 * un ordine gia' creato e pagato — ma non si creano piu' numeri cosi'.
 */
async function findLegacySessionOrder(stripeSessionId: string): Promise<CmsOrder | null> {
  return findCmsOrder(`${ORDER_REF_PREFIX}${stripeSessionId}`)
}

/**
 * Risolve l'ordine gia' esistente per questa sessione, senza inventare nulla.
 *
 * Ordine dei tentativi: il riferimento dichiarato dal checkout, poi la chiave di
 * sessione, poi il numero legacy `FOOLISH-<session.id>`. Ogni passaggio e' una
 * LETTURA: nessuno di questi percorsi crea un documento.
 */
async function findExistingOrderForSession(session: Stripe.Checkout.Session): Promise<CmsOrder | null> {
  const declared = getSessionOrderRef(session)
  if (declared) return findCmsOrder(declared)
  return (await findCmsOrderBySessionId(session.id)) ?? (await findLegacySessionOrder(session.id))
}

export async function createOrderInCMS(session: Stripe.Checkout.Session): Promise<OrderPersistenceResult> {
  const meta = session.metadata ?? {}
  const declaredOrderRef = getSessionOrderRef(session)
  const existing = await findExistingOrderForSession(session)
  if (existing) {
    return { orderRef: existing.orderNumber, created: false, orderId: existing.id }
  }
  if (!declaredOrderRef) {
    // Fail-closed: senza un riferimento leggibile non esiste un numero d'ordine
    // legittimo. Crearne uno dalla sessione significherebbe scrivere un documento
    // con un numero che il cliente non riconosce e che il bot non sa aprire.
    throw new OrderReferenceUnresolvedError(session.id)
  }
  const orderRef = declaredOrderRef

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
      // Chiave di risoluzione del pagamento: il webhook trova l'ordine da qui
      // quando il metadata `order_ref` manca, senza mai usare l'id di sessione
      // come numero d'ordine. Unica a livello di schema.
      stripeSessionId: session.id,
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
    // Webhook e cron possono correre insieme. A decidere il vincitore sono le due
    // chiavi uniche del CMS (`orderNumber` e `stripeSessionId`); se l'altro
    // processo ha creato l'ordine, è successo. Si rilegge per entrambe, perché un
    // retry dopo un timeout può arrivare quando il documento esiste gia'.
    const racedOrder = (await findCmsOrder(orderRef).catch(() => null))
      ?? (await findCmsOrderBySessionId(session.id).catch(() => null))
    if (racedOrder) {
      return { orderRef: racedOrder.orderNumber, created: false, orderId: racedOrder.id }
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
      // Un pagamento senza riferimento risolvibile non migliora ritentando: e'
      // deterministico (nessun metadata e nessun ordine per quella sessione).
      // Ritentarlo produrrebbe solo 17 secondi di attesa e lo stesso esito.
      if (error instanceof OrderReferenceUnresolvedError) throw error
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
    let orderRef: string | null = getSessionOrderRef(sessionSummary)
    try {
      // Retrieve the complete session before checking the order so attribution
      // can repair a missed ledger even when the order already exists.
      const session = await stripe.checkout.sessions.retrieve(sessionSummary.id)
      const declaredRef = getSessionOrderRef(session)
      const existing = declaredRef
        ? await findCmsOrder(declaredRef)
        : (await findCmsOrderBySessionId(session.id)) ?? (await findLegacySessionOrder(session.id))

      if (existing) {
        // Il numero buono e' quello del documento CMS, non quello sperato nei metadata.
        orderRef = existing.orderNumber
        result.alreadyPresent += 1
      } else if (!declaredRef) {
        // Fail-closed, come nel webhook: senza riferimento risolvibile non si crea
        // nulla e lo si segnala. La riga finisce in `errors`, quindi nell'allarme.
        result.errors.push({
          orderRef: null,
          stripeSessionId: session.id,
          error: new OrderReferenceUnresolvedError(session.id).message,
        })
        continue
      } else {
        const persistence = await createOrderInCMSWithRetry(session)
        orderRef = persistence.orderRef
        if (persistence.created) {
          result.recovered.push({
            orderRef: persistence.orderRef,
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
