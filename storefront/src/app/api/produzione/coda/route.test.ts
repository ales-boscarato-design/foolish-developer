/**
 * Test della rotta `GET /api/produzione/coda`.
 *
 * La rotta e' il contratto che scheda prodotto, carrello e checkout consumano,
 * quindi il test chiama l'handler vero contro uno stub HTTP del CMS su porta
 * effimera (nessun CMS di produzione, nessun segreto reale). Copre: risposta
 * valida, richiesta sintatticamente sbagliata, e CMS giu' che deve restare
 * `unavailable` — mai `extraDays: 0`.
 *
 * Gli ordini sono datati `NOW` e lo stub mette l'istante reale quando risponde:
 * il test non dipende dal giorno in cui gira (con date fisse in fixture sarebbe
 * verde oggi e rosso domani, e non coprirebbe piu' il valore).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import test, { after, before, beforeEach } from 'node:test'

import { NextRequest } from 'next/server'
import { GET } from './route'
import { productionQueueDayKey } from '@/lib/production-queue'
import { resetProductionQueueReadCache } from '@/lib/production-queue-service'

const fixtures = JSON.parse(
  readFileSync(new URL('../../../../lib/production-queue.fixtures.json', import.meta.url), 'utf8'),
) as { catalog: unknown[] }

interface StubState {
  down: boolean
  orders: unknown[]
  ordersCalls: number
}

const state: StubState = { down: false, orders: [], ordersCalls: 0 }

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

/** Ordine pagato con `createdAt` materializzato al momento della risposta. */
function paidOrder(sku: string, quantity: number) {
  return {
    id: 1,
    orderNumber: 'FOOLISH-ROUTE-TEST',
    createdAt: 'NOW',
    paymentStatus: 'paid',
    lineItems: [{ sku, quantity }],
  }
}

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? '/', 'http://stub.test')
  if (state.down) return sendJson(res, 503, { error: 'down' })

  if (url.pathname === '/api/orders') {
    state.ordersCalls += 1
    const nowIso = new Date().toISOString()
    const docs = state.orders.map((order) => (
      order && typeof order === 'object' && (order as { createdAt?: unknown }).createdAt === 'NOW'
        ? { ...(order as Record<string, unknown>), createdAt: nowIso }
        : order
    ))
    return sendJson(res, 200, { docs, totalDocs: docs.length, hasNextPage: false })
  }
  if (url.pathname === '/api/products') {
    return sendJson(res, 200, {
      docs: fixtures.catalog,
      totalDocs: fixtures.catalog.length,
      hasNextPage: false,
    })
  }
  return sendJson(res, 404, { error: 'not found' })
})

after(() => {
  server.close()
})

// tsx transpila i test in CJS: niente top-level await. Lo stub si mette in
// ascolto in `before` e solo allora si punta l'ambiente su di lui.
let cmsUrl = ''
const ready = new Promise<void>((resolve) => {
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address() as AddressInfo
    cmsUrl = `http://127.0.0.1:${port}`
    resolve()
  })
})

before(async () => {
  await ready
  // URL e secret si leggono a ogni chiamata: il test resta ermetico e non tocca
  // ne' il CMS ne' il secret di produzione.
  process.env.PAYLOAD_PUBLIC_URL = cmsUrl
  process.env.STOREFRONT_API_SECRET = 'test-storefront-secret'
})

// La cache di processo e' condivisa fra i test: senza azzerarla il secondo caso
// leggerebbe gli ordini del primo e il test misurerebbe la cache, non la rotta.
beforeEach(() => {
  resetProductionQueueReadCache()
  state.ordersCalls = 0
})

function request(query: string) {
  return new NextRequest(`https://thefoolishbutcher.com/api/produzione/coda${query}`)
}

test('rotta: 200 con la stima per gli SKU richiesti', async () => {
  state.down = false
  state.orders = [paidOrder('DBL-A4', 21)]

  const response = await GET(request('?sku=DBL-A4'))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')

  const body = await response.json() as Record<string, unknown>
  assert.equal(body.state, 'ok')
  assert.equal(body.extraDays, 1)
  assert.equal(body.batchSize, 20)
  // Giornata calcolata, non una data scritta nel test: la rotta usa l'orologio
  // vero e il caso deve restare valido in qualunque giorno giri.
  assert.equal(body.dayKey, productionQueueDayKey(new Date()))
  assert.deepEqual(body.requested, [{ sku: 'DBL-A4', format: 'a4' }])
  assert.equal(body.catalogState, 'ok')

  // La rotta e' pubblica: il dettaglio operativo non deve uscire.
  for (const hidden of ['loads', 'extraDaysByFormat', 'unknownSkus', 'unknownPieces', 'excludedOrders', 'ordersRead']) {
    assert.equal(hidden in body, false, `${hidden} non deve uscire dalla rotta pubblica`)
  }
})

