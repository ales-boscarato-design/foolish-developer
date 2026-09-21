import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { after, before, test } from 'node:test'
import type Stripe from 'stripe'

const CMS_SECRET = 'test-storefront-secret'
const ACCOUNT_EMAIL = 'cliente@example.invalid'
const SOURCE_ORDER_NUMBER = 'FOOLISH-1789930941341'

process.env.PAYLOAD_API_SECRET = CMS_SECRET
process.env.STRIPE_SECRET_KEY = 'sk_test_reorder'
process.env.STOREFRONT_URL = 'https://thefoolishbutcher.com'
delete process.env.NEXT_PUBLIC_CMS_URL

import { handleReorderRequest } from './reorder-route'
import { createOrderInCMS } from './stripe-orders'

/**
 * Test di route del riordino.
 *
 * Perche' esiste: il pulsante "Riordina" apriva una sessione Stripe con le sole
 * righe prodotto. Nessuna riga "Spedizione" (0,00 di trasporto incassato su
 * qualunque destinazione) e nessun `items_json`, quindi l'ordine registrato dal
 * webhook finiva con `shippingCost` = valore merce.
 *
 * Il test non si limita a leggere il codice: parla il protocollo. Il CMS e' uno
 * stub HTTP reale, e le chiamate del SDK Stripe sono intercettate a livello di
 * client HTTP, quindi quello che si asserisce e' il corpo form-encoded che Stripe
 * avrebbe ricevuto. Dalla stessa sessione ricostruita si genera poi l'ordine nel
 * CMS, per verificare l'invariante che conta: `shippingCost` registrato == riga
 * "Spedizione" incassata.
 */

function sourceOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 101,
    orderNumber: SOURCE_ORDER_NUMBER,
    customerEmail: ACCOUNT_EMAIL,
    customerName: 'Cliente Test',
    customerPhone: '+390000000000',
    lineItems: [
      { sku: 'TS-DUO-A4', name: 'T-Sheet Duoskin', variantLabel: 'A4', quantity: 1, unitPrice: 43.2 },
    ],
    shippingAddress: {
      name: 'Cliente Test',
      address1: 'Via Test 1',
      address2: '',
      city: 'Torino',
      postalCode: '10100',
      country: 'IT',
    },
    ...overrides,
  }
}

let server: ReturnType<typeof createServer>
let baseUrl = ''
let cmsOrder: Record<string, unknown> | null = sourceOrder()
let cmsLookupStatus = 200
let cmsCreateStatus = 201
let cmsCreatedBody: Record<string, unknown> | null = null

let stripeRequests: Array<{ path: string; method: string; body: string }> = []
let stripeStatus = 200

