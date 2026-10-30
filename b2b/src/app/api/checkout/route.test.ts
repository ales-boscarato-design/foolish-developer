/**
 * Test della ROTTA VERA /api/checkout (bonifico).
 *
 * Il test importa ed esegue la `POST` esportata da `route.ts`, costruendo una
 * `NextRequest` vera di `next/server`. La rotta usa `realCheckoutDeps`: il
 * confine di mock e' quindi sulle chiamate esterne, non sulla rotta. Lo stub
 * HTTP locale (`src/test-support/http-stub.ts`) risponde a CMS, VIES e Stripe;
 * `globalThis.fetch` e' sostituito e qualunque host non previsto fa fallire
 * il test. "Nessun ordine" e "nessuna PaymentIntent" sono contatori a zero.
 *
 * La sessione e' un JWT vero firmato con `B2B_SESSION_SECRET` e inviato nel
 * cookie: la rotta lo verifica con `getServerSession(req)`. Una sessione
 * valida evita la creazione dell'anagrafica ospite (e quindi il database),
 * che non e' oggetto di questi test.
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
} from '../../../test-support/http-stub'

// --- catalogo sintetico -----------------------------------------------------

/** Stencil sintetico: listino 14,99 EUR; 20% da 10 a 49 pz, 30% da 50 pz. */
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
      variants: [
        { id: 'v1', sku: 'ST-14', label: '14 cm', price: 14.99, stockStatus: 'available' },
      ],
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
      // Prezzo che dopo lo sconto non e' un centesimo intero: 12,50 -35% =
      // 8,125. Serve a provare che l'arrotondamento avviene sul totale riga.
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

// --- harness ----------------------------------------------------------------

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
let baseUrl = ''

before(async () => {
  baseUrl = await startStub()
  process.env.CMS_URL = baseUrl
  process.env.PAYLOAD_API_SECRET = 'test-payload-secret'
  process.env.B2B_SESSION_SECRET = 'test-session-secret'
  // Nessun database reale: le richieste rifiutate non ci arrivano, le
  // richieste legittime usano una sessione e non creano l'anagrafica ospite.
  process.env.DATABASE_URL = 'postgres://test:test@127.0.0.1:1/test'
  // Bassa solo nei test: il timeout vero e' 5 s.
  process.env.B2B_CATALOG_TIMEOUT_MS = '200'

  installFetchRouting()

  const auth = await import('../../../lib/auth')
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

function makeRequest(body: unknown, withSession = true, withKey = true): NextRequest {
  const payload = withKey ? withIdempotencyKey(body) : body
  return new NextRequest('http://b2b.test/api/checkout', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(withSession ? { cookie: `b2b_session=${sessionToken}` } : {}),
    },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  })
}

async function call(body: unknown, withSession = true, withKey = true) {
  const res = await post(makeRequest(body, withSession, withKey))
  const json = await res.json() as Record<string, unknown>
  return { status: res.status, body: json }
}

function diagnostic(status: number, body: unknown): string {
  return `status ${status}, ordini POST /api/orders: ${stubState.orderPosts.length}, body ${JSON.stringify(body)}`
}

/** Rifiuto controllato: nessun ordine, nessuna PaymentIntent, corpo minimo. */
function assertRejected(r: Awaited<ReturnType<typeof call>>, status: number, error: string): void {
  assert.equal(r.status, status, diagnostic(r.status, r.body))
  assert.equal(r.body.error, error, diagnostic(r.status, r.body))
  assert.deepEqual(Object.keys(r.body), ['error'], 'il corpo non porta dettagli interni')
  assert.equal(stubState.orderPosts.length, 0, diagnostic(r.status, r.body))
  assert.equal(stubState.stripeIntents.length, 0, 'nessuna PaymentIntent per un rifiuto')
}

// --- prezzo / fasce manomessi ----------------------------------------------

test('unitPrice manipolato a 0.01: 400 prezzo_non_allineato, nessun effetto', async () => {
  const r = await call({ form: FORM, items: [line({ unitPrice: 0.01 })] })
  assertRejected(r, 400, 'prezzo_non_allineato')
  assert.ok(!JSON.stringify(r.body).includes('14.99'), 'la risposta non rivela il prezzo del catalogo')
})

