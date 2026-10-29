/**
 * Test del GATE VERO del portale: il middleware `src/proxy.ts`.
 *
 * Il difetto che questo file sorveglia: `/api/cart/prices` e' l'unica via di
 * rimedio a un `400 prezzo_non_allineato` al checkout, e il checkout e'
 * deliberatamente pubblico (ospite ammesso, carrello in localStorage). Se la
 * rotta resta dietro l'auth del middleware, un ospite con un prezzo vecchio nel
 * carrello non puo' completare l'ordine: ogni submit torna 400 e il pannello di
 * revisione risponde 307 -> /login.
 *
 * Qui non si testa un helper: si chiama il `proxy` esportato, con la stessa
 * `NextRequest` che il runtime gli passerebbe, e poi si passa la richiesta al
 * VERO handler `POST /api/cart/prices`. Le asserzioni sono sul comportamento
 * dell'accoppiata gate+rotta:
 *  - ospite (nessun cookie)      -> nessun redirect, 200 con `items`
 *  - sessione valida             -> stesso esito
 *  - rotta non elencata (/account, /api/orders) -> 307 verso /login
 *  - cookie non valido           -> 307 e cookie di sessione cancellato
 *
 * Se la voce viene tolta da PUBLIC_PATHS il primo test diventa rosso: e' il
 * suo scopo. Il CMS e' lo stub HTTP locale, nessuna richiesta esce.
 *
 * Va eseguito in un processo suo (`npm run test:proxy`, in coda a
 * `test:checkout`): `src/lib/cms.ts` lega `CMS_URL` all'import, quindi dentro
 * un'esecuzione unica con gli altri file lo stub di un altro file prenderebbe
 * il sopravvento e questa rotta risponderebbe 503 per un motivo che non
 * c'entra nulla con il gate.
 */

import assert from 'node:assert/strict'
import test, { after, before, beforeEach } from 'node:test'
import { NextRequest } from 'next/server'
import { SignJWT } from 'jose'

import {
  installFetchRouting,
  resetStub,
  startStub,
  stopStub,
  stubState,
} from './test-support/http-stub'

/** Segreto solo di test: non e' e non deve essere quello di produzione. */
const SESSION_SECRET = 'test-only-b2b-session-secret'

const TIERS = [
  { minQty: 10, maxQty: 49, discountPercent: 20 },
  { minQty: 50, maxQty: null, discountPercent: 30 },
]

/** Catalogo SINTETICO: questi non sono prezzi di listino. */
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
      ],
    },
  ]
}

type Proxy = typeof import('./proxy').proxy
type PostCartPrices = typeof import('./app/api/cart/prices/route').POST

let proxy: Proxy
let postCartPrices: PostCartPrices

before(async () => {
  const baseUrl = await startStub()
  process.env.CMS_URL = baseUrl
  // Bassa solo nei test: il timeout vero e' 5 s.
  process.env.B2B_CATALOG_TIMEOUT_MS = '200'
  // Il middleware legge il segreto all'import: va impostato PRIMA.
  process.env.B2B_SESSION_SECRET = SESSION_SECRET

  installFetchRouting()
  proxy = (await import('./proxy')).proxy
  postCartPrices = (await import('./app/api/cart/prices/route')).POST
})

after(async () => {
  await stopStub()
})

beforeEach(() => {
  resetStub()
  stubState.cmsDocs = baseCatalog()
})

const CART_PRICES_BODY = { items: [{ variantSku: 'ST-14', qty: 10 }] }

function makeRequest(
  pathname: string,
  init: { cookie?: string } = {},
): NextRequest {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (init.cookie) headers.set('cookie', init.cookie)
  return new NextRequest(`http://b2b.test${pathname}`, {
    method: 'POST',
    headers,
    body: pathname === '/api/cart/prices' ? JSON.stringify(CART_PRICES_BODY) : undefined,
  })
}

function assertNotRedirected(pathname: string, res: Response): void {
  assert.equal(
    res.headers.get('location'),
    null,
    `${pathname}: il middleware ha rediretto a ${res.headers.get('location')}`,
  )
  assert.notEqual(res.status, 307, `${pathname}: 307 invece di passare alla rotta`)
  assert.notEqual(res.status, 308, `${pathname}: 308 invece di passare alla rotta`)
  // NextResponse.next() porta questo header: passaggio al handler, non risposta.
  assert.equal(res.headers.get('x-middleware-next'), '1', `${pathname}: non e' un passaggio`)
}

async function validSessionCookie(): Promise<string> {
  const token = await new SignJWT({ sub: '1', email: 'sessione-test@example.test' })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(SESSION_SECRET))
  return `b2b_session=${token}`
}

// --- il difetto: la rotta dei prezzi deve essere raggiungibile dall'ospite ----

test('ospite: /api/cart/prices non viene rediretto e la rotta risponde 200 con items', async () => {
  const req = makeRequest('/api/cart/prices')
  const gate = await proxy(req)
  assertNotRedirected('/api/cart/prices', gate)

  // Stessa richiesta al handler vero: il gate l'ha lasciata passare davvero.
  const res = await postCartPrices(req)
  const body = (await res.json()) as Record<string, unknown>

  assert.equal(res.status, 200, JSON.stringify(body))
  const items = body.items as Array<Record<string, unknown>>
  assert.equal(items.length, 1, 'la risposta deve contenere le righe richieste')
  assert.equal(items[0].variantSku, 'ST-14')
  assert.equal(items[0].lineTotalCents, 11992)
  assert.equal(stubState.productsRequests.length, 1)
  // Sola lettura: nessun ordine, nessuna PaymentIntent.
  assert.equal(stubState.orderPosts.length, 0)
  assert.equal(stubState.stripeIntents.length, 0)
})

test('sessione valida: /api/cart/prices si comporta allo stesso modo', async () => {
  const req = makeRequest('/api/cart/prices', { cookie: await validSessionCookie() })
  const gate = await proxy(req)
  assertNotRedirected('/api/cart/prices', gate)

  const res = await postCartPrices(req)
  const body = (await res.json()) as Record<string, unknown>
  assert.equal(res.status, 200, JSON.stringify(body))
  assert.equal((body.items as unknown[]).length, 1)
})

// --- nessun allargamento: le altre rotte restano protette --------------------

for (const pathname of ['/account', '/api/orders', '/dashboard', '/api/cart/items']) {
  test(`ospite: ${pathname} resta protetta e redirige a /login`, async () => {
    const res = await proxy(makeRequest(pathname))
    assert.equal(res.status, 307, `${pathname}: atteso 307`)
    const location = res.headers.get('location')
    assert.ok(location, `${pathname}: manca Location`)
    assert.ok(
      new URL(location).pathname === '/login',
      `${pathname}: atteso redirect a /login, trovato ${location}`,
    )
  })
}

test('cookie non valido: 307 verso /login e cookie di sessione cancellato', async () => {
  const res = await proxy(makeRequest('/account', { cookie: 'b2b_session=non-un-jwt' }))
  assert.equal(res.status, 307)
  const location = res.headers.get('location')
  assert.ok(location)
  assert.equal(new URL(location).pathname, '/login')
  const setCookie = res.headers.get('set-cookie') ?? ''
  assert.match(setCookie, /b2b_session=/, 'il cookie rotto va cancellato')
})
