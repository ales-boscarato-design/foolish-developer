import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type Stripe from 'stripe'
import {
  createOrderInCMS,
  createOrderInCMSWithRetry,
  reconcilePaidStripeOrders,
  PROMO_TYPES,
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

// ─── Snapshot del codice promo sull'ordine ───────────────────────────────────
// Lo sconto vive solo come prezzo netto per riga: senza questi campi l'ordine non
// dice quale codice e' stato usato ne' quanto e' stato scontato.

async function captureOrderBody(session: Stripe.Checkout.Session): Promise<Record<string, unknown>> {
  const originalFetch = globalThis.fetch
  let captured: Record<string, unknown> | null = null
  globalThis.fetch = async (_input, init) => {
    if (init?.method === 'POST') {
      captured = JSON.parse(String(init.body)) as Record<string, unknown>
      return jsonResponse({ id: 909, orderNumber: 'FOOLISH-ORDER-TEST' }, 201)
    }
    return jsonResponse({ docs: [] })
  }

  try {
    await createOrderInCMS(session)
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.ok(captured, 'CMS create payload was not captured')
  return captured as Record<string, unknown>
}

function sessionWithPromo(promo: Record<string, string>): Stripe.Checkout.Session {
  return checkoutSession({
    // 16 x 8,75 € = 140,00 € di merce netta (già scontata) + 10,00 € di spedizione
    amount_total: 15_000,
    metadata: {
      order_ref: 'FOOLISH-PROMO-TEST',
      customer_name: 'Promo Test',
      customer_country: 'IT',
      customer_address: 'Via Test 1|Torino|10100',
      items_json: JSON.stringify([
        { sku: 'TS-A5', qty: 16, name: 'T-Sheet Skin -DBL-', variantLabel: 'A5', price: 8.75 },
      ]),
      ...promo,
    },
  })
}

test('persists the promo snapshot when code and discount are valid', async () => {
  const body = await captureOrderBody(sessionWithPromo({
    promo_code: 'davidsalas',
    promo_type: 'percent_tiered',
    promo_discount_amount_cents: '6000',
  }))

  assert.equal(body.promoCode, 'DAVIDSALAS', 'il codice va salvato normalizzato in uppercase')
  assert.equal(body.promoType, 'percent_tiered')
  assert.equal(body.promoDiscountCents, 6_000)
  // il resto dell'ordine non cambia
  assert.equal(body.total, 150)
  assert.equal(body.shippingCost, 10)
})

test('keeps the promo code but never invents the discount when the amount is unreadable', async () => {
  for (const unreadable of ['12.5', '-1', '1e3', '', 'abc']) {
    const body = await captureOrderBody(sessionWithPromo({
      promo_code: 'DAVIDSALAS',
      promo_type: 'percent_tiered',
      promo_discount_amount_cents: unreadable,
    }))

    assert.equal(body.promoCode, 'DAVIDSALAS', `code kept for ${JSON.stringify(unreadable)}`)
    assert.equal(body.promoType, 'percent_tiered', `type kept for ${JSON.stringify(unreadable)}`)
    assert.equal('promoDiscountCents' in body, false, `no invented discount for ${JSON.stringify(unreadable)}`)
    assert.equal(body.total, 150)
  }
})

test('drops every promo field when the code is malformed, even with an amount present', async () => {
  for (const malformed of ['', '  ', 'has space', 'a'.repeat(65), '-LEADING']) {
    const body = await captureOrderBody(sessionWithPromo({
      promo_code: malformed,
      promo_type: 'percent',
      promo_discount_amount_cents: '500',
    }))

    assert.equal('promoCode' in body, false, `no code for ${JSON.stringify(malformed)}`)
    assert.equal('promoType' in body, false, `no type for ${JSON.stringify(malformed)}`)
    assert.equal('promoDiscountCents' in body, false, `no discount for ${JSON.stringify(malformed)}`)
    assert.equal(body.total, 150, 'ordine comunque creato')
  }
})

test('an order without promo metadata sends no promo fields', async () => {
  const body = await captureOrderBody(checkoutSession())
  assert.equal('promoCode' in body, false)
  assert.equal('promoType' in body, false)
  assert.equal('promoDiscountCents' in body, false)
  assert.equal(body.paymentStatus, 'paid')
})

test('an unsupported promo type is dropped while the code and discount survive', async () => {
  const body = await captureOrderBody(sessionWithPromo({
    promo_code: 'DAVIDSALAS',
    promo_type: 'percent_tiered_v2',
    promo_discount_amount_cents: '6000',
  }))

  assert.equal(body.promoCode, 'DAVIDSALAS')
  assert.equal('promoType' in body, false)
  assert.equal(body.promoDiscountCents, 6_000)
})

// Storefront e CMS sono due pacchetti separati e non si importano a vicenda: la lista dei
// tipi promo esiste in due copie. Questa guardia legge la copia canonica dal CMS e
// confronta, cosi' aggiungere un tipo in un solo posto diventa rosso invece di far perdere
// il `promoType` sugli ordini in silenzio. Gira qui (e quindi in CI) perche' e' il test
// storefront gia' eseguito dal workflow.
test('the storefront promo type list matches the canonical CMS list', () => {
  const cmsPath = fileURLToPath(new URL('../../../cms/src/collections/promoTypes.ts', import.meta.url))
  const source = readFileSync(cmsPath, 'utf8')
  const match = source.match(/PROMO_TYPES\s*=\s*\[([^\]]*)\]/)
  assert.ok(match, 'PROMO_TYPES non trovato in cms/src/collections/promoTypes.ts')
  const cmsTypes = [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1])

  assert.deepEqual([...PROMO_TYPES].sort(), [...cmsTypes].sort())
})