test('rotta: 20 pezzi restano a +0, il 21esimo alza la stima', async () => {
  state.down = false

  state.orders = [paidOrder('DBL-A4', 20)]
  const twenty = await (await GET(request('?sku=DBL-A4'))).json() as Record<string, unknown>
  assert.equal(twenty.state, 'ok')
  assert.equal(twenty.extraDays, 0)

  resetProductionQueueReadCache()
  state.orders = [paidOrder('DBL-A4', 21)]
  const twentyOne = await (await GET(request('?sku=DBL-A4'))).json() as Record<string, unknown>
  assert.equal(twentyOne.state, 'ok')
  assert.equal(twentyOne.extraDays, 1)
})

test('rotta: il carrello misto chiede tutti gli SKU e non somma i formati', async () => {
  state.down = false
  state.orders = [paidOrder('DBL-A4', 25), paidOrder('DUO-A5-PELLE', 19)]

  const response = await GET(request('?sku=DBL-A4&sku=DUO-A5-PELLE'))
  const body = await response.json() as Record<string, unknown>
  assert.equal(response.status, 200)
  assert.equal(body.state, 'ok')
  // 25 A4 (+1) e 19 A5 (+0): il carrello prende il massimo, non la somma.
  assert.equal(body.extraDays, 1)
  assert.deepEqual(
    (body.requested as Array<{ format: string }>).map((entry) => entry.format),
    ['a4', 'a5'],
  )
})

test('rotta: gli SKU ripetuti valgono una volta sola', async () => {
  state.down = false
  state.orders = [paidOrder('DBL-A4', 21)]

  const body = await (await GET(request('?sku=DBL-A4&sku=DBL-A4&sku=%20DBL-A4%20'))).json() as Record<string, unknown>
  assert.equal(body.state, 'ok')
  assert.equal(body.extraDays, 1)
  assert.deepEqual(body.requested, [{ sku: 'DBL-A4', format: 'a4' }])
})

test('rotta: nessuno SKU -> 400 invalid_payload, senza chiamare il CMS', async () => {
  const response = await GET(request(''))
  assert.equal(response.status, 400)
  const body = await response.json() as Record<string, unknown>
  assert.equal(body.state, 'unavailable')
  assert.equal(body.reason, 'invalid_payload')
  assert.equal(body.detail, 'sku_missing')
  assert.equal(state.ordersCalls, 0)
})

test('rotta: SKU vuoto -> 400, non una stima con meno formati', async () => {
  const response = await GET(request('?sku=DBL-A4&sku='))
  assert.equal(response.status, 400)
  const body = await response.json() as Record<string, unknown>
  assert.equal(body.detail, 'sku_invalid')
  assert.equal(state.ordersCalls, 0)
})

test('rotta: troppi SKU distinti -> 400', async () => {
  const query = Array.from({ length: 51 }, (_, index) => `sku=SKU-${index}`).join('&')
  const response = await GET(request(`?${query}`))
  assert.equal(response.status, 400)
  const body = await response.json() as Record<string, unknown>
  assert.equal(body.detail, 'too_many_skus')
  assert.equal(state.ordersCalls, 0)
})

test('rotta: 51 parametri ripetuti sullo stesso SKU non sono 51 SKU', async () => {
  state.down = false
  state.orders = [paidOrder('DBL-A4', 21)]

  const query = Array.from({ length: 51 }, () => 'sku=DBL-A4').join('&')
  const response = await GET(request(`?${query}`))
  const body = await response.json() as Record<string, unknown>
  assert.equal(response.status, 200)
  assert.equal(body.state, 'ok')
  assert.equal(body.extraDays, 1)
})

test('rotta: CMS giu -> 200 unavailable cms_unavailable, nessun extraDays', async () => {
  state.down = true

  const response = await GET(request('?sku=DBL-A4'))
  assert.equal(response.status, 200)
  const body = await response.json() as Record<string, unknown>
  assert.equal(body.state, 'unavailable')
  assert.equal(body.reason, 'cms_unavailable')
  // Il punto della card: un guasto CMS non puo' diventare "coda vuota".
  assert.equal('extraDays' in body, false)
  assert.equal('loads' in body, false)
})
