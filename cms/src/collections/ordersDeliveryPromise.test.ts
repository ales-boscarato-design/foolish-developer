import assert from 'node:assert/strict'
import test from 'node:test'
import { beforeChange as payloadBeforeChange } from '../../node_modules/payload/dist/fields/hooks/beforeChange/index.js'
import { beforeValidate as payloadBeforeValidate } from '../../node_modules/payload/dist/fields/hooks/beforeValidate/index.js'
import { Orders, normalizeDeliveryPromise } from './Orders'

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

async function runPayloadFieldLifecycle(args: {
  data: Record<string, unknown>
  originalDoc: Record<string, unknown> | null
  operation: 'create' | 'update'
}): Promise<Record<string, unknown>> {
  const req = {
    payload: { config: { localization: null }, collections: {} },
    context: {},
    locale: 'en',
    user: null,
    t: (key: string) => key,
    i18n: { t: (key: string) => key },
  }
  const collection = { ...Orders, slug: 'orders' }
  const doc = args.originalDoc ?? {}
  await payloadBeforeValidate({
    collection,
    data: args.data,
    doc,
    docForHooks: doc,
    operation: args.operation,
    req,
    context: {},
    overrideAccess: true,
  } as unknown as Parameters<typeof payloadBeforeValidate>[0])

  let data = args.data
  for (const hook of collection.hooks?.beforeChange ?? []) {
    data = await hook({ data, originalDoc: doc, operation: args.operation, req } as unknown as Parameters<typeof hook>[0]) as Record<string, unknown>
  }
  return await payloadBeforeChange({
    collection,
    data,
    doc,
    docWithLocales: doc,
    operation: args.operation,
    req,
    context: {},
    overrideAccess: true,
    skipValidation: true,
  } as unknown as Parameters<typeof payloadBeforeChange>[0]) as Record<string, unknown>
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
  assert.equal(manual.deliveryPromise, undefined)

  const reseller = run({
    data: { orderNumber: 'FOOLISH-B2B-1', source: 'reseller', paymentMethod: 'stripe', stripeSessionId: 'cs_live_b2b' },
  })
  assert.equal(reseller.deliveryPromise, undefined)

  const subscription = run({ data: { orderNumber: 'FOOLISH-SUB-1', source: 'subscription' } })
  assert.equal(subscription.deliveryPromise, undefined)
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
  assert.equal(result.deliveryPromise, undefined)
})

