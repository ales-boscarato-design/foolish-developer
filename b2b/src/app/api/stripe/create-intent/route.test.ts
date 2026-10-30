/**
 * Test della ROTTA VERA /api/stripe/create-intent (carta).
 *
 * Il test importa ed esegue la `POST` esportata da `route.ts`, costruendo una
 * `NextRequest` vera. La rotta usa `realCheckoutDeps` e il client Stripe
 * reale (con `Stripe.createFetchHttpClient()`): l'SDK passa quindi da
 * `globalThis.fetch`, che lo stub locale riscrive su
 * `/stripe/v1/payment_intents`. Contiamo le PaymentIntent create davvero e
 * ne verifichiamo l'importo. Nessun host non previsto puo' essere raggiunto.
 *
 * I prezzi sono SINTETICI e inventati per il test: non sono prezzi di listino.
 */

import assert from 'node:assert/strict'
import test, { after, before, beforeEach } from 'node:test'
import { NextRequest } from 'next/server'

import {
  installFetchRouting,
  markOrderPaid,
  patchStoredOrder,
  resetStub,
  startStub,
  stopStub,
  stubState,
} from '../../../../test-support/http-stub'

const TIERS = [
  { minQty: 10, maxQty: 49, discountPercent: 20 },
  { minQty: 50, maxQty: null, discountPercent: 30 },
]

function tiers(): Array<Record<string, unknown>> {
  return TIERS.map((tier) => ({ ...tier }))
}

function baseCatalog(): Array<Record<string, unknown>> {
  return [
    {
      id: 1,
      slug: 'stencil-test',
      name: 'Stencil Test (sintetico)',
      active: true,
      resellerVisible: true,
      basePrice: 14.99,
      priceTiers: tiers(),
      variants: [{ id: 'v1', sku: 'ST-14', label: '14 cm', price: 14.99, stockStatus: 'available' }],
    },
    {
      id: 2,
      slug: 'kit-test',
      name: 'Kit Test (sintetico)',
      active: true,
      resellerVisible: true,
      basePrice: 5,
      priceTiers: [],
      variants: [{ id: 'v2', sku: 'KIT-5', label: 'Standard', price: 5, stockStatus: 'low' }],
    },
    {
      id: 3,
      slug: 'prodotto-spento',
      name: 'Prodotto Spento (sintetico)',
      active: false,
      resellerVisible: true,
      basePrice: 9.99,
      priceTiers: [],
      variants: [{ id: 'v3', sku: 'OFF-1', label: 'Standard', price: 9.99 }],
    },
    {
      id: 5,
      slug: 'round-test',
      name: 'Round Test (sintetico)',
      active: true,
      resellerVisible: true,
      basePrice: 12.5,
      priceTiers: [{ minQty: 50, maxQty: null, discountPercent: 35 }],
      variants: [{ id: 'v5', sku: 'ROUND-1', label: 'Standard', price: 12.5 }],
    },
  ]
}

function brokenCatalog(kind: 'discount' | 'overlap' | 'price' | 'unordered'): Array<Record<string, unknown>> {
  const docs = baseCatalog()
  const product = docs[0] as Record<string, unknown>
  if (kind === 'discount') {
    product.priceTiers = [{ minQty: 10, maxQty: null, discountPercent: 120 }]
  } else if (kind === 'overlap') {
    product.priceTiers = [{ minQty: 10, maxQty: 60, discountPercent: 20 }, { minQty: 50, maxQty: null, discountPercent: 30 }]
  } else if (kind === 'unordered') {
    product.priceTiers = [{ minQty: 50, maxQty: null, discountPercent: 30 }, { minQty: 10, maxQty: 49, discountPercent: 20 }]
  } else {
    ;(product.variants as Array<Record<string, unknown>>)[0].price = null
  }
  return docs
}

const FORM = {
  email: 'acquirente@example.test',
  businessName: 'Studio Test Srl',
  vatNumber: 'IT12345678901',
  shippingName: 'Mario Test',
  shippingAddress1: 'Via Test 1',
  shippingCity: 'Torino',
  shippingPostalCode: '10100',
  shippingCountry: 'IT',
  billingAddress1: 'Via Test 1',
  billingCity: 'Torino',
  billingPostalCode: '10100',
  billingCountry: 'IT',
  sdiCode: '0000000',
}

