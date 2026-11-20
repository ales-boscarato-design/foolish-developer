/**
 * Test della rotta webhook Stripe, al confine HTTP.
 *
 * PERCHE' ESISTE. La rotta e' il punto in cui un pagamento riuscito diventa (o
 * non diventa) un ordine. Il caso che questo test copre non si vede dai test
 * degli helper: un pagamento consegnato SENZA `order_ref` nei metadata.
 *
 * - Se l'ordine esiste gia' (chiave `stripeSessionId`, oppure numero legacy
 *   `FOOLISH-<session.id>`), la rotta lo risolve e risponde 200 senza scrivere.
 * - Se non esiste, la rotta NON crea un ordine con un numero inventato: risponde
 *   503 con un codice riconoscibile, e il log lo dice a chiare lettere. Una
 *   quarantena silenziosa con 200 farebbe perdere l'ordine per sempre.
 *
 * Il CMS e' uno stub HTTP vero (porta effimera), non un mock di funzione: la
 * forma serializzata delle query (`where[stripeSessionId][equals]`) e' parte del
 * contratto e un mock non la verificherebbe.
 */

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, beforeEach, test } from 'node:test'
import Stripe from 'stripe'
import { NextRequest } from 'next/server'

const WEBHOOK_SECRET = 'whsec_test_webhook_secret'
const STOREFRONT_SECRET = 'test-storefront-secret'
const RESOLVED_ORDER_NUMBER = 'FOOLISH-0123456789abcdef0123456789abcdef'

process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy_key_for_route_tests'
process.env.PAYLOAD_API_SECRET = STOREFRONT_SECRET
// Porta chiusa: le scritture marketing (che vivono fuori dal perimetro ordine e
// sono in try/catch) devono fallire subito, non restare appese.
process.env.DATABASE_URL = 'postgres://test:test@127.0.0.1:1/foolish_test'
delete process.env.NANOBOT_WEBHOOK_URL

import { POST } from './route'

type CmsQuery = 'session' | 'order' | 'other'

interface CmsState {
  posts: Array<Record<string, unknown>>
  queries: string[]
  refundTransitions: Array<Record<string, unknown>>
  refundEndpointStatus: 'updated' | 'missing' | 'stale'
  /**
   * Esito dell'endpoint affiliate apply-refund-transition. `missing` e' il caso
   * permanente (marker scritto al checkout, conversione mai creata); `error`
   * copre un guasto transitorio del ledger.
   */
  affiliateRefundEndpoint: 'updated' | 'missing' | 'error'
  affiliateRefundRequests: Array<Record<string, unknown>>
  /** Numero d'ordine da restituire per la chiave di sessione, se presente. */
  bySession: string | null
  /** Numero d'ordine da restituire per la ricerca per numero, se presente. */
  byOrderNumber: string | null
  /** Record di abbonamento restituito dalla ricerca per `stripeSubscriptionId`. */
  subscription: Record<string, unknown> | null
  /** Patch inviate a `/api/subscriptions/<id>` (avanzamento di `cyclesCompleted`). */
  subscriptionPatches: Array<Record<string, unknown>>
}

const state: CmsState = {
  posts: [],
  queries: [],
  refundTransitions: [],
  refundEndpointStatus: 'updated',
  affiliateRefundEndpoint: 'updated',
  affiliateRefundRequests: [],
  bySession: null,
  byOrderNumber: null,
  subscription: null,
  subscriptionPatches: [],
}

let server: ReturnType<typeof createServer>
let baseUrl = ''

function classify(url: URL): CmsQuery {
  if (url.searchParams.get('where[stripeSessionId][equals]')) return 'session'
  if (url.searchParams.get('where[orderNumber][equals]')) return 'order'
  return 'other'
}

