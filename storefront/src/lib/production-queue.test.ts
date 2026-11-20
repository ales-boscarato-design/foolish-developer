import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  PRODUCTION_BATCH_SIZE,
  baseSkuOf,
  buildFormatIndex,
  computeProductionEstimate,
  extraDaysForPieces,
  formatFromVariant,
  productionQueueDayKey,
  romeDayKey,
  type ProductionQueueEstimate,
  type ProductionQueueOk,
} from './production-queue'

interface FixtureLineItem {
  sku: string
  quantity: number
}

interface FixtureScenario {
  id: string
  now: string
  skus: string[]
  orders: unknown[]
}

const fixtures = JSON.parse(
  readFileSync(new URL('./production-queue.fixtures.json', import.meta.url), 'utf8'),
) as { catalog: unknown[]; scenarios: FixtureScenario[] }

function scenario(id: string): FixtureScenario {
  const found = fixtures.scenarios.find((candidate) => candidate.id === id)
  assert.ok(found, `scenario ${id} mancante nelle fixture`)
  return found
}

function estimate(id: string, overrides: { ordersComplete?: boolean } = {}): ProductionQueueEstimate {
  const current = scenario(id)
  return computeProductionEstimate({
    orders: current.orders,
    products: fixtures.catalog,
    now: new Date(current.now),
    skus: current.skus,
    ordersComplete: overrides.ordersComplete ?? true,
  })
}

function ok(id: string, overrides: { ordersComplete?: boolean } = {}): ProductionQueueOk {
  const result = estimate(id, overrides)
  assert.equal(result.state, 'ok', `scenario ${id}: ${JSON.stringify(result)}`)
  return result as ProductionQueueOk
}

const LADDER: Array<[string, string, number, number]> = [
  ['zero', '2026-11-20', 0, 0],
  ['19-a4', '2026-11-20', 19, 0],
  ['20-a4', '2026-11-20', 20, 0],
  ['21-a4', '2026-11-20', 21, 1],
  ['40-a4', '2026-11-20', 40, 1],
  ['41-a4', '2026-11-20', 41, 2],
]

for (const [id, dayKey, pieces, expectedExtra] of LADDER) {
  test(`coda: ${pieces} pezzi A4 nella giornata -> +${expectedExtra} giorni`, () => {
    const result = ok(id)
    assert.equal(result.dayKey, dayKey)
    assert.equal(result.batchSize, PRODUCTION_BATCH_SIZE)
    assert.equal(result.loads.a4 ?? 0, pieces)
    assert.equal(result.extraDaysByFormat.a4 ?? 0, expectedExtra)
    assert.equal(result.extraDays, expectedExtra)
    assert.deepEqual(result.excludedOrders, [])
  })
}

test('coda: la somma dei pezzi non dipende da come sono spezzati gli ordini', () => {
  const makeOrder = (quantity: number, at: string) => ({
    id: 500 + quantity,
    orderNumber: `FOOLISH-SPLIT-${quantity}`,
    createdAt: at,
    paymentStatus: 'paid',
    lineItems: [{ sku: 'DBL-A4', quantity }],
  })
  const run = (orders: unknown[]) => computeProductionEstimate({
    orders,
    products: fixtures.catalog,
    now: new Date('2026-11-20T12:00:00.000Z'),
    skus: ['DBL-A4'],
    ordersComplete: true,
  })

  const split = run([makeOrder(15, '2026-11-20T08:00:00.000Z'), makeOrder(5, '2026-11-20T09:00:00.000Z')])
  const single = run([makeOrder(20, '2026-11-20T08:00:00.000Z')])
  assert.equal(split.state, 'ok')
  assert.equal(single.state, 'ok')
  assert.deepEqual(split.state === 'ok' ? split.loads : null, single.state === 'ok' ? single.loads : null)
  assert.equal(split.state === 'ok' ? split.extraDays : null, 0)
})