const SESSION = {
  email: 'acquirente@example.test',
  businessName: 'Studio Test Srl',
  contactName: 'Mario Test',
  vatNumber: 'IT12345678901',
  status: 'active' as const,
}

function line(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    productId: 1,
    productSlug: 'stencil-test',
    productName: 'Stencil Test (sintetico)',
    variantSku: 'ST-14',
    variantLabel: '14 cm',
    unitPrice: 14.99,
    qty: 1,
    priceTiers: tiers(),
    ...overrides,
  }
}

type Post = typeof import('./route').POST

let post: Post
let sessionToken = ''

before(async () => {
  const baseUrl = await startStub()
  process.env.CMS_URL = baseUrl
  process.env.PAYLOAD_API_SECRET = 'test-payload-secret'
  process.env.B2B_SESSION_SECRET = 'test-session-secret'
  process.env.DATABASE_URL = 'postgres://test:test@127.0.0.1:1/test'
  process.env.B2B_CATALOG_TIMEOUT_MS = '200'
  // Chiave finta: lo stub conta la richiesta, nessun addebito possibile.
  process.env.STRIPE_SECRET_KEY = 'sk_test_fake_for_local_stub'

  installFetchRouting()

  const auth = await import('../../../../lib/auth')
  sessionToken = await auth.createSessionToken(SESSION)
  post = (await import('./route')).POST
})

after(async () => {
  await stopStub()
})

beforeEach(() => {
  resetStub()
  stubState.cmsDocs = baseCatalog()
})

const IDEM_KEY = 'test-idem-key-00000001'

function withIdempotencyKey(body: unknown): unknown {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return body
  return { idempotencyKey: IDEM_KEY, ...body }
}

function makeRequest(body: unknown, withKey = true): NextRequest {
  const payload = withKey ? withIdempotencyKey(body) : body
  return new NextRequest('http://b2b.test/api/stripe/create-intent', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: `b2b_session=${sessionToken}`,
    },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  })
}

async function call(body: unknown, withKey = true) {
  const res = await post(makeRequest(body, withKey))
  const json = await res.json() as Record<string, unknown>
  return { status: res.status, body: json }
}

function diagnostic(status: number, body: unknown): string {
  return `status ${status}, ordini POST /api/orders: ${stubState.orderPosts.length}, PaymentIntent: ${stubState.stripeIntents.length}, body ${JSON.stringify(body)}`
}

function assertRejected(r: Awaited<ReturnType<typeof call>>, status: number, error: string): void {
  assert.equal(r.status, status, diagnostic(r.status, r.body))
  assert.equal(r.body.error, error, diagnostic(r.status, r.body))
  assert.deepEqual(Object.keys(r.body), ['error'], 'il corpo non porta dettagli interni')
  assert.equal(stubState.orderPosts.length, 0, diagnostic(r.status, r.body))
  assert.equal(stubState.stripeIntents.length, 0, 'nessuna PaymentIntent per un rifiuto')
}

// --- prezzo / fasce manomessi ----------------------------------------------

test('unitPrice manipolato a 0.01: 400 prezzo_non_allineato, nessun ordine ne PaymentIntent', async () => {
  const r = await call({ form: FORM, items: [line({ unitPrice: 0.01 })] })
  assertRejected(r, 400, 'prezzo_non_allineato')
  assert.ok(!JSON.stringify(r.body).includes('14.99'), 'la risposta non rivela il prezzo del catalogo')
})

test('unitPrice con piu di due decimali (14.989): 400 prezzo_non_valido', async () => {
  const r = await call({ form: FORM, items: [line({ unitPrice: 14.989 })] })
  assertRejected(r, 400, 'prezzo_non_valido')
})

