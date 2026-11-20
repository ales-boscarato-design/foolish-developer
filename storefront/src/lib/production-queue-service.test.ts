/**
 * Test del lettore server-side della coda di produzione.
 *
 * Il CMS e' uno stub HTTP reale su porta effimera: cosi' il test verifica anche
 * la forma della richiesta (filtro `where[createdAt][greater_than_equal]`,
 * header del secret) e non solo il calcolo. Le fixture sono quelle del contratto
 * (`production-queue.fixtures.json`), con documenti nella forma di
 * `GET /api/orders` e `GET /api/products`.
 *
 * Casi che contano per la promessa: la scala 19/20/21/40/41, la finestra del
 * lunedi' (sabato e domenica), la troncatura, il CMS giu' e il catalogo giu'.
 * Ogni caso che non prova la completezza deve uscire `unavailable`, mai con
 * `extraDays` 0.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import test, { after } from 'node:test'

import {
  PRODUCTION_QUEUE_CACHE_TTL_MS,
  PRODUCTION_QUEUE_ORDERS_WINDOW_HOURS,
  readProductionQueueEstimate,
  resetProductionQueueReadCache,
  type ProductionQueueReadResult,
} from '@/lib/production-queue-service'
import type { ProductionQueueUnavailable } from '@/lib/production-queue'

const SECRET = 'test-storefront-secret'

interface FixtureScenario {
  id: string
  now: string
  skus: string[]
  orders: unknown[]
}

interface Fixtures {
  catalog: unknown[]
  scenarios: FixtureScenario[]
}

const fixtures = JSON.parse(
  readFileSync(new URL('./production-queue.fixtures.json', import.meta.url), 'utf8'),
) as Fixtures

function scenario(id: string): FixtureScenario {
  const found = fixtures.scenarios.find((candidate) => candidate.id === id)
  assert.ok(found, `scenario ${id} mancante nelle fixture`)
  return found
}

type Behaviour = 'ok' | 'orders-500' | 'orders-401' | 'orders-truncated' | 'orders-has-next'
  | 'orders-total-missing' | 'orders-not-json' | 'catalog-500'

interface StubState {
  behaviour: Behaviour
  orders: unknown[]
  catalog: unknown[]
  ordersRequests: Array<{ at: number; since: string | null; secret: string | null }>
}

const state: StubState = {
  behaviour: 'ok',
  orders: [],
  catalog: fixtures.catalog,
  ordersRequests: [],
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(payload)
}

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? '/', 'http://stub.test')

  if (url.pathname === '/api/orders') {
    state.ordersRequests.push({
      at: Date.now(),
      since: url.searchParams.get('where[createdAt][greater_than_equal]'),
      secret: req.headers['x-storefront-secret'] as string | null,
    })
    switch (state.behaviour) {
      case 'orders-500':
        return sendJson(res, 500, { error: 'boom' })
      case 'orders-401':
        return sendJson(res, 401, { error: 'denied' })
      case 'orders-not-json':
        res.writeHead(200, { 'Content-Type': 'text/html' })
        return res.end('<html>non json</html>')
      case 'orders-truncated':
        return sendJson(res, 200, { docs: state.orders, totalDocs: state.orders.length + 3, hasNextPage: true })
      case 'orders-has-next':
        return sendJson(res, 200, { docs: state.orders, totalDocs: state.orders.length, hasNextPage: true })
      case 'orders-total-missing':
        return sendJson(res, 200, { docs: state.orders })
      default:
        return sendJson(res, 200, {
          docs: state.orders,
          totalDocs: state.orders.length,
          hasNextPage: false,
        })
    }
  }

  if (url.pathname === '/api/products') {
    if (state.behaviour === 'catalog-500') return sendJson(res, 500, { error: 'boom' })
    return sendJson(res, 200, {
      docs: state.catalog,
      totalDocs: state.catalog.length,
      hasNextPage: false,
    })
  }

  sendJson(res, 404, { error: 'not found' })
})

// tsx transpila i test in CJS: niente top-level await. `ready` si attende
// dentro `read()`, cosi' ogni test parte a server gia' in ascolto.
let cmsUrl = ''
const ready = new Promise<void>((resolve) => {
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address() as AddressInfo
    cmsUrl = `http://127.0.0.1:${port}`
    resolve()
  })
})

after(() => {
  server.close()
})

function reset(behaviour: Behaviour = 'ok') {
  state.behaviour = behaviour
  state.orders = []
  state.catalog = fixtures.catalog
  state.ordersRequests = []
  resetProductionQueueReadCache()
}

async function read(
  skus: string[],
  now: string,
  overrides: { secret?: string; useCache?: boolean } = {},
): Promise<ProductionQueueReadResult> {
  await ready
  return readProductionQueueEstimate({
    skus,
    deps: {
      cmsUrl,
      secret: overrides.secret ?? SECRET,
      now: new Date(now),
      useCache: overrides.useCache ?? false,
    },
  })
}

function ok(result: ProductionQueueReadResult) {
  assert.equal(result.state, 'ok', JSON.stringify(result))
  return result as Extract<ProductionQueueReadResult, { state: 'ok' }>
}

function unavailable(result: ProductionQueueReadResult): ProductionQueueUnavailable {
  assert.equal(result.state, 'unavailable', JSON.stringify(result))
  return result as ProductionQueueUnavailable
}

// ── Scala della capacita' ────────────────────────────────────────────────────
const LADDER: Array<[string, number]> = [
  ['19-a4', 0],
  ['20-a4', 0],
  ['21-a4', 1],
  ['40-a4', 1],
  ['41-a4', 2],
]

for (const [id, expectedExtra] of LADDER) {
  test(`lettore: ${id} -> +${expectedExtra} giorni`, async () => {
    reset()
    const current = scenario(id)
    state.orders = current.orders

    const result = ok(await read(current.skus, current.now))
    assert.equal(result.extraDays, expectedExtra)
    assert.equal(result.batchSize, 20)
    assert.equal(result.dayKey, '2026-11-20')
    assert.equal(result.catalogState, 'ok')
    assert.equal(result.ordersWindowHours, PRODUCTION_QUEUE_ORDERS_WINDOW_HOURS)
    assert.equal(result.ordersRead, current.orders.length)
  })
}

test('lettore: 19 e 20 pezzi danno la stessa stima, il 21esimo la alza', async () => {
  const estimate = async (id: string) => {
    reset()
    const current = scenario(id)
    state.orders = current.orders
    return ok(await read(current.skus, current.now))
  }
  const nineteen = await estimate('19-a4')
  const twenty = await estimate('20-a4')
  const twentyOne = await estimate('21-a4')
  assert.equal(nineteen.extraDays, twenty.extraDays)
  assert.equal(twenty.extraDays, 0)
  assert.equal(twentyOne.extraDays, 1)
})

// ── Finestra di lettura ─────────────────────────────────────────────────────
test('lettore: il lunedi la finestra include gli ordini di sabato e domenica', async () => {
  reset()
  // Sabato 21/11/2026 00:05 Europe/Rome (CET, UTC+1) = 20/11 23:05Z.
  // Il bucket del lunedi 23/11 inizia sabato 00:00: sono ~60 ore prima del now,
  // fuori da una finestra di 48 ore e dentro quella di 96.
  const saturdayOrder = {
    id: 900,
    orderNumber: 'FOOLISH-WEEKEND-1',
    createdAt: '2026-11-20T23:05:00.000Z',
    paymentStatus: 'paid',
    lineItems: [{ sku: 'DBL-A4', quantity: 21 }],
  }
  state.orders = [saturdayOrder]

  const result = ok(await read(['DBL-A4'], '2026-11-23T11:00:00.000Z'))
  assert.equal(result.dayKey, '2026-11-23')
  assert.equal(result.loads.a4, 21)
  assert.equal(result.extraDays, 1)

  const since = state.ordersRequests[0]?.since
  assert.ok(since, 'la richiesta porta il filtro createdAt')
  assert.ok(
    new Date(since).getTime() <= new Date(saturdayOrder.createdAt).getTime(),
    `la finestra (${since}) deve includere l'ordine di sabato`,
  )
  assert.equal(state.ordersRequests[0]?.secret, SECRET)
})

// ── Completezza della lettura ───────────────────────────────────────────────
test('lettore: lettura troncata -> unavailable, mai un numero', async () => {
  reset('orders-truncated')
  state.orders = scenario('21-a4').orders

  const result = unavailable(await read(['DBL-A4'], '2026-11-20T12:00:00.000Z'))
  assert.equal(result.reason, 'incomplete_orders')
  assert.equal(result.detail, 'orders_read_truncated')
  assert.equal('extraDays' in result, false)
})

test('lettore: hasNextPage true -> unavailable anche con conteggi coerenti', async () => {
  reset('orders-has-next')
  state.orders = scenario('21-a4').orders

  const result = unavailable(await read(['DBL-A4'], '2026-11-20T12:00:00.000Z'))
  assert.equal(result.reason, 'incomplete_orders')
  assert.equal(result.detail, 'orders_read_truncated')
})

test('lettore: senza totalDocs la completezza non e dimostrabile', async () => {
  reset('orders-total-missing')
  state.orders = scenario('21-a4').orders

  const result = unavailable(await read(['DBL-A4'], '2026-11-20T12:00:00.000Z'))
  assert.equal(result.reason, 'incomplete_orders')
  assert.equal(result.detail, 'orders_total_docs_missing')
})

// ── Errori del CMS: stato distinto dal valore valido ────────────────────────
test('lettore: CMS 500 -> unavailable cms_unavailable', async () => {
  reset('orders-500')

  const result = unavailable(await read(['DBL-A4'], '2026-11-20T12:00:00.000Z'))
  assert.equal(result.reason, 'cms_unavailable')
  assert.equal(result.detail, 'orders_http_500')
})

test('lettore: CMS 401 -> unavailable cms_unavailable', async () => {
  reset('orders-401')

  const result = unavailable(await read(['DBL-A4'], '2026-11-20T12:00:00.000Z'))
  assert.equal(result.reason, 'cms_unavailable')
  assert.equal(result.detail, 'orders_http_401')
})

test('lettore: corpo non JSON -> unavailable cms_unavailable', async () => {
  reset('orders-not-json')

  const result = unavailable(await read(['DBL-A4'], '2026-11-20T12:00:00.000Z'))
  assert.equal(result.reason, 'cms_unavailable')
  assert.equal(result.detail, 'orders_response_not_json')
})

test('lettore: rete irraggiungibile -> unavailable cms_unavailable', async () => {
  reset()
  const result = unavailable(await readProductionQueueEstimate({
    skus: ['DBL-A4'],
    deps: {
      // Porta chiusa: la fetch fallisce, non deve diventare "coda vuota".
      cmsUrl: 'http://127.0.0.1:1',
      secret: SECRET,
      now: new Date('2026-11-20T12:00:00.000Z'),
      useCache: false,
    },
  }))
  assert.equal(result.reason, 'cms_unavailable')
  assert.equal(result.detail, 'orders_fetch_failed')
})

test('lettore: senza secret non si chiama il CMS e non si stima', async () => {
  reset()

  const result = unavailable(await read(['DBL-A4'], '2026-11-20T12:00:00.000Z', { secret: '' }))
  assert.equal(result.reason, 'cms_unavailable')
  assert.equal(result.detail, 'orders_secret_missing')
  assert.equal(state.ordersRequests.length, 0)
})

// ── Catalogo non leggibile: prudente, non ottimistico ───────────────────────
test('lettore: catalogo giu -> i pezzi sono ignoti e la stima non scende', async () => {
  reset('catalog-500')
  // 25 pezzi A4 pagati: con il catalogo la richiesta su A5 darebbe 0 giorni.
  state.orders = [{
    id: 901,
    orderNumber: 'FOOLISH-CATALOG-DOWN',
    createdAt: '2026-11-20T08:00:00.000Z',
    paymentStatus: 'paid',
    lineItems: [{ sku: 'DBL-A4', quantity: 25 }],
  }]

  const result = ok(await read(['DBL-A5'], '2026-11-20T12:00:00.000Z'))
  assert.equal(result.catalogState, 'unavailable')
  assert.equal(result.unknownPieces, 25)
  assert.deepEqual(result.unknownSkus, ['DBL-A4'])
  // Il formato di A5 non e' noto: il pezzo puo' finire su A4, quindi +1.
  assert.equal(result.extraDays, 1)

  // Controllo di non-vacuita': con il catalogo leggibile lo stesso ordine da'
  // 0 giorni su A5. Se il caso "catalogo giu" desse 0, il test non misurerebbe
  // nulla.
  reset()
  state.orders = [{
    id: 901,
    orderNumber: 'FOOLISH-CATALOG-OK',
    createdAt: '2026-11-20T08:00:00.000Z',
    paymentStatus: 'paid',
    lineItems: [{ sku: 'DBL-A4', quantity: 25 }],
  }]
  const healthy = ok(await read(['DBL-A5'], '2026-11-20T12:00:00.000Z'))
  assert.equal(healthy.catalogState, 'ok')
  assert.equal(healthy.extraDays, 0)
})

// ── Cache ───────────────────────────────────────────────────────────────────
test('lettore: la cache di processo evita letture ripetute nella stessa giornata', async () => {
  reset()
  state.orders = scenario('21-a4').orders

  const now = '2026-11-20T12:00:00.000Z'
  const first = ok(await read(['DBL-A4'], now, { useCache: true }))
  const second = ok(await read(['DBL-A4'], now, { useCache: true }))
  assert.equal(first.extraDays, second.extraDays)
  assert.equal(state.ordersRequests.length, 1, 'la seconda chiamata usa la cache')

  // Oltre la TTL si rilegge.
  const later = new Date(new Date(now).getTime() + PRODUCTION_QUEUE_CACHE_TTL_MS + 1_000)
  ok(await read(['DBL-A4'], later.toISOString(), { useCache: true }))
  assert.equal(state.ordersRequests.length, 2)
})

// ── Input non valido ────────────────────────────────────────────────────────
test('lettore: elenco SKU non valido -> unavailable invalid_payload', async () => {
  reset()
  for (const skus of [[], ['   '], [42], new Array(51).fill('DBL-A4')]) {
    const result = unavailable(await readProductionQueueEstimate({
      skus,
      deps: { cmsUrl, secret: SECRET, now: new Date('2026-11-20T12:00:00.000Z'), useCache: false },
    }))
    assert.equal(result.reason, 'invalid_payload')
    assert.equal(result.detail, 'skus_invalid')
  }
  assert.equal(state.ordersRequests.length, 0, 'una richiesta non valida non tocca il CMS')
})
