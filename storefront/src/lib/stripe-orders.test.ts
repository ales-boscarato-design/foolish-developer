import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type Stripe from 'stripe'
import {
  createOrderInCMS,
  createOrderInCMSWithRetry,
  findCmsOrderWithRetry,
  reconcilePaidStripeOrders,
  OrderReferenceUnresolvedError,
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

function cmsLookupResponse(status: number, value: unknown, retryAfter?: string): Response {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (retryAfter !== undefined) headers.set('retry-after', retryAfter)
  return new Response(JSON.stringify(value), { status, headers })
}

function reconciliationStripe(sessions: Stripe.Checkout.Session[]): Stripe {
  return {
    checkout: {
      sessions: {
        list: () => ({
          autoPagingToArray: async () => sessions,
        }),
        retrieve: async (id: string) => sessions.find((session) => session.id === id)!,
      },
    },
  } as unknown as Stripe
}

test('reconciliation treats a recovered lookup 429 as already present', async () => {
  const originalFetch = globalThis.fetch
  const paid = checkoutSession()
  let lookupAttempts = 0
  let postAttempts = 0
  const waits: number[] = []

  globalThis.fetch = async (_input, init) => {
    if (init?.method === 'POST') {
      postAttempts += 1
      return jsonResponse({ id: 1001 }, 201)
    }
    lookupAttempts += 1
    return lookupAttempts < 3
      ? cmsLookupResponse(429, { error: 'rate limited' })
      : cmsLookupResponse(200, { docs: [{ id: 1001, orderNumber: 'FOOLISH-ORDER-TEST' }] })
  }

  try {
    const result = await reconcilePaidStripeOrders({
      stripe: reconciliationStripe([paid]),
      lookbackDays: 30,
      lookupRetry: { delays: [0, 0, 0], sleep: async (ms) => { waits.push(ms) } },
    })
    assert.equal(result.alreadyPresent, 1)
    assert.equal(result.errors.length, 0)
    assert.equal(result.recovered.length, 0)
    assert.equal(lookupAttempts, 3)
    assert.equal(postAttempts, 0)
    assert.deepEqual(waits, [0, 0])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('persistent lookup 429 fails closed without creating an order', async () => {
  const originalFetch = globalThis.fetch
  const paid = checkoutSession()
  let lookupAttempts = 0
  let postAttempts = 0

  globalThis.fetch = async (_input, init) => {
    if (init?.method === 'POST') {
      postAttempts += 1
      return jsonResponse({ id: 1002 }, 201)
    }
    lookupAttempts += 1
    return cmsLookupResponse(429, { error: 'rate limited' })
  }

  try {
    const result = await reconcilePaidStripeOrders({
      stripe: reconciliationStripe([paid]),
      lookbackDays: 30,
      lookupRetry: { delays: [0, 0, 0], sleep: async () => {} },
    })
    assert.equal(result.recovered.length, 0)
    assert.equal(result.alreadyPresent, 0)
    assert.equal(result.errors.length, 1)
    assert.match(result.errors[0]!.error, /CMS order lookup failed 429/)
    assert.equal(lookupAttempts, 3)
    assert.equal(postAttempts, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('lookup Retry-After never shortens the configured backoff and is capped', async () => {
  const originalFetch = globalThis.fetch

  const run = async (
    retryAfter: string,
    delays: readonly number[],
    maxRetryAfterMs?: number,
    now?: () => number,
  ): Promise<number[]> => {
    const waits: number[] = []
    let lookupAttempts = 0
    globalThis.fetch = async () => {
      lookupAttempts += 1
      return lookupAttempts === 1
        ? cmsLookupResponse(429, { error: 'rate limited' }, retryAfter)
        : cmsLookupResponse(200, { docs: [] })
    }
    await findCmsOrderWithRetry('FOOLISH-RETRY-AFTER', {
      delays,
      maxRetryAfterMs,
      now,
      sleep: async (ms) => { waits.push(ms) },
    })
    return waits
  }

  try {
    assert.deepEqual(await run('1', [0, 4_000]), [4_000])
    assert.deepEqual(await run('30', [0, 0]), [5_000])
    assert.deepEqual(await run('30', [0, 0], 500), [500])

    const now = 1_700_000_000_000
    const futureDate = new Date(now + 3_000).toUTCString()
    assert.deepEqual(await run(futureDate, [0, 0], undefined, () => now), [3_000])
    assert.deepEqual(await run(new Date(now - 3_000).toUTCString(), [0, 4_000], undefined, () => now), [4_000])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('non-transient lookup errors are not retried', async () => {
  const originalFetch = globalThis.fetch
  const paid = checkoutSession()
  let lookupAttempts = 0
  let postAttempts = 0
  const waits: number[] = []

  globalThis.fetch = async (_input, init) => {
    if (init?.method === 'POST') {
      postAttempts += 1
      return jsonResponse({ id: 1004 }, 201)
    }
    lookupAttempts += 1
    return cmsLookupResponse(401, { error: 'unauthorized' })
  }

  try {
    const result = await reconcilePaidStripeOrders({
      stripe: reconciliationStripe([paid]),
      lookbackDays: 30,
      lookupRetry: { delays: [0, 0, 0], sleep: async (ms) => { waits.push(ms) } },
    })
    assert.equal(lookupAttempts, 1)
    assert.deepEqual(waits, [])
    assert.equal(result.errors.length, 1)
    assert.match(result.errors[0]!.error, /CMS order lookup failed 401/)
    assert.equal(postAttempts, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('an exhausted lookup retry opens a circuit for later sessions', async () => {
  const originalFetch = globalThis.fetch
  const sessions = [
    checkoutSession({ id: 'cs_live_first_lookup_failure' }),
    checkoutSession({
      id: 'cs_live_second_lookup_failure',
      metadata: { ...checkoutSession().metadata, order_ref: 'FOOLISH-ORDER-SECOND' },
    }),
  ]
  let lookupAttempts = 0
  let postAttempts = 0

  globalThis.fetch = async (_input, init) => {
    if (init?.method === 'POST') {
      postAttempts += 1
      return jsonResponse({ id: 1005 }, 201)
    }
    lookupAttempts += 1
    return cmsLookupResponse(429, { error: 'rate limited' })
  }

  try {
    const result = await reconcilePaidStripeOrders({
      stripe: reconciliationStripe(sessions),
      lookbackDays: 30,
      lookupRetry: { delays: [0, 0, 0], sleep: async () => {} },
    })
    assert.equal(result.errors.length, 2)
    assert.equal(result.recovered.length, 0)
    assert.equal(result.alreadyPresent, 0)
    assert.equal(lookupAttempts, 3)
    assert.equal(postAttempts, 0)
    assert.match(result.errors[1]!.error, /^CMS order lookup skipped: CMS order lookup failed 429:/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('an exhausted lookup circuit limits CMS requests across a batch', async () => {
  const originalFetch = globalThis.fetch
  const sessions = [
    checkoutSession({ id: 'cs_live_batch_lookup_failure_1' }),
    checkoutSession({
      id: 'cs_live_batch_lookup_failure_2',
      metadata: { ...checkoutSession().metadata, order_ref: 'FOOLISH-ORDER-BATCH-2' },
    }),
    checkoutSession({
      id: 'cs_live_batch_lookup_failure_3',
      metadata: { ...checkoutSession().metadata, order_ref: 'FOOLISH-ORDER-BATCH-3' },
    }),
  ]
  let lookupAttempts = 0
  let postAttempts = 0

  globalThis.fetch = async (_input, init) => {
    if (init?.method === 'POST') {
      postAttempts += 1
      return jsonResponse({ id: 1006 }, 201)
    }
    lookupAttempts += 1
    return cmsLookupResponse(429, { error: 'rate limited' })
  }

  try {
    const result = await reconcilePaidStripeOrders({
      stripe: reconciliationStripe(sessions),
      lookbackDays: 30,
      lookupRetry: { delays: [0, 0, 0], sleep: async () => {} },
    })
    assert.equal(lookupAttempts, 3)
    assert.equal(result.errors.length, 3)
    assert.equal(result.recovered.length, 0)
    assert.equal(result.alreadyPresent, 0)
    assert.equal(postAttempts, 0)
    assert.match(result.errors[1]!.error, /^CMS order lookup skipped:/)
    assert.match(result.errors[2]!.error, /^CMS order lookup skipped:/)
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

// ─── Risoluzione per id di sessione: il numero d'ordine non si inventa ────────
// Il codice vecchio, quando il metadata `order_ref` mancava, usava
// `FOOLISH-${session.id}`: un numero di ~74 caratteri scritto dal webhook, che
// nessuno aveva emesso e che rompeva il deep link Telegram. Qui il caso si
// risolve per le chiavi che esistono davvero (`stripeSessionId` sull'ordine, poi
// il numero legacy) oppure si ferma con un errore esplicito.

/** Quale filtro porta la richiesta: la chiave di sessione o il numero d'ordine. */
function cmsLookup(input: unknown): 'session' | 'order' | 'other' {
  const url = new URL(String(input))
  if (url.searchParams.get('where[stripeSessionId][equals]')) return 'session'
  if (url.searchParams.get('where[orderNumber][equals]')) return 'order'
  return 'other'
}

test('order_ref assente ma sessione registrata: l ordine si risolve, nessun numero inventato', async () => {
  const originalFetch = globalThis.fetch
  let postCount = 0
  const lookups: string[] = []
  const resolvedOrderNumber = 'FOOLISH-0123456789abcdef0123456789abcdef'
  globalThis.fetch = async (input, init) => {
    if (init?.method === 'POST') {
      postCount += 1
      return jsonResponse({ id: 900, orderNumber: 'NON-DOVUTO' }, 201)
    }
    const kind = cmsLookup(input)
    lookups.push(kind)
    return kind === 'session'
      ? jsonResponse({ docs: [{ id: 77, orderNumber: resolvedOrderNumber }] })
      : jsonResponse({ docs: [] })
  }

  try {
    const session = checkoutSession({ id: 'cs_live_no_order_ref', metadata: { items_json: '[]' } })
    const result = await createOrderInCMSWithRetry(session, { delays: [0] })

    assert.equal(result.created, false, 'l ordine esiste già: non se ne crea un secondo')
    assert.equal(result.orderId, 77)
    assert.equal(result.orderRef, resolvedOrderNumber)
    assert.notEqual(result.orderRef, `FOOLISH-${session.id}`, 'id di sessione usato come numero d’ordine')
    assert.equal(postCount, 0)
    assert.deepEqual(lookups, ['session'], 'con la sessione registrata basta una lettura')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('senza order_ref e senza ordine per la sessione: errore esplicito, nessuna scrittura, nessun retry', async () => {
  const originalFetch = globalThis.fetch
  let postCount = 0
  const lookups: string[] = []
  globalThis.fetch = async (input, init) => {
    if (init?.method === 'POST') {
      postCount += 1
      return jsonResponse({ id: 901, orderNumber: 'FOOLISH-ffffffffffffffffffffffffffffffff' }, 201)
    }
    lookups.push(cmsLookup(input))
    return jsonResponse({ docs: [] })
  }

  try {
    const session = checkoutSession({ id: 'cs_live_unresolved', metadata: { items_json: '[]' } })

    await assert.rejects(
      createOrderInCMSWithRetry(session, { delays: [0, 0, 0, 0] }),
      (error: unknown) => {
        assert.ok(error instanceof OrderReferenceUnresolvedError, 'il tipo di errore deve essere riconoscibile')
        assert.equal(error.code, 'order_ref_unresolved')
        assert.equal(error.stripeSessionId, 'cs_live_unresolved')
        return true
      },
    )

    assert.equal(postCount, 0, 'nessun ordine creato con un numero inventato')
    // Un tentativo = due letture (sessione, poi numero legacy). Quattro letture
    // significherebbero due tentativi: l'errore deterministico non va ritentato.
    assert.deepEqual(lookups, ['session', 'order'])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('un ordine legacy con numero FOOLISH-cs_live_... resta raggiungibile', async () => {
  const originalFetch = globalThis.fetch
  let postCount = 0
  const legacyOrderNumber = 'FOOLISH-cs_live_legacy_order'
  const requested: string[] = []
  globalThis.fetch = async (input, init) => {
    if (init?.method === 'POST') {
      postCount += 1
      return jsonResponse({ id: 902, orderNumber: 'NON-DOVUTO' }, 201)
    }
    const url = new URL(String(input))
    requested.push(url.searchParams.get('where[orderNumber][equals]') ?? 'session')
    if (url.searchParams.get('where[orderNumber][equals]') === legacyOrderNumber) {
      return jsonResponse({ docs: [{ id: 88, orderNumber: legacyOrderNumber }] })
    }
    return jsonResponse({ docs: [] })
  }

  try {
    const session = checkoutSession({ id: 'cs_live_legacy_order', metadata: { items_json: '[]' } })
    const result = await createOrderInCMSWithRetry(session, { delays: [0] })

    assert.equal(result.created, false)
    assert.equal(result.orderId, 88)
    assert.equal(result.orderRef, legacyOrderNumber)
    assert.equal(postCount, 0)
    assert.deepEqual(requested, ['session', legacyOrderNumber], 'la ricerca legacy è una lettura, non una creazione')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('l ordine creato registra la sessione Stripe come chiave di risoluzione', async () => {
  const body = await captureOrderBody(checkoutSession())
  assert.equal(body.orderNumber, 'FOOLISH-ORDER-TEST')
  assert.equal(body.stripeSessionId, 'cs_live_order_test')
})

test('riconciliazione: risolve per sessione e attribuisce il numero dell ordine, non un id inventato', async () => {
  const originalFetch = globalThis.fetch
  const resolvedOrderNumber = 'FOOLISH-0123456789abcdef0123456789abcdef'
  let attributionOrderRef: string | null = null
  globalThis.fetch = async (input) => (
    cmsLookup(input) === 'session'
      ? jsonResponse({ docs: [{ id: 909, orderNumber: resolvedOrderNumber }] })
      : jsonResponse({ docs: [] })
  )

  const paid = checkoutSession({ id: 'cs_live_reconcile_session', metadata: { items_json: '[]' } })
  const stripe = {
    checkout: {
      sessions: {
        list: () => ({ autoPagingToArray: async () => [paid] }),
        retrieve: async () => paid,
      },
    },
  } as unknown as Stripe

  try {
    const result = await reconcilePaidStripeOrders({
      stripe,
      lookbackDays: 30,
      affiliateAttribution: async (_session, orderNumber) => { attributionOrderRef = orderNumber },
    })

    assert.equal(result.alreadyPresent, 1)
    assert.equal(result.recovered.length, 0)
    assert.equal(result.errors.length, 0)
    assert.equal(attributionOrderRef, resolvedOrderNumber)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('riconciliazione: una sessione senza riferimento finisce fra gli errori, con orderRef nullo', async () => {
  const originalFetch = globalThis.fetch
  let postCount = 0
  globalThis.fetch = async (_input, init) => {
    if (init?.method === 'POST') postCount += 1
    return jsonResponse({ docs: [] })
  }

  const paid = checkoutSession({ id: 'cs_live_reconcile_unresolved', metadata: { items_json: '[]' } })
  const stripe = {
    checkout: {
      sessions: {
        list: () => ({ autoPagingToArray: async () => [paid] }),
        retrieve: async () => paid,
      },
    },
  } as unknown as Stripe

  try {
    const result = await reconcilePaidStripeOrders({ stripe, lookbackDays: 30 })

    assert.equal(result.recovered.length, 0)
    assert.equal(result.alreadyPresent, 0)
    assert.equal(result.errors.length, 1)
    assert.equal(result.errors[0]?.orderRef, null)
    assert.equal(result.errors[0]?.stripeSessionId, 'cs_live_reconcile_unresolved')
    assert.match(result.errors[0]?.error ?? '', /order_ref/)
    assert.equal(postCount, 0)

    // In questo scenario (nessuna attribuzione affiliate) ogni sessione idonea ha
    // esattamente un esito. Non e' un invariante globale: se `affiliateAttribution`
    // fallisce, la stessa sessione resta in `alreadyPresent` e finisce anche in
    // `errors` — comportamento preesistente, non introdotto qui.
    const counted = result.alreadyPresent + result.recovered.length + result.errors.length
    assert.equal(counted, result.eligiblePaidSessions, 'in questo scenario ogni sessione idonea ha un esito')
  } finally {
    globalThis.fetch = originalFetch
  }
})