test('priceTiers con sconto 99.9%: 400 fasce_non_allineate', async () => {
  const r = await call({
    form: FORM,
    items: [line({
      priceTiers: [
        { minQty: 10, maxQty: 49, discountPercent: 99.9 },
        { minQty: 50, maxQty: null, discountPercent: 30 },
      ],
    })],
  })
  assertRejected(r, 400, 'fasce_non_allineate')
})

test('tier inventato (minQty 5): 400 fasce_non_allineate', async () => {
  const r = await call({
    form: FORM,
    items: [line({
      priceTiers: [{ minQty: 5, maxQty: 49, discountPercent: 20 }, { minQty: 50, maxQty: null, discountPercent: 30 }],
    })],
  })
  assertRejected(r, 400, 'fasce_non_allineate')
})

// --- quantita ---------------------------------------------------------------

for (const qty of [-10, -1, 0, 2.5, '3', null, true]) {
  test(`qty ${JSON.stringify(qty)}: 400 quantita_non_valida, nessun effetto`, async () => {
    const r = await call({ form: FORM, items: [line({ qty })] })
    assertRejected(r, 400, 'quantita_non_valida')
  })
}

test('qty oltre il tetto: 400 quantita_non_valida', async () => {
  const r = await call({ form: FORM, items: [line({ qty: 100001 })] })
  assertRejected(r, 400, 'quantita_non_valida')
})

// --- prezzo non numerico ----------------------------------------------------

for (const unitPrice of ['0.01', 'abc', null, undefined, {}]) {
  test(`unitPrice ${JSON.stringify(unitPrice)}: 400 prezzo_non_valido`, async () => {
    const r = await call({ form: FORM, items: [line({ unitPrice })] })
    assertRejected(r, 400, 'prezzo_non_valido')
  })
}

// --- SKU / prodotto ---------------------------------------------------------

test('SKU sconosciuto: 400 sku_non_disponibile', async () => {
  const r = await call({ form: FORM, items: [line({ variantSku: 'NON-ESISTE' })] })
  assertRejected(r, 400, 'sku_non_disponibile')
})

test('catalogo con documento non resellerVisible: 503 catalogo_non_disponibile', async () => {
  stubState.cmsDocs = [...baseCatalog(), {
    id: 4,
    slug: 'prodotto-nascosto',
    name: 'Prodotto Nascosto (sintetico)',
    active: true,
    resellerVisible: false,
    basePrice: 7.5,
    priceTiers: [],
    variants: [{ id: 'v4', sku: 'HIDDEN-1', label: 'Standard', price: 7.5 }],
  }]
  const r = await call({
    form: FORM,
    items: [line({ productId: 4, productSlug: 'prodotto-nascosto', variantSku: 'HIDDEN-1', unitPrice: 7.5, priceTiers: [] })],
  })
  assertRejected(r, 503, 'catalogo_non_disponibile')
})

test('productId inventato: 400 prodotto_non_disponibile', async () => {
  const r = await call({ form: FORM, items: [line({ productId: 999 })] })
  assertRejected(r, 400, 'prodotto_non_disponibile')
})

test('prodotto active:false ma resellerVisible:true: vendibile, ordine e PaymentIntent', async () => {
  const r = await call({
    form: FORM,
    items: [line({ productId: 3, productSlug: 'prodotto-spento', variantSku: 'OFF-1', unitPrice: 9.99, priceTiers: [] })],
  })
  assert.equal(r.status, 200, diagnostic(r.status, r.body))
  assert.equal(stubState.orderPosts.length, 1)
  assert.equal(stubState.stripeIntents.length, 1)
  assert.equal(stubState.orderPosts[0].total, 17.64)
  assert.equal(Number(stubState.stripeIntents[0].amount), 1764)
  const items = stubState.orderPosts[0].lineItems as Array<Record<string, unknown>>
  assert.equal(items[0].sku, 'OFF-1')
})

test('prodotto active:false con prezzo manomesso: 400 prezzo_non_allineato', async () => {
  const r = await call({
    form: FORM,
    items: [line({ productId: 3, productSlug: 'prodotto-spento', variantSku: 'OFF-1', unitPrice: 0.01, priceTiers: [] })],
  })
  assertRejected(r, 400, 'prezzo_non_allineato')
})

