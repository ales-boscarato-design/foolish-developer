import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import test from 'node:test'
import { NextRequest } from 'next/server'
import Stripe from 'stripe'

const originalFetch = globalThis.fetch
const originalPayloadUrl = process.env.PAYLOAD_PUBLIC_URL
const originalStripeKey = process.env.STRIPE_SECRET_KEY

test('subscription checkout requires a resolvable listed CMS plan product before Stripe', async () => {
  let productState: 'listed' | 'unlisted' | 'unavailable' = 'listed'
  let stripeSessions = 0
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json')
    if (productState === 'unavailable') {
      res.statusCode = 503
      res.end(JSON.stringify({ error: 'unavailable' }))
      return
    }
    res.end(JSON.stringify({ docs: [{
      key: 'tattoo',
      product: { id: 1, unlisted: productState === 'unlisted' },
    }] }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  process.env.PAYLOAD_PUBLIC_URL = `http://127.0.0.1:${port}`
  process.env.STRIPE_SECRET_KEY = 'sk_test_synthetic'
  const sessionPrototype = Object.getPrototypeOf(new Stripe('sk_test_synthetic').checkout.sessions) as {
    create: (params: Stripe.Checkout.SessionCreateParams) => Promise<unknown>
  }
  const originalCreate = sessionPrototype.create
  sessionPrototype.create = async () => {
    stripeSessions += 1
    return { id: 'cs_synthetic', url: 'https://stripe.invalid/session' }
  }
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') return Promise.reject(new Error('external network blocked'))
    if (url.pathname === '/api/subscription-plans') assert.equal(init?.cache, 'no-store')
    return originalFetch(input, init)
  }) as typeof fetch

  try {
    const { POST } = await import('./checkout/route')
    const request = () => new NextRequest('http://shop.test/api/subscribe/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plan: 'tattoo', zone: 'IT', email: 'test@example.invalid', locale: 'it' }),
    })
    const listed = await POST(request())
    assert.equal(listed.status, 200)
    assert.deepEqual(await listed.json(), { checkoutUrl: 'https://stripe.invalid/session' })
    assert.equal(stripeSessions, 1)

    productState = 'unlisted'
    const unlisted = await POST(request())
    assert.equal(unlisted.status, 409)
    assert.deepEqual(await unlisted.json(), { error: 'product_unlisted' })
    assert.equal(stripeSessions, 1, 'unlisted product must not create a Stripe session')

    productState = 'unavailable'
    const unavailable = await POST(request())
    assert.equal(unavailable.status, 503)
    assert.equal(stripeSessions, 1, 'unresolvable product must fail closed before Stripe')
  } finally {
    sessionPrototype.create = originalCreate
    globalThis.fetch = originalFetch
    await new Promise<void>((resolve) => server.close(() => resolve()))
    if (originalPayloadUrl === undefined) delete process.env.PAYLOAD_PUBLIC_URL
    else process.env.PAYLOAD_PUBLIC_URL = originalPayloadUrl
    if (originalStripeKey === undefined) delete process.env.STRIPE_SECRET_KEY
    else process.env.STRIPE_SECRET_KEY = originalStripeKey
  }
})
