import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import test from 'node:test'
import { NextRequest } from 'next/server'
import Stripe from 'stripe'

const require = createRequire(import.meta.url)
const https = require('node:https') as typeof import('node:https')
const originalHttpsRequest = https.request
const originalHttpsGet = https.get
const originalFetch = globalThis.fetch
const originalEnv = {
  payloadUrl: process.env.PAYLOAD_PUBLIC_URL,
  storefrontSecret: process.env.STOREFRONT_API_SECRET,
  stripeSecret: process.env.STRIPE_SECRET_KEY,
}
let externalRequests = 0
https.request = (() => { externalRequests += 1; throw new Error('HTTPS disabled in test') }) as typeof https.request
https.get = https.request as typeof https.get
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
    externalRequests += 1
    return Promise.reject(new Error('Only local HTTP allowed'))
  }
  return originalFetch(input, init)
}) as typeof fetch

test('real checkout handler rejects unlisted product even when active is false and never creates a Stripe session', async () => {
  let stripeSessionCount = 0
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    res.setHeader('content-type', 'application/json')
    if (url.pathname === '/api/orders') {
      res.end(JSON.stringify({ docs: [] }))
      return
    }
    if (url.pathname === '/api/products/1') {
      res.end(JSON.stringify({
        id: 1,
        name: 'Synthetic retired product',
        active: false,
        unlisted: true,
        variants: [{ sku: 'SYNTH-UNLISTED', label: 'Synthetic', price: 10, stockStatus: 'available' }],
      }))
      return
    }
    res.statusCode = 404
    res.end(JSON.stringify({ docs: [] }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  process.env.PAYLOAD_PUBLIC_URL = `http://127.0.0.1:${port}`
  process.env.STOREFRONT_API_SECRET = 'synthetic-test-secret'
  process.env.STRIPE_SECRET_KEY = 'sk_test_synthetic'
  const stripe = new Stripe('sk_test_synthetic')
  const resource = Object.getPrototypeOf(stripe.checkout.sessions) as { create: (params: Stripe.Checkout.SessionCreateParams) => Promise<unknown> }
  const originalCreate = resource.create
  resource.create = async () => {
    stripeSessionCount += 1
    return { id: 'cs_synthetic', url: 'https://stripe.test/session' }
  }

  try {
    const { POST } = await import('./checkout/route')
    const response = await POST(new NextRequest('http://shop.test/api/stripe/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        items: [{ productId: '1', sku: 'SYNTH-UNLISTED', quantity: 1 }],
        customer: { email: 'synthetic@example.invalid', name: 'Test Customer', firstName: 'Test', lastName: 'Customer', country: 'IT', address: 'Via Test 1', city: 'Torino', postalCode: '10100', phone: '+39000000000' },
      }),
    }))
    assert.equal(response.status, 409)
    assert.deepEqual(await response.json(), { error: 'product_unlisted' })
    assert.equal(stripeSessionCount, 0)
    assert.equal(externalRequests, 0)
  } finally {
    resource.create = originalCreate
    await new Promise<void>((resolve) => server.close(() => resolve()))
    if (originalEnv.payloadUrl === undefined) delete process.env.PAYLOAD_PUBLIC_URL
    else process.env.PAYLOAD_PUBLIC_URL = originalEnv.payloadUrl
    if (originalEnv.storefrontSecret === undefined) delete process.env.STOREFRONT_API_SECRET
    else process.env.STOREFRONT_API_SECRET = originalEnv.storefrontSecret
    if (originalEnv.stripeSecret === undefined) delete process.env.STRIPE_SECRET_KEY
    else process.env.STRIPE_SECRET_KEY = originalEnv.stripeSecret
    https.request = originalHttpsRequest
    https.get = originalHttpsGet
    globalThis.fetch = originalFetch
  }
})