test('coda: formati diversi non si sommano', () => {
  const separate = ok('formats-separate')
  assert.equal(separate.loads.a4, 20)
  assert.equal(separate.loads.a5, 20)
  assert.equal(separate.loads.xxl, 19)
  assert.equal(separate.extraDaysByFormat.a4, 0)
  assert.equal(separate.extraDaysByFormat.a5, 0)
  assert.equal(separate.extraDaysByFormat.xxl, 0)
  assert.equal(separate.extraDays, 0)

  const notSummed = ok('formats-not-summed')
  assert.equal(notSummed.loads.a4, 25)
  assert.equal(notSummed.loads.a5, 19)
  assert.equal(notSummed.extraDaysByFormat.a4, 1)
  assert.equal(notSummed.extraDaysByFormat.a5, 0)
  // 44 pezzi totali darebbero 2 giorni: il formato piu' carico ne da' uno.
  assert.equal(notSummed.extraDays, 1)
})

test('coda: pagato, in attesa e rimborsato contano; fallito e annullato no', () => {
  const states = ok('payment-states')
  assert.equal(states.loads.a4, 20)
  assert.equal(states.extraDays, 0)
  assert.deepEqual(
    states.excludedOrders.map((entry) => entry.reason).sort(),
    ['cancelled', 'payment_failed'],
  )

  const refunded = ok('refunded-stays-counted')
  assert.equal(refunded.loads.a4, 21)
  assert.equal(refunded.extraDays, 1)

  const excludedOnly = ok('excluded-only')
  assert.equal(excludedOnly.loads.a4 ?? 0, 0)
  assert.equal(excludedOnly.extraDays, 0)
  assert.equal(excludedOnly.excludedOrders.length, 2)
})

test('coda: un rinnovo abbonamento senza paymentStatus resta contato', () => {
  const subscription = ok('subscription-pending')
  assert.equal(subscription.excludedOrders.length, 0)
  assert.equal(subscription.unknownPieces, 2)
  assert.deepEqual(subscription.unknownSkus, ['SUB-TATTOO', 'SUB-TATTOO-GIFT'])
})

test('coda: gli ordini di un altro giorno non entrano nel conteggio', () => {
  const otherDay = ok('other-day-ignored')
  assert.equal(otherDay.loads.a4 ?? 0, 0)
  assert.equal(otherDay.extraDays, 0)
})

test('confine di mezzanotte Europe/Rome: 23:59 dentro, 00:01 fuori', () => {
  const before = ok('midnight-before')
  assert.equal(before.dayKey, '2026-11-20')
  assert.equal(before.loads.a4, 20)
  assert.equal(before.extraDays, 0)

  const after = ok('midnight-after')
  assert.equal(after.dayKey, '2026-11-23')
  assert.equal(after.loads.a4, 21)
  assert.equal(after.extraDays, 1)
})

test('coda: il passaggio ora legale/solare non sposta la giornata', () => {
  assert.equal(romeDayKey(new Date('2026-10-25T00:30:00.000Z')), '2026-10-25')
  assert.equal(romeDayKey(new Date('2026-10-25T01:30:00.000Z')), '2026-10-25')
  assert.equal(romeDayKey(new Date('2026-03-28T23:30:00.000Z')), '2026-03-29')
  assert.equal(romeDayKey(new Date('2026-03-29T22:30:00.000Z')), '2026-03-30')

  const dstEnd = ok('dst-end')
  assert.equal(dstEnd.dayKey, '2026-10-26')
  assert.equal(dstEnd.loads.a4, 21)
  assert.equal(dstEnd.extraDays, 1)

  const dstStart = ok('dst-start')
  assert.equal(dstStart.dayKey, '2026-03-30')
  assert.equal(dstStart.loads.a4, 21)
  assert.equal(dstStart.extraDays, 1)
})

test('coda: sabato e domenica si riportano al lunedi', () => {
  assert.equal(productionQueueDayKey(new Date('2026-11-20T22:59:00.000Z')), '2026-11-20')
  assert.equal(productionQueueDayKey(new Date('2026-11-20T23:01:00.000Z')), '2026-11-23')
  assert.equal(productionQueueDayKey(new Date('2026-11-22T18:00:00.000Z')), '2026-11-23')

  const weekend = ok('weekend-roll')
  assert.equal(weekend.dayKey, '2026-11-23')
  assert.equal(weekend.loads.a4, 21)
  assert.equal(weekend.extraDays, 1)
})

