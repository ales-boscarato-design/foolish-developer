/**
 * Test della rotta che serve il prezzo extra-UE al carrello.
 *
 * Perche' esiste: e' l'unico punto in cui il negozio parla con la Pi di Alfred e
 * con il catalogo, e l'unico che puo' far uscire un prezzo sbagliato verso il
 * browser. Il test copre i casi che contano per i soldi: quota reale, fallback
 * quando la Pi non risponde, carrello con pack, destinazione UE, limite di
 * richieste, catalogo giu', e nessuna fuga di segreti nella risposta.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { NextRequest } from 'next/server'

const SHARED_SECRET = 'test-shared-secret-do-not-log'
const QUOTE_URL = 'https://quote.test/landed-cost/v1/quote'
process.env.LANDED_COST_URL = QUOTE_URL
process.env.LANDED_COST_SHARED_SECRET = SHARED_SECRET
process.env.SHIPPING_QUOTE_TOKEN_SECRET = 'test-token-secret'

import { POST } from './route'
import { cartFingerprint, resolveExtraEuShipping, verifyQuoteToken } from '@/lib/landed-cost'

const PRICES: Record<string, number> = {
  'T-3D-WMN-BCK': 99,
  'TS-A4': 23.9,
  'TS-A5': 12.5,
}

/** Risposta del servizio di quota con la forma reale (CH, Basel, merce 99), dopo
 * la correzione della copertura assicurata approvata (`goods_plus_shipping`). */
function quoteBody() {
  return {
    status: 'ok',
    goods_value: 99,
    parcel: { weight: 2, width: 40, height: 10, length: 40, packages: 1 },
    services: [
      {
        service_id: 22131,
        carrier: 'UPS',
        service_name: 'Standard Access Point',
        transport: 23,
        insurance: 3.57,
        import_charges: 14.77,
        ddp_fee: 4.96,
        shipping_and_import: 47.29,
        landed_cost_estimate: 47.29,
        insurance_coverage: {
          policy: 'goods_plus_shipping',
          base: 142.72,
          declared_goods_value: 99,
          shipping_cost_excluding_premium: 43.72,
          rate: 0.025,
          premium: 3.57,
          premium_quoted: 3.57,
          premium_agrees: true,
          minimum_premium: 0.99,
        },
        checkout_invoice_number: 'TFC-WEB-00011',
        expires_at: 1_800_000_000,
      },
    ],
  }
}

let quoteBehaviour: 'ok' | 'down' | 'error' = 'ok'
let cmsBehaviour: 'ok' | 'down' = 'ok'
let quoteCalls = 0