before(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (req.headers['x-storefront-secret'] !== CMS_SECRET) return json(403, { error: 'forbidden' })

    if (url.pathname === '/api/orders' && req.method === 'GET') {
      if (cmsLookupStatus !== 200) return json(cmsLookupStatus, { error: 'cms' })
      const orderNumber = url.searchParams.get('where[orderNumber][equals]')
      const email = url.searchParams.get('where[customerEmail][equals]')
      const match = cmsOrder
        && cmsOrder.orderNumber === orderNumber
        && cmsOrder.customerEmail === email
      return json(200, { docs: match ? [cmsOrder] : [] })
    }

    if (url.pathname === '/api/orders' && req.method === 'POST') {
      let raw = ''
      for await (const chunk of req) raw += chunk
      if (cmsCreateStatus >= 400) return json(cmsCreateStatus, { error: 'cms create' })
      cmsCreatedBody = JSON.parse(raw || '{}') as Record<string, unknown>
      return json(201, { id: 202, orderNumber: String(cmsCreatedBody.orderNumber) })
    }

    return json(404, { error: 'not found' })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  baseUrl = `http://127.0.0.1:${address.port}`
  process.env.PAYLOAD_PUBLIC_URL = baseUrl

  // Intercetta il client HTTP del SDK Stripe: nessuna chiave, nessuna rete.
  const require = createRequire(import.meta.url)
  const stripeRoot = path.resolve('node_modules/stripe')
  const patch = (
    NodeHttpClient: { prototype: { makeRequest: unknown } },
    NodeHttpClientResponse: new (res: unknown) => unknown,
  ) => {
    NodeHttpClient.prototype.makeRequest = (
      _host: string,
      _port: string,
      requestPath: string,
      method: string,
      _headers: Record<string, string>,
      requestData: string,
    ) => {
      stripeRequests.push({ path: requestPath, method, body: String(requestData) })
      const stream = Readable.from([Buffer.from(JSON.stringify(stripeStatus === 200
        ? { id: 'cs_test_reorder', object: 'checkout.session', url: 'https://checkout.stripe.com/c/pay/cs_test_reorder' }
        : { error: { type: 'api_error', message: 'stripe unavailable' } }))]) as Readable & { statusCode: number; headers: Record<string, string> }
      stream.statusCode = stripeStatus
      stream.headers = { 'content-type': 'application/json' }
      return Promise.resolve(new NodeHttpClientResponse(stream))
    }
  }
  patch(require(path.join(stripeRoot, 'cjs/net/NodeHttpClient.js')).NodeHttpClient,
    require(path.join(stripeRoot, 'cjs/net/NodeHttpClient.js')).NodeHttpClientResponse)
  const esm = await import(pathToFileURL(path.join(stripeRoot, 'esm/net/NodeHttpClient.js')).href)
  patch(esm.NodeHttpClient, esm.NodeHttpClientResponse)
})

after(() => { server.close() })

function reset() {
  stripeRequests = []
  stripeStatus = 200
  cmsOrder = sourceOrder()
  cmsLookupStatus = 200
  cmsCreateStatus = 201
  cmsCreatedBody = null
}

/** Ultima sessione Stripe richiesta, letta dal corpo form-encoded. */
function lastCheckoutSessionRequest() {
  const request = stripeRequests.filter((entry) => entry.path === '/v1/checkout/sessions').at(-1)
  assert.ok(request, 'nessuna sessione Stripe richiesta')
  return { method: request.method, params: new URLSearchParams(request.body) }
}

function productLines(params: URLSearchParams) {
  const lines: Array<{ name: string; unitAmount: number; quantity: number; sku?: string }> = []
  for (const [key, value] of params) {
    const match = key.match(/^line_items\[(\d+)\]\[price_data\]\[product_data\]\[name\]$/)
    if (!match) continue
    const index = match[1]
    lines.push({
      name: value,
      unitAmount: Number(params.get(`line_items[${index}][price_data][unit_amount]`)),
      quantity: Number(params.get(`line_items[${index}][quantity]`)),
      sku: params.get(`line_items[${index}][price_data][product_data][metadata][sku]`) ?? undefined,
    })
  }
  return lines
}

function sessionMetadata(params: URLSearchParams) {
  const metadata: Record<string, string> = {}
  for (const [key, value] of params) {
    const match = key.match(/^metadata\[(.+)\]$/)
    if (match) metadata[match[1]] = value
  }
  return metadata
}

/**
 * Ricostruisce la sessione che il webhook riceverebbe: totale da Stripe (righe
 * prodotto + spedizione) e metadata di sessione. `collected_information` resta
 * nullo di proposito, cosi' l'indirizzo puo' venire solo dai metadata scritti dal
 * riordino (e' il caso delle sessioni vecchie).
 */
function webhookSession(params: URLSearchParams): Stripe.Checkout.Session {
  const amountTotal = productLines(params).reduce((sum, line) => sum + line.unitAmount * line.quantity, 0)
  return {
    id: 'cs_test_reorder',
    object: 'checkout.session',
    livemode: true,
    mode: 'payment',
    payment_status: 'paid',
    payment_intent: 'pi_test_reorder',
    currency: 'eur',
    amount_total: amountTotal,
    customer_email: params.get('customer_email'),
    customer_details: null,
    collected_information: null,
    metadata: sessionMetadata(params),
  } as unknown as Stripe.Checkout.Session
}