// --- carrello ---------------------------------------------------------------

test('una riga non valida in mezzo a righe valide fa rifiutare tutto', async () => {
  const r = await call({
    form: FORM,
    items: [
      line({ qty: 10 }),
      line({ productId: 2, productSlug: 'kit-test', variantSku: 'KIT-5', unitPrice: 5, priceTiers: [] }),
      line({ unitPrice: 0.01 }),
    ],
  })
  assertRejected(r, 400, 'prezzo_non_allineato')
})

test('carrello vuoto o non array: 400 righe_non_valide', async () => {
  for (const items of [[], 'niente', null, undefined, {}]) {
    const r = await call({ form: FORM, items })
    assertRejected(r, 400, 'righe_non_valide')
  }
})

test('piu di 100 righe: 400 righe_non_valide', async () => {
  const r = await call({ form: FORM, items: Array.from({ length: 101 }, () => line()) })
  assertRejected(r, 400, 'righe_non_valide')
})

// --- catalogo indisponibile / invalido --------------------------------------

test('CMS giu (500): 503 catalogo_non_disponibile, nessun effetto', async () => {
  stubState.cmsProductsStatus = 500
  const r = await call({ form: FORM, items: [line()] })
  assertRejected(r, 503, 'catalogo_non_disponibile')
})

test('CMS in timeout: 503 catalogo_non_disponibile, nessun effetto', async () => {
  stubState.cmsDelayMs = 1000
  const r = await call({ form: FORM, items: [line()] })
  assertRejected(r, 503, 'catalogo_non_disponibile')
})

test('corpo del catalogo troncato: 503 catalogo_non_disponibile', async () => {
  stubState.cmsTruncateBody = true
  const r = await call({ form: FORM, items: [line()] })
  assertRejected(r, 503, 'catalogo_non_disponibile')
})

test('catalogo troncato (totalDocs > docs): 503 catalogo_non_disponibile', async () => {
  stubState.cmsTotalDocs = 50
  const r = await call({ form: FORM, items: [line()] })
  assertRejected(r, 503, 'catalogo_non_disponibile')
})

for (const kind of ['discount', 'overlap', 'price', 'unordered'] as const) {
  test(`dati catalogo invalidi (${kind}): 503 catalogo_non_valido`, async () => {
    stubState.cmsDocs = brokenCatalog(kind)
    const r = await call({ form: FORM, items: [line()] })
    assertRejected(r, 503, 'catalogo_non_valido')
  })
}

// --- comportamento esistente ------------------------------------------------

test('partita IVA invalida: 400 partita_iva_non_valida prima del catalogo', async () => {
  stubState.viesValid = false
  const r = await call({ form: FORM, items: [line()] })
  assertRejected(r, 400, 'partita_iva_non_valida')
  assert.equal(stubState.productsRequests.length, 0)
})

test('body non JSON: 400 body_non_valido', async () => {
  const r = await call('{ non json')
  assertRejected(r, 400, 'body_non_valido')
})

// --- caso legittimo ---------------------------------------------------------

const LEGIT: Array<{ qty: number; country: string; productsCents: number; shippingCents: number }> = [
  { qty: 1, country: 'IT', productsCents: 1499, shippingCents: 765 },
  { qty: 9, country: 'IT', productsCents: 13491, shippingCents: 0 },
  { qty: 10, country: 'IT', productsCents: 11992, shippingCents: 0 },
  { qty: 49, country: 'IT', productsCents: 58761, shippingCents: 0 },
  { qty: 50, country: 'IT', productsCents: 52465, shippingCents: 0 },
  { qty: 1, country: 'FR', productsCents: 1499, shippingCents: 1499 },
  { qty: 10, country: 'FR', productsCents: 11992, shippingCents: 1499 },
]

