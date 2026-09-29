import assert from 'node:assert/strict'
import test from 'node:test'
import type Stripe from 'stripe'
import {
  createOrderInCMS,
  createOrderInCMSWithRetry,
  createStorefrontOrderRef,
  isValidStorefrontOrderRef,
  reconcilePaidStripeOrders,
  type OrderPersistenceResult,
} from './stripe-orders'

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function checkoutSession(overrides: Partial<Stripe.Checkout.Session> = {}): Stripe.Checkout.Session {
  return {
    id: 'cs_live_order_test',
    object: 'checkout.session',
    livemode: true,
    mode: 'payment',
    payment_status: 'paid',
    payment_intent: 'pi_live_order_test',
    amount_total: 3_500,
    currency: 'eur',
    customer_email: 'order-test@example.invalid',
    customer_details: null,
    collected_information: null,
    metadata: {
      order_ref: 'FOOLISH-1746364800000',
      customer_name: 'Order Test',
      customer_country: 'IT',
      customer_address: 'Via Test 1|Torino|10100',
      items_json: JSON.stringify([
        { sku: 'TEST-SKU', qty: 1, name: 'Test', variantLabel: 'A', price: 30 },
      ]),
    },
    ...overrides,
  } as unknown as Stripe.Checkout.Session
}

