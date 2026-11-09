/**
 * Test della ROTTA VERA POST /api/cart/prices.
 *
 * La rotta e' di sola lettura: rilegge il catalogo con `fetchResellerCatalog`
 * (fail-closed), confronta gli SKU richiesti e restituisce i prezzi
 * autorevoli. Non deve creare ordini, non deve creare PaymentIntent e non
 * deve chiamare Stripe. Il CMS e' lo stub HTTP locale; qualunque host non
 * previsto fa fallire il test.
 *
 * I prezzi sono SINTETICI e inventati: non sono prezzi di listino.
 */

import assert from 'node:assert/strict'
import test, { after, before, beforeEach } from 'node:test'
import { NextRequest } from 'next/server'

import {
  installFetchRouting,
  resetStub,
  startStub,
  stopStub,
  stubState,
} from '../../../../test-support/http-stub'

const TIERS = [
  { minQty: 10, maxQty: 49, discountPercent: 20 },
  { minQty: 50, maxQty: null, discountPercent: 30 },
]

function baseCatalog(): Array<Record<string, unknown>> {
  return [
    {
      id: 1,
      slug: 'stencil-test',
      name: 'Stencil Test (sintetico)',
      active: true,
      resellerVisible: true,
      basePrice: 14.99,
      priceTiers: TIERS.map((tier) => ({ ...tier })),
      variants: [
        { id: 'v1', sku: 'ST-14', label: '14 cm', price: 14.99, stockStatus: 'available' },
        { id: 'v2', sku: 'ST-OFF', label: 'Esaurito', price: 14.99, stockStatus: 'unavailable' },
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
      variants: [{ id: 'v3', sku: 'KIT-5', label: 'Standard', price: 5, stockStatus: 'low' }],
    },
  ]
}

type Post = typeof import('./route').POST

let post: Post
let baseUrl = ''

before(async () => {
  baseUrl = await startStub()
  process.env.CMS_URL = baseUrl
  // Bassa solo nei test: il timeout vero e' 5 s.
  process.env.B2B_CATALOG_TIMEOUT_MS = '200'

  installFetchRouting()
  post = (await import('./route')).POST
})

after(async () => {
  await stopStub()
})

beforeEach(() => {
  resetStub()
  stubState.cmsDocs = baseCatalog()
})

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://b2b.test/api/cart/prices', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

async function call(body: unknown) {
  const res = await post(makeRequest(body))
  const json = await res.json() as Record<string, unknown>
  return { status: res.status, body: json }
}

function assertNoWrites(): void {
  assert.equal(stubState.orderPosts.length, 0, 'nessun ordine creato')
  assert.equal(stubState.orderPostAttempts, 0, 'nessuna POST /api/orders')
  assert.equal(stubState.stripeIntents.length, 0, 'nessuna PaymentIntent')
  assert.equal(stubState.viesRequests, 0, 'la rotta prezzi non chiama VIES')
}

// --- 200 con prezzi autorevoli ---------------------------------------------

test('200: prezzi autorevoli, lineTotalCents dalla funzione condivisa, SKU assente non disponibile', async () => {
  const r = await call({
    items: [
      { variantSku: 'ST-14', qty: 10 },
      { variantSku: 'KIT-5', qty: 3 },
      { variantSku: 'NON-ESISTE', qty: 2 },
    ],
  })

  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.productsTotalCents, 13492)
  const items = r.body.items as Array<Record<string, unknown>>
  assert.equal(items.length, 3)

  // ST-14: unitPrice e' il listino (14.99), la fascia 20% vive nel totale riga.
  assert.deepEqual(items[0], {
    variantSku: 'ST-14',
    qty: 10,
    available: true,
    unitPrice: 14.99,
    priceTiers: TIERS,
    lineTotalCents: 11992,
  })
  // KIT-5: prezzo 5.00, qty 3, nessuna fascia.
  assert.deepEqual(items[1], {
    variantSku: 'KIT-5',
    qty: 3,
    available: true,
    unitPrice: 5,
    priceTiers: [],
    lineTotalCents: 1500,
  })
  // SKU assente: disponibile false, prezzo null.
  assert.deepEqual(items[2], {
    variantSku: 'NON-ESISTE',
    qty: 2,
    available: false,
    unitPrice: null,
    priceTiers: [],
    lineTotalCents: 0,
  })

  assert.equal(stubState.productsRequests.length, 1)
  const query = new URLSearchParams(stubState.productsRequests[0].split('?')[1])
  assert.equal(query.get('where[resellerVisible][equals]'), 'true')
  assert.equal(query.get('depth'), '0')
  assert.equal(query.get('limit'), '200')
  assertNoWrites()
})