for (const scenario of LEGIT) {
  const totalCents = scenario.productsCents + scenario.shippingCents
  test(`legittimo qty ${scenario.qty} ${scenario.country}: ordine unico e PaymentIntent da ${totalCents} centesimi`, async () => {
    const r = await call({
      form: { ...FORM, shippingCountry: scenario.country },
      items: [line({ qty: scenario.qty })],
    })
    assert.equal(r.status, 200, diagnostic(r.status, r.body))
    assert.equal(stubState.orderPosts.length, 1, 'un solo ordine')
    assert.equal(stubState.stripeIntents.length, 1, 'una sola PaymentIntent')
    const order = stubState.orderPosts[0]
    assert.equal(Math.round((order.total as number) * 100), totalCents)
    assert.equal(Math.round((order.shippingCost as number) * 100), scenario.shippingCents)
    assert.equal(order.paymentMethod, 'stripe')

    const intent = stubState.stripeIntents[0]
    assert.equal(Number(intent.amount), totalCents, 'importo PaymentIntent = totale calcolato')
    assert.equal(intent.currency, 'eur')
    assert.equal(intent['metadata[orderId]'], '1001')
    assert.equal(intent['metadata[orderNumber]'], order.orderNumber)
    assert.equal(intent['metadata[resellerEmail]'], 'acquirente@example.test')
    assert.equal(stubState.stripeIdempotencyKeys[0], order.orderNumber)
    assert.equal(typeof r.body.clientSecret, 'string')
    assert.equal(r.body.orderId, 1001)
  })
}

test('arrotondamento: PaymentIntent da 40625 centesimi (406,25 EUR), non 40650', async () => {
  const r = await call({
    form: FORM,
    items: [line({
      productId: 5,
      productSlug: 'round-test',
      variantSku: 'ROUND-1',
      unitPrice: 12.5,
      qty: 50,
      priceTiers: [{ minQty: 50, maxQty: null, discountPercent: 35 }],
    })],
  })
  assert.equal(r.status, 200, diagnostic(r.status, r.body))
  assert.equal(stubState.orderPosts.length, 1)
  assert.equal(Math.round((stubState.orderPosts[0].total as number) * 100), 40625)
  assert.equal(Number(stubState.stripeIntents[0].amount), 40625)
})


// --- R5: idempotenza (D1-D4, D6) ------------------------------------------

test('R5.1 timeout ambiguo poi retry: 502, poi 200 con lo stesso ordine e la stessa PaymentIntent', async () => {
  const body = {
    form: FORM,
    items: [line()],
    idempotencyKey: 'stripe-timeout-retry-001',
  }

  stubState.stripeTimeoutAfterRegister = true
  const first = await call(body)
  assert.equal(first.status, 502, diagnostic(first.status, first.body))
  assert.equal(stubState.ordersCreated, 1, 'il primo tentativo ha creato l ordine')
  assert.equal(stubState.stripeIntents.length, 1, 'il provider ha registrato la intent')

  const firstSecret = stubState.stripeIntentResponses[0].client_secret
  assert.equal(typeof firstSecret, 'string')

  const second = await call(body)
  assert.equal(second.status, 200, diagnostic(second.status, second.body))
  assert.equal(stubState.ordersCreated, 1, 'un solo ordine')
  assert.equal(stubState.stripeIntents.length, 1, 'una sola PaymentIntent')
  assert.equal(second.body.clientSecret, firstSecret, 'stesso client_secret')
  assert.equal(typeof second.body.orderNumber, 'string')
  assert.equal(stubState.stripeIdempotencyKeys[0], second.body.orderNumber)
  assert.equal(stubState.stripeIdempotencyKeys[1], second.body.orderNumber)
})

test('R5.2 due richieste concorrenti con la stessa chiave: un ordine e una PaymentIntent', async () => {
  const body = {
    form: FORM,
    items: [line({ qty: 10 })],
    idempotencyKey: 'stripe-concorrente-0001',
  }

  const [first, second] = await Promise.all([call(body), call(body)])

  assert.equal(first.status, 200, diagnostic(first.status, first.body))
  assert.equal(second.status, 200, diagnostic(second.status, second.body))
  assert.equal(first.body.orderNumber, second.body.orderNumber)
  assert.equal(first.body.clientSecret, second.body.clientSecret)
  assert.equal(stubState.ordersCreated, 1)
  assert.equal(stubState.stripeIntents.length, 1)
})

