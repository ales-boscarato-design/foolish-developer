import assert from 'node:assert/strict'
import test from 'node:test'
import type { CatalogProductFetcher } from './catalog'
import type { ExtraEuShippingResolution } from './landed-cost'
import { handleReorder, planReorder } from './reorder'

const SESSION_EMAIL = 'cliente@example.test'

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: 'product-1',
    name: 'Foglio Test',
    active: true,
    variants: [{
      sku: 'SKU-1',
      label: 'A4',
      price: 12.5,
      stockStatus: 'available',
    }],
    packs: [],
    ...overrides,
  }
}

function catalogFetcher(document: unknown = product()): CatalogProductFetcher {
  return async () => ({ status: 'found', product: document })
}

/** Un documento per SKU: serve agli ordini con piu` righe distinte. */
function multiSkuFetcher(skus: string[], overrides: Record<string, unknown> = {}): CatalogProductFetcher {
  return async ({ sku }) => {
    if (!sku || !skus.includes(sku)) return { status: 'not-found' }
    return {
      status: 'found',
      product: product({
        id: `product-${sku}`,
        variants: [{ sku, label: 'A4', price: 12.5, stockStatus: 'available' }],
        ...overrides,
      }),
    }
  }
}

function order(overrides: Record<string, unknown> = {}) {
  return {
    orderNumber: 'ORD-1',
    customerEmail: SESSION_EMAIL,
    customerCountry: 'IT',
    customerPhone: '+390000000000',
    shippingAddress: {
      name: 'Mario Rossi',
      address1: 'Via Test 1',
      city: 'Torino',
      postalCode: '10100',
      country: 'IT',
    },
    lineItems: [{
      sku: 'SKU-1',
      name: 'Foglio',
      variantLabel: 'A4',
      quantity: 2,
      unitPrice: 12.5,
    }],
    ...overrides,
  }
}

function withVariantPrice(price: number) {
  return product({
    variants: [{ sku: 'SKU-1', label: 'A4', price, stockStatus: 'available' }],
  })
}

const SHIPPING_RESOLUTION: ExtraEuShippingResolution = {
  costCents: 5_249,
  source: 'profile',
  basisCostCents: 4_772,
  marginCents: 477,
  minChargeCents: 4_800,
  minimumChargeApplied: false,
  quote: null,
  verified: false,
  quoteFailure: 'disabled',
  profileCostCents: 4_772,
  tableCostCents: null,
}

test('listino corrente diverso dallo storico: prezzo_cambiato con le due cifre', async () => {
  const plan = await planReorder({
    order: order(),
    sessionEmail: SESSION_EMAIL,
    fetchProduct: catalogFetcher(withVariantPrice(16)),
  })

  assert.equal(plan.status, 'refused')
  if (plan.status !== 'refused') return
  assert.equal(plan.code, 'prezzo_cambiato')
  assert.equal(plan.httpStatus, 409)
  assert.deepEqual(plan.rows, [{
    sku: 'SKU-1',
    previousTotalCents: 2_500,
    currentTotalCents: 3_200,
  }])
})

test('prezzi uguali: ok con metadata canonici, items_json e riga Spedizione', async () => {
  const plan = await planReorder({
    order: order(),
    sessionEmail: SESSION_EMAIL,
    fetchProduct: catalogFetcher(),
    now: new Date(1_700_000_000_000),
  })

  assert.equal(plan.status, 'ok')
  if (plan.status !== 'ok') return
  assert.equal(plan.orderRef, 'FOOLISH-1700000000000')
  assert.equal(plan.sessionParams.mode, 'payment')
  assert.equal(plan.sessionParams.customer_email, SESSION_EMAIL)
  assert.deepEqual(plan.sessionParams.shipping_address_collection, {
    allowed_countries: ['IT'],
  })

  const metadata = plan.sessionParams.metadata as Record<string, string>
  for (const key of [
    'order_ref',
    'customer_name',
    'customer_country',
    'customer_address',
    'customer_phone',
    'items_json',
    'shipping_source',
  ]) {
    assert.ok(key in metadata, `manca la chiave metadata ${key}`)
  }
  assert.equal(metadata.order_ref, 'FOOLISH-1700000000000')
  assert.equal(metadata.shipping_source, 'carrier_flat')

  assert.deepEqual(JSON.parse(metadata.items_json), [{
    sku: 'SKU-1',
    qty: 2,
    name: 'Foglio Test',
    variantLabel: 'A4',
    price: 12.5,
  }])

  const lineItems = plan.sessionParams.line_items as Array<{
    price_data: { unit_amount: number; product_data: { name: string; metadata?: { sku: string } } }
    quantity: number
  }>
  assert.equal(lineItems.length, 2)
  assert.deepEqual(lineItems[0]!.price_data.product_data.metadata, { sku: 'SKU-1' })
  const shipping = lineItems.find((line) => line.price_data.product_data.name === 'Spedizione')
  assert.ok(shipping, 'manca la riga Spedizione')
  assert.equal(shipping.price_data.unit_amount, 765)
  assert.equal(shipping.quantity, 1)
})