test('unitPrice con piu di due decimali (14.989): 400 prezzo_non_valido', async () => {
  const r = await call({ form: FORM, items: [line({ unitPrice: 14.989 })] })
  assertRejected(r, 400, 'prezzo_non_valido')
})

test('unitPrice discordante di un centesimo (14.98): 400 prezzo_non_allineato', async () => {
  const r = await call({ form: FORM, items: [line({ unitPrice: 14.98 })] })
  assertRejected(r, 400, 'prezzo_non_allineato')
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

test('tier fuori soglia (sconto 150%): 400 fasce_non_allineate', async () => {
  const r = await call({
    form: FORM,
    items: [line({
      priceTiers: [{ minQty: 10, maxQty: 49, discountPercent: 150 }, { minQty: 50, maxQty: null, discountPercent: 30 }],
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

test('qty oltre il tetto (100001): 400 quantita_non_valida', async () => {
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

test('SKU case-sensitive: st-14 non trova ST-14', async () => {
  const r = await call({ form: FORM, items: [line({ variantSku: 'st-14' })] })
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

test('productId assente: 400 prodotto_non_valido', async () => {
  const withoutId = line()
  delete withoutId.productId
  const r = await call({ form: FORM, items: [withoutId] })
  assertRejected(r, 400, 'prodotto_non_valido')
})

test('prodotto active:false ma resellerVisible:true: vendibile, ordine creato', async () => {
  const r = await call({
    form: FORM,
    items: [line({ productId: 3, productSlug: 'prodotto-spento', variantSku: 'OFF-1', unitPrice: 9.99, priceTiers: [] })],
  })
  assert.equal(r.status, 200, diagnostic(r.status, r.body))
  assert.equal(stubState.orderPosts.length, 1)
  assert.equal(stubState.orderPosts[0].total, 17.64)
  const items = stubState.orderPosts[0].lineItems as Array<Record<string, unknown>>
  assert.equal(items[0].sku, 'OFF-1')
})

test('variante stockStatus unavailable: 400 variante_non_disponibile, nessun ordine e nessuna PaymentIntent', async () => {
  const docs = baseCatalog()
  const first = docs[0] as Record<string, unknown>
  ;(first.variants as Array<Record<string, unknown>>)[0].stockStatus = 'unavailable'
  stubState.cmsDocs = docs
  const r = await call({ form: FORM, items: [line()] })
  assertRejected(r, 400, 'variante_non_disponibile')
})

test('variante stockStatus low: vendibile, ordine creato', async () => {
  const r = await call({
    form: FORM,
    items: [line({ productId: 2, productSlug: 'kit-test', variantSku: 'KIT-5', unitPrice: 5, priceTiers: [] })],
  })
  assert.equal(r.status, 200, diagnostic(r.status, r.body))
  assert.equal(stubState.orderPosts.length, 1)
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

test('email non valida: 400 email_non_valida senza chiamare VIES', async () => {
  // Senza sessione: l'email del form e' l'unica disponibile e non e' valida.
  const r = await call({ form: { ...FORM, email: 'non-una-email' }, items: [line()] }, false)
  assertRejected(r, 400, 'email_non_valida')
  assert.equal(stubState.viesRequests, 0)
})

test('ragione sociale mancante: 400 ragione_sociale_mancante', async () => {
  const r = await call({ form: { ...FORM, businessName: '  ' }, items: [line()] })
  assertRejected(r, 400, 'ragione_sociale_mancante')
})

test('partita IVA invalida: 400 partita_iva_non_valida prima del catalogo', async () => {
  stubState.viesValid = false
  const r = await call({ form: FORM, items: [line()] })
  assertRejected(r, 400, 'partita_iva_non_valida')
  assert.equal(stubState.productsRequests.length, 0)
})

// --- campi di form non stringa ---------------------------------------------

for (const [field, value] of [
  ['email', 5],
  ['businessName', 5],
  ['vatNumber', 5],
  ['shippingCountry', { code: 'IT' }],
  ['notes', { text: 'nota' }],
] as const) {
  test(`form.${field} non stringa: 400 campo_non_valido, nessun effetto`, async () => {
    const r = await call({ form: { ...FORM, [field]: value }, items: [line()] })
    assertRejected(r, 400, 'campo_non_valido')
  })
}

test('body non JSON: 400 body_non_valido', async () => {
  const r = await call('{ non json')
  assertRejected(r, 400, 'body_non_valido')
})

// --- caso legittimo ---------------------------------------------------------

const LEGIT: Array<{ qty: number; country: string; productsCents: number; shippingCents: number }> = [
  { qty: 1, country: 'IT', productsCents: 1499, shippingCents: 765 },
  { qty: 9, country: 'IT', productsCents: 13491, shippingCents: 0 }, // minQty-1
  { qty: 10, country: 'IT', productsCents: 11992, shippingCents: 0 }, // minQty
  { qty: 49, country: 'IT', productsCents: 58761, shippingCents: 0 }, // maxQty
  { qty: 50, country: 'IT', productsCents: 52465, shippingCents: 0 }, // maxQty+1
  { qty: 1, country: 'FR', productsCents: 1499, shippingCents: 1499 },
  { qty: 10, country: 'FR', productsCents: 11992, shippingCents: 1499 },
]

for (const scenario of LEGIT) {
  const totalCents = scenario.productsCents + scenario.shippingCents
  test(`legittimo qty ${scenario.qty} ${scenario.country}: totale ${totalCents} centesimi, un solo ordine`, async () => {
    const r = await call({
      form: { ...FORM, shippingCountry: scenario.country },
      items: [line({ qty: scenario.qty })],
    })
    assert.equal(r.status, 200, diagnostic(r.status, r.body))
    assert.equal(stubState.orderPosts.length, 1, 'un solo ordine')
    assert.equal(stubState.stripeIntents.length, 0, 'la rotta bonifico non crea PaymentIntent')
    const order = stubState.orderPosts[0]
    assert.equal(Math.round((order.total as number) * 100), totalCents)
    assert.equal(Math.round((order.shippingCost as number) * 100), scenario.shippingCents)
    const items = order.lineItems as Array<Record<string, unknown>>
    assert.equal(items[0].sku, 'ST-14')
    assert.equal(items[0].name, 'Stencil Test (sintetico)')
    assert.equal(items[0].quantity, scenario.qty)
  })
}

test('arrotondamento: 12,50 -35% x 50 = 406,25 EUR (40625 centesimi), non 406,50', async () => {
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
})

test('il catalogo si legge fresco, completo e senza filtro active', async () => {
  const r = await call({ form: FORM, items: [line({ qty: 10 })] })
  assert.equal(r.status, 200, diagnostic(r.status, r.body))
  assert.equal(stubState.productsRequests.length, 1)
  const query = new URLSearchParams(stubState.productsRequests[0].split('?')[1])
  assert.equal(query.get('where[resellerVisible][equals]'), 'true')
  assert.equal(query.get('depth'), '0')
  assert.equal(query.get('limit'), '200')
  assert.equal(query.get('locale'), 'it')
  assert.equal(query.get('where[active][equals]'), null)
})


// --- R5: idempotenza (D1-D3, D5-D6) ---------------------------------------

test('R5.6 chiave mancante: 400 chiave_idempotenza_mancante, zero VIES e zero catalogo', async () => {
  const r = await call({ form: FORM, items: [line()] }, true, false)
  assert.equal(r.status, 400, diagnostic(r.status, r.body))
  assert.equal(r.body.error, 'chiave_idempotenza_mancante')
  assert.equal(stubState.viesRequests, 0, 'la chiave si valida prima di VIES')
  assert.equal(stubState.productsRequests.length, 0, 'la chiave si valida prima del catalogo')
  assert.equal(stubState.orderPosts.length, 0)
})

for (const [label, idempotencyKey] of [
  ['non stringa', 1234567890123456],
  ['troppo corta (15)', 'a'.repeat(15)],
  ['troppo lunga (129)', 'a'.repeat(129)],
  ['carattere illegale', 'abc def ghi jkl mno'],
] as const) {
  test(`R5.6 chiave ${label}: 400 chiave_idempotenza_mancante senza servizi esterni`, async () => {
    const r = await call({ form: FORM, items: [line()], idempotencyKey })
    assert.equal(r.status, 400, diagnostic(r.status, r.body))
    assert.equal(r.body.error, 'chiave_idempotenza_mancante')
    assert.equal(stubState.viesRequests, 0)
    assert.equal(stubState.productsRequests.length, 0)
    assert.equal(stubState.orderPosts.length, 0)
  })
}

test('R5.7 bonifico: retry con la stessa chiave, un solo ordine e una sola POST', async () => {
  const body = { form: FORM, items: [line()], idempotencyKey: 'bonifico-retry-000001' }
  const first = await call(body)
  assert.equal(first.status, 200, diagnostic(first.status, first.body))
  const second = await call(body)

  assert.equal(second.status, 200, diagnostic(second.status, second.body))
  assert.equal(second.body.orderNumber, first.body.orderNumber)
  assert.equal(stubState.ordersCreated, 1)
  assert.equal(stubState.orderPosts.length, 1, 'una sola POST /api/orders')
  assert.equal(stubState.stripeIntents.length, 0)
})

test('R5.7 bonifico: ordine gia pagato -> 409 ordine_gia_pagato, nessun nuovo ordine', async () => {
  const body = { form: FORM, items: [line()], idempotencyKey: 'bonifico-paid-000001' }
  const first = await call(body)
  assert.equal(first.status, 200, diagnostic(first.status, first.body))
  markOrderPaid(String(first.body.orderNumber))

  const second = await call(body)
  assert.equal(second.status, 409, diagnostic(second.status, second.body))
  assert.equal(second.body.error, 'ordine_gia_pagato')
  assert.equal(stubState.ordersCreated, 1)
  assert.equal(stubState.orderPostAttempts, 1)
})

test('R5.5 documento CMS con email divergente: 409 ordine_non_coerente, nessun ordine nuovo', async () => {
  const body = { form: FORM, items: [line()], idempotencyKey: 'coerenza-email-000001' }
  const first = await call(body)
  assert.equal(first.status, 200, diagnostic(first.status, first.body))
  patchStoredOrder(String(first.body.orderNumber), { customerEmail: 'altro@example.test' })

  const second = await call(body)
  assert.equal(second.status, 409, diagnostic(second.status, second.body))
  assert.equal(second.body.error, 'ordine_non_coerente')
  assert.equal(stubState.ordersCreated, 1)
  assert.equal(stubState.orderPostAttempts, 1)
})

test('R5.5 documento CMS con totale divergente: 409 ordine_non_coerente, nessun ordine nuovo', async () => {
  const body = { form: FORM, items: [line()], idempotencyKey: 'coerenza-totale-00001' }
  const first = await call(body)
  assert.equal(first.status, 200, diagnostic(first.status, first.body))
  patchStoredOrder(String(first.body.orderNumber), { total: 1 })

  const second = await call(body)
  assert.equal(second.status, 409, diagnostic(second.status, second.body))
  assert.equal(second.body.error, 'ordine_non_coerente')
  assert.equal(stubState.ordersCreated, 1)
  assert.equal(stubState.orderPostAttempts, 1)
})

test('R5.3 riavvio: seconda invocazione da modulo fresco, un solo ordine', async () => {
  const body = { form: FORM, items: [line()], idempotencyKey: 'riavvio-modulo-000001' }
  const first = await call(body)
  assert.equal(first.status, 200, diagnostic(first.status, first.body))

  const freshUrl = new URL('../../../lib/b2b-checkout.ts?fresh=1', import.meta.url).href
  const fresh = await import(freshUrl) as typeof import('../../../lib/b2b-checkout')
  const res = await fresh.handleCheckout(makeRequest(body), fresh.realCheckoutDeps)
  const json = await res.json() as Record<string, unknown>

  assert.equal(res.status, 200, diagnostic(res.status, json))
  assert.equal(json.orderNumber, first.body.orderNumber)
  assert.equal(stubState.ordersCreated, 1)
  assert.equal(stubState.orderPostAttempts, 1)
})

// --- B1: riuso idempotente e coerenza del documento ------------------------

test('B1.2 bonifico: riuso identico, stesso ordine e una sola POST', async () => {
  const body = { form: FORM, items: [line()], idempotencyKey: 'b1-bonifico-identico-01' }

  const first = await call(body)
  assert.equal(first.status, 200, diagnostic(first.status, first.body))
  const second = await call(body)

  assert.equal(second.status, 200, diagnostic(second.status, second.body))
  assert.equal(second.body.orderNumber, first.body.orderNumber, 'stesso orderNumber')
  assert.equal(stubState.ordersCreated, 1)
  assert.equal(stubState.orderPostAttempts, 1, 'una sola POST /api/orders')
  assert.equal(stubState.stripeIntents.length, 0, 'il bonifico non crea PaymentIntent')
})

test('B1.3 bonifico: P.IVA/ragione sociale/SDI corretti -> 409 ordine_non_coerente', async () => {
  const key = 'b1-bonifico-corretti-001'
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
  assert.equal(stubState.cmsOrders[0].billingVatNumber, FORM.vatNumber, 'documento immutato')
  assert.equal(stubState.cmsOrders[0].billingCompanyName, FORM.businessName)
  assert.equal(stubState.cmsOrders[0].billingSdiCode, '0000000')
})

test('B1.4 bonifico: cambio paese a totale identico -> 409, indirizzo invariato', async () => {
  const key = 'b1-bonifico-paese-stesso-01'
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
  const shippingAddress = stubState.cmsOrders[0].shippingAddress as Record<string, unknown>
  assert.equal(shippingAddress.country, 'IT', 'indirizzo del documento invariato')
})

test('B1.4 inverso bonifico: paese sotto soglia e totale diverso -> nuovo ordine pendente', async () => {
  const key = 'b1-bonifico-paese-diverso-1'
  const first = await call({
    form: { ...FORM, shippingCountry: 'IT' },
    items: [line({ qty: 10 })],
    idempotencyKey: key,
  })
  assert.equal(first.status, 200, diagnostic(first.status, first.body))

  const second = await call({
    form: { ...FORM, shippingCountry: 'FR' },
    items: [line({ qty: 10 })],
    idempotencyKey: key,
  })

  // Il totale cambia (IT gratis, FR 14,99): cambia orderNumber e nasce un
  // secondo pending. Nessun pagamento viene registrato.
  assert.equal(second.status, 200, diagnostic(second.status, second.body))
  assert.notEqual(second.body.orderNumber, first.body.orderNumber)
  assert.equal(stubState.ordersCreated, 2)
  assert.equal(stubState.stripeIntents.length, 0)
  assert.deepEqual(stubState.cmsOrders.map((order) => order.paymentStatus), ['pending', 'pending'])
})

test('B1.5a bonifico: nota del cliente diversa sulla stessa chiave -> 409', async () => {
  const key = 'b1-bonifico-nota-000001'
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
  assert.equal(stubState.cmsOrders[0].notes, storedNotes, 'nota del documento invariata')
})

test('B1.5b bonifico: VIES non verificato poi valido non produce un 409 falso', async () => {
  const body = { form: FORM, items: [line()], idempotencyKey: 'b1-bonifico-vies-00001' }

  stubState.viesStatus = 500
  const first = await call(body)
  assert.equal(first.status, 200, diagnostic(first.status, first.body))
  assert.match(String(stubState.cmsOrders[0].notes), /VIES NON VERIFICATA/)

  stubState.viesStatus = 200
  const second = await call(body)

  assert.equal(second.status, 200, diagnostic(second.status, second.body))
  assert.equal(second.body.orderNumber, first.body.orderNumber)
  assert.equal(stubState.ordersCreated, 1)
  assert.equal(stubState.orderPostAttempts, 1)
})

test('B1.6 bonifico: ordine pagato con campi diversi -> 409 ordine_gia_pagato', async () => {
  const key = 'b1-bonifico-pagato-0001'
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
})