test('R5.4 ordine gia pagato: 409 ordine_gia_pagato, nessuna nuova PaymentIntent', async () => {
  const body = {
    form: FORM,
    items: [line()],
    idempotencyKey: 'stripe-paid-00000001',
  }

  const first = await call(body)
  assert.equal(first.status, 200, diagnostic(first.status, first.body))
  markOrderPaid(String(first.body.orderNumber))

  const second = await call(body)
  assert.equal(second.status, 409, diagnostic(second.status, second.body))
  assert.equal(second.body.error, 'ordine_gia_pagato')
  assert.equal(stubState.ordersCreated, 1)
  assert.equal(stubState.stripeIntents.length, 1, 'zero nuove PaymentIntent')
})

test('R5.5 documento CMS divergente per email: 409 ordine_non_coerente, nessun ordine ne intent nuovi', async () => {
  const body = {
    form: FORM,
    items: [line()],
    idempotencyKey: 'stripe-coerenza-00001',
  }

  const first = await call(body)
  assert.equal(first.status, 200, diagnostic(first.status, first.body))
  patchStoredOrder(String(first.body.orderNumber), { customerEmail: 'altro@example.test' })

  const second = await call(body)
  assert.equal(second.status, 409, diagnostic(second.status, second.body))
  assert.equal(second.body.error, 'ordine_non_coerente')
  assert.equal(stubState.ordersCreated, 1)
  assert.equal(stubState.stripeIntents.length, 1)
})

test('R5.6 chiave mancante: 400 chiave_idempotenza_mancante prima di VIES e catalogo', async () => {
  const r = await call({ form: FORM, items: [line()] }, false)
  assert.equal(r.status, 400, diagnostic(r.status, r.body))
  assert.equal(r.body.error, 'chiave_idempotenza_mancante')
  assert.equal(stubState.viesRequests, 0)
  assert.equal(stubState.productsRequests.length, 0)
  assert.equal(stubState.ordersCreated, 0)
  assert.equal(stubState.stripeIntents.length, 0)
})

// --- B1: riuso idempotente e coerenza del documento ------------------------

test('B1.2 Stripe: riuso identico, stesso ordine, stesso clientSecret e una sola intent', async () => {
  const body = { form: FORM, items: [line()], idempotencyKey: 'b1-stripe-identico-0001' }

  const first = await call(body)
  assert.equal(first.status, 200, diagnostic(first.status, first.body))
  const second = await call(body)

  assert.equal(second.status, 200, diagnostic(second.status, second.body))
  assert.equal(second.body.orderNumber, first.body.orderNumber, 'stesso orderNumber')
  assert.equal(second.body.clientSecret, first.body.clientSecret, 'stesso clientSecret')
  assert.equal(stubState.ordersCreated, 1)
  assert.equal(stubState.orderPostAttempts, 1, 'una sola POST /api/orders')
  assert.equal(stubState.stripeIntents.length, 1, 'una sola PaymentIntent')
})

test('B1.3 Stripe: P.IVA/ragione sociale/SDI corretti -> 409 ordine_non_coerente', async () => {
  const key = 'b1-stripe-corretti-00001'
  const first = await call({ form: FORM, items: [line()], idempotencyKey: key })
  assert.equal(first.status, 200, diagnostic(first.status, first.body))

  const corrected = {
    ...FORM,
    vatNumber: 'IT99999999999',
    businessName: 'Studio Corretto Srl',
    sdiCode: '1234567',
  }
  const second = await call({ form: corrected, items: [line()], idempotencyKey: key })

  assert.equal(second.status, 409, diagnostic(second.status, second.body))
  assert.equal(second.body.error, 'ordine_non_coerente')
  assert.deepEqual(Object.keys(second.body), ['error'])
  assert.equal(stubState.ordersCreated, 1, 'nessun ordine nuovo')
  assert.equal(stubState.orderPostAttempts, 1, 'nessuna seconda POST')
  assert.equal(stubState.stripeIntents.length, 1, 'nessuna nuova PaymentIntent')
  assert.equal(stubState.cmsOrders[0].billingVatNumber, FORM.vatNumber, 'documento immutato')
  assert.equal(stubState.cmsOrders[0].billingCompanyName, FORM.businessName)
  assert.equal(stubState.cmsOrders[0].billingSdiCode, '0000000')
})