test('sku non piu a catalogo, variante unavailable o prodotto inactive: righe_non_disponibili', async () => {
  const cases: Array<[string, CatalogProductFetcher]> = [
    ['sku assente', async () => ({ status: 'not-found' })],
    ['variante unavailable', catalogFetcher(product({
      variants: [{ sku: 'SKU-1', label: 'A4', price: 12.5, stockStatus: 'unavailable' }],
    }))],
    ['prodotto inactive', catalogFetcher(product({ active: false }))],
  ]

  for (const [label, fetchProduct] of cases) {
    const plan = await planReorder({ order: order(), sessionEmail: SESSION_EMAIL, fetchProduct })
    assert.equal(plan.status, 'refused', label)
    if (plan.status !== 'refused') continue
    assert.equal(plan.code, 'righe_non_disponibili', label)
    assert.equal(plan.httpStatus, 409, label)
    assert.deepEqual(plan.skus, ['SKU-1'], label)
  }
})

test('catalogo irraggiungibile: catalogo_non_disponibile 503', async () => {
  const plan = await planReorder({
    order: order(),
    sessionEmail: SESSION_EMAIL,
    fetchProduct: async () => ({ status: 'unavailable' }),
  })

  assert.equal(plan.status, 'refused')
  if (plan.status !== 'refused') return
  assert.equal(plan.code, 'catalogo_non_disponibile')
  assert.equal(plan.httpStatus, 503)
})

test('extra-UE senza base di prezzo: spedizione_da_quotare, con base: ok e metadata spedizione', async () => {
  const extraEuOrder = order({
    customerCountry: 'CH',
    shippingAddress: {
      name: 'Mario Rossi',
      address1: 'Via Test 1',
      city: 'Basel',
      postalCode: '4058',
      country: 'CH',
    },
    lineItems: [{ sku: 'SKU-1', name: 'Foglio', variantLabel: 'A4', quantity: 1, unitPrice: 12.5 }],
  })

  const refused = await planReorder({
    order: extraEuOrder,
    sessionEmail: SESSION_EMAIL,
    fetchProduct: catalogFetcher(),
    resolveExtraEu: async () => null,
  })
  assert.equal(refused.status, 'refused')
  if (refused.status === 'refused') {
    assert.equal(refused.code, 'spedizione_da_quotare')
    assert.equal(refused.httpStatus, 409)
  }

  let seenDestination: { zip?: string; city?: string } | null = null
  const plan = await planReorder({
    order: extraEuOrder,
    sessionEmail: SESSION_EMAIL,
    fetchProduct: catalogFetcher(),
    resolveExtraEu: async (args) => {
      seenDestination = args.destination
      return SHIPPING_RESOLUTION
    },
  })

  assert.deepEqual(seenDestination, { zip: '4058', city: 'Basel' })
  assert.equal(plan.status, 'ok')
  if (plan.status !== 'ok') return
  const metadata = plan.sessionParams.metadata as Record<string, string>
  assert.equal(metadata.shipping_source, 'profile')
  assert.equal(metadata.shipping_basis_cents, '4772')
  const lineItems = plan.sessionParams.line_items as Array<{
    price_data: { unit_amount: number; product_data: { name: string } }
  }>
  const shipping = lineItems.find((line) => line.price_data.product_data.name === 'Spedizione')
  assert.equal(shipping?.price_data.unit_amount, 5_249)
})

// ------------------------------------------------------- guardia preventivo BR

