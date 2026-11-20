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
  console.error = (...args: unknown[]) => { lines.push(args.map(String).join(' ')) }
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')) }
  try {
    const result = await run()
    return { result, lines }
  } finally {
    console.error = originalError
    console.log = originalLog
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
      refundCount: 1,
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
    amount_refunded: 10_000, currency: 'eur', refunded: true, metadata: {},
    refunds: refundList([{ id: 're_missing_order', object: 'refund', amount: 10_000, currency: 'eur', status: 'succeeded', created: 1_700_000_120 }]),
  })
  assert.equal(response.status, 503)
  assert.equal(state.refundTransitions.length, 1, 'il 503 viene dall ordine mancante, non da un rifiuto dello snapshot')
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
    amount_refunded: 2_500, currency: 'eur', refunded: false, metadata: {},
    refunds: refundList([{ id: 're_out_of_order', object: 'refund', amount: 2_500, currency: 'eur', status: 'succeeded', created: 1_700_000_120 }]),
  })
  assert.equal(response.status, 200)
})

test('la data del rimborso viene dai refund riletti, mai da event.created', async () => {
  // L'evento ha `created` 1_700_000_123: se comparisse nell'ISO la rotta starebbe
  // inventando la data dal momento della consegna invece che dal rimborso.
  const response = await submitEventWithStripe(
    refundEvent(),
    {
      id: 'ch_test_refund', object: 'charge', payment_intent: 'pi_test_refund', amount: 10_000,
      amount_refunded: 2_500, currency: 'eur', refunded: false, metadata: {},
      refunds: refundList([{ id: 're_only', object: 'refund', amount: 2_500, currency: 'eur', status: 'succeeded', created: 1_699_999_000 }]),
    },
  )
  assert.equal(response.status, 200)
  assert.equal(state.refundTransitions[0]?.lastRefundedAt, new Date(1_699_999_000 * 1000).toISOString())
  assert.equal(state.refundTransitions[0]?.refundCount, 1)
})

test('due consegne dello stesso charge producono la stessa fotografia cumulativa', async () => {
  const originalFetch = globalThis.fetch
  const requests: Array<Record<string, unknown>> = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/api/orders/apply-refund-transition')) {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return Response.json({ status: 'stale' })
    }
    return originalFetch(input, init)
  }) as typeof globalThis.fetch
  try {
    const charge = {
      id: 'ch_test_refund', object: 'charge', payment_intent: 'pi_test_refund', amount: 10_000,
      amount_refunded: 2_500, currency: 'eur', refunded: false, metadata: {},
      refunds: refundList([{ id: 're_only', object: 'refund', amount: 2_500, currency: 'eur', status: 'succeeded', created: 1_700_000_120 }]),
    }
    const first = await submitEventWithStripe(refundEvent(), charge)
    const second = await submitEventWithStripe(refundEvent(), charge)
    assert.equal(first.status, 200)
    assert.equal(second.status, 200)
    assert.equal(requests.length, 2)
    assert.deepEqual(requests[0], requests[1], 'il retry non deve produrre uno stato diverso')
    assert.equal(requests[0]?.refundCount, 1)
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
    refundCount: 1,
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

/* ────────────────────────────────────────────────────────────────────────────
 * RIMBORSI ANNULLATI / FALLITI (card t_6f9c968d)
 *
 * `charge.amount_refunded` SCENDE quando Stripe passa un rimborso a
 * `failed`/`canceled`. La rotta deve rileggere il charge (sola lettura) e
 * riconciliare l'ordine con una sorgente di ordinamento diversa dall'importo:
 * il numero di rimborsi presenti sul charge (`refundCount`), che Stripe non
 * riduce mai. `refund.updated`/`refund.failed` non sono piu' un ACK muto.
 * ──────────────────────────────────────────────────────────────────────────── */

function refundList(data: Array<Record<string, unknown>>, hasMore = false): Record<string, unknown> {
  return { object: 'list', url: '/v1/charges/ch_test_refund/refunds', has_more: hasMore, data }
}

function refundObjectEvent(
  type: 'refund.updated' | 'refund.failed',
  refund: Record<string, unknown> = {},
): { payload: string; signature: string } {
  const object = {
    id: 're_test_refund', object: 'refund', amount: 2_500, currency: 'eur', status: 'failed',
    charge: 'ch_test_refund', payment_intent: 'pi_test_refund', created: 1_700_000_120, metadata: {},
    ...refund,
  }
  const payload = JSON.stringify({
    id: `evt_test_${type.replace('.', '_')}`, object: 'event', api_version: '2025-01-27.acacia',
    created: 1_700_000_500, livemode: false, pending_webhooks: 1,
    request: { id: null, idempotency_key: null }, type, data: { object },
  })
  return { payload, signature: Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET }) }
}

