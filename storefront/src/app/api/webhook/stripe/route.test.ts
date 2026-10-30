import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import test from 'node:test'
import { NextRequest } from 'next/server'

process.env.DATABASE_URL = 'postgres://test:test@127.0.0.1:5432/test'
process.env.STRIPE_SECRET_KEY = 'sk_test_webhook_route'
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_webhook_route'
process.env.PAYLOAD_PUBLIC_URL = 'https://cms.test'
process.env.PAYLOAD_API_SECRET = ''
delete process.env.NANOBOT_WEBHOOK_URL
delete process.env.NANOBOT_WEBHOOK_SECRET

const routePromise = import('./route')

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function paymentSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cs_test_route_order',
    object: 'checkout.session',
    livemode: true,
    mode: 'payment',
    payment_status: 'paid',
    payment_intent: 'pi_test_route_order',
    amount_total: 3_500,
    currency: 'eur',
    customer_email: null,
    customer_details: null,
    collected_information: null,
    metadata: {
      order_ref: 'FOOLISH-1746364800000',
      items_json: '[]',
    },
    ...overrides,
  }
}

function webhookEvent(session: Record<string, unknown>, id = 'evt_test_route') {
  return {
    id,
    object: 'event',
    api_version: '2025-03-31.basil',
    created: 1_746_364_800,
    livemode: true,
    pending_webhooks: 1,
    request: null,
    type: 'checkout.session.completed',
    data: { object: session },
  }
}

function signedRequest(event: Record<string, unknown>): NextRequest {
  const payload = JSON.stringify(event)
  const timestamp = Math.floor(Date.now() / 1_000)
  const signature = createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET!)
    .update(`${timestamp}.${payload}`)
    .digest('hex')
  return new NextRequest('https://storefront.test/api/webhook/stripe', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'stripe-signature': `t=${timestamp},v1=${signature}`,
    },
    body: payload,
  })
}

async function post(event: Record<string, unknown>): Promise<Response> {
  const { POST } = await routePromise
  return POST(signedRequest(event))
}

test('valid paid storefront checkout persists one order across webhook redelivery', async () => {
  const originalFetch = globalThis.fetch
  const calls: Array<{ url: string; method: string }> = []
  const orders = new Map<string, number>()
  let nextId = 1
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ url, method })

    if (url.includes('/api/orders?')) {
      const orderRef = new URL(url).searchParams.get('where[orderNumber][equals]')
      const id = orderRef ? orders.get(orderRef) : undefined
      return jsonResponse({ docs: id ? [{ id, orderNumber: orderRef }] : [] })
    }
    if (method === 'POST' && url.endsWith('/api/orders')) {
      const body = JSON.parse(String(init?.body)) as { orderNumber: string }
      const id = nextId++
      orders.set(body.orderNumber, id)
      return jsonResponse({ id, orderNumber: body.orderNumber }, 201)
    }
    throw new Error(`unexpected fetch in route test: ${method} ${url}`)
  }

  try {
    const event = webhookEvent(paymentSession())
    assert.equal((await post(event)).status, 200)
    assert.equal((await post(event)).status, 200)
    assert.equal(orders.size, 1)
    assert.equal(calls.filter((call) => call.method === 'POST').length, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

for (const [label, orderRef, paymentIntentId] of [
  ['missing order_ref', undefined, 'pi_test_quarantine_missing'],
  ['invalid order_ref', 'FOOLISH-cs_test_not_an_order_ref', 'pi_test_quarantine_invalid'],
] as const) {
  test(`paid payment checkout with ${label} is quarantined without side effects`, async () => {
    const originalFetch = globalThis.fetch
    const originalWarn = console.warn
    let fetchCount = 0
    const warnings: unknown[][] = []
    globalThis.fetch = async () => {
      fetchCount += 1
      throw new Error('quarantined checkout must not call fetch')
    }
    console.warn = (...args: unknown[]) => warnings.push(args)

    try {
      const session = paymentSession({
        id: `cs_test_quarantine_${label.replaceAll(' ', '_')}`,
        payment_intent: paymentIntentId,
        amount_total: 99_999,
        customer_email: 'must-not-be-logged@example.invalid',
        metadata: {
          order_ref: orderRef,
          customer_name: 'Must Not Be Logged',
          items_json: JSON.stringify([{ sku: 'PII-SKU', qty: 1 }]),
        },
      })
      const response = await post(webhookEvent(session))

      assert.equal(response.status, 200)
      assert.equal(fetchCount, 0)
      assert.deepEqual(warnings, [[
        '[webhook] paid payment checkout quarantined',
        {
          stripeSessionId: session.id,
          paymentIntentId,
        },
      ]])
    } finally {
      globalThis.fetch = originalFetch
      console.warn = originalWarn
    }
  })
}

test('subscription checkout remains on the subscription path without order quarantine', async () => {
  const originalFetch = globalThis.fetch
  const calls: string[] = []
  const originalWarn = console.warn
  const warnings: unknown[][] = []
  globalThis.fetch = async (input) => {
    const url = String(input)
    calls.push(url)
    if (url.includes('/api/subscriptions?')) {
      return jsonResponse({
        docs: [{
          id: 'subscription-record-1',
          customerEmail: 'subscription@example.invalid',
          plan: 'tattoo',
          zone: 'IT',
          stripeSubscriptionId: 'sub_test_route',
          stripeScheduleId: 'sched_test_route',
          status: 'active',
          cyclesCompleted: 0,
        }],
      })
    }
    throw new Error(`unexpected fetch in subscription route test: ${url}`)
  }
  console.warn = (...args: unknown[]) => warnings.push(args)

  try {
    const session = paymentSession({
      id: 'cs_test_route_subscription',
      mode: 'subscription',
      payment_intent: null,
      subscription: 'sub_test_route',
      metadata: {
        plan: 'tattoo',
        zone: 'IT',
        customerEmail: 'subscription@example.invalid',
      },
    })
    const response = await post(webhookEvent(session, 'evt_test_route_subscription'))

    assert.equal(response.status, 200)
    assert.equal(calls.length, 1)
    assert.equal(calls[0]?.includes('/api/subscriptions?'), true)
    assert.equal(calls.some((url) => url.includes('/api/orders')), false)
    assert.deepEqual(warnings, [])
  } finally {
    globalThis.fetch = originalFetch
    console.warn = originalWarn
  }
})