test('destinazione in preventivo (BR): spedizione_da_quotare prima della spedizione, nessuna sessione', async () => {
  const brOrder = order({
    customerCountry: 'BR',
    shippingAddress: {
      name: 'Mario Rossi',
      address1: 'Rua Test 1',
      city: 'Sao Paulo',
      postalCode: '01000-000',
      country: 'BR',
    },
    lineItems: [{ sku: 'SKU-1', name: 'Foglio', variantLabel: 'A4', quantity: 1, unitPrice: 12.5 }],
  })

  let resolveCalls = 0
  const direct = await planReorder({
    order: brOrder,
    sessionEmail: SESSION_EMAIL,
    fetchProduct: catalogFetcher(),
    resolveExtraEu: async () => {
      resolveCalls += 1
      return SHIPPING_RESOLUTION
    },
  })
  assert.equal(direct.status, 'refused')
  if (direct.status === 'refused') {
    assert.equal(direct.code, 'spedizione_da_quotare')
    assert.equal(direct.httpStatus, 409)
    // Stesso testo del checkout canonico.
    assert.equal(
      direct.message,
      'Per questa destinazione calcoliamo la spedizione con lo sdoganamento incluso: scrivici e la quotiamo prima del pagamento.',
    )
  }
  // La guardia sta PRIMA della risoluzione: nessun profilo prudenziale puo`
  // produrre una riga Spedizione per un pacco che non parte.
  assert.equal(resolveCalls, 0)

  let createCalls = 0
  const response = await handleReorder({
    orderId: 'ORD-1',
    sessionEmail: SESSION_EMAIL,
    findOrder: async () => brOrder,
    fetchProduct: catalogFetcher(),
    createCheckoutSession: async () => {
      createCalls += 1
      return { url: 'https://stripe.test/session' }
    },
  })
  assert.equal(response.status, 409)
  assert.equal(((await response.json()) as { error: string }).error, 'spedizione_da_quotare')
  assert.equal(createCalls, 0)
})

test('7 righe distinte: ordine_troppo_grande, nessuna sessione', async () => {
  const skus = ['SKU-1', 'SKU-2', 'SKU-3', 'SKU-4', 'SKU-5', 'SKU-6', 'SKU-7']
  const sevenLineOrder = order({
    lineItems: skus.map((sku) => ({
      sku,
      name: 'Foglio',
      variantLabel: 'A4',
      quantity: 1,
      unitPrice: 12.5,
    })),
  })
  const fetchProduct = multiSkuFetcher(skus)

  const plan = await planReorder({
    order: sevenLineOrder,
    sessionEmail: SESSION_EMAIL,
    fetchProduct,
  })
  assert.equal(plan.status, 'refused')
  if (plan.status === 'refused') {
    assert.equal(plan.code, 'ordine_troppo_grande')
    assert.equal(plan.httpStatus, 409)
    assert.match(plan.message, /troppe righe/)
  }

  let createCalls = 0
  const response = await handleReorder({
    orderId: 'ORD-1',
    sessionEmail: SESSION_EMAIL,
    findOrder: async () => sevenLineOrder,
    fetchProduct,
    createCheckoutSession: async () => {
      createCalls += 1
      return { url: 'https://stripe.test/session' }
    },
  })
  assert.equal(response.status, 409)
  assert.equal(((await response.json()) as { error: string }).error, 'ordine_troppo_grande')
  assert.equal(createCalls, 0)
})

test('riga pack: prezzo scontato dal pack e quantita multipla', async () => {
  const packProduct = product({
    packs: [{ id: 'p3', name: 'Pack 3', quantity: 3, discountPercent: 10 }],
  })
  // Listino 12,50 EUR; pack -10% => 11,25 EUR per unita`; 6 pezzi = 67,50 EUR.
  const packOrder = order({
    lineItems: [{
      sku: 'SKU-1-pack-p3',
      name: 'Foglio',
      variantLabel: 'A4',
      quantity: 6,
      unitPrice: 11.25,
    }],
  })

  const plan = await planReorder({
    order: packOrder,
    sessionEmail: SESSION_EMAIL,
    fetchProduct: catalogFetcher(packProduct),
  })
  assert.equal(plan.status, 'ok')
  if (plan.status !== 'ok') return

  const metadata = plan.sessionParams.metadata as Record<string, string>
  assert.deepEqual(JSON.parse(metadata.items_json), [{
    sku: 'SKU-1-pack-p3',
    qty: 6,
    name: 'Foglio Test',
    variantLabel: 'A4',
    price: 11.25,
  }])

  const lineItems = plan.sessionParams.line_items as Array<{
    price_data: { unit_amount: number; product_data: { name: string; metadata?: { sku: string } } }
    quantity: number
  }>
  const packLine = lineItems.find(
    (line) => line.price_data.product_data.metadata?.sku === 'SKU-1-pack-p3',
  )
  assert.ok(packLine, 'manca la riga prodotto del pack')
  assert.equal(packLine.price_data.unit_amount, 1_125)
  assert.equal(packLine.quantity, 6)
  assert.equal(packLine.price_data.product_data.name, 'Foglio Test — A4')
})

