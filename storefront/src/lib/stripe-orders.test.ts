import assert from 'node:assert/strict'
import test from 'node:test'
import type Stripe from 'stripe'
import {
  createOrderInCMS,
  createOrderInCMSWithRetry,
  parseDeclaredShippingCostCents,
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
  let createBody: Record<string, unknown> | null = null
  globalThis.fetch = async (_input, init) => {
    if (init?.method === 'POST') {
      createCount += 1
      createBody = JSON.parse(String(init.body)) as Record<string, unknown>
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

test('charged product prices keep the parser from treating a discount as shipping', async () => {
  const originalFetch = globalThis.fetch
  let createBody: Record<string, unknown> | null = null
  globalThis.fetch = async (_input, init) => {
    if (init?.method === 'POST') {
      createBody = JSON.parse(String(init.body)) as Record<string, unknown>
      return jsonResponse({ id: 505, orderNumber: 'FOOLISH-ORDER-TEST' }, 201)
    }
    return jsonResponse({ docs: [] })
  }

  try {
    const session = checkoutSession({
      amount_total: 3_000,
      metadata: {
        order_ref: 'FOOLISH-DISCOUNT-TEST',
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

test('reconciliation invokes attribution for a paid session whose order already exists', async () => {
  const originalFetch = globalThis.fetch
  let retrieveCount = 0
  let attributionSession: Stripe.Checkout.Session | null = null
  let attributionOrderRef: string | null = null
  globalThis.fetch = async () => jsonResponse({ docs: [{ id: 606, orderNumber: 'FOOLISH-ORDER-TEST' }] })

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
    assert.equal(attributionOrderRef, 'FOOLISH-ORDER-TEST')
  } finally {
    globalThis.fetch = originalFetch
  }
})

/** Persiste la sessione e restituisce il corpo con cui è stato creato l'ordine. */
async function persistAndCapture(session: Stripe.Checkout.Session): Promise<Record<string, unknown>> {
  const originalFetch = globalThis.fetch
  let createBody: Record<string, unknown> | null = null
  globalThis.fetch = async (_input, init) => {
    if (init?.method === 'POST') {
      createBody = JSON.parse(String(init.body)) as Record<string, unknown>
      return jsonResponse({ id: 707, orderNumber: String((createBody as Record<string, unknown>).orderNumber) }, 201)
    }
    return jsonResponse({ docs: [] })
  }
  try {
    await createOrderInCMS(session)
  } finally {
    globalThis.fetch = originalFetch
  }
  const captured = createBody as Record<string, unknown> | null
  assert.ok(captured, 'CMS create payload was not captured')
  return captured
}

/** Metadata di un ordine da 30,00 € di merce: il residuo sarebbe 5,00 €. */
function metadataWithProductLines(extra: Record<string, string> = {}): Record<string, string> {
  return {
    order_ref: 'FOOLISH-ORDER-TEST',
    customer_name: 'Order Test',
    customer_country: 'IT',
    customer_address: 'Via Test 1|Torino|10100',
    items_json: JSON.stringify([
      { sku: 'TEST-SKU', qty: 1, name: 'Test', variantLabel: 'A', price: 30 },
    ]),
    ...extra,
  }
}

test('parseDeclaredShippingCostCents accetta solo interi non negativi', () => {
  assert.equal(parseDeclaredShippingCostCents({ shipping_cost_cents: '0' }), 0)
  assert.equal(parseDeclaredShippingCostCents({ shipping_cost_cents: '5249' }), 5249)
  for (const raw of ['', ' ', '-1', '+1', '1.5', '7,65', '1e3', ' 765 ', 'abc', '9'.repeat(10)]) {
    assert.equal(parseDeclaredShippingCostCents({ shipping_cost_cents: raw }), null, JSON.stringify(raw))
  }
  assert.equal(parseDeclaredShippingCostCents({}), null)
})

test('la spedizione registrata è quella incassata, non il valore merce', async () => {
  // Sessione con le righe prodotto assenti dai metadata e la spedizione
  // dichiarata: prima di questo contratto il residuo `amount_total - 0`
  // registrava l'intero valore merce nel campo spedizione (era il difetto dei
  // riordini). La spedizione svizzera misurata è 52,49 su 99,00 di merce.
  const persisted = await persistAndCapture(checkoutSession({
    amount_total: 15_149,
    metadata: {
      order_ref: 'FOOLISH-REORDER-TEST',
      customer_name: 'Order Test',
      customer_country: 'CH',
      customer_address: 'Via Test 1|Torino|10100',
      shipping_cost_cents: '5249',
    },
  }))

  assert.equal(persisted.shippingCost, 52.49)
  assert.equal(persisted.total, 151.49)
})

test('la spedizione registrata è quella incassata, non il residuo', async () => {
  // Con le righe prodotto corrette il residuo sarebbe 5,00: la sessione dichiara
  // invece i 7,65 effettivamente incassati per il trasporto.
  const persisted = await persistAndCapture(checkoutSession({
    amount_total: 3_500,
    metadata: metadataWithProductLines({ shipping_cost_cents: '765' }),
  }))

  assert.equal(persisted.shippingCost, 7.65)
})

test('senza la chiave dichiarata resta il residuo delle sessioni precedenti', async () => {
  const persisted = await persistAndCapture(checkoutSession({
    amount_total: 3_500,
    metadata: metadataWithProductLines(),
  }))

  assert.equal(persisted.shippingCost, 5)
})

test('una spedizione dichiarata malformata non diventa un importo', async () => {
  for (const raw of ['7.65', '-1', '', 'abc', '9'.repeat(10), ' 765 ']) {
    const persisted = await persistAndCapture(checkoutSession({
      amount_total: 3_500,
      metadata: metadataWithProductLines({ shipping_cost_cents: raw }),
    }))
    assert.equal(persisted.shippingCost, 5, `valore dichiarato ${JSON.stringify(raw)}`)
  }
})