test('un update non puo introdurre uno snapshot valido in un ordine storico', () => {
  const result = run({
    operation: 'update',
    originalDoc: { orderNumber: 'FOOLISH-OLD-3', source: 'woocommerce' },
    data: { orderNumber: 'FOOLISH-OLD-3', deliveryPromise: { ...FROZEN_PROMISE } },
  })
  assert.equal(result.deliveryPromise, undefined)
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

test('il lifecycle reale Payload accetta create manuali e update storici senza snapshot', async () => {
  const manual = await runPayloadFieldLifecycle({
    operation: 'create',
    originalDoc: null,
    data: { orderNumber: 'FOOLISH-MANUAL-LIFECYCLE', source: 'manual' },
  })
  assert.deepEqual(manual.deliveryPromise, {})

  const historical = await runPayloadFieldLifecycle({
    operation: 'update',
    originalDoc: { orderNumber: 'FOOLISH-OLD-LIFECYCLE', source: 'woocommerce' },
    data: { orderNumber: 'FOOLISH-OLD-LIFECYCLE', pipelineState: 'shipped' },
  })
  assert.deepEqual(historical.deliveryPromise, {})

  const historicalWithInjectedSnapshot = await runPayloadFieldLifecycle({
    operation: 'update',
    originalDoc: { orderNumber: 'FOOLISH-OLD-INJECTED', source: 'woocommerce' },
    data: {
      orderNumber: 'FOOLISH-OLD-INJECTED',
      deliveryPromise: { ...FROZEN_PROMISE },
    },
  })
  assert.deepEqual(historicalWithInjectedSnapshot.deliveryPromise, {})
})

test('il lifecycle Payload accetta null esplicito come assenza solo dove ammesso', async () => {
  const manualCreate = await runPayloadFieldLifecycle({
    operation: 'create',
    originalDoc: null,
    data: { orderNumber: 'FOOLISH-MANUAL-NULL', source: 'manual', deliveryPromise: null },
  })
  assert.deepEqual(manualCreate.deliveryPromise, {})

  const historicalUpdate = await runPayloadFieldLifecycle({
    operation: 'update',
    originalDoc: { orderNumber: 'FOOLISH-OLD-NULL', source: 'woocommerce' },
    data: { orderNumber: 'FOOLISH-OLD-NULL', pipelineState: 'shipped', deliveryPromise: null },
  })
  assert.deepEqual(historicalUpdate.deliveryPromise, {})

  await assert.rejects(
    runPayloadFieldLifecycle({
      operation: 'create',
      originalDoc: null,
      data: { ...checkoutOrder, deliveryPromise: null },
    }),
    (error: unknown) => (error as { status?: number }).status === 400,
  )
})

test('il lifecycle Payload rifiuta prima della traversata chiavi sconosciute e valori scalari', async () => {
  const malformed = [
    { unexpected: 'X' },
    { unexpected: null },
    42,
    'not-a-group',
    ['unexpected'],
  ]

  for (const value of malformed) {
    await assert.rejects(
      runPayloadFieldLifecycle({
        operation: 'create',
        originalDoc: null,
        data: { orderNumber: 'FOOLISH-MALFORMED-CREATE', source: 'manual', deliveryPromise: value } as Record<string, unknown>,
      }),
      (error: unknown) => (error as { status?: number }).status === 400,
      `create should reject ${JSON.stringify(value)}`,
    )
    await assert.rejects(
      runPayloadFieldLifecycle({
        operation: 'update',
        originalDoc: { orderNumber: 'FOOLISH-MALFORMED-UPDATE', source: 'woocommerce' },
        data: { orderNumber: 'FOOLISH-MALFORMED-UPDATE', deliveryPromise: value } as Record<string, unknown>,
      }),
      (error: unknown) => (error as { status?: number }).status === 400,
      `update should reject ${JSON.stringify(value)}`,
    )
  }
})

test('il lifecycle Payload accetta patch parziali solo quando preserva lo snapshot storico', async () => {
  const partialUpdate = await runPayloadFieldLifecycle({
    operation: 'update',
    originalDoc: { ...checkoutOrder, deliveryPromise: { ...FROZEN_PROMISE } },
    data: { orderNumber: checkoutOrder.orderNumber, deliveryPromise: { promiseShown: true } },
  })
  assert.deepEqual(partialUpdate.deliveryPromise, FROZEN_PROMISE)

  await assert.rejects(
    runPayloadFieldLifecycle({
      operation: 'create',
      originalDoc: null,
      data: { ...checkoutOrder, deliveryPromise: { promiseShown: true } },
    }),
    (error: unknown) => (error as { status?: number }).status === 400,
  )
})

test('il lifecycle reale Payload conserva lo snapshot presente e rifiuta checkout senza snapshot', async () => {
  const created = await runPayloadFieldLifecycle({
    operation: 'create',
    originalDoc: null,
    data: { ...checkoutOrder, deliveryPromise: { ...FROZEN_PROMISE } },
  })
  assert.deepEqual(created.deliveryPromise, FROZEN_PROMISE)

  const preserved = await runPayloadFieldLifecycle({
    operation: 'update',
    originalDoc: { ...checkoutOrder, deliveryPromise: { ...FROZEN_PROMISE } },
    data: { ...checkoutOrder, deliveryPromise: null },
  })
  assert.deepEqual(preserved.deliveryPromise, FROZEN_PROMISE)

  await assert.rejects(
    runPayloadFieldLifecycle({ operation: 'create', originalDoc: null, data: { ...checkoutOrder } }),
    (error: unknown) => (error as { status?: number }).status === 400,
  )
})
