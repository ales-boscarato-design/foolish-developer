import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeDeliveryPromise } from './Orders'

type HookArgs = Parameters<typeof normalizeDeliveryPromise>[0]

const FROZEN_PROMISE = {
  version: 1,
  promiseShown: true,
  zone: 'IT_EU',
  departureDate: '2026-11-23',
  estimatedDeliveryDate: '2026-11-25',
  productionDays: 1,
  marginDays: 2,
  fallback: false,
  reason: 'ok',
  calculatedAt: '2026-11-20T09:00:00.000Z',
}

function run(args: {
  data: Record<string, unknown>
  originalDoc?: Record<string, unknown> | null
  operation?: 'create' | 'update'
}): Record<string, unknown> {
  const result = normalizeDeliveryPromise({
    data: args.data,
    originalDoc: args.originalDoc ?? null,
    operation: args.operation ?? 'create',
  } as unknown as HookArgs)
  return result as unknown as Record<string, unknown>
}

/** L'ordine come lo crea il webhook: macchina, quindi con l'obbligo di snapshot. */
const checkoutOrder = {
  orderNumber: 'FOOLISH-SNAPSHOT-1',
  source: 'storefront',
  paymentMethod: 'stripe',
  stripeSessionId: 'cs_live_snapshot_1',
}

function errorStatus(fn: () => void): number | null {
  try {
    fn()
    return null
  } catch (error) {
    const value = error as { status?: number; statusCode?: number }
    return value.status ?? value.statusCode ?? -1
  }
}

test('un ordine del checkout senza snapshot non viene creato', () => {
  const status = errorStatus(() => run({ data: { ...checkoutOrder } }))
  assert.equal(status, 400)
})

test('un ordine del checkout senza snapshot ma con il campo vuoto non viene creato', () => {
  const status = errorStatus(() => run({
    data: {
      ...checkoutOrder,
      deliveryPromise: {
        version: null, promiseShown: null, zone: null, departureDate: null,
        estimatedDeliveryDate: null, productionDays: null, marginDays: null,
        fallback: null, reason: null, calculatedAt: null,
      },
    },
  }))
  assert.equal(status, 400)
})

test('uno snapshot coerente viene salvato normalizzato', () => {
  const result = run({ data: { ...checkoutOrder, deliveryPromise: { ...FROZEN_PROMISE } } })
  assert.deepEqual(result.deliveryPromise, FROZEN_PROMISE)
})

test('uno snapshot incoerente (margine non previsto) viene rifiutato', () => {
  const status = errorStatus(() => run({
    data: { ...checkoutOrder, deliveryPromise: { ...FROZEN_PROMISE, marginDays: 6 } },
  }))
  assert.equal(status, 400)
})

test('un ordine senza sessione di pagamento non ha l\'obbligo (ordine manuale, B2B, abbonamento)', () => {
  const manual = run({ data: { orderNumber: 'FOOLISH-MANUAL-1', source: 'storefront', paymentMethod: 'manual' } })
  assert.equal(manual.deliveryPromise, null)

  const reseller = run({
    data: { orderNumber: 'FOOLISH-B2B-1', source: 'reseller', paymentMethod: 'stripe', stripeSessionId: 'cs_live_b2b' },
  })
  assert.equal(reseller.deliveryPromise, null)

  const subscription = run({ data: { orderNumber: 'FOOLISH-SUB-1', source: 'subscription' } })
  assert.equal(subscription.deliveryPromise, null)
})

test('lo snapshot gia\' salvato e\' immutabile: un update non lo cambia', () => {
  const result = run({
    operation: 'update',
    originalDoc: { ...checkoutOrder, deliveryPromise: { ...FROZEN_PROMISE } },
    data: {
      ...checkoutOrder,
      // L'admin invia il documento intero: se qualcuno tocca la data, il valore
      // memorizzato vince. La promessa fatta al cliente non si sposta.
      deliveryPromise: { ...FROZEN_PROMISE, estimatedDeliveryDate: '2026-12-24' },
    },
  })
  assert.deepEqual(result.deliveryPromise, FROZEN_PROMISE)
})

test('lo snapshot salvato non si puo\' svuotare', () => {
  const result = run({
    operation: 'update',
    originalDoc: { ...checkoutOrder, deliveryPromise: { ...FROZEN_PROMISE } },
    data: { ...checkoutOrder, deliveryPromise: null },
  })
  assert.deepEqual(result.deliveryPromise, FROZEN_PROMISE)
})

test('un update che non tocca la promessa resta com\'e\' (niente normalizzazioni a sorpresa)', () => {
  const result = run({
    operation: 'update',
    originalDoc: { ...checkoutOrder, deliveryPromise: { ...FROZEN_PROMISE } },
    data: { orderNumber: 'FOOLISH-SNAPSHOT-1', pipelineState: 'in_production' },
  })
  assert.equal('deliveryPromise' in result, false)
})

test('gli ordini storici senza snapshot si possono ancora modificare', () => {
  const result = run({
    operation: 'update',
    originalDoc: { orderNumber: 'FOOLISH-OLD-1', source: 'woocommerce' },
    data: { orderNumber: 'FOOLISH-OLD-1', pipelineState: 'shipped', deliveryPromise: null },
  })
  assert.equal(result.deliveryPromise, null)
})

test('un update non puo\' introdurre uno snapshot incoerente dove non c\'era', () => {
  const status = errorStatus(() => run({
    operation: 'update',
    originalDoc: { orderNumber: 'FOOLISH-OLD-2', source: 'woocommerce' },
    data: {
      orderNumber: 'FOOLISH-OLD-2',
      deliveryPromise: { ...FROZEN_PROMISE, promiseShown: false, departureDate: '2026-11-23' },
    },
  }))
  assert.equal(status, 400)
})
