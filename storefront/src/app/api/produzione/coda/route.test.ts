/**
 * Test della rotta `GET /api/produzione/coda`.
 *
 * La rotta e' il contratto che scheda prodotto, carrello e checkout consumano,
 * quindi il test chiama l'handler vero contro uno stub HTTP del CMS su porta
 * effimera (nessun CMS di produzione, nessun segreto reale). Copre: risposta
 * valida, richiesta sintatticamente sbagliata, e CMS giu' che deve restare
 * `unavailable` — mai `extraDays: 0`.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import test, { after, before, beforeEach } from 'node:test'

import { NextRequest } from 'next/server'
import { GET } from './route'
import { resetProductionQueueReadCache } from '@/lib/production-queue-service'

const fixtures = JSON.parse(
  readFileSync(new URL('../../../../lib/production-queue.fixtures.json', import.meta.url), 'utf8'),
) as { catalog: unknown[]; scenarios: Array<{ id: string; orders: unknown[] }> }

interface StubState {
  down: boolean
  orders: unknown[]
}

const state: StubState = { down: false, orders: [] }

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? '/', 'http://stub.test')
  if (state.down) return sendJson(res, 503, { error: 'down' })

  if (url.pathname === '/api/orders') {
    return sendJson(res, 200, { docs: state.orders, totalDocs: state.orders.length, hasNextPage: false })
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
})

function request(query: string) {
  return new NextRequest(`https://thefoolishbutcher.com/api/produzione/coda${query}`)
}

function scenarioOrders(id: string): unknown[] {
  const found = fixtures.scenarios.find((candidate) => candidate.id === id)
  assert.ok(found, `scenario ${id} mancante`)
  return found.orders
}

test('rotta: 200 con la stima per gli SKU richiesti', async () => {
  state.down = false
  state.orders = scenarioOrders('21-a4')

  const response = await GET(request('?sku=DBL-A4'))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')

  const body = await response.json() as Record<string, unknown>
  assert.equal(body.state, 'ok')
  assert.equal(body.extraDays, 1)
  assert.equal(body.batchSize, 20)
  assert.equal(body.dayKey, '2026-11-20')
  assert.deepEqual(body.requested, [{ sku: 'DBL-A4', format: 'a4' }])
  assert.equal(body.catalogState, 'ok')

  // La rotta e' pubblica: il dettaglio operativo non deve uscire.
  for (const hidden of ['loads', 'extraDaysByFormat', 'unknownSkus', 'unknownPieces', 'excludedOrders', 'ordersRead']) {
    assert.equal(hidden in body, false, `${hidden} non deve uscire dalla rotta pubblica`)
  }
})

test('rotta: il carrello misto chiede tutti gli SKU e non somma i formati', async () => {
  state.down = false
  state.orders = scenarioOrders('formats-not-summed')

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

test('rotta: nessuno SKU -> 400 invalid_payload', async () => {
  const response = await GET(request(''))
  assert.equal(response.status, 400)
  const body = await response.json() as Record<string, unknown>
  assert.equal(body.state, 'unavailable')
  assert.equal(body.reason, 'invalid_payload')
  assert.equal(body.detail, 'sku_missing')
})

test('rotta: SKU vuoto -> 400, non una stima con meno formati', async () => {
  const response = await GET(request('?sku=DBL-A4&sku='))
  assert.equal(response.status, 400)
  const body = await response.json() as Record<string, unknown>
  assert.equal(body.detail, 'sku_invalid')
})

test('rotta: troppi SKU -> 400', async () => {
  const query = Array.from({ length: 51 }, () => 'sku=DBL-A4').join('&')
  const response = await GET(request(`?${query}`))
  assert.equal(response.status, 400)
  const body = await response.json() as Record<string, unknown>
  assert.equal(body.detail, 'too_many_skus')
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