test('coda: SKU senza formato del catalogo viene attribuito a ogni formato, mai ignorato', () => {
  const unknown = ok('unknown-sku')
  assert.equal(unknown.loads.a4, 21)
  assert.equal(unknown.loads.unknown, 1)
  assert.equal(unknown.unknownPieces, 1)
  assert.deepEqual(unknown.unknownSkus, ['LEGACY-XYZ'])
  assert.equal(unknown.extraDays, 1)
})

test('coda: la riga pack conta i pezzi, non i pacchi', () => {
  const pack = ok('pack-sku')
  assert.equal(pack.loads.a4, 21)
  assert.equal(pack.extraDays, 1)
})

test('coda: formato ricavato dalle dimensioni quando l etichetta non lo dichiara', () => {
  const dimensions = ok('format-from-dimensions')
  assert.equal(dimensions.loads['180x60'], 21)
  assert.equal(dimensions.loads['15x15'], 20)
  assert.deepEqual(
    dimensions.requested.map((entry) => entry.format),
    ['180x60', '15x15'],
  )
  assert.equal(dimensions.extraDays, 1)
})

test('coda: un payload non valido non produce un numero', () => {
  const quantity = estimate('invalid-quantity')
  assert.equal(quantity.state, 'unavailable')
  assert.equal(quantity.state === 'unavailable' ? quantity.reason : null, 'invalid_payload')
  assert.equal(quantity.state === 'unavailable' ? quantity.detail : null, 'order_line_items_invalid')

  const lineItems = estimate('invalid-line-items')
  assert.equal(lineItems.state, 'unavailable')

  const truncated = estimate('20-a4', { ordersComplete: false })
  assert.equal(truncated.state, 'unavailable')
  assert.equal(truncated.state === 'unavailable' ? truncated.reason : null, 'incomplete_orders')
})

test('funzioni pure: formati, SKU base, soglia', () => {
  assert.equal(formatFromVariant({ label: 'A5' }), 'a5')
  assert.equal(formatFromVariant({ label: 'A5 — Pelle' }), 'a5')
  assert.equal(formatFromVariant({ label: 'XXL' }), 'xxl')
  assert.equal(formatFromVariant({ label: '15×15' }), '15x15')
  assert.equal(formatFromVariant({ label: 'Rotolo', dimensions: '180×60 cm' }), '180x60')
  assert.equal(formatFromVariant({ label: 'Standard' }), null)

  assert.equal(baseSkuOf('DBL-A4-pack-3'), 'DBL-A4')
  assert.equal(baseSkuOf('T-3D-WMN-BCK-PACK-2'), 'T-3D-WMN-BCK')
  assert.equal(baseSkuOf('DBL-A4'), 'DBL-A4')

  assert.equal(extraDaysForPieces(0), 0)
  assert.equal(extraDaysForPieces(19), 0)
  assert.equal(extraDaysForPieces(20), 0)
  assert.equal(extraDaysForPieces(21), 1)
  assert.equal(extraDaysForPieces(40), 1)
  assert.equal(extraDaysForPieces(41), 2)
  assert.equal(extraDaysForPieces(61), 3)
})

test('funzioni pure: indice formati costruito dal catalogo CMS', () => {
  const index = buildFormatIndex(fixtures.catalog as never)
  assert.equal(index.get('DBL-A4'), 'a4')
  assert.equal(index.get('DUO-A5-PELLE'), 'a5')
  assert.equal(index.get('FP-15'), '15x15')
  assert.equal(index.get('MANO-TATTOO'), null)
  assert.equal(index.get('SKU-SCONOSCIUTO'), undefined)

  const lineItems: FixtureLineItem[] = [{ sku: 'MANO-TATTOO', quantity: 3 }]
  const result = computeProductionEstimate({
    orders: [{
      id: 1,
      orderNumber: 'FOOLISH-UNKNOWN-FORMAT',
      createdAt: '2026-11-20T09:00:00.000Z',
      paymentStatus: 'paid',
      lineItems,
    }],
    products: fixtures.catalog,
    now: new Date('2026-11-20T12:00:00.000Z'),
    skus: ['MANO-TATTOO'],
    ordersComplete: true,
  })
  assert.equal(result.state, 'ok')
  assert.equal(result.state === 'ok' ? result.unknownPieces : null, 3)
  assert.equal(result.state === 'ok' ? result.extraDays : null, 0)
})