const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  // L'URL base del CMS e' letto al caricamento del modulo: si stuba per
  // percorso, non per host.
  if (url.includes('/api/products')) {
    if (cmsBehaviour === 'down') {
      return new Response(JSON.stringify({ error: 'down' }), { status: 500 })
    }
    const sku = new URL(url).searchParams.get('where[variants.sku][equals]') ?? ''
    const price = PRICES[sku]
    return new Response(
      JSON.stringify({
        docs: price === undefined ? [] : [
          {
            id: 1,
            active: true,
            name: 'Prodotto ' + sku,
            variants: [{ sku, label: 'Standard', price, stockStatus: 'available' }],
            packs: [{ id: '2', quantity: 2, discountPercent: 10, name: 'Pack 2' }],
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }
  if (url === QUOTE_URL) {
    quoteCalls += 1
    if (quoteBehaviour === 'down') throw new TypeError('network down')
    if (quoteBehaviour === 'error') return new Response('{}', { status: 503 })
    return new Response(JSON.stringify(quoteBody()), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  throw new Error(`fetch non previsto nel test: ${url}`)
}) as typeof fetch

function request(body: unknown, ip = '203.0.113.10'): NextRequest {
  return new NextRequest(new URL('https://shop.test/api/spedizione/quote'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  })
}

test.after(() => {
  globalThis.fetch = realFetch
})

test('destinazione extra-UE: risponde il prezzo della quota, senza segreti', async () => {
  quoteBehaviour = 'ok'
  const response = await POST(request({ country: 'CH', city: 'Basel', postalCode: '4058', items: [{ sku: 'T-3D-WMN-BCK', quantity: 1 }] }, '203.0.113.11'))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.country, 'CH')
  assert.equal(body.costCents, 5202)
  assert.equal(body.source, 'live_quote')
  assert.equal(body.verified, true)
  assert.equal(body.checkoutInvoiceNumber, 'TFC-WEB-00011')
  // il browser riceve il prezzo, non la composizione del nostro margine
  assert.equal(body.basisCostCents, undefined)
  assert.equal(body.quoteFailure, undefined)
  const serialized = JSON.stringify(body)
  assert.ok(!serialized.includes(SHARED_SECRET))
  assert.ok(!serialized.includes('shared'))

  // il gettone congela ESATTAMENTE quel prezzo per quel carrello
  const fingerprint = cartFingerprint([{ sku: 'T-3D-WMN-BCK', quantity: 1 }], 'CH')
  assert.equal(verifyQuoteToken(body.quoteToken, { countryCode: 'CH', fingerprint }), 5202)
  assert.equal(verifyQuoteToken(body.quoteToken, { countryCode: 'CH', fingerprint: 'altro' }), null)

  // ACCETTAZIONE: quello che il carrello ha mostrato e' quello che il checkout
  // incassa riusando il gettone di QUESTA route. Il checkout chiama lo stesso
  // resolver con lo stesso carrello risolto dal catalogo e `goodsCents` = 9.900.
  const charged = await resolveExtraEuShipping({
    countryCode: 'CH',
    goodsCents: 9900,
    items: [{ sku: 'T-3D-WMN-BCK', quantity: 1 }],
    quoteToken: body.quoteToken,
  })
  assert.ok(charged)
  assert.equal(charged.costCents, body.costCents)
})

test('Pi di Alfred giu: si risponde con la base prudenziale in casa, non con un errore', async () => {
  quoteBehaviour = 'down'
  const response = await POST(request({ country: 'US', city: 'New York', postalCode: '10001', items: [{ sku: 'TS-A4', quantity: 1 }] }, '203.0.113.12'))
  quoteBehaviour = 'ok'
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.verified, false)
  assert.ok(['price_table', 'profile'].includes(body.source))
  assert.ok(Number.isSafeInteger(body.costCents) && body.costCents >= 4800)
})

test('servizio di quota in errore: 503 dal servizio, prezzo prudenziale al cliente', async () => {
  quoteBehaviour = 'error'
  const response = await POST(request({ country: 'NO', city: 'Oslo', postalCode: '0150', items: [{ sku: 'TS-A5', quantity: 1 }] }, '203.0.113.13'))
  quoteBehaviour = 'ok'
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.verified, false)
  assert.ok(body.costCents >= 4800)
})

test('destinazione UE o non ammessa: nessuna quota, nessuna chiamata', async () => {
  const before = quoteCalls
  const italy = await POST(request({ country: 'IT', items: [{ sku: 'TS-A4', quantity: 1 }] }, '203.0.113.14'))
  assert.equal(italy.status, 400)
  const unknown = await POST(request({ country: 'ZZ', items: [{ sku: 'TS-A4', quantity: 1 }] }, '203.0.113.15'))
  assert.equal(unknown.status, 400)
  assert.equal(quoteCalls, before)
})

test('carrello non valido o con pack: la quota non si inventa un prezzo piu piccolo', async () => {
  const empty = await POST(request({ country: 'CH', items: [] }, '203.0.113.16'))
  assert.equal(empty.status, 400)
  const pack = await POST(request({ country: 'CH', items: [{ sku: 'T-3D-WMN-BCK-pack-2', quantity: 2 }] }, '203.0.113.17'))
  assert.equal(pack.status, 409)
})

test('catalogo giu: 503, mai un prezzo calcolato su un carrello sconosciuto', async () => {
  cmsBehaviour = 'down'
  const response = await POST(request({ country: 'CH', items: [{ sku: 'TS-A4', quantity: 1 }] }, '203.0.113.18'))
  cmsBehaviour = 'ok'
  assert.equal(response.status, 503)
})

test('limite di richieste: il servizio di quota non e spammabile dal negozio', async () => {
  const ip = '203.0.113.19'
  let limited = 0
  for (let index = 0; index < 45; index += 1) {
    const response = await POST(request({ country: 'CH', items: [{ sku: 'TS-A4', quantity: 1 }] }, ip))
    if (response.status === 429) limited += 1
  }
  assert.ok(limited > 0, 'attesa almeno una risposta 429')
})
