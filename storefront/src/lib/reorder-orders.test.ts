import assert from 'node:assert/strict'
import test from 'node:test'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type Stripe from 'stripe'
import type { CatalogProductFetcher } from './catalog'
import { planReorder, type ReorderPlan } from './reorder'
import { createOrderInCMSWithRetry, reconcilePaidStripeOrders } from './stripe-orders'

const SESSION_EMAIL = 'cliente@example.test'
const SESSION_ID = 'cs_test_reorder_1'

const CATALOG: CatalogProductFetcher = async () => ({
  status: 'found',
  product: {
    id: 'product-1',
    name: 'Foglio Test',
    active: true,
    variants: [{ sku: 'SKU-1', label: 'A4', price: 12.5, stockStatus: 'available' }],
    packs: [],
  },
})

const SOURCE_ORDER = {
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
}

type CmsState = {
  orders: Array<Record<string, unknown>>
  posts: Array<Record<string, unknown>>
}

type CmsHarness = {
  base: string
  state: CmsState
  close: () => Promise<void>
}

async function startCms(): Promise<CmsHarness> {
  const state: CmsState = { orders: [], posts: [] }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')

    if (req.method === 'GET' && url.pathname === '/api/orders') {
      const orderNumber = url.searchParams.get('where[orderNumber][equals]')
      const docs = state.orders.filter((order) => order.orderNumber === orderNumber)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ docs }))
      return
    }

    if (req.method === 'POST' && url.pathname === '/api/orders') {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
      state.posts.push(body)
      const stored = { id: state.posts.length, orderNumber: body.orderNumber }
      state.orders.push(stored)
      res.writeHead(201, { 'content-type': 'application/json' })
      res.end(JSON.stringify(stored))
      return
    }

    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'not found' }))
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const port = (server.address() as AddressInfo).port

  return {
    base: `http://127.0.0.1:${port}`,
    state,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    }),
  }
}

async function withCms(run: (cms: CmsHarness) => Promise<void>): Promise<void> {
  const originalCmsUrl = process.env.PAYLOAD_PUBLIC_URL
  const cms = await startCms()
  process.env.PAYLOAD_PUBLIC_URL = cms.base
  try {
    await run(cms)
  } finally {
    if (originalCmsUrl === undefined) delete process.env.PAYLOAD_PUBLIC_URL
    else process.env.PAYLOAD_PUBLIC_URL = originalCmsUrl
    await cms.close()
  }
}

async function plannedSession(): Promise<Stripe.Checkout.Session> {
  const plan: ReorderPlan = await planReorder({
    order: SOURCE_ORDER,
    sessionEmail: SESSION_EMAIL,
    fetchProduct: CATALOG,
    now: new Date(1_700_000_000_000),
  })
  assert.equal(plan.status, 'ok')
  if (plan.status !== 'ok') throw new Error('il piano di riordino non e` ok')

  const sessionParams = plan.sessionParams
  const lineItems = sessionParams.line_items as Array<{
    price_data: { unit_amount: number }
    quantity: number
  }>
  const amountTotalCents = lineItems.reduce(
    (sum, line) => sum + line.price_data.unit_amount * line.quantity,
    0,
  )

  return {
    id: SESSION_ID,
    object: 'checkout.session',
    livemode: true,
    mode: 'payment',
    payment_status: 'paid',
    payment_intent: 'pi_test_reorder_1',
    amount_total: amountTotalCents,
    currency: 'eur',
    customer_email: SESSION_EMAIL,
    customer_details: { name: 'Mario Rossi', email: SESSION_EMAIL },
    collected_information: {
      shipping_details: {
        name: 'Mario Rossi',
        address: {
          line1: 'Via Test 1',
          line2: '',
          city: 'Torino',
          postal_code: '10100',
          country: 'IT',
        },
      },
    },
    metadata: sessionParams.metadata as Stripe.Metadata,
  } as unknown as Stripe.Checkout.Session
}

function metadataOrderRef(session: Stripe.Checkout.Session): string {
  const orderRef = session.metadata?.order_ref
  assert.equal(typeof orderRef, 'string')
  return orderRef as string
}

test('la sessione pagata del riordino crea un ordine CMS con righe, totale e spedizione veri', async () => {
  await withCms(async (cms) => {
    const session = await plannedSession()
    const result = await createOrderInCMSWithRetry(session)

    assert.equal(result.created, true)
    assert.equal(cms.state.posts.length, 1)
    const persisted = cms.state.posts[0]!

    assert.equal(persisted.orderNumber, metadataOrderRef(session))
    assert.deepEqual(persisted.lineItems, [{
      sku: 'SKU-1',
      name: 'Foglio Test',
      variantLabel: 'A4',
      quantity: 2,
      unitPrice: 12.5,
    }])
    assert.equal(persisted.total, 32.65)
    assert.equal(persisted.shippingCost, 7.65)
    assert.deepEqual(persisted.shippingAddress, {
      name: 'Mario Rossi',
      address1: 'Via Test 1',
      address2: '',
      city: 'Torino',
      postalCode: '10100',
      country: 'IT',
    })
    assert.equal(persisted.customerName, 'Mario Rossi')
    assert.equal(persisted.paymentStatus, 'paid')
  })
})

test('webhook fallito: il riconciliatore recupera la sessione pagata del riordino', async () => {
  await withCms(async (cms) => {
    const session = await plannedSession()
    assert.equal(cms.state.posts.length, 0, 'il webhook non ha scritto nulla')

    const stripeStub = {
      checkout: {
        sessions: {
          list: () => ({
            autoPagingToArray: async () => [session],
          }),
          retrieve: async () => session,
        },
      },
    } as unknown as Stripe

    const result = await reconcilePaidStripeOrders({ stripe: stripeStub, lookbackDays: 7 })

    assert.equal(result.eligiblePaidSessions, 1)
    assert.equal(result.recovered.length, 1)
    assert.equal(result.recovered[0]!.orderRef, metadataOrderRef(session))
    assert.equal(result.errors.length, 0)
    assert.equal(cms.state.posts.length, 1)
  })
})

test('retry sulla stessa sessione: il secondo tentativo non duplica l ordine', async () => {
  await withCms(async (cms) => {
    const session = await plannedSession()
    const first = await createOrderInCMSWithRetry(session)
    const second = await createOrderInCMSWithRetry(session)

    assert.equal(first.created, true)
    assert.equal(second.created, false)
    assert.equal(cms.state.posts.length, 1)
  })
})