before(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }

    if (req.method === 'POST' && url.pathname === '/api/orders') {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
        state.posts.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>)
        json(201, { id: 1234, orderNumber: 'NON-DOVUTO' })
      })
      return
    }

    if (req.method === 'POST' && url.pathname === '/api/orders/apply-refund-transition') {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
        state.refundTransitions.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>)
        json(200, { status: state.refundEndpointStatus })
      })
      return
    }

    if (req.method === 'POST' && url.pathname === '/api/affiliate-conversions/apply-refund-transition') {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
        state.affiliateRefundRequests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>)
        if (state.affiliateRefundEndpoint === 'missing') return json(200, { status: 'missing' })
        if (state.affiliateRefundEndpoint === 'error') return json(500, { error: 'affiliate ledger unavailable' })
        return json(200, { status: 'updated' })
      })
      return
    }

    if (req.method === 'GET' && url.pathname === '/api/orders') {
      const kind = classify(url)
      state.queries.push(kind)
      const session = url.searchParams.get('where[stripeSessionId][equals]')
      const orderNumber = url.searchParams.get('where[orderNumber][equals]')
      const match = (kind === 'session' && state.bySession && session === 'cs_test_webhook_session')
        || (kind === 'order' && state.byOrderNumber && orderNumber === state.byOrderNumber)
      return json(200, {
        docs: match ? [{ id: 4321, orderNumber: state.bySession ?? state.byOrderNumber }] : [],
      })
    }

    // Ricerca dell'abbonamento (ramo `invoice.paid`) e avanzamento del contatore.
    if (req.method === 'GET' && url.pathname === '/api/subscriptions') {
      return json(200, { docs: state.subscription ? [state.subscription] : [] })
    }

    if (req.method === 'PATCH' && url.pathname.startsWith('/api/subscriptions/')) {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
        state.subscriptionPatches.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>)
        json(200, { doc: state.subscription ?? {} })
      })
      return
    }

    // Tutte le altre letture (affiliati, offer-config, clienti) non riguardano
    // questo test: una collezione vuota e' una risposta valida.
    return json(200, { docs: [], totalDocs: 0 })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${port}`
  process.env.PAYLOAD_PUBLIC_URL = baseUrl
})

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

beforeEach(() => {
  state.posts = []
  state.queries = []
  state.refundTransitions = []
  state.refundEndpointStatus = 'updated'
  state.affiliateRefundEndpoint = 'updated'
  state.affiliateRefundRequests = []
  state.bySession = null
  state.byOrderNumber = null
  state.subscription = null
  state.subscriptionPatches = []
})

function sessionEvent(overrides: Partial<Stripe.Checkout.Session> = {}): {
  payload: string
  signature: string
} {
  const session = {
    id: 'cs_test_webhook_session',
    object: 'checkout.session',
    livemode: false,
    mode: 'payment',
    payment_status: 'paid',
    payment_intent: 'pi_test_webhook',
    amount_total: 3_500,
    currency: 'eur',
    customer_email: 'webhook-test@example.invalid',
    customer_details: null,
    collected_information: null,
    // Nessun `order_ref`: e' esattamente il caso in esame.
    metadata: { items_json: '[]', customer_name: 'Webhook Test', customer_country: 'IT' },
    ...overrides,
  }
  const payload = JSON.stringify({
    id: 'evt_test_webhook',
    object: 'event',
    api_version: '2025-01-27.acacia',
    created: 1_700_000_000,
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type: 'checkout.session.completed',
    data: { object: session },
  })
  return {
    payload,
    signature: Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET }),
  }
}

function webhookRequest(payload: string, signature: string): NextRequest {
  return new NextRequest('http://localhost/api/webhook/stripe', {
    method: 'POST',
    body: payload,
    headers: { 'stripe-signature': signature },
  })
}

function refundEvent(charge: Partial<Stripe.Charge> = {}): { payload: string; signature: string } {
  const object = {
    id: 'ch_test_refund', object: 'charge', payment_intent: 'pi_test_refund', amount: 10_000,
    amount_refunded: 10_000, currency: 'eur', refunded: true, metadata: {}, ...charge,
  }
  const payload = JSON.stringify({
    id: 'evt_test_charge_refunded', object: 'event', api_version: '2025-01-27.acacia',
    created: 1_700_000_123, livemode: false, pending_webhooks: 1,
    request: { id: null, idempotency_key: null }, type: 'charge.refunded', data: { object },
  })
  return { payload, signature: Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET }) }
}

/** Raccoglie stderr/stdout del handler per poterli asserire. */
async function captureLogs<T>(run: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = []
  const originalError = console.error
  const originalLog = console.log
  const originalWarn = console.warn
  console.error = (...args: unknown[]) => { lines.push(args.map(String).join(' ')) }
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')) }
  console.warn = (...args: unknown[]) => { lines.push(args.map(String).join(' ')) }
  try {
    const result = await run()
    return { result, lines }
  } finally {
    console.error = originalError
    console.log = originalLog
    console.warn = originalWarn
  }
}

test('senza order_ref ma con la sessione registrata: risolve l ordine e risponde 200 senza scrivere', async () => {
  state.bySession = RESOLVED_ORDER_NUMBER

  const { payload, signature } = sessionEvent()
  const { result, lines } = await captureLogs(() => POST(webhookRequest(payload, signature)))

  assert.equal(result.status, 200)
  assert.equal(state.posts.length, 0, 'nessun ordine creato: quello giusto esiste già')

  const logged = lines.join('\n')
  assert.match(logged, new RegExp(`CMS order created OK ${RESOLVED_ORDER_NUMBER}`))
  assert.equal(
    logged.includes(`FOOLISH-cs_test_webhook_session`),
    false,
    'il log non deve nominare un numero d’ordine inventato dalla sessione',
  )
})

test('senza order_ref e senza ordine: 503 con codice esplicito, nessun ordine, log riconoscibile', async () => {
  const { payload, signature } = sessionEvent()
  const { result, lines } = await captureLogs(() => POST(webhookRequest(payload, signature)))

  assert.equal(result.status, 503, 'un 200 segnerebbe l’evento come consegnato e l’ordine andrebbe perso')

  const body = await result.json() as Record<string, unknown>
  assert.equal(body.error, 'order_reference_unresolved')
  assert.equal(body.code, 'order_ref_unresolved')
  assert.equal(body.stripeSessionId, 'cs_test_webhook_session')

  assert.equal(state.posts.length, 0, 'nessun ordine creato con un numero inventato')
  const logged = lines.join('\n')
  assert.match(logged, /ORDER REF UNRESOLVED/)
  assert.match(logged, /code=order_ref_unresolved/)
})

test('un ordine legacy FOOLISH-cs_live_... resta raggiungibile anche dal webhook', async () => {
  state.byOrderNumber = 'FOOLISH-cs_test_webhook_session'

  const { payload, signature } = sessionEvent()
  const { result, lines } = await captureLogs(() => POST(webhookRequest(payload, signature)))

  assert.equal(result.status, 200)
  assert.equal(state.posts.length, 0)
  assert.deepEqual(state.queries, ['session', 'order'], 'prima la sessione, poi il numero legacy')
  assert.match(lines.join('\n'), /CMS order created OK FOOLISH-cs_test_webhook_session/)
})

test('con order_ref nei metadata l ordine nuovo si crea con numero e chiave di sessione', async () => {
  const orderRef = 'FOOLISH-0123456789abcdef0123456789abcdef'

  const { payload, signature } = sessionEvent({
    metadata: {
      order_ref: orderRef,
      items_json: '[]',
      customer_name: 'Webhook Test',
      customer_country: 'IT',
    },
  })
  const { result, lines } = await captureLogs(() => POST(webhookRequest(payload, signature)))

  assert.equal(result.status, 200)
  assert.equal(state.posts.length, 1, 'un ordine pagato deve nascere')
  const persisted = state.posts[0]!
  assert.equal(persisted.orderNumber, orderRef)
  assert.equal(persisted.stripeSessionId, 'cs_test_webhook_session')
  assert.match(lines.join('\n'), new RegExp(`CMS order created OK ${orderRef}`))
})

test('charge.refunded senza marker aggiorna l’ordine con lo stato cumulativo letto da Stripe', async () => {
  const ChargeResource = Stripe.resources.Charges
  const originalRetrieve = ChargeResource.prototype.retrieve
  ChargeResource.prototype.retrieve = (async () => ({
    id: 'ch_test_refund', object: 'charge', payment_intent: 'pi_test_refund', amount: 10_000,
    amount_refunded: 10_000, currency: 'eur', refunded: true, metadata: {},
    refunds: { data: [{ created: 1_700_000_120 }], has_more: false, object: 'list', url: '' },
  })) as unknown as typeof ChargeResource.prototype.retrieve
  try {
    const { payload, signature } = refundEvent()
    const response = await POST(webhookRequest(payload, signature))
    assert.equal(response.status, 200)
    assert.deepEqual(state.refundTransitions, [{
      stripePaymentIntentId: 'pi_test_refund', chargeAmountCents: 10_000, amountRefundedCents: 10_000,
      lastRefundedAt: new Date(1_700_000_120 * 1000).toISOString(),
    }])
  } finally {
    ChargeResource.prototype.retrieve = originalRetrieve
  }
})

async function submitRefundWithStripeCharge(charge: Record<string, unknown>) {
  const ChargeResource = Stripe.resources.Charges
  const originalRetrieve = ChargeResource.prototype.retrieve
  ChargeResource.prototype.retrieve = (async () => charge) as unknown as typeof ChargeResource.prototype.retrieve
  try {
    const { payload, signature } = refundEvent()
    return await POST(webhookRequest(payload, signature))
  } finally {
    ChargeResource.prototype.retrieve = originalRetrieve
  }
}

test('charge.refunded parziale salva i centesimi cumulativi, non il solo refund corrente', async () => {
  const response = await submitRefundWithStripeCharge({
    id: 'ch_test_refund', object: 'charge', payment_intent: 'pi_test_refund', amount: 10_000,
    amount_refunded: 2_500, currency: 'eur', refunded: false, metadata: {},
    refunds: { data: [{ created: 1_700_000_120 }], has_more: false, object: 'list', url: '' },
  })
  assert.equal(response.status, 200)
  assert.equal(state.refundTransitions[0]?.amountRefundedCents, 2_500)
  assert.equal(state.refundTransitions[0]?.chargeAmountCents, 10_000)
})

test('ordine mancante resta retryable con 503', async () => {
  state.refundEndpointStatus = 'missing'
  const response = await submitRefundWithStripeCharge({
    id: 'ch_test_refund', object: 'charge', payment_intent: 'pi_test_refund', amount: 10_000,
    amount_refunded: 10_000, currency: 'eur', refunded: true, metadata: {}, refunds: { data: [], has_more: false, object: 'list', url: '' },
  })
  assert.equal(response.status, 503)
})

test('il ramo affiliate aggiorna ledger e ordine nello stesso retry Stripe', async () => {
  const response = await submitRefundWithStripeCharge({
    id: 'ch_test_refund', object: 'charge', payment_intent: 'pi_test_refund', amount: 10_000,
    amount_refunded: 10_000, currency: 'eur', refunded: true,
    metadata: { affiliate_promo_code: 'NESTOR' },
    refunds: { data: [{ created: 1_700_000_120 }], has_more: false, object: 'list', url: '' },
  })
  assert.equal(response.status, 200)
  assert.equal(state.refundTransitions.length, 1)
})

test('il replay o uno snapshot cumulativo fuori ordine non forza una risposta retryable', async () => {
  state.refundEndpointStatus = 'stale'
  const response = await submitRefundWithStripeCharge({
    id: 'ch_test_refund', object: 'charge', payment_intent: 'pi_test_refund', amount: 10_000,
    amount_refunded: 2_500, currency: 'eur', refunded: false, metadata: {}, refunds: { data: [], has_more: false, object: 'list', url: '' },
  })
  assert.equal(response.status, 200)
})

test('charge senza refunds completi non inventa lastRefundedAt da event.created', async () => {
  const response = await submitRefundWithStripeCharge({
    id: 'ch_test_refund', object: 'charge', payment_intent: 'pi_test_refund', amount: 10_000,
    amount_refunded: 2_500, currency: 'eur', refunded: false, metadata: {},
    refunds: { data: [], has_more: true, object: 'list', url: '' },
  })
  assert.equal(response.status, 200)
  assert.equal('lastRefundedAt' in (state.refundTransitions[0] ?? {}), false)
})

test('rifare la stessa fotografia cumulativa può completare una data mancante senza arretrare importo', async () => {
  const originalFetch = globalThis.fetch
  const requests: Array<Record<string, unknown>> = []
  let transitionNumber = 0
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/api/orders/apply-refund-transition')) {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      transitionNumber += 1
      return Response.json({ status: transitionNumber === 1 ? 'updated' : 'updated' })
    }
    return originalFetch(input, init)
  }) as typeof globalThis.fetch
  try {
    const first = await submitRefundWithStripeCharge({
      id: 'ch_test_refund', object: 'charge', payment_intent: 'pi_test_refund', amount: 10_000,
      amount_refunded: 2_500, currency: 'eur', refunded: false, metadata: {},
      refunds: { data: [], has_more: true, object: 'list', url: '' },
    })
    const second = await submitRefundWithStripeCharge({
      id: 'ch_test_refund', object: 'charge', payment_intent: 'pi_test_refund', amount: 10_000,
      amount_refunded: 2_500, currency: 'eur', refunded: false, metadata: {},
      refunds: { data: [{ created: 1_700_000_120 }], has_more: false, object: 'list', url: '' },
    })
    assert.equal(first.status, 200)
    assert.equal(second.status, 200)
    assert.equal('lastRefundedAt' in requests[0]!, false)
    assert.equal(requests[1]?.lastRefundedAt, new Date(1_700_000_120 * 1000).toISOString())
  } finally {
    globalThis.fetch = originalFetch
  }
})

/**
 * DIFETTO STORICO (rosso prima della correzione): il ramo charge.refunded
 * aggiornava il ledger affiliate PRIMA dello snapshot ordine. Con marker
 * affiliate e conversione assente (`missing`, permanente) la rotta usciva 503
 * senza mai scrivere il rimborso sull'ordine. Questi test fissano l'ordine
 * delle due scritture e la ritentabilita' del retry.
 */
function refundedAffiliateCharge(): Record<string, unknown> {
  return {
    id: 'ch_test_refund', object: 'charge', payment_intent: 'pi_test_refund', amount: 10_000,
    amount_refunded: 10_000, currency: 'eur', refunded: true,
    metadata: { affiliate_promo_code: 'NESTOR' },
    refunds: { data: [{ created: 1_700_000_120 }], has_more: false, object: 'list', url: '' },
  }
}

test('marker affiliate con conversione mancante: la transizione ordine parte comunque e la risposta resta 503', async () => {
  state.affiliateRefundEndpoint = 'missing'

  const response = await submitRefundWithStripeCharge(refundedAffiliateCharge())

  assert.equal(
    state.refundTransitions.length,
    1,
    'lo snapshot cumulativo dell ordine non dipende dal ledger e deve essere scritto prima',
  )
  assert.deepEqual(state.refundTransitions[0], {
    stripePaymentIntentId: 'pi_test_refund',
    chargeAmountCents: 10_000,
    amountRefundedCents: 10_000,
    lastRefundedAt: new Date(1_700_000_120 * 1000).toISOString(),
  })
  assert.equal(response.status, 503, 'la conversione mancante resta ritentabile per Stripe')
})

test('marker affiliate con ledger in errore: la transizione ordine parte comunque e la risposta resta 503', async () => {
  state.affiliateRefundEndpoint = 'error'

  const response = await submitRefundWithStripeCharge(refundedAffiliateCharge())

  assert.equal(
    state.refundTransitions.length,
    1,
    'un guasto del ledger non deve impedire la scrittura dell ordine',
  )
  assert.equal(response.status, 503, 'il guasto del ledger resta ritentabile per Stripe')
})

test('il retry con ledger in errore resta 503 e riscrive lo stesso snapshot ordine, senza duplicare altro', async () => {
  state.affiliateRefundEndpoint = 'error'

  const first = await submitRefundWithStripeCharge(refundedAffiliateCharge())
  const second = await submitRefundWithStripeCharge(refundedAffiliateCharge())

  assert.equal(first.status, 503)
  assert.equal(second.status, 503)
  assert.equal(
    state.refundTransitions.length,
    2,
    'ogni consegna ritenta la stessa fotografia cumulativa',
  )
  assert.deepEqual(
    state.refundTransitions[0],
    state.refundTransitions[1],
    'la transizione ordine e idempotente/stale: il retry non produce uno stato diverso',
  )
  assert.equal(state.posts.length, 0, 'il ramo refund non crea ordini')
})

/*
 * RINNOVI SENZA PAYMENTINTENT (card t_e1223d64).
 *
 * `stripePaymentIntentId` puo' essere scritto sull'ordine di rinnovo solo se
 * `invoice.payments` e' completo e contiene esattamente un pagamento pagato di
 * tipo `payment_intent`. Negli altri casi l'ordine nasceva senza id e senza
 * nessun segnale: quel rinnovo non e' piu' raggiungibile da un rimborso
 * (`apply-refund-transition` risponde `missing` → 503 a ogni consegna).
 *
 * MISURATO IN PRODUZIONE (sola lettura, 20/11/2026): su un'invoice di
 * subscription pagata, il campo `payments` NON e' presente ne' nell'evento ne'
 * in `invoices.retrieve` senza expand; compare solo con `expand[]=payments`.
 * Per questo la fixture del primo test non ha `payments`: e' la forma vera, non
 * un caso di scuola.
 *
 * Questi test passano dalla rotta vera (`POST`) con eventi firmati: asseriscono
 * l'ordine creato nel CMS (stub HTTP) e la riga JSON emessa UNA volta sola.
 */
const RENEWAL_SUBSCRIPTION_ID = 'sub_test_renewal'
const RENEWAL_INVOICE_ID = 'in_test_renewal'
const RENEWAL_ORDER_REF = `FOOLISH-SUB-${RENEWAL_SUBSCRIPTION_ID}-${RENEWAL_INVOICE_ID}`
const RENEWAL_PAYMENT_INTENT = 'pi_test_renewal'

function renewalSubscription(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '77',
    customerEmail: 'renewal-test@example.invalid',
    plan: 'tattoo',
    zone: 'IT',
    stripeSubscriptionId: RENEWAL_SUBSCRIPTION_ID,
    stripeScheduleId: 'sub_sched_test',
    status: 'active',
    cyclesCompleted: 0,
    ...overrides,
  }
}

function invoicePaidEvent(invoiceOverrides: Record<string, unknown> = {}): { payload: string; signature: string } {
  const invoice = {
    id: RENEWAL_INVOICE_ID,
    object: 'invoice',
    status: 'paid',
    parent: {
      type: 'subscription_details',
      subscription_details: { subscription: RENEWAL_SUBSCRIPTION_ID },
    },
    customer_shipping: {
      name: 'Renewal Test',
      address: {
        line1: 'Via Test 1',
        line2: null,
        city: 'Milano',
        postal_code: '20100',
        country: 'IT',
      },
    },
    ...invoiceOverrides,
  }
  const payload = JSON.stringify({
    id: 'evt_test_invoice_paid',
    object: 'event',
    api_version: '2026-04-22.dahlia',
    created: 1_700_000_500,
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type: 'invoice.paid',
    data: { object: invoice },
  })
  return { payload, signature: Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET }) }
}

/** Righe JSON del segnale, parse come le leggerebbe un raccoglitore di log. */
function renewalSignals(lines: string[]): Array<Record<string, unknown>> {
  const signals: Array<Record<string, unknown>> = []
  for (const line of lines) {
    if (!line.startsWith('{')) continue
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>
      if (parsed.event === 'renewal_order_without_payment_intent') signals.push(parsed)
    } catch {
      // una riga non-JSON e' rumore: non e' il segnale in esame
    }
  }
  return signals
}

async function submitInvoicePaid(invoiceOverrides: Record<string, unknown> = {}) {
  state.subscription = renewalSubscription()
  const { payload, signature } = invoicePaidEvent(invoiceOverrides)
  return await captureLogs(() => POST(webhookRequest(payload, signature)))
}

test('invoice.paid senza `payments`: l ordine nasce senza PaymentIntent e il segnale dice payments_absent', async () => {
  const { result, lines } = await submitInvoicePaid()

  assert.equal(result.status, 200)
  assert.equal(state.posts.length, 1, 'il rinnovo pagato deve comunque creare l ordine')
  const order = state.posts[0]!
  assert.equal(order.orderNumber, RENEWAL_ORDER_REF)
  assert.equal(
    'stripePaymentIntentId' in order,
    false,
    'senza lista pagamenti non si inventa un PaymentIntent',
  )

  const signals = renewalSignals(lines)
  assert.equal(signals.length, 1, 'una sola riga per rinnovo: il caso deve essere contabile, non ripetuto')
  assert.deepEqual(signals[0], {
    event: 'renewal_order_without_payment_intent',
    orderRef: RENEWAL_ORDER_REF,
    reason: 'payments_absent',
  })
  const logged = lines.join('\n')
  assert.equal(
    logged.includes('renewal-test@example.invalid'),
    false,
    'il segnale non deve portare dati cliente',
  )
})

test('invoice.paid con lista paginata (`has_more: true`): segnale payments_paginated, una volta', async () => {
  const { result, lines } = await submitInvoicePaid({
    payments: {
      has_more: true,
      data: [{ status: 'paid', payment: { type: 'payment_intent', payment_intent: RENEWAL_PAYMENT_INTENT } }],
    },
  })

  assert.equal(result.status, 200)
  assert.equal(state.posts.length, 1)
  assert.equal(
    'stripePaymentIntentId' in state.posts[0]!,
    false,
    'con la lista troncata il pagamento puo essere oltre la prima pagina: non si sceglie il primo',
  )

  const signals = renewalSignals(lines)
  assert.equal(signals.length, 1)
  assert.equal(signals[0]?.reason, 'payments_paginated')
  assert.equal(signals[0]?.orderRef, RENEWAL_ORDER_REF)
})

test('invoice.paid con due pagamenti pagati: segnale payments_ambiguous, una volta', async () => {
  const { result, lines } = await submitInvoicePaid({
    payments: {
      has_more: false,
      data: [
        { status: 'paid', payment: { type: 'payment_intent', payment_intent: 'pi_test_renewal_a' } },
        { status: 'paid', payment: { type: 'payment_intent', payment_intent: 'pi_test_renewal_b' } },
      ],
    },
  })

  assert.equal(result.status, 200)
  assert.equal(state.posts.length, 1)
  assert.equal('stripePaymentIntentId' in state.posts[0]!, false, 'fra due pagamenti non si indovina')

  const signals = renewalSignals(lines)
  assert.equal(signals.length, 1)
  assert.equal(signals[0]?.reason, 'payments_ambiguous')
})

test('invoice.paid con lista completa ma senza PaymentIntent pagato: payments_ambiguous, non silenzio', async () => {
  const { result, lines } = await submitInvoicePaid({
    payments: {
      has_more: false,
      data: [
        { status: 'paid', payment: { type: 'charge', charge: 'ch_test_renewal' } },
        { status: 'failed', payment: { type: 'payment_intent', payment_intent: RENEWAL_PAYMENT_INTENT } },
      ],
    },
  })

  assert.equal(result.status, 200)
  assert.equal('stripePaymentIntentId' in state.posts[0]!, false)
  const signals = renewalSignals(lines)
  assert.equal(signals.length, 1)
  assert.equal(signals[0]?.reason, 'payments_ambiguous')
})

test('controllo: con un solo pagamento pagato l ordine porta il PaymentIntent e NON emette il segnale', async () => {
  const { result, lines } = await submitInvoicePaid({
    payments: {
      has_more: false,
      data: [{ status: 'paid', payment: { type: 'payment_intent', payment_intent: RENEWAL_PAYMENT_INTENT } }],
    },
  })

  assert.equal(result.status, 200)
  assert.equal(state.posts.length, 1, 'un rinnovo pagato crea l ordine')
  assert.equal(
    state.posts[0]!.stripePaymentIntentId,
    RENEWAL_PAYMENT_INTENT,
    'con la lista completa e un solo pagamento l id deve finire sull ordine',
  )
  assert.deepEqual(renewalSignals(lines), [], 'nessun segnale quando il PaymentIntent c e')
})