/**
 * Consegna un evento con un charge e, se serve, un elenco di rimborsi paginato
 * (`stripe.refunds.list`) perche' il charge ne porta solo i primi dieci.
 */
async function submitEventWithStripe(
  event: { payload: string; signature: string },
  charge: Record<string, unknown>,
  refundPages?: Array<{ data: Array<Record<string, unknown>>; has_more: boolean }>,
): Promise<Response> {
  const Charges = Stripe.resources.Charges
  const Refunds = Stripe.resources.Refunds
  const originalRetrieve = Charges.prototype.retrieve
  const originalList = Refunds.prototype.list
  Charges.prototype.retrieve = (async (chargeId: string) => {
    assert.equal(chargeId, 'ch_test_refund', 'Stripe Charge.retrieve deve ricevere refund.charge, non refund.id')
    return charge
  }) as unknown as typeof Charges.prototype.retrieve
  let page = 0
  Refunds.prototype.list = (async () => {
    if (!refundPages) throw new Error('stripe.refunds.list non deve essere chiamato: il charge porta l elenco completo')
    const next = refundPages[Math.min(page, refundPages.length - 1)]
    page += 1
    return next
  }) as unknown as typeof Refunds.prototype.list
  try {
    return await POST(webhookRequest(event.payload, event.signature))
  } finally {
    Charges.prototype.retrieve = originalRetrieve
    Refunds.prototype.list = originalList
  }
}

function chargeWithRefunds(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'ch_test_refund', object: 'charge', payment_intent: 'pi_test_refund', amount: 10_000,
    amount_refunded: 1_000, currency: 'eur', refunded: false, metadata: {},
    refunds: refundList([
      { id: 're_succeeded', object: 'refund', amount: 2_500, currency: 'eur', status: 'succeeded', created: 1_700_000_100 },
      { id: 're_failed', object: 'refund', amount: 2_000, currency: 'eur', status: 'failed', created: 1_700_000_200 },
    ]),
    ...overrides,
  }
}

test('refund.updated di un rimborso fallito rilegge il charge e abbassa il cumulativo dell ordine', async () => {
  const response = await submitEventWithStripe(refundObjectEvent('refund.updated'), chargeWithRefunds())

  assert.equal(response.status, 200)
  assert.deepEqual(state.refundTransitions, [{
    stripePaymentIntentId: 'pi_test_refund',
    chargeAmountCents: 10_000,
    amountRefundedCents: 1_000,
    refundCount: 2,
    lastRefundedAt: new Date(1_700_000_200 * 1000).toISOString(),
  }], 'il calo legittimo va scritto sull ordine insieme al conteggio dei rimborsi')
})

test('refund.failed riconcilia un ordine rimasto completamente rimborsato', async () => {
  const response = await submitEventWithStripe(
    refundObjectEvent('refund.failed'),
    chargeWithRefunds({
      amount_refunded: 0,
      refunded: false,
      refunds: refundList([
        { id: 're_cancelled', object: 'refund', amount: 10_000, currency: 'eur', status: 'failed', created: 1_700_000_300 },
      ]),
    }),
  )

  assert.equal(response.status, 200)
  assert.equal(state.refundTransitions[0]?.amountRefundedCents, 0)
  assert.equal(state.refundTransitions[0]?.refundCount, 1)
})