test('ordine pagato con promo (prezzi netti sotto listino): prezzo_cambiato', async () => {
  // 2 x 10,00 EUR incassati con promo; il listino corrente e` 12,50.
  const discountedOrder = order({
    lineItems: [{ sku: 'SKU-1', name: 'Foglio', variantLabel: 'A4', quantity: 2, unitPrice: 10 }],
  })

  const plan = await planReorder({
    order: discountedOrder,
    sessionEmail: SESSION_EMAIL,
    fetchProduct: catalogFetcher(),
  })
  assert.equal(plan.status, 'refused')
  if (plan.status !== 'refused') return
  assert.equal(plan.code, 'prezzo_cambiato')
  assert.equal(plan.httpStatus, 409)
  assert.deepEqual(plan.rows, [{
    sku: 'SKU-1',
    previousTotalCents: 2_000,
    currentTotalCents: 2_500,
  }])
})

test('indirizzo vecchio inutilizzabile (paese non ammesso): dati_ordine_non_validi', async () => {
  const plan = await planReorder({
    order: order({
      customerCountry: 'ZZ',
      shippingAddress: {
        name: 'Mario Rossi',
        address1: 'Via Test 1',
        city: 'Torino',
        postalCode: '10100',
        country: 'ZZ',
      },
    }),
    sessionEmail: SESSION_EMAIL,
    fetchProduct: catalogFetcher(),
  })

  assert.equal(plan.status, 'refused')
  if (plan.status !== 'refused') return
  assert.equal(plan.code, 'dati_ordine_non_validi')
  assert.equal(plan.httpStatus, 409)
})

test('ownership: ordine di un altro cliente -> order_not_found, nessuna sessione', async () => {
  // Il planner e' il confine che decide se si puo' incassare: deve rifiutare
  // anche quando viene chiamato direttamente, non solo tramite la rotta.
  const direct = await planReorder({
    order: order({ customerEmail: 'altro@example.test' }),
    sessionEmail: SESSION_EMAIL,
    fetchProduct: catalogFetcher(),
  })
  assert.equal(direct.status, 'refused')
  if (direct.status === 'refused') {
    assert.equal(direct.code, 'order_not_found')
    assert.equal(direct.httpStatus, 404)
  }

  let createCalls = 0
  const response = await handleReorder({
    orderId: 'ORD-1',
    sessionEmail: SESSION_EMAIL,
    findOrder: async () => order({ customerEmail: 'altro@example.test' }),
    fetchProduct: catalogFetcher(),
    createCheckoutSession: async () => {
      createCalls += 1
      return { url: 'https://stripe.test/session' }
    },
  })

  assert.equal(response.status, 404)
  assert.deepEqual(await response.json(), {
    error: 'order_not_found',
    message: 'Ordine non trovato.',
  })
  assert.equal(createCalls, 0)
})