test('B1.4 Stripe: cambio paese a totale identico -> 409, indirizzo invariato', async () => {
  const key = 'b1-stripe-paese-stesso-01'
  const first = await call({
    form: { ...FORM, shippingCountry: 'IT' },
    items: [line({ qty: 20 })],
    idempotencyKey: key,
  })
  assert.equal(first.status, 200, diagnostic(first.status, first.body))

  const second = await call({
    form: { ...FORM, shippingCountry: 'FR' },
    items: [line({ qty: 20 })],
    idempotencyKey: key,
  })

  assert.equal(second.status, 409, diagnostic(second.status, second.body))
  assert.equal(second.body.error, 'ordine_non_coerente')
  assert.equal(stubState.ordersCreated, 1)
  assert.equal(stubState.orderPostAttempts, 1)
  assert.equal(stubState.stripeIntents.length, 1, 'nessuna nuova PaymentIntent')
  const shippingAddress = stubState.cmsOrders[0].shippingAddress as Record<string, unknown>
  assert.equal(shippingAddress.country, 'IT', 'indirizzo del documento invariato')
})

test('B1.5a Stripe: nota del cliente diversa sulla stessa chiave -> 409', async () => {
  const key = 'b1-stripe-nota-0000001'
  const first = await call({
    form: { ...FORM, notes: 'Consegna al piano' },
    items: [line()],
    idempotencyKey: key,
  })
  assert.equal(first.status, 200, diagnostic(first.status, first.body))
  const storedNotes = stubState.cmsOrders[0].notes

  const second = await call({
    form: { ...FORM, notes: 'Consegna al portone' },
    items: [line()],
    idempotencyKey: key,
  })

  assert.equal(second.status, 409, diagnostic(second.status, second.body))
  assert.equal(second.body.error, 'ordine_non_coerente')
  assert.equal(stubState.ordersCreated, 1)
  assert.equal(stubState.orderPostAttempts, 1)
  assert.equal(stubState.stripeIntents.length, 1)
  assert.equal(stubState.cmsOrders[0].notes, storedNotes, 'nota del documento invariata')
})

test('B1.5b Stripe: VIES non verificato poi valido non produce un 409 falso', async () => {
  const body = { form: FORM, items: [line()], idempotencyKey: 'b1-stripe-vies-000001' }

  stubState.viesStatus = 500
  const first = await call(body)
  assert.equal(first.status, 200, diagnostic(first.status, first.body))
  assert.match(String(stubState.cmsOrders[0].notes), /VIES NON VERIFICATA/)

  stubState.viesStatus = 200
  const second = await call(body)

  assert.equal(second.status, 200, diagnostic(second.status, second.body))
  assert.equal(second.body.orderNumber, first.body.orderNumber)
  assert.equal(second.body.clientSecret, first.body.clientSecret)
  assert.equal(stubState.ordersCreated, 1)
  assert.equal(stubState.orderPostAttempts, 1)
  assert.equal(stubState.stripeIntents.length, 1)
})

test('B1.6 Stripe: ordine pagato con campi diversi -> 409 ordine_gia_pagato', async () => {
  const key = 'b1-stripe-pagato-000001'
  const first = await call({ form: FORM, items: [line()], idempotencyKey: key })
  assert.equal(first.status, 200, diagnostic(first.status, first.body))
  markOrderPaid(String(first.body.orderNumber))

  const second = await call({
    form: { ...FORM, vatNumber: 'IT99999999999', businessName: 'Studio Corretto Srl' },
    items: [line()],
    idempotencyKey: key,
  })

  assert.equal(second.status, 409, diagnostic(second.status, second.body))
  assert.equal(second.body.error, 'ordine_gia_pagato', 'il pagato viene prima del confronto')
  assert.equal(stubState.ordersCreated, 1)
  assert.equal(stubState.orderPostAttempts, 1)
  assert.equal(stubState.stripeIntents.length, 1)
})