test('il riordino incassa la spedizione e registra l\'ordine con lo stesso importo', async () => {
  reset()
  const response = await handleReorderRequest(SOURCE_ORDER_NUMBER, ACCOUNT_EMAIL)
  const body = await response.json() as { url?: string; error?: string }

  assert.equal(response.status, 200, JSON.stringify(body))
  assert.equal(body.url, 'https://checkout.stripe.com/c/pay/cs_test_reorder')

  const { method, params } = lastCheckoutSessionRequest()
  assert.equal(method, 'POST')
  const lines = productLines(params)
  assert.equal(lines.length, 2)
  assert.deepEqual(lines[0], { name: 'T-Sheet Duoskin — A4', unitAmount: 4320, quantity: 1, sku: 'TS-DUO-A4' })
  assert.deepEqual(lines[1], { name: 'Spedizione', unitAmount: 765, quantity: 1, sku: undefined })

  // L'indirizzo viene raccolto e confermato, e solo nella destinazione su cui la
  // tariffa e' stata calcolata.
  const country = params.getAll('shipping_address_collection[allowed_countries][0]')
  assert.deepEqual(country, ['IT'])
  assert.equal(params.get('billing_address_collection'), 'auto')
  assert.equal(params.get('customer_email'), ACCOUNT_EMAIL)
  assert.equal(params.get('success_url'), 'https://thefoolishbutcher.com/account/ordini?reorder=success')
  assert.equal(params.get('cancel_url'), 'https://thefoolishbutcher.com/account')

  const metadata = sessionMetadata(params)
  assert.equal(metadata.order_ref.startsWith('FOOLISH-'), true)
  assert.equal(metadata.shipping_cost_cents, '765')
  assert.equal(metadata.reorder_from, SOURCE_ORDER_NUMBER)
  assert.equal(metadata.customer_country, 'IT')
  assert.equal(metadata.customer_address, 'Via Test 1|Torino|10100')
  assert.deepEqual(JSON.parse(metadata.items_json), [
    { sku: 'TS-DUO-A4', qty: 1, name: 'T-Sheet Duoskin', variantLabel: 'A4', price: 43.2 },
  ])

  // Il difetto originale: la sessione non aveva items_json e il webhook registrava
  // shippingCost = 43,20 (l'intero valore merce). Ora il campo vale l'incassato.
  const persisted = await createOrderInCMS(webhookSession(params))
  assert.equal(persisted.created, true)
  assert.ok(cmsCreatedBody, 'nessun ordine inviato al CMS')
  assert.equal(cmsCreatedBody.shippingCost, 7.65)
  assert.equal(cmsCreatedBody.total, 50.85)
  assert.equal(cmsCreatedBody.orderNumber, metadata.order_ref)
  assert.deepEqual(cmsCreatedBody.lineItems, [
    { sku: 'TS-DUO-A4', name: 'T-Sheet Duoskin', variantLabel: 'A4', quantity: 1, unitPrice: 43.2 },
  ])
  const address = cmsCreatedBody.shippingAddress as Record<string, string>
  assert.equal(address.address1, 'Via Test 1')
  assert.equal(address.city, 'Torino')
  assert.equal(address.postalCode, '10100')
  assert.equal(address.country, 'IT')
  for (const [field, value] of Object.entries(address)) {
    if (field === 'address2') continue
    assert.ok(value.length > 0, `indirizzo di spedizione vuoto: ${field}`)
  }
})

test('la sessione di riordino mantiene l\'indirizzo raccolto da Stripe quando c\'è', async () => {
  reset()
  const response = await handleReorderRequest(SOURCE_ORDER_NUMBER, ACCOUNT_EMAIL)
  assert.equal(response.status, 200)
  const { params } = lastCheckoutSessionRequest()

  const session = webhookSession(params)
  session.collected_information = {
    shipping_details: {
      name: 'Cliente Test',
      address: { line1: 'Via Nuova 9', line2: null, city: 'Chieri', postal_code: '10023', country: 'IT' },
    },
  } as Stripe.Checkout.Session['collected_information']

  const persisted = await createOrderInCMS(session)
  assert.equal(persisted.created, true)
  assert.ok(cmsCreatedBody)
  assert.deepEqual(cmsCreatedBody.shippingAddress, {
    name: 'Cliente Test',
    address1: 'Via Nuova 9',
    address2: '',
    city: 'Chieri',
    postalCode: '10023',
    country: 'IT',
  })
  assert.equal(cmsCreatedBody.shippingCost, 7.65)
})