test('un refund senza charge riconoscibile viene riconosciuto (ACK) ma non ritenta per sempre', async () => {
  const { result, lines } = await captureLogs(() =>
    submitEventWithStripe(refundObjectEvent('refund.updated', { charge: null, payment_intent: null }), chargeWithRefunds()),
  )

  assert.equal(result.status, 200)
  assert.equal(state.refundTransitions.length, 0, 'senza charge non c e uno stato cumulativo da scrivere')
  assert.match(lines.join('\n'), /refund event without charge/)
})

test('con piu di dieci rimborsi il conteggio viene paginato, non troncato alla prima pagina', async () => {
  const firstPage = Array.from({ length: 10 }, (_, index) => ({
    id: `re_page1_${index}`, object: 'refund', amount: 100, currency: 'eur', status: 'succeeded', created: 1_700_000_100 + index,
  }))
  const secondPage = [
    { id: 're_page2_0', object: 'refund', amount: 500, currency: 'eur', status: 'succeeded', created: 1_700_000_400 },
    { id: 're_page2_1', object: 'refund', amount: 400, currency: 'eur', status: 'failed', created: 1_700_000_500 },
  ]
  const response = await submitEventWithStripe(
    refundObjectEvent('refund.updated'),
    chargeWithRefunds({ amount_refunded: 1_500, refunds: refundList(firstPage, true) }),
    [{ data: firstPage, has_more: true }, { data: secondPage, has_more: false }],
  )

  assert.equal(response.status, 200)
  assert.equal(state.refundTransitions[0]?.refundCount, 12, 'il conteggio comprende anche i rimborsi falliti')
  assert.equal(state.refundTransitions[0]?.amountRefundedCents, 1_500)
  assert.equal(
    state.refundTransitions[0]?.lastRefundedAt,
    new Date(1_700_000_500 * 1000).toISOString(),
    'la data piu recente sta nell ultima pagina',
  )
})

test('se l elenco dei rimborsi resta incompleto la rotta non inventa un conteggio: 503 ritentabile', async () => {
  const firstPage = Array.from({ length: 2 }, (_, index) => ({
    id: `re_incomplete_${index}`, object: 'refund', amount: 100, currency: 'eur', status: 'succeeded', created: 1_700_000_100,
  }))
  const response = await submitEventWithStripe(
    refundObjectEvent('refund.updated'),
    chargeWithRefunds({ refunds: refundList(firstPage, true) }),
    [{ data: firstPage, has_more: true }],
  )

  assert.equal(response.status, 503)
  assert.equal(state.refundTransitions.length, 0, 'un conteggio parziale non entra nella transizione')
})

test('charge.refund.updated passa dallo stesso percorso di riconciliazione', async () => {
  const charge = chargeWithRefunds()
  const payload = JSON.stringify({
    id: 'evt_test_charge_refund_updated', object: 'event', api_version: '2025-01-27.acacia',
    created: 1_700_000_500, livemode: false, pending_webhooks: 1,
    request: { id: null, idempotency_key: null }, type: 'charge.refund.updated', data: { object: {
      id: 're_test_refund', object: 'refund', amount: 2_500, currency: 'eur', status: 'failed',
      charge: 'ch_test_refund', payment_intent: 'pi_test_refund', created: 1_700_000_120, metadata: {},
    } },
  })
  const response = await submitEventWithStripe(
    { payload, signature: Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET }) },
    charge,
  )

  assert.equal(response.status, 200)
  assert.equal(state.refundTransitions.length, 1)
  assert.equal(state.refundTransitions[0]?.refundCount, 2)
})
