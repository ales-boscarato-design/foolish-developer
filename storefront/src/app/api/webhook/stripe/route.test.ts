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
  /** Valori del filtro `where[stripeSubscriptionId][equals]` ricevuti dallo stub. */
  subscriptionQueries: string[]
  /** Patch inviate a `/api/subscriptions/<id>` (avanzamento di `cyclesCompleted`). */
  subscriptionPatches: Array<Record<string, unknown>>
  /** Id su cui lo stub ha ricevuto una PATCH in `/api/subscriptions/<id>`. */
  subscriptionPatchIds: string[]
  /** Status della creazione ordine (per provare il percorso di creazione fallita). */
  orderPostStatus: number
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
  subscriptionQueries: [],
  subscriptionPatches: [],
  subscriptionPatchIds: [],
  orderPostStatus: 201,
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
        if (state.orderPostStatus >= 400) return json(state.orderPostStatus, { error: 'ordine rifiutato' })
        json(state.orderPostStatus, { id: 1234, orderNumber: 'NON-DOVUTO' })
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
    // Lo stub rispetta il filtro serializzato: se la rotta cerca con la chiave
    // sbagliata non trova nulla (e il test lo vede), come in produzione.
    if (req.method === 'GET' && url.pathname === '/api/subscriptions') {
      const wanted = url.searchParams.get('where[stripeSubscriptionId][equals]')
      state.subscriptionQueries.push(wanted ?? '')
      const match = state.subscription !== null && wanted !== null
        && wanted === state.subscription.stripeSubscriptionId
      return json(200, { docs: match ? [state.subscription] : [] })
    }

    if (req.method === 'PATCH' && url.pathname.startsWith('/api/subscriptions/')) {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
        state.subscriptionPatchIds.push(url.pathname.slice('/api/subscriptions/'.length))
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
  state.subscriptionQueries = []
  state.subscriptionPatches = []
  state.subscriptionPatchIds = []
  state.orderPostStatus = 201
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

/**
 * Esito della lettura `invoices.retrieve(id, { expand: ['payments'] })` che la
 * rotta fa nel solo ramo «pagamenti mancanti». `ok` senza `payments` riproduce
 * la forma misurata di un'API che risponde ma non porta la lista.
 */
type InvoiceRetrieveOutcome =
  | { status: 'ok'; payments?: unknown }
  | { status: 'error' }

interface InvoiceRetrieveCall {
  id: string
  params?: Record<string, unknown>
}

async function submitInvoicePaid(
  invoiceOverrides: Record<string, unknown> = {},
  expanded: InvoiceRetrieveOutcome = { status: 'ok' },
) {
  state.subscription = renewalSubscription()
  const { payload, signature } = invoicePaidEvent(invoiceOverrides)
  const invoiceCalls: InvoiceRetrieveCall[] = []
  const Invoices = Stripe.resources.Invoices
  const originalRetrieve = Invoices.prototype.retrieve
  Invoices.prototype.retrieve = (async (id: string, params?: Record<string, unknown>) => {
    invoiceCalls.push({ id, params })
    if (expanded.status === 'error') {
      // Forma di un guasto di trasporto dell'SDK: la rotta deve trattarlo come
      // ritentabile e NON creare l'ordine.
      throw Object.assign(new Error('Stripe connection error'), { type: 'StripeConnectionError' })
    }
    return { id, object: 'invoice', payments: expanded.payments }
  }) as unknown as typeof Invoices.prototype.retrieve
  try {
    const captured = await captureLogs(() => POST(webhookRequest(payload, signature)))
    return { ...captured, invoiceCalls }
  } finally {
    Invoices.prototype.retrieve = originalRetrieve
  }
}

test('invoice.paid senza `payments` e expand senza lista: l ordine nasce senza PaymentIntent e il segnale dice payments_absent', async () => {
  const { result, lines, invoiceCalls } = await submitInvoicePaid()

  assert.equal(result.status, 200)
  assert.equal(state.posts.length, 1, 'il rinnovo pagato deve comunque creare l ordine')
  const order = state.posts[0]!
  assert.equal(order.orderNumber, RENEWAL_ORDER_REF)
  assert.deepEqual(
    invoiceCalls,
    [{ id: RENEWAL_INVOICE_ID, params: { expand: ['payments'] } }],
    'una sola lettura, con l expand misurato e sulla stessa invoice dell evento',
  )
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
  assert.deepEqual(
    state.subscriptionPatches,
    [{ cyclesCompleted: 1 }],
    'il contatore avanza una volta sola, e solo dopo la creazione riuscita dell ordine',
  )
  assert.deepEqual(
    state.subscriptionQueries,
    [RENEWAL_SUBSCRIPTION_ID],
    'la ricerca dell abbonamento usa la chiave serializzata vera, non una qualunque',
  )
  assert.deepEqual(state.subscriptionPatchIds, ['77'], 'il contatore si aggiorna sul record trovato')
  const logged = lines.join('\n')
  assert.equal(
    logged.includes('renewal-test@example.invalid'),
    false,
    'il segnale non deve portare dati cliente',
  )
})

test('invoice.paid con lista paginata: l expand la completa e l id finisce sull ordine', async () => {
  // Il caso che la decisione (default, 20/11) copre: la lista troncata
  // dell'evento non basta, la stessa invoice riletta con expand si'.
  const { result, lines, invoiceCalls } = await submitInvoicePaid(
    {
      payments: {
        has_more: true,
        data: [{ status: 'paid', payment: { type: 'payment_intent', payment_intent: RENEWAL_PAYMENT_INTENT } }],
      },
    },
    {
      status: 'ok',
      payments: {
        has_more: false,
        data: [{ status: 'paid', payment: { type: 'payment_intent', payment_intent: RENEWAL_PAYMENT_INTENT } }],
      },
    },
  )

  assert.equal(result.status, 200)
  assert.equal(state.posts.length, 1)
  assert.equal(
    state.posts[0]!.stripePaymentIntentId,
    RENEWAL_PAYMENT_INTENT,
    'la lista completa letta con expand e la fonte dell id',
  )
  assert.deepEqual(
    invoiceCalls,
    [{ id: RENEWAL_INVOICE_ID, params: { expand: ['payments'] } }],
    'l expand si chiede una volta sola',
  )
  assert.deepEqual(renewalSignals(lines), [], 'con l id risolto non c e nulla da segnalare')
})

test('invoice.paid con lista paginata che resta tale dopo l expand: segnale payments_paginated', async () => {
  const { result, lines, invoiceCalls } = await submitInvoicePaid(
    {
      payments: {
        has_more: true,
        data: [{ status: 'paid', payment: { type: 'payment_intent', payment_intent: RENEWAL_PAYMENT_INTENT } }],
      },
    },
    {
      status: 'ok',
      payments: {
        has_more: true,
        data: [{ status: 'paid', payment: { type: 'payment_intent', payment_intent: RENEWAL_PAYMENT_INTENT } }],
      },
    },
  )

  assert.equal(result.status, 200)
  assert.equal(state.posts.length, 1)
  assert.equal(
    'stripePaymentIntentId' in state.posts[0]!,
    false,
    'se anche la lettura espansa e troncata il pagamento puo essere oltre la prima pagina: non si sceglie il primo',
  )
  assert.equal(invoiceCalls.length, 1, 'una sola lettura: non si insiste')

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
  const { result, lines, invoiceCalls } = await submitInvoicePaid({
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
  assert.deepEqual(
    invoiceCalls,
    [],
    'sul percorso normale non si fa nessuna lettura Stripe in piu: l expand scatta solo quando la lista manca',
  )
})

test('controllo: un id che non e un PaymentIntent valido non finisce sull ordine e produce il segnale', async () => {
  const { result, lines } = await submitInvoicePaid({
    payments: {
      has_more: false,
      data: [{ status: 'paid', payment: { type: 'payment_intent', payment_intent: 'pi_bad-id!' } }],
    },
  })

  assert.equal(result.status, 200)
  assert.equal(
    'stripePaymentIntentId' in state.posts[0]!,
    false,
    'un id che non rispetta il formato pi_… non va scritto sul CMS: il rimborso non lo troverebbe comunque',
  )
  const signals = renewalSignals(lines)
  assert.equal(signals.length, 1)
  assert.equal(signals[0]?.reason, 'payments_ambiguous')
})

test('redelivery dello stesso invoice con l ordine gia creato: nessun secondo ordine, nessun secondo segnale', async () => {
  // L'ordine esiste gia': la ricerca per numero d'ordine lo trova e la rotta
  // esce prima di creare (idempotenza su `invoice.id`).
  state.subscription = renewalSubscription()
  state.byOrderNumber = RENEWAL_ORDER_REF

  const { payload, signature } = invoicePaidEvent()
  const { result, lines } = await captureLogs(() => POST(webhookRequest(payload, signature)))

  assert.equal(result.status, 200)
  assert.equal(state.posts.length, 0, 'un redelivery non crea un secondo ordine')
  assert.deepEqual(
    renewalSignals(lines),
    [],
    'il segnale accompagna la creazione: su un rinnovo gia esistente non si ripete',
  )
  assert.deepEqual(state.subscriptionPatches, [], 'il contatore non avanza una seconda volta')
})

test('creazione ordine rifiutata: nessun segnale, contatore fermo (il rinnovo non e stato creato)', async () => {
  state.orderPostStatus = 500

  const { result, lines } = await submitInvoicePaid()

  assert.equal(result.status, 200, 'il ramo invoice.paid non rende la risposta retryable: resta com e')
  assert.equal(state.posts.length, 1, 'il tentativo di creazione c e stato')
  assert.deepEqual(
    renewalSignals(lines),
    [],
    'il segnale dichiara un rinnovo CREATO senza PaymentIntent, non un tentativo fallito',
  )
  assert.deepEqual(state.subscriptionPatches, [], 'nessun ordine, nessun avanzamento del ciclo')
})

test('payments senza `has_more`: lista di completezza ignota, si segnala payments_paginated', async () => {
  const { result, lines } = await submitInvoicePaid(
    {
      payments: {
        data: [{ status: 'paid', payment: { type: 'payment_intent', payment_intent: RENEWAL_PAYMENT_INTENT } }],
      },
    },
    {
      status: 'ok',
      payments: {
        data: [{ status: 'paid', payment: { type: 'payment_intent', payment_intent: RENEWAL_PAYMENT_INTENT } }],
      },
    },
  )

  assert.equal(result.status, 200)
  assert.equal(
    'stripePaymentIntentId' in state.posts[0]!,
    false,
    'senza `has_more: false` non si puo escludere che il pagamento sia oltre la prima pagina',
  )
  const signals = renewalSignals(lines)
  assert.equal(signals.length, 1)
  assert.equal(signals[0]?.reason, 'payments_paginated')
})

test('forma espansa: `payment_intent` come oggetto porta comunque l id sull ordine', async () => {
  const { result, lines } = await submitInvoicePaid({
    payments: {
      has_more: false,
      data: [{ status: 'paid', payment: { type: 'payment_intent', payment_intent: { id: RENEWAL_PAYMENT_INTENT } } }],
    },
  })

  assert.equal(result.status, 200)
  assert.equal(state.posts[0]!.stripePaymentIntentId, RENEWAL_PAYMENT_INTENT)
  assert.deepEqual(renewalSignals(lines), [])
})

test('un pagamento pagato di tipo diverso non viene letto come PaymentIntent, anche se ne nomina uno', async () => {
  const { result, lines } = await submitInvoicePaid({
    payments: {
      has_more: false,
      data: [{ status: 'paid', payment: { type: 'charge', payment_intent: RENEWAL_PAYMENT_INTENT } }],
    },
  })

  assert.equal(result.status, 200)
  assert.equal(
    'stripePaymentIntentId' in state.posts[0]!,
    false,
    'il tipo del pagamento conta: un charge che nomina un payment_intent non e la fonte dell id',
  )
  const signals = renewalSignals(lines)
  assert.equal(signals.length, 1)
  assert.equal(signals[0]?.reason, 'payments_ambiguous')
})

/*
 * COPERTURA DEL CASO (decisione del 20/11, opzione A).
 *
 * La lettura con `expand[]=payments` non e' un extra: senza di essa ogni
 * rinnovo nasce senza PaymentIntent (e' la forma normale dell'evento, non un
 * caso di scuola). Le garanzie che questi test pinnano:
 *   1. l'expand scatta solo quando la lista manca o e' troncata;
 *   2. errore/timeout Stripe -> 503 ritentabile, mai un ordine senza id;
 *   3. id assente anche dopo expand -> segnale strutturato, nessun id inventato;
 *   4. nessuna scrittura Stripe: solo `retrieve`.
 */

test('lettura Stripe in errore: 503 ritentabile e nessun ordine creato senza identificativo', async () => {
  const { result, lines, invoiceCalls } = await submitInvoicePaid({}, { status: 'error' })

  assert.equal(result.status, 503, 'un 200 segnerebbe l evento come consegnato e il rinnovo nascerebbe senza id')
  const body = (await result.json()) as Record<string, unknown>
  assert.equal(body.error, 'PaymentIntent lookup failed')
  assert.equal(invoiceCalls.length, 1, 'la lettura e stata tentata')
  assert.equal(state.posts.length, 0, 'la lettura non riuscita non crea un ordine senza id')
  assert.deepEqual(state.subscriptionPatches, [], 'il contatore non avanza: al retry si rifa tutto')
  assert.deepEqual(
    renewalSignals(lines),
    [],
    'il segnale dichiara un rinnovo CREATO senza id, non un tentativo fallito',
  )
})

test('dopo il 503 per errore Stripe il retry crea il rinnovo con l id, senza duplicati', async () => {
  const first = await submitInvoicePaid({}, { status: 'error' })
  assert.equal(first.result.status, 503)
  assert.equal(state.posts.length, 0)

  const second = await submitInvoicePaid(
    {},
    {
      status: 'ok',
      payments: {
        has_more: false,
        data: [{ status: 'paid', payment: { type: 'payment_intent', payment_intent: RENEWAL_PAYMENT_INTENT } }],
      },
    },
  )

  assert.equal(second.result.status, 200)
  assert.equal(state.posts.length, 1, 'un solo ordine: il tentativo fallito non ne ha lasciato nessuno')
  assert.equal(state.posts[0]!.stripePaymentIntentId, RENEWAL_PAYMENT_INTENT)
  assert.deepEqual(renewalSignals(second.lines), [])
})

test('id assente anche dopo expand: ordine creato senza id e segnale payments_ambiguous', async () => {
  const { result, lines, invoiceCalls } = await submitInvoicePaid(
    {},
    {
      status: 'ok',
      payments: {
        has_more: false,
        data: [{ status: 'paid', payment: { type: 'charge', charge: 'ch_test_renewal' } }],
      },
    },
  )

  assert.equal(result.status, 200)
  assert.equal(invoiceCalls.length, 1, 'l id non c era: si e tentata una sola rilettura')
  assert.equal(state.posts.length, 1)
  assert.equal(
    'stripePaymentIntentId' in state.posts[0]!,
    false,
    'se l expand non da un PaymentIntent non se ne inventa uno',
  )
  assert.deepEqual(renewalSignals(lines), [
    {
      event: 'renewal_order_without_payment_intent',
      orderRef: RENEWAL_ORDER_REF,
      reason: 'payments_ambiguous',
    },
  ])
})

test('lista completa ma ambigua: nessuna lettura Stripe in piu, il segnale resta', async () => {
  const { result, lines, invoiceCalls } = await submitInvoicePaid({
    payments: {
      has_more: false,
      data: [
        { status: 'paid', payment: { type: 'payment_intent', payment_intent: 'pi_test_renewal_a' } },
        { status: 'paid', payment: { type: 'payment_intent', payment_intent: 'pi_test_renewal_b' } },
      ],
    },
  })

  assert.equal(result.status, 200)
  assert.deepEqual(
    invoiceCalls,
    [],
    'una lista completa e ambigua non cambia con l expand: una lettura in piu aggiungerebbe solo un modo di far fallire un rinnovo pagato',
  )
  assert.equal(state.posts.length, 1)
  const signals = renewalSignals(lines)
  assert.equal(signals.length, 1)
  assert.equal(signals[0]?.reason, 'payments_ambiguous')
})