test('un ordine senza telefono nel CMS resta riordinabile', async () => {
  reset()
  // Payload restituisce null per un campo di testo vuoto.
  cmsOrder = sourceOrder({ customerPhone: null })
  const response = await handleReorderRequest(SOURCE_ORDER_NUMBER, ACCOUNT_EMAIL)
  assert.equal(response.status, 200)

  const { params } = lastCheckoutSessionRequest()
  assert.equal(sessionMetadata(params).customer_phone, '')
  assert.equal(productLines(params)[1]?.unitAmount, 765)
})

test('destinazione non determinabile: nessuna sessione di pagamento', async () => {
  reset()
  cmsOrder = sourceOrder({ shippingAddress: { ...sourceOrder().shippingAddress, country: '' } })
  const response = await handleReorderRequest(SOURCE_ORDER_NUMBER, ACCOUNT_EMAIL)
  const body = await response.json() as { error: string }

  assert.equal(response.status, 409)
  assert.match(body.error, /destinazione/)
  assert.equal(stripeRequests.length, 0)
})

test('un ordine di un altro cliente non esiste', async () => {
  reset()
  const response = await handleReorderRequest(SOURCE_ORDER_NUMBER, 'altro@example.invalid')
  assert.equal(response.status, 404)
  assert.equal(stripeRequests.length, 0)
})

test('ordine inesistente', async () => {
  reset()
  cmsOrder = null
  const response = await handleReorderRequest('FOOLISH-0000', ACCOUNT_EMAIL)
  assert.equal(response.status, 404)
  assert.equal(stripeRequests.length, 0)
})

test('CMS non raggiungibile o in errore: nessun incasso', async () => {
  reset()
  cmsLookupStatus = 500
  const unavailable = await handleReorderRequest(SOURCE_ORDER_NUMBER, ACCOUNT_EMAIL)
  assert.equal(unavailable.status, 503)
  assert.equal(stripeRequests.length, 0)

  reset()
  process.env.PAYLOAD_PUBLIC_URL = 'http://127.0.0.1:1'
  const unreachable = await handleReorderRequest(SOURCE_ORDER_NUMBER, ACCOUNT_EMAIL)
  assert.equal(unreachable.status, 503)
  assert.equal(stripeRequests.length, 0)
  process.env.PAYLOAD_PUBLIC_URL = baseUrl
})

test('senza chiave Stripe il riordino non parte', async () => {
  reset()
  const secret = process.env.STRIPE_SECRET_KEY
  delete process.env.STRIPE_SECRET_KEY
  try {
    const response = await handleReorderRequest(SOURCE_ORDER_NUMBER, ACCOUNT_EMAIL)
    assert.equal(response.status, 503)
    assert.equal(stripeRequests.length, 0)
  } finally {
    process.env.STRIPE_SECRET_KEY = secret
  }
})

test('un errore di Stripe non diventa un url di pagamento', async () => {
  reset()
  stripeStatus = 402
  const response = await handleReorderRequest(SOURCE_ORDER_NUMBER, ACCOUNT_EMAIL)
  const body = await response.json() as { url?: string; error?: string }
  assert.equal(response.status, 502)
  assert.equal(body.url, undefined)
})

test('un ordine con righe non pagabili non apre una sessione', async () => {
  reset()
  cmsOrder = sourceOrder({ lineItems: [{ sku: 'SUB-GIFT', name: 'Omaggio abbonamento', variantLabel: '', quantity: 1, unitPrice: 0 }] })
  const response = await handleReorderRequest(SOURCE_ORDER_NUMBER, ACCOUNT_EMAIL)
  assert.equal(response.status, 400)
  assert.equal(stripeRequests.length, 0)
})
