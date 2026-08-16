import assert from 'node:assert/strict'
import test from 'node:test'
import type Stripe from 'stripe'
import {
  createOrderInCMS,
  createOrderInCMSWithRetry,
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
    amount_total: 3_500,
    currency: 'eur',
    customer_email: 'order-test@example.invalid',
    customer_details: null,
    collected_information: null,
    metadata: {
      order_ref: 'FOOLISH-ORDER-TEST',
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
  globalThis.fetch = async (_input, init) => {
    if (init?.method === 'POST') {
      createCount += 1
      return jsonResponse({ id: 101, orderNumber: 'FOOLISH-ORDER-TEST' }, 201)
    }
    lookupCount += 1
    return lookupCount === 1
      ? jsonResponse({ docs: [] })
      : jsonResponse({ docs: [{ id: 101, orderNumber: 'FOOLISH-ORDER-TEST' }] })
  }

  try {
    const first = await createOrderInCMS(checkoutSession())
    const duplicate = await createOrderInCMS(checkoutSession())
    assert.equal(first.created, true)
    assert.equal(duplicate.created, false)
    assert.equal(createCount, 1)
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
      : jsonResponse({ docs: [{ id: 202, orderNumber: 'FOOLISH-ORDER-TEST' }] })
  }

  try {
    const result = await createOrderInCMS(checkoutSession())
    assert.deepEqual(result, {
      orderRef: 'FOOLISH-ORDER-TEST',
      created: false,
      orderId: 202,
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('temporary CMS failures are retried and eventually succeed', async () => {
  let attempts = 0
  const expected: OrderPersistenceResult = {
    orderRef: 'FOOLISH-ORDER-TEST',
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

test('reconciliation recovers a paid session even if its webhook was missed', async () => {
  const originalFetch = globalThis.fetch
  let createCount = 0
  globalThis.fetch = async (_input, init) => {
    if (init?.method === 'POST') {
      createCount += 1
      return jsonResponse({ id: 404, orderNumber: 'FOOLISH-ORDER-TEST' }, 201)
    }
    return jsonResponse({ docs: [] })
  }

  const paid = checkoutSession()
  const unpaid = checkoutSession({
    id: 'cs_live_unpaid_test',
    payment_status: 'unpaid',
    metadata: { order_ref: 'FOOLISH-UNPAID', items_json: '[]' },
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
    assert.equal(result.recovered[0]?.orderRef, 'FOOLISH-ORDER-TEST')
    assert.equal(result.errors.length, 0)
    assert.equal(createCount, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})