test('encoding: un orderId che prova a iniettare where non emette alcuna query', async () => {
  const originalFetch = globalThis.fetch
  let queries = 0
  globalThis.fetch = (async () => {
    queries += 1
    return new Response(JSON.stringify({ docs: [] }), { status: 200 })
  }) as typeof fetch

  try {
    const response = await handleReorder({
      orderId: 'ORD-1&where[customerEmail][equals]=vittima@example.test',
      sessionEmail: SESSION_EMAIL,
      fetchProduct: catalogFetcher(),
    })
    assert.equal(response.status, 404)
    assert.equal(queries, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('la query CMS codifica entrambi i valori e usa l esatto contratto', async () => {
  const originalFetch = globalThis.fetch
  const originalCmsUrl = process.env.NEXT_PUBLIC_CMS_URL
  const originalSecret = process.env.PAYLOAD_API_SECRET
  const calls: Array<{ url: string; init?: RequestInit }> = []
  process.env.NEXT_PUBLIC_CMS_URL = 'https://cms.example.test'
  process.env.PAYLOAD_API_SECRET = 'test-secret'
  globalThis.fetch = (async (input, init) => {
    calls.push({ url: String(input), init })
    return new Response(JSON.stringify({ docs: [order()] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch

  try {
    const response = await handleReorder({
      orderId: 'ORD-1',
      sessionEmail: SESSION_EMAIL,
      fetchProduct: catalogFetcher(),
      createCheckoutSession: async () => ({ url: 'https://stripe.test/session' }),
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { url: 'https://stripe.test/session' })
    assert.equal(calls.length, 1)
    assert.equal(
      calls[0]!.url,
      'https://cms.example.test/api/orders'
        + '?where[orderNumber][equals]=ORD-1'
        + '&where[customerEmail][equals]=cliente%40example.test'
        + '&depth=0&limit=1',
    )
    assert.equal(
      (calls[0]!.init?.headers as Record<string, string>)['x-storefront-secret'],
      'test-secret',
    )
  } finally {
    globalThis.fetch = originalFetch
    if (originalCmsUrl === undefined) delete process.env.NEXT_PUBLIC_CMS_URL
    else process.env.NEXT_PUBLIC_CMS_URL = originalCmsUrl
    if (originalSecret === undefined) delete process.env.PAYLOAD_API_SECRET
    else process.env.PAYLOAD_API_SECRET = originalSecret
  }
})

test('handleReorder: 401 senza email di sessione', async () => {
  const response = await handleReorder({ orderId: 'ORD-1', sessionEmail: '' })
  assert.equal(response.status, 401)
})

test('handleReorder: 404 se il CMS non restituisce un ordine, nessuna sessione', async () => {
  let createCalls = 0
  const response = await handleReorder({
    orderId: 'ORD-1',
    sessionEmail: SESSION_EMAIL,
    findOrder: async () => null,
    createCheckoutSession: async () => {
      createCalls += 1
      return { url: 'https://stripe.test/session' }
    },
  })
  assert.equal(response.status, 404)
  assert.equal(createCalls, 0)
})

test('handleReorder: 409 prezzo cambiato, nessuna sessione', async () => {
  let createCalls = 0
  const response = await handleReorder({
    orderId: 'ORD-1',
    sessionEmail: SESSION_EMAIL,
    findOrder: async () => order(),
    fetchProduct: catalogFetcher(withVariantPrice(16)),
    createCheckoutSession: async () => {
      createCalls += 1
      return { url: 'https://stripe.test/session' }
    },
  })
  assert.equal(response.status, 409)
  assert.equal(((await response.json()) as { error: string }).error, 'prezzo_cambiato')
  assert.equal(createCalls, 0)
})

test('handleReorder: 503 se il CMS e irraggiungibile, nessuna sessione', async () => {
  let createCalls = 0
  const response = await handleReorder({
    orderId: 'ORD-1',
    sessionEmail: SESSION_EMAIL,
    findOrder: async () => {
      throw new Error('CMS down')
    },
    createCheckoutSession: async () => {
      createCalls += 1
      return { url: 'https://stripe.test/session' }
    },
  })
  assert.equal(response.status, 503)
  assert.equal(createCalls, 0)
})

test('handleReorder: 503 se STRIPE_SECRET_KEY manca, senza chiamare Stripe', async () => {
  const original = process.env.STRIPE_SECRET_KEY
  delete process.env.STRIPE_SECRET_KEY
  try {
    const response = await handleReorder({
      orderId: 'ORD-1',
      sessionEmail: SESSION_EMAIL,
      findOrder: async () => order(),
      fetchProduct: catalogFetcher(),
    })
    assert.equal(response.status, 503)
  } finally {
    if (original === undefined) delete process.env.STRIPE_SECRET_KEY
    else process.env.STRIPE_SECRET_KEY = original
  }
})

test('handleReorder: 502 su errore Stripe senza far trapelare il messaggio', async () => {
  const response = await handleReorder({
    orderId: 'ORD-1',
    sessionEmail: SESSION_EMAIL,
    findOrder: async () => order(),
    fetchProduct: catalogFetcher(),
    createCheckoutSession: async () => {
      throw new Error('errore-provider-con-dettagli-interni')
    },
  })
  assert.equal(response.status, 502)
  const body = (await response.json()) as { error: string; message: string }
  assert.equal(body.error, 'pagamento_non_disponibile')
  assert.doesNotMatch(body.message, /dettagli-interni/)
})