test('variante stockStatus unavailable: available false, prezzo comunque leggibile', async () => {
  const r = await call({ items: [{ variantSku: 'ST-OFF', qty: 1 }] })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const items = r.body.items as Array<Record<string, unknown>>
  assert.equal(items[0].available, false)
  assert.equal(items[0].unitPrice, 14.99)
  assertNoWrites()
})

// --- 503 catalogo -----------------------------------------------------------

test('CMS giu (500): 503 catalogo_non_disponibile, nessuna scrittura', async () => {
  stubState.cmsProductsStatus = 500
  const r = await call({ items: [{ variantSku: 'ST-14', qty: 1 }] })
  assert.equal(r.status, 503, JSON.stringify(r.body))
  assert.deepEqual(r.body, { error: 'catalogo_non_disponibile' })
  assertNoWrites()
})

test('CMS troncato: 503 catalogo_non_disponibile, nessuna scrittura', async () => {
  stubState.cmsTruncateBody = true
  const r = await call({ items: [{ variantSku: 'ST-14', qty: 1 }] })
  assert.equal(r.status, 503, JSON.stringify(r.body))
  assert.deepEqual(r.body, { error: 'catalogo_non_disponibile' })
  assertNoWrites()
})

test('catalogo troncato (totalDocs > docs): 503 catalogo_non_disponibile', async () => {
  stubState.cmsTotalDocs = 99
  const r = await call({ items: [{ variantSku: 'ST-14', qty: 1 }] })
  assert.equal(r.status, 503, JSON.stringify(r.body))
  assert.deepEqual(r.body, { error: 'catalogo_non_disponibile' })
  assertNoWrites()
})

test('CMS in timeout: 503 catalogo_non_disponibile, nessuna scrittura', async () => {
  stubState.cmsDelayMs = 1000
  const r = await call({ items: [{ variantSku: 'ST-14', qty: 1 }] })
  assert.equal(r.status, 503, JSON.stringify(r.body))
  assert.deepEqual(r.body, { error: 'catalogo_non_disponibile' })
  assertNoWrites()
})

// --- 400 corpo malformato ---------------------------------------------------

test('corpo non JSON: 400 righe_non_valide senza leggere il catalogo', async () => {
  const r = await call('{ non json')
  assert.equal(r.status, 400, JSON.stringify(r.body))
  assert.deepEqual(r.body, { error: 'righe_non_valide' })
  assert.equal(stubState.productsRequests.length, 0)
  assertNoWrites()
})

for (const [label, body] of [
  ['non oggetto', []],
  ['stringa', 'niente'],
  ['null', null],
  ['oggetto senza items', {}],
  ['items non array', { items: 'x' }],
  ['array vuoto', { items: [] }],
  ['riga non oggetto', { items: ['x'] }],
  ['piu di 100 righe', { items: Array.from({ length: 101 }, () => ({ variantSku: 'ST-14', qty: 1 })) }],
] as const) {
  test(`corpo malformato (${label}): 400 righe_non_valide`, async () => {
    const r = await call(body)
    assert.equal(r.status, 400, JSON.stringify(r.body))
    assert.deepEqual(r.body, { error: 'righe_non_valide' })
    assert.equal(stubState.productsRequests.length, 0)
    assertNoWrites()
  })
}

for (const [label, line] of [
  ['qty non intera', { variantSku: 'ST-14', qty: 1.5 }],
  ['qty zero', { variantSku: 'ST-14', qty: 0 }],
  ['qty negativa', { variantSku: 'ST-14', qty: -1 }],
  ['qty oltre il tetto', { variantSku: 'ST-14', qty: 100001 }],
  ['qty stringa', { variantSku: 'ST-14', qty: '3' }],
  ['qty null', { variantSku: 'ST-14', qty: null }],
  ['sku non stringa', { variantSku: 5, qty: 1 }],
  ['sku null', { variantSku: null, qty: 1 }],
  ['sku vuota', { variantSku: '  ', qty: 1 }],
] as const) {
  test(`riga malformata (${label}): 400 righe_non_valide`, async () => {
    const r = await call({ items: [line] })
    assert.equal(r.status, 400, JSON.stringify(r.body))
    assert.deepEqual(r.body, { error: 'righe_non_valide' })
    assert.equal(stubState.productsRequests.length, 0)
    assertNoWrites()
  })
}
