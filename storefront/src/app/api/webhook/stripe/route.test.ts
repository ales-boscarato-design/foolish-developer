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
  /** Numero d'ordine da restituire per la chiave di sessione, se presente. */
  bySession: string | null
  /** Numero d'ordine da restituire per la ricerca per numero, se presente. */
  byOrderNumber: string | null
}

const state: CmsState = { posts: [], queries: [], bySession: null, byOrderNumber: null }

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

test('attribuzione Stripe valida viene persistita nel gruppo CMS', async () => {
  const attribution = JSON.stringify({ landingPath: '/it/', referrerHost: null, utmSource: 'google', utmMedium: 'cpc', utmCampaign: null, utmTerm: null, utmContent: null, refSlug: null, sourceClass: 'paidAds' })
  const { payload, signature } = sessionEvent({ metadata: { order_ref: RESOLVED_ORDER_NUMBER, items_json: '[]', customer_name: 'Webhook Test', customer_country: 'IT', attribution_json: attribution } })
  const result = await POST(webhookRequest(payload, signature))
  assert.equal(result.status, 200)
  assert.equal(state.posts.length, 1)
  assert.deepEqual(state.posts[0]?.attribution, JSON.parse(attribution))
})

test('attribuzione illeggibile produce snapshot unknown ma l ordine viene creato', async () => {
  const { payload, signature } = sessionEvent({ metadata: { order_ref: RESOLVED_ORDER_NUMBER, items_json: '[]', customer_name: 'Webhook Test', customer_country: 'IT', attribution_json: 'not json' } })
  const result = await POST(webhookRequest(payload, signature))
  assert.equal(result.status, 200)
  assert.equal(state.posts.length, 1)
  assert.deepEqual(state.posts[0]?.attribution, { landingPath: null, referrerHost: null, utmSource: null, utmMedium: null, utmCampaign: null, utmTerm: null, utmContent: null, refSlug: null, sourceClass: 'unknown' })
})