test('a duplicated paid session creates one CMS order', async () => {
  const originalFetch = globalThis.fetch
  let lookupCount = 0
  let createCount = 0
  let createBody: Record<string, unknown> | null = null
  globalThis.fetch = async (_input, init) => {
    if (init?.method === 'POST') {
      createCount += 1
      createBody = JSON.parse(String(init.body)) as Record<string, unknown>
      return jsonResponse({ id: 101, orderNumber: 'FOOLISH-1746364800000' }, 201)
    }
    lookupCount += 1
    return lookupCount === 1
      ? jsonResponse({ docs: [] })
      : jsonResponse({ docs: [{ id: 101, orderNumber: 'FOOLISH-1746364800000' }] })
  }

  try {
    const first = await createOrderInCMS(checkoutSession())
    const duplicate = await createOrderInCMS(checkoutSession())
    assert.equal(first.created, true)
    assert.equal(duplicate.created, false)
    assert.equal(createCount, 1)
    assert.ok(createBody, 'CMS create payload was not captured')
    const persistedBody = createBody as Record<string, unknown>
    assert.equal(persistedBody.paymentStatus, 'paid')
    assert.equal(persistedBody.paymentMethod, 'stripe')
    assert.equal(persistedBody.stripePaymentIntentId, 'pi_live_order_test')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('a webhook and reconciler create race resolves as already present', async () => {
  const originalFetch = globalThis.fetch
  let lookupCount = 0
  globalThis.fetch = async (_input, init) => {
    if (init?.method === 'POST') return jsonResponse({ errors: ['duplicate'] }, 409)
    lookupCount += 1
    return lookupCount === 1
      ? jsonResponse({ docs: [] })
      : jsonResponse({ docs: [{ id: 202, orderNumber: 'FOOLISH-1746364800000' }] })
  }

  try {
    const result = await createOrderInCMS(checkoutSession())
    assert.deepEqual(result, {
      orderRef: 'FOOLISH-1746364800000',
      created: false,
      orderId: 202,
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('charged product prices keep the parser from treating a discount as shipping', async () => {
  const originalFetch = globalThis.fetch
  let createBody: Record<string, unknown> | null = null
  globalThis.fetch = async (_input, init) => {
    if (init?.method === 'POST') {
      createBody = JSON.parse(String(init.body)) as Record<string, unknown>
      return jsonResponse({ id: 505, orderNumber: 'FOOLISH-1746364800000' }, 201)
    }
    return jsonResponse({ docs: [] })
  }

  try {
    const session = checkoutSession({
      amount_total: 3_000,
      metadata: {
        order_ref: 'FOOLISH-1746364800001',
        customer_name: 'Order Test',
        customer_country: 'IT',
        customer_address: 'Via Test 1|Torino|10100',
        items_json: JSON.stringify([
          { sku: 'TEST-SKU', qty: 1, name: 'Test', variantLabel: 'A', price: 20 },
        ]),
        promo_discount_amount_cents: '500',
      },
    })

    await createOrderInCMS(session)
    assert.ok(createBody, 'CMS create payload was not captured')
    const persistedBody = createBody as Record<string, unknown>
    assert.equal(persistedBody.total, 30)
    assert.equal(persistedBody.shippingCost, 10)
    assert.deepEqual(persistedBody.lineItems, [{
      sku: 'TEST-SKU',
      name: 'Test',
      variantLabel: 'A',
      quantity: 1,
      unitPrice: 20,
    }])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('temporary CMS failures are retried and eventually succeed', async () => {
  let attempts = 0
  const expected: OrderPersistenceResult = {
    orderRef: 'FOOLISH-1746364800000',
    created: true,
    orderId: 303,
  }
  const persist = async () => {
    attempts += 1
    if (attempts < 3) throw new Error('CMS temporarily unavailable')
    return expected
  }

  const result = await createOrderInCMSWithRetry(checkoutSession(), {
    delays: [0, 0, 0, 0],
    persist,
  })

  assert.deepEqual(result, expected)
  assert.equal(attempts, 3)
})

test('a permanent CMS failure exhausts exactly four attempts', async () => {
  let attempts = 0
  const persist = async (): Promise<OrderPersistenceResult> => {
    attempts += 1
    throw new Error('CMS unavailable')
  }

  await assert.rejects(
    createOrderInCMSWithRetry(checkoutSession(), {
      delays: [0, 0, 0, 0],
      persist,
    }),
    /CMS unavailable/,
  )
  assert.equal(attempts, 4)
})

test('storefront order refs remain valid across the legacy and collision-resistant formats', () => {
  const timestamp = 1_746_364_800_000
  const first = createStorefrontOrderRef(timestamp, '00000000-0000-4000-8000-000000000001')
  const second = createStorefrontOrderRef(timestamp, '00000000-0000-4000-8000-000000000002')

  assert.notEqual(first, second)
  assert.equal(isValidStorefrontOrderRef('FOOLISH-1746364800000'), true)
  assert.equal(isValidStorefrontOrderRef(first), true)
  assert.equal(isValidStorefrontOrderRef(second), true)
  assert.equal(isValidStorefrontOrderRef('FOOLISH-1746364800000-not-a-uuid'), false)
})

test('reconciliation recovers a paid session even if its webhook was missed', async () => {
  const originalFetch = globalThis.fetch
  let createCount = 0
  globalThis.fetch = async (_input, init) => {
    if (init?.method === 'POST') {
      createCount += 1
      return jsonResponse({ id: 404, orderNumber: 'FOOLISH-1746364800000' }, 201)
    }
    return jsonResponse({ docs: [] })
  }

  const paid = checkoutSession()
  const unpaid = checkoutSession({
    id: 'cs_live_unpaid_test',
    payment_status: 'unpaid',
    metadata: { order_ref: 'FOOLISH-1746364800002', items_json: '[]' },
  })
  const stripe = {
    checkout: {
      sessions: {
        list: () => ({
          autoPagingToArray: async () => [unpaid, paid],
        }),
        retrieve: async (id: string) => {
          assert.equal(id, paid.id)
          return paid
        },
      },
    },
  } as unknown as Stripe

  try {
    const result = await reconcilePaidStripeOrders({ stripe, lookbackDays: 30 })
    assert.equal(result.sessionsScanned, 2)
    assert.equal(result.eligiblePaidSessions, 1)
    assert.equal(result.recovered.length, 1)
    assert.equal(result.recovered[0]?.orderRef, 'FOOLISH-1746364800000')
    assert.equal(result.errors.length, 0)
    assert.equal(createCount, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('reconciliation ignores paid payment sessions without a valid storefront order_ref', async () => {
  const originalFetch = globalThis.fetch
  const originalError = console.error
  let fetchCount = 0
  const errors: unknown[][] = []
  globalThis.fetch = async () => {
    fetchCount += 1
    throw new Error('an unscoped paid session must not reach CMS')
  }
  console.error = (...args: unknown[]) => errors.push(args)

  const missingRef = checkoutSession({
    id: 'cs_live_unscoped_paid_test',
    payment_intent: 'pi_live_unscoped_paid_test',
    customer_email: 'must-not-be-logged@example.invalid',
    metadata: { items_json: '[]', customer_name: 'Must Not Be Logged' },
  })
  const invalidRef = checkoutSession({
    id: 'cs_live_invalid_ref_test',
    payment_intent: 'pi_live_invalid_ref_test',
    customer_email: 'must-not-be-logged-2@example.invalid',
    metadata: { order_ref: 'FOOLISH-not-an-order-ref', items_json: '[]' },
  })
  const stripe = {
    checkout: {
      sessions: {
        list: () => ({ autoPagingToArray: async () => [missingRef, invalidRef] }),
        retrieve: async () => missingRef,
      },
    },
  } as unknown as Stripe

  try {
    const result = await reconcilePaidStripeOrders({ stripe, lookbackDays: 30 })
    assert.equal(result.sessionsScanned, 2)
    assert.equal(result.eligiblePaidSessions, 0)
    assert.equal(result.recovered.length, 0)
    assert.equal(result.errors.length, 0)
    assert.equal(fetchCount, 0)
    assert.deepEqual(errors, [
      [
        '[stripe-reconcile] paid payment checkout quarantined',
        { stripeSessionId: missingRef.id, paymentIntentId: 'pi_live_unscoped_paid_test' },
      ],
      [
        '[stripe-reconcile] paid payment checkout quarantined',
        { stripeSessionId: invalidRef.id, paymentIntentId: 'pi_live_invalid_ref_test' },
      ],
    ])
    assert.equal(JSON.stringify(errors).includes('must-not-be-logged'), false)
    assert.equal(JSON.stringify(errors).includes('Must Not Be Logged'), false)
  } finally {
    globalThis.fetch = originalFetch
    console.error = originalError
  }
})

test('reconciliation invokes attribution for a paid session whose order already exists', async () => {
  const originalFetch = globalThis.fetch
  let retrieveCount = 0
  let attributionSession: Stripe.Checkout.Session | null = null
  let attributionOrderRef: string | null = null
  globalThis.fetch = async () => jsonResponse({ docs: [{ id: 606, orderNumber: 'FOOLISH-1746364800000' }] })

  const paid = checkoutSession()
  const stripe = {
    checkout: {
      sessions: {
        list: () => ({
          autoPagingToArray: async () => [paid],
        }),
        retrieve: async (id: string) => {
          retrieveCount += 1
          assert.equal(id, paid.id)
          return paid
        },
      },
    },
  } as unknown as Stripe

  try {
    const result = await reconcilePaidStripeOrders({
      stripe,
      lookbackDays: 30,
      affiliateAttribution: async (session, orderNumber) => {
        attributionSession = session
        attributionOrderRef = orderNumber
      },
    })
    assert.equal(result.alreadyPresent, 1)
    assert.equal(result.recovered.length, 0)
    assert.equal(result.errors.length, 0)
    assert.equal(retrieveCount, 1)
    assert.equal((attributionSession as unknown as Stripe.Checkout.Session).id, paid.id)
    assert.equal(attributionOrderRef, 'FOOLISH-1746364800000')
  } finally {
    globalThis.fetch = originalFetch
  }
})
